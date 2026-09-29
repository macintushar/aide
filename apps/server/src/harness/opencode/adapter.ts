import type { StandardSchemaV1 } from "@standard-schema/spec"
import type {
  AideError,
  AuthProvider,
  AideEvent,
  HarnessCapabilities,
  HarnessInventory,
  HarnessModel,
  InstanceAuth,
  InstanceRuntimeStatus,
  McpServerConfig,
  McpServerStatus,
  OptionDescriptor,
  SelectOption,
} from "@workspace/contracts"

import { createEventBus, type EventBus } from "../event-bus"
import type {
  ActiveTurnInput,
  DiscoverInput,
  DisposeInput,
  HarnessAdapter,
  HarnessEventsInput,
  HealthInput,
  InputResponseInput,
  InstanceHandle,
  InstanceHealth,
  InterruptTurnInput,
  McpStatusInput,
  NativeSession,
  OpenSessionInput,
  PermissionResponseInput,
  ResumeSessionInput,
  SendTurnInput,
  SetMcpServersInput,
  StartInstanceInput,
  SteerTurnInput,
  StopInstanceInput,
} from "../types"
import {
  createOpencodeRuntime,
  type OpencodeAgent,
  type OpencodeMcpConfig,
  type OpencodeMcpServer,
  type OpencodeIntegration,
  type OpencodeModel,
  type OpencodeProviderInfo,
  type OpencodeRuntime,
  type OpencodeRuntimeFactory,
} from "./client"
import {
  isCompatibleRuntimeVersion,
  opencodeConfigSchema,
  PINNED_OPENCODE_SDK_VERSION,
  type OpencodeInstanceConfig,
} from "./config"
import {
  createOpencodeSessionRuntime,
  OpencodeRuntimeFailure,
  type OpencodeSessionRuntime,
} from "./session"

/**
 * OpenCode v2 adapter. The SDK boundary is isolated in this directory; Aide's
 * core only sees normalized inventory, sessions, requests, parts, and events.
 */

export class OpencodeAdapterError extends Error {
  readonly aideError: AideError

  constructor(aideError: AideError) {
    super(aideError.message)
    this.name = "OpencodeAdapterError"
    this.aideError = aideError
  }
}

function adapterError(
  code: string,
  message: string,
  instanceId: string,
  retryable = false,
  detail?: unknown
): OpencodeAdapterError {
  return new OpencodeAdapterError({
    code,
    message,
    instanceId,
    retryable,
    ...(detail === undefined ? {} : { detail }),
  })
}

const CAPABILITIES: HarnessCapabilities = {
  // Project configuration changes the available agents and models, so inventory
  // is per instance *and* per project directory.
  inventoryScope: "directory",
  agentSelection: true,
  // OpenCode expresses modes as agents, so it reports no separate mode axis.
  interactionModes: [],
  sessionModelSwitch: "in-session",
  steer: true,
  interrupt: true,
  permissions: true,
  userInput: true,
  reasoningParts: true,
  mcp: {
    stdio: true,
    http: true,
    sse: true,
    // No in-process hosting: an Aide toolset reaches OpenCode over a
    // loopback-bound HTTP endpoint instead.
    inProcess: false,
    runtimeReconfigure: true,
  },
  commands: true,
  skills: true,
  subagents: true,
  usage: true,
}

type StartedInstance = {
  instanceId: string
  config: OpencodeInstanceConfig
  status: InstanceRuntimeStatus
  version?: string
  /** One host or client per instance; every call names its own directory. */
  runtime: Promise<OpencodeRuntime> | undefined
  /**
   * Directories this instance has served. OpenCode scopes MCP configuration
   * to a directory, so each one gets the instance's servers on first use.
   */
  directories: Set<string>
  projectDirectory: string | undefined
  sessions: Map<string, OpencodeSessionRuntime>
  bus: EventBus
  mcpServers: Record<string, McpServerConfig>
  operation: Promise<void>
}

export type OpencodeAdapterOptions = {
  createRuntime?: OpencodeRuntimeFactory
  now?: () => string
  /** How long discovery waits for a directory's built-in plugins to load. */
  warmupMs?: number
}

export function createOpencodeAdapter(
  options: OpencodeAdapterOptions = {}
): HarnessAdapter {
  const createRuntime = options.createRuntime ?? createOpencodeRuntime
  const now = options.now ?? (() => new Date().toISOString())
  const warmupMs = options.warmupMs ?? DEFAULT_WARMUP_MS
  const instances = new Map<string, StartedInstance>()

  let idCounter = 0
  const nextId = (prefix: string) =>
    `${prefix}-${String(++idCounter).padStart(4, "0")}`

  const requireInstance = (handle: InstanceHandle): StartedInstance => {
    const instance = instances.get(handle.instanceId)
    if (!instance) {
      throw adapterError(
        "instance_not_started",
        `OpenCode instance "${handle.instanceId}" is not started`,
        handle.instanceId
      )
    }
    return instance
  }

  const mcpCall = async (
    instance: StartedInstance,
    operation: () => Promise<void>,
    message: string
  ): Promise<void> => {
    try {
      await operation()
    } catch (error) {
      throw adapterError(
        "mcp_reconfigure_failed",
        message,
        instance.instanceId,
        true,
        error instanceof Error ? { message: error.message } : error
      )
    }
  }

  const applyMcpServers = async (
    instance: StartedInstance,
    runtime: OpencodeRuntime,
    directory: string,
    servers: Record<string, McpServerConfig>
  ): Promise<void> => {
    for (const [name, server] of Object.entries(servers)) {
      const config = toOpencodeMcpConfig(server)
      if (!config) continue
      await mcpCall(
        instance,
        () =>
          runtime.api.mcp.add({
            ...location(directory),
            server: name,
            config,
          }),
        `OpenCode could not configure MCP server "${name}"`
      )
    }
  }

  const reconcileMcpServers = async (
    instance: StartedInstance,
    runtime: OpencodeRuntime,
    directory: string,
    previous: Record<string, McpServerConfig>,
    next: Record<string, McpServerConfig>
  ): Promise<void> => {
    for (const name of Object.keys(previous)) {
      if (name in next) continue
      await mcpCall(
        instance,
        () => runtime.api.mcp.remove({ ...location(directory), server: name }),
        `OpenCode could not remove MCP server "${name}"`
      )
    }
    await applyMcpServers(instance, runtime, directory, next)
  }

  const withInstanceLock = async <T>(
    instance: StartedInstance,
    operation: () => Promise<T>
  ): Promise<T> => {
    const previous = instance.operation
    let release!: () => void
    instance.operation = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  /**
   * The instance's runtime, with this directory's MCP servers applied. OpenCode
   * 2 takes the directory on every call, so one host serves every project.
   */
  const runtimeFor = async (
    instance: StartedInstance,
    directory?: string
  ): Promise<OpencodeRuntime> => {
    const key = directory ?? instance.config.directory ?? ""
    return withInstanceLock(instance, async () => {
      instance.runtime ??= createRuntime({
        instanceId: instance.instanceId,
        config: instance.config,
      })
      const runtime = await instance.runtime
      if (!instance.directories.has(key)) {
        await applyMcpServers(instance, runtime, key, instance.mcpServers)
        instance.directories.add(key)
      }
      return runtime
    })
  }

  const readVersion = async (
    instance: StartedInstance,
    runtime: OpencodeRuntime
  ): Promise<string> => {
    try {
      const info = await runtime.api.server.info()
      return runtime.version ?? info.version
    } catch (error) {
      throw adapterError(
        "health_check_failed",
        `OpenCode runtime for "${instance.instanceId}" did not report health`,
        instance.instanceId,
        true,
        error instanceof Error ? { message: error.message } : error
      )
    }
  }

  /** Auth state is read from the model catalog; Aide never holds a credential. */
  const readAuth = async (
    runtime: OpencodeRuntime,
    directory: string | undefined
  ): Promise<InstanceAuth> => {
    try {
      return authFromModels(
        (await runtime.api.model.list(location(directory))).data
      )
    } catch {
      return { status: "unknown" }
    }
  }

  const assertCompatible = (instance: StartedInstance, version: string) => {
    if (instance.config.allowVersionMismatch) return
    if (isCompatibleRuntimeVersion(version)) return
    throw adapterError(
      "harness_version_incompatible",
      `OpenCode runtime ${version} is not compatible with this adapter, which targets SDK ${PINNED_OPENCODE_SDK_VERSION}. Upgrade the runtime, or set allowVersionMismatch to proceed anyway.`,
      instance.instanceId,
      false,
      { version, pinnedSdkVersion: PINNED_OPENCODE_SDK_VERSION }
    )
  }

  const requireSession = (
    handle: InstanceHandle,
    nativeSession: NativeSession
  ): OpencodeSessionRuntime => {
    const instance = requireInstance(handle)
    const session = instance.sessions.get(nativeSession.nativeSessionId)
    if (!session) {
      throw adapterError(
        "native_session_not_found",
        `OpenCode native session "${nativeSession.nativeSessionId}" is not open`,
        handle.instanceId
      )
    }
    return session
  }

  const rethrow = (error: unknown, instanceId: string): never => {
    if (error instanceof OpencodeRuntimeFailure) {
      throw new OpencodeAdapterError(error.aideError)
    }
    if (error instanceof OpencodeAdapterError) throw error
    throw adapterError(
      "opencode_adapter_failed",
      error instanceof Error ? error.message : String(error),
      instanceId,
      true
    )
  }

  const adapter: HarnessAdapter = {
    driver: "opencode",
    configSchema: opencodeConfigSchema as unknown as StandardSchemaV1,

    capabilities() {
      return CAPABILITIES
    },

    async start(input: StartInstanceInput) {
      const parsed = opencodeConfigSchema.safeParse(input.instance.config)
      if (!parsed.success) {
        throw adapterError(
          "invalid_instance_config",
          `OpenCode instance "${input.instance.instanceId}" has invalid config`,
          input.instance.instanceId,
          false,
          parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          }))
        )
      }

      const instance: StartedInstance = {
        instanceId: input.instance.instanceId,
        config: parsed.data,
        status: "starting",
        runtime: undefined,
        directories: new Set(),
        projectDirectory: input.projectDirectory,
        sessions: new Map(),
        bus: createEventBus(),
        mcpServers: {},
        operation: Promise.resolve(),
      }
      instances.set(instance.instanceId, instance)

      try {
        const runtime = await runtimeFor(instance, input.projectDirectory)
        const version = await readVersion(instance, runtime)
        assertCompatible(instance, version)
        instance.version = version
        instance.status = "ready"
      } catch (error) {
        instance.status = "failed"
        await closeRuntimes(instance)
        instances.delete(instance.instanceId)
        throw error
      }

      return { instanceId: instance.instanceId, driver: "opencode" }
    },

    async stop(input: StopInstanceInput) {
      const instance = instances.get(input.handle.instanceId)
      if (!instance) return
      instance.status = "stopped"
      await Promise.all(
        [...instance.sessions.values()].map((session) =>
          session.close().catch(() => undefined)
        )
      )
      instance.sessions.clear()
      await closeRuntimes(instance)
      instance.bus.close()
      instances.delete(instance.instanceId)
    },

    async health(input: HealthInput): Promise<InstanceHealth> {
      const instance = instances.get(input.handle.instanceId)
      if (!instance) {
        return {
          status: "stopped",
          installed: true,
          auth: { status: "unknown" },
        }
      }

      try {
        const runtime = await runtimeFor(instance)
        const version = await readVersion(instance, runtime)
        instance.version = version
        return {
          status: instance.status,
          version,
          installed: true,
          auth: await readAuth(runtime, instance.projectDirectory),
        }
      } catch (error) {
        return {
          status: "degraded",
          ...(instance.version ? { version: instance.version } : {}),
          installed: true,
          auth: { status: "unknown" },
          error: toAideError(error, instance.instanceId),
        }
      }
    },

    async discover(input: DiscoverInput): Promise<HarnessInventory> {
      const instance = requireInstance(input.handle)
      const runtime = await runtimeFor(instance, input.directory)

      const scope = location(input.directory)
      let catalog: OpencodeModel[]
      let defaultModel: OpencodeModel | null
      let agents: OpencodeAgent[]
      let commands: Array<{ name: string; description?: string }>
      let skills: Array<{ id: string; name: string; description?: string }>
      let providers: OpencodeProviderInfo[]
      let integrations: OpencodeIntegration[]
      try {
        agents = await warmAgents(runtime, scope, warmupMs)
        ;[catalog, defaultModel, commands, skills, providers, integrations] =
          await Promise.all([
            runtime.api.model.list(scope).then((result) => result.data),
            runtime.api.model.default(scope).then((result) => result.data),
            runtime.api.command
              .list(scope)
              .then((result) => result.data)
              .catch(() => []),
            runtime.api.skill
              .list(scope)
              .then((result) => result.data)
              .catch(() => []),
            runtime.api.provider
              .list(scope)
              .then((result) => result.data)
              .catch(() => []),
            runtime.api.integration
              .list(scope)
              .then((result) => result.data)
              .catch(() => []),
          ])
      } catch (error) {
        throw adapterError(
          "inventory_discovery_failed",
          `OpenCode inventory discovery failed for "${instance.instanceId}"`,
          instance.instanceId,
          true,
          error instanceof Error ? { message: error.message } : error
        )
      }

      const models = catalog
        .filter((model) => model.enabled)
        .map((model) => toHarnessModel(model, defaultModel))

      return {
        instanceId: instance.instanceId,
        driver: "opencode",
        revision: inventoryRevision(models, agents, [
          ...commands.map((command) => `/${command.name}`),
          ...skills.map((skill) => `skill:${skill.id}`),
        ]),
        discoveredAt: now(),
        stale: false,
        capabilities: CAPABILITIES,
        auth: {
          ...authFromModels(catalog),
          providers: authProviders(providers, integrations),
        },
        commands: commands.map((command) => ({
          name: command.name,
          ...(command.description ? { description: command.description } : {}),
        })),
        skills: skills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          ...(skill.description ? { description: skill.description } : {}),
        })),
        models,
        agents: toAgentOptions(agents),
        // OpenCode has no mode axis distinct from agents.
        interactionModes: [],
      }
    },

    async openSession(input: OpenSessionInput) {
      const instance = requireInstance(input.handle)
      const runtime = await runtimeFor(instance, input.projectDirectory)
      const providerID = input.execution.selection.model.providerId
      if (!providerID) {
        throw adapterError(
          "invalid_execution_selection",
          "OpenCode model selection requires providerId",
          instance.instanceId
        )
      }
      const model = {
        id: input.execution.selection.model.modelId,
        providerID,
        ...(input.execution.selection.options.variant
          ? { variant: input.execution.selection.options.variant }
          : {}),
      }
      let created
      try {
        created = await runtime.api.session.create({
          ...(input.execution.selection.agent
            ? { agent: input.execution.selection.agent }
            : {}),
          model,
          location: { directory: input.projectDirectory },
        })
      } catch (error) {
        throw adapterError(
          "native_session_create_failed",
          `OpenCode could not create a session for "${input.sessionId}"`,
          instance.instanceId,
          true,
          error instanceof Error ? { message: error.message } : error
        )
      }
      try {
        const session = await createOpencodeSessionRuntime({
          instanceId: instance.instanceId,
          aideSessionId: input.sessionId,
          projectDirectory: input.projectDirectory,
          api: runtime.api,
          session: created,
          mcpServerNames: Object.keys(instance.mcpServers),
          now,
          nextId,
        })
        instance.sessions.set(session.native.nativeSessionId, session)
        return session.native
      } catch (error) {
        return rethrow(error, instance.instanceId)
      }
    },

    async resumeSession(input: ResumeSessionInput) {
      const instance = requireInstance(input.handle)
      const live = instance.sessions.get(input.nativeSessionId)
      if (live) return live.native

      const runtime = await runtimeFor(instance, instance.projectDirectory)
      let info
      try {
        info = await runtime.api.session.get({
          sessionID: input.nativeSessionId,
        })
      } catch (error) {
        throw adapterError(
          "native_session_not_resumable",
          `OpenCode native session "${input.nativeSessionId}" is not available`,
          instance.instanceId,
          true,
          error instanceof Error ? { message: error.message } : error
        )
      }
      const scopedRuntime = await runtimeFor(instance, info.location.directory)
      try {
        const session = await createOpencodeSessionRuntime({
          instanceId: instance.instanceId,
          aideSessionId: input.sessionId,
          projectDirectory: info.location.directory,
          api: scopedRuntime.api,
          session: info,
          ...(input.resumeCursor ? { resumeCursor: input.resumeCursor } : {}),
          ...(input.activeTurn ? { activeTurn: input.activeTurn } : {}),
          mcpServerNames: Object.keys(instance.mcpServers),
          now,
          nextId,
        })
        instance.sessions.set(session.native.nativeSessionId, session)
        return session.native
      } catch (error) {
        return rethrow(error, instance.instanceId)
      }
    },

    async send(input: SendTurnInput) {
      const session = requireSession(input.handle, input.nativeSession)
      try {
        await session.send({
          turnId: input.turnId,
          commandId: input.commandId,
          userMessage: input.userMessage,
          execution: input.execution,
          ...(input.handoff ? { handoff: input.handoff } : {}),
        })
      } catch (error) {
        rethrow(error, input.handle.instanceId)
      }
    },

    async steer(input: SteerTurnInput) {
      const session = requireSession(input.handle, input.nativeSession)
      try {
        await session.steer(input.turnId, input.message)
      } catch (error) {
        rethrow(error, input.handle.instanceId)
      }
    },

    async activeTurn(input: ActiveTurnInput) {
      const session = requireSession(input.handle, input.nativeSession)
      const turnId = await session.activeTurnId()
      return turnId ? { turnId } : undefined
    },

    async interrupt(input: InterruptTurnInput) {
      const session = requireSession(input.handle, input.nativeSession)
      try {
        await session.interrupt(input.turnId)
      } catch (error) {
        rethrow(error, input.handle.instanceId)
      }
    },

    async respondToPermission(input: PermissionResponseInput) {
      if (input.request.kind !== "permission") {
        throw adapterError(
          "request_kind_mismatch",
          "respondToPermission requires a permission request",
          input.handle.instanceId
        )
      }
      const session = requireSession(input.handle, input.nativeSession)
      try {
        await session.respondToPermission(input.request)
      } catch (error) {
        rethrow(error, input.handle.instanceId)
      }
    },

    async respondToInput(input: InputResponseInput) {
      if (input.request.kind !== "input") {
        throw adapterError(
          "request_kind_mismatch",
          "respondToInput requires an input request",
          input.handle.instanceId
        )
      }
      const session = requireSession(input.handle, input.nativeSession)
      try {
        await session.respondToInput(input.request)
      } catch (error) {
        rethrow(error, input.handle.instanceId)
      }
    },

    async setMcpServers(input: SetMcpServersInput) {
      const instance = requireInstance(input.handle)
      await withInstanceLock(instance, async () => {
        const previous = instance.mcpServers
        const runtime = instance.runtime ? await instance.runtime : undefined
        const runtimes: Array<[string, OpencodeRuntime]> = runtime
          ? [...instance.directories].map((directory) => [directory, runtime])
          : []
        try {
          for (const [directory, runtime] of runtimes) {
            await reconcileMcpServers(
              instance,
              runtime,
              directory,
              previous,
              input.servers
            )
          }
        } catch (error) {
          const rollback = await Promise.allSettled(
            runtimes.map(([directory, runtime]) =>
              reconcileMcpServers(
                instance,
                runtime,
                directory,
                input.servers,
                previous
              )
            )
          )
          const rollbackErrors = rollback.flatMap((result) =>
            result.status === "rejected" ? [result.reason] : []
          )
          if (rollbackErrors.length > 0) {
            throw adapterError(
              "mcp_rollback_failed",
              "OpenCode MCP reconfiguration failed and the previous configuration could not be fully restored",
              instance.instanceId,
              true,
              { cause: error, rollbackErrors }
            )
          }
          throw error
        }
        instance.mcpServers = { ...input.servers }
        const names = Object.keys(instance.mcpServers)
        for (const session of instance.sessions.values()) {
          session.setMcpServerNames(names)
        }
      })
    },

    async mcpStatus(input: McpStatusInput): Promise<McpServerStatus[]> {
      const instance = requireInstance(input.handle)
      const runtime = await runtimeFor(instance, instance.projectDirectory)
      let servers: OpencodeMcpServer[]
      try {
        servers = (
          await runtime.api.mcp.list(location(instance.projectDirectory))
        ).data
      } catch {
        return Object.keys(instance.mcpServers).map((name) => ({
          name,
          connected: false,
          error: {
            code: "mcp_status_unavailable",
            message: `OpenCode did not report MCP status for "${name}"`,
            instanceId: instance.instanceId,
            retryable: true,
          },
        }))
      }
      const byName = new Map(servers.map((server) => [server.name, server]))
      return Object.keys(instance.mcpServers).map((name) =>
        toMcpServerStatus(instance.instanceId, name, byName.get(name)?.status)
      )
    },

    events(input: HarnessEventsInput): AsyncIterable<AideEvent> {
      const instance = requireInstance(input.handle)
      if (!input.nativeSession) return instance.bus.subscribe()
      return requireSession(input.handle, input.nativeSession).events()
    },

    async dispose(input: DisposeInput) {
      await adapter.stop({ handle: input.handle })
    },
  }

  return adapter
}

const DEFAULT_WARMUP_MS = 10_000
const WARMUP_POLL_MS = 250

/**
 * OpenCode loads a directory's built-in plugins in the background the first
 * time the directory is used, and until they load it lists no agents, models,
 * commands, or skills. Every OpenCode location has built-in agents once warm,
 * so an empty agent list means "not loaded yet" rather than "none".
 */
async function warmAgents(
  runtime: OpencodeRuntime,
  scope: { location?: { directory: string } },
  budgetMs: number
): Promise<OpencodeAgent[]> {
  const deadline = Date.now() + budgetMs
  while (true) {
    const agents = (await runtime.api.agent.list(scope)).data
    if (agents.length > 0 || Date.now() >= deadline) return agents
    await new Promise((resolve) => setTimeout(resolve, WARMUP_POLL_MS))
  }
}

/** OpenCode's per-call location argument; the empty directory is the default. */
function location(directory: string | undefined): {
  location?: { directory: string }
} {
  return directory ? { location: { directory } } : {}
}

function toOpencodeMcpConfig(
  server: McpServerConfig
): OpencodeMcpConfig | undefined {
  switch (server.type) {
    case "stdio":
      return {
        type: "local",
        command: [server.command, ...(server.args ?? [])],
        ...(server.env ? { environment: server.env } : {}),
      }
    case "http":
    case "sse":
      return {
        type: "remote",
        url: server.url,
        ...(server.headers ? { headers: server.headers } : {}),
        // Aide has no browser callback surface for OpenCode's remote OAuth.
        oauth: false,
      }
    case "aide":
      return undefined
  }
}

function toMcpServerStatus(
  instanceId: string,
  name: string,
  status: OpencodeMcpServer["status"] | undefined
): McpServerStatus {
  if (status?.status === "connected") return { name, connected: true }
  const code =
    status?.status === "needs_auth"
      ? "mcp_authentication_unsupported"
      : status?.status === "failed"
        ? "mcp_connection_failed"
        : status?.status === "disabled"
          ? "mcp_disabled"
          : status?.status === "pending"
            ? "mcp_connecting"
            : "mcp_status_unavailable"
  const message =
    status?.status === "needs_auth"
      ? `MCP server "${name}" requires OAuth authentication, which this OpenCode adapter cannot complete`
      : status?.status === "failed"
        ? status.error
        : `MCP server "${name}" is ${status?.status ?? "unavailable"}`
  return {
    name,
    connected: false,
    error: {
      code,
      message,
      instanceId,
      retryable:
        status?.status === "failed" ||
        status?.status === "pending" ||
        status === undefined,
    },
  }
}

async function closeRuntimes(instance: StartedInstance): Promise<void> {
  const pending = instance.runtime
  instance.runtime = undefined
  instance.directories.clear()
  if (!pending) return
  const runtime = await pending.catch(() => undefined)
  await Promise.resolve(runtime?.close?.()).catch(() => undefined)
}

/**
 * Model variants come from SDK model metadata and are exposed as an
 * `OptionDescriptor` with id `variant` — options are per model, because one
 * model may offer variants while another does not.
 */
function variantDescriptor(model: OpencodeModel): OptionDescriptor[] {
  const names = model.variants.map((variant) => variant.id)
  if (names.length === 0) return []
  const options: SelectOption[] = names.map((name, index) => ({
    id: name,
    label: name,
    ...(index === 0 ? { isDefault: true } : {}),
  }))
  return [
    {
      id: "variant",
      label: "Variant",
      type: "select",
      options,
      defaultValue: names[0],
    },
  ]
}

function toHarnessModel(
  model: OpencodeModel,
  defaultModel: OpencodeModel | null
): HarnessModel {
  return {
    providerId: model.providerID,
    modelId: model.id,
    displayName: model.name,
    ...(defaultModel?.id === model.id &&
    defaultModel.providerID === model.providerID
      ? { isDefault: true }
      : {}),
    optionDescriptors: variantDescriptor(model),
  }
}

/** Only agents the main loop can run are composer selections; subagents are a different axis. */
function toAgentOptions(agents: OpencodeAgent[]): SelectOption[] {
  return agents
    .filter((agent) => !agent.hidden && agent.mode !== "subagent")
    .map((agent, index) => ({
      id: agent.id,
      label: agent.name,
      ...(index === 0 ? { isDefault: true } : {}),
    }))
}

/**
 * Auth is surfaced, never stored or proxied. OpenCode lists models only for
 * providers it can use (a connected credential, or a provider that needs
 * none), so each provider in the catalog counts as authenticated.
 */
function authFromModels(models: OpencodeModel[]): InstanceAuth {
  if (models.length === 0) {
    return {
      status: "unauthenticated",
      type: "opencode",
      label: "No providers configured",
    }
  }
  const providers = [
    ...new Set(
      models.filter((model) => model.enabled).map((model) => model.providerID)
    ),
  ].sort()
  if (providers.length === 0) {
    return {
      status: "unauthenticated",
      type: "opencode",
      label: "No authenticated providers",
    }
  }
  return {
    status: "authenticated",
    type: "opencode",
    label: `${providers.length} provider${providers.length === 1 ? "" : "s"}`,
    account: providers.join(","),
  }
}

/**
 * The providers OpenCode can use, and how each one is connected. A provider
 * with no stored credential or environment variable (OpenCode's own, for one)
 * is still listed: it is usable, just not through anything the user set up.
 */
function authProviders(
  providers: OpencodeProviderInfo[],
  integrations: OpencodeIntegration[]
): AuthProvider[] {
  const byId = new Map(integrations.map((entry) => [entry.id, entry]))
  return providers
    .filter((provider) => provider.activation !== "disabled")
    .map((provider) => {
      const connection = byId.get(provider.integrationID ?? provider.id)
        ?.connections[0]
      return {
        id: provider.id,
        label: provider.name,
        connected: true,
        ...(connection
          ? {
              method:
                connection.type === "env"
                  ? `env:${connection.name}`
                  : connection.method,
            }
          : {}),
      }
    })
}

/**
 * A stable digest of what the composer can offer. It changes exactly when the
 * selectable surface changes, so a revision comparison is a meaningful cache
 * check.
 */
function inventoryRevision(
  models: HarnessModel[],
  agents: OpencodeAgent[],
  invocables: string[] = []
): string {
  const surface = JSON.stringify({
    models: models
      .map((model) => `${model.providerId ?? ""}/${model.modelId}`)
      .sort(),
    agents: agents.map((agent) => agent.id).sort(),
    ...(invocables.length > 0 ? { invocables: [...invocables].sort() } : {}),
  })
  let hash = 5381
  for (let index = 0; index < surface.length; index += 1) {
    hash = ((hash << 5) + hash + surface.charCodeAt(index)) >>> 0
  }
  return `opencode-${hash.toString(16)}`
}

function toAideError(error: unknown, instanceId: string): AideError {
  if (error instanceof OpencodeAdapterError) return error.aideError
  return {
    code: "opencode_adapter_error",
    message: error instanceof Error ? error.message : String(error),
    instanceId,
    retryable: true,
  }
}
