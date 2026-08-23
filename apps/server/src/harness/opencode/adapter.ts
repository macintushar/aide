import type { StandardSchemaV1 } from "@standard-schema/spec"
import type {
  AideError,
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
  StopInstanceInput,
} from "../types"
import {
  createOpencodeRuntime,
  type OpencodeAgent,
  type OpencodeModel,
  type OpencodeProvider,
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
}

type StartedInstance = {
  instanceId: string
  config: OpencodeInstanceConfig
  status: InstanceRuntimeStatus
  version?: string
  /** Directory-scoped runtimes; the empty key is the instance default. */
  runtimes: Map<string, OpencodeRuntime>
  projectDirectory: string | undefined
  sessions: Map<string, OpencodeSessionRuntime>
  bus: EventBus
  mcpServers: Record<string, McpServerConfig>
  operation: Promise<void>
}

export type OpencodeAdapterOptions = {
  createRuntime?: OpencodeRuntimeFactory
  now?: () => string
}

export function createOpencodeAdapter(
  options: OpencodeAdapterOptions = {}
): HarnessAdapter {
  const createRuntime = options.createRuntime ?? createOpencodeRuntime
  const now = options.now ?? (() => new Date().toISOString())
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

  const applyMcpServers = async (
    instance: StartedInstance,
    runtime: OpencodeRuntime,
    directory: string,
    servers: Record<string, McpServerConfig>
  ): Promise<void> => {
    if (!runtime.api.mcp) return
    for (const [name, server] of Object.entries(servers)) {
      const config = toOpencodeMcpConfig(server)
      if (!config) continue
      const result = await runtime.api.mcp.add({
        ...(directory ? { directory } : {}),
        name,
        config,
      })
      if (result.error) {
        throw adapterError(
          "mcp_reconfigure_failed",
          `OpenCode could not configure MCP server "${name}"`,
          instance.instanceId,
          true,
          result.error
        )
      }
    }
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
   * A changed working directory gets its own client. Sessions and inventory are
   * scoped to the selected project directory, and OpenCode resolves project
   * configuration from it.
   */
  const runtimeFor = async (
    instance: StartedInstance,
    directory?: string
  ): Promise<OpencodeRuntime> => {
    const key = directory ?? instance.config.directory ?? ""
    return withInstanceLock(instance, async () => {
      const current = instance.runtimes.get(key)
      if (current) return current
      const runtime = await createRuntime({
        config: instance.config,
        ...(key ? { directory: key } : {}),
      })
      try {
        await applyMcpServers(instance, runtime, key, instance.mcpServers)
        instance.runtimes.set(key, runtime)
        return runtime
      } catch (error) {
        await Promise.resolve(runtime.close?.()).catch(() => undefined)
        throw error
      }
    })
  }

  const readVersion = async (
    instance: StartedInstance,
    runtime: OpencodeRuntime
  ): Promise<string> => {
    const result = await runtime.api.global.health()
    if (result.error || !result.data) {
      throw adapterError(
        "health_check_failed",
        `OpenCode runtime for "${instance.instanceId}" did not report health`,
        instance.instanceId,
        true,
        result.error
      )
    }
    return result.data.version
  }

  /** Auth state is read from the provider list; Aide never holds a credential. */
  const readAuth = async (
    instance: StartedInstance,
    runtime: OpencodeRuntime
  ): Promise<InstanceAuth> => {
    const result = await runtime.api.config.providers({})
    if (result.error || !result.data) return { status: "unknown" }
    return authFromProviders(result.data.providers)
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
        runtimes: new Map(),
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
          auth: await readAuth(instance, runtime),
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

      const [providersResult, agentsResult] = await Promise.all([
        runtime.api.config.providers(
          input.directory ? { directory: input.directory } : {}
        ),
        runtime.api.app.agents(
          input.directory ? { directory: input.directory } : {}
        ),
      ])

      if (providersResult.error || !providersResult.data) {
        throw adapterError(
          "inventory_discovery_failed",
          `OpenCode provider discovery failed for "${instance.instanceId}"`,
          instance.instanceId,
          true,
          providersResult.error
        )
      }
      if (agentsResult.error || !agentsResult.data) {
        throw adapterError(
          "inventory_discovery_failed",
          `OpenCode agent discovery failed for "${instance.instanceId}"`,
          instance.instanceId,
          true,
          agentsResult.error
        )
      }

      const providers = providersResult.data.providers
      const defaults = providersResult.data.default ?? {}
      const models = providers.flatMap((provider) =>
        Object.values(provider.models).map((model) =>
          toHarnessModel(provider, model, defaults[provider.id])
        )
      )

      return {
        instanceId: instance.instanceId,
        driver: "opencode",
        revision: inventoryRevision(models, agentsResult.data),
        discoveredAt: now(),
        stale: false,
        capabilities: CAPABILITIES,
        auth: authFromProviders(providers),
        models,
        agents: toAgentOptions(agentsResult.data),
        // OpenCode has no mode axis distinct from agents.
        interactionModes: [],
      }
    },

    async openSession(input: OpenSessionInput) {
      const instance = requireInstance(input.handle)
      const runtime = await runtimeFor(instance, input.projectDirectory)
      const sessionApi = runtime.api.v2?.session
      if (!sessionApi) {
        throw adapterError(
          "opencode_v2_unavailable",
          "The connected OpenCode runtime does not expose the pinned v2 session API",
          instance.instanceId
        )
      }
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
      const created = await sessionApi.create({
        ...(input.execution.selection.agent
          ? { agent: input.execution.selection.agent }
          : {}),
        model,
        location: { directory: input.projectDirectory },
      })
      if (created.error || !created.data?.data) {
        throw adapterError(
          "native_session_create_failed",
          `OpenCode could not create a session for "${input.sessionId}"`,
          instance.instanceId,
          true,
          created.error
        )
      }
      try {
        const session = await createOpencodeSessionRuntime({
          instanceId: instance.instanceId,
          aideSessionId: input.sessionId,
          projectDirectory: input.projectDirectory,
          api: runtime.api,
          session: created.data.data,
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
      const sessionApi = runtime.api.v2?.session
      if (!sessionApi) {
        throw adapterError(
          "opencode_v2_unavailable",
          "The connected OpenCode runtime does not expose the pinned v2 session API",
          instance.instanceId
        )
      }
      const inspected = await sessionApi.get({
        sessionID: input.nativeSessionId,
      })
      if (inspected.error || !inspected.data?.data) {
        throw adapterError(
          "native_session_not_resumable",
          `OpenCode native session "${input.nativeSessionId}" is not available`,
          instance.instanceId,
          true,
          inspected.error
        )
      }
      const info = inspected.data.data
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
        const removed = Object.keys(instance.mcpServers).filter(
          (name) => !(name in input.servers)
        )
        await Promise.all(
          [...instance.runtimes.entries()].map(async ([directory, runtime]) => {
            if (!runtime.api.mcp) return
            for (const name of removed) {
              const result = await runtime.api.mcp.disconnect({
                name,
                ...(directory ? { directory } : {}),
              })
              if (result.error) {
                throw adapterError(
                  "mcp_reconfigure_failed",
                  `OpenCode could not disconnect MCP server "${name}"`,
                  instance.instanceId,
                  true,
                  result.error
                )
              }
            }
            await applyMcpServers(instance, runtime, directory, input.servers)
          })
        )
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
      const result = await runtime.api.mcp?.status(
        instance.projectDirectory
          ? { directory: instance.projectDirectory }
          : undefined
      )
      if (!result || result.error || !result.data) {
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
      return Object.keys(instance.mcpServers).map((name) =>
        toMcpServerStatus(instance.instanceId, name, result.data![name])
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

function toOpencodeMcpConfig(server: McpServerConfig):
  | {
      type: "local"
      command: string[]
      environment?: Record<string, string>
    }
  | {
      type: "remote"
      url: string
      headers?: Record<string, string>
      oauth: false
    }
  | undefined {
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
  status:
    | { status: "connected" | "disabled" | "needs_auth" }
    | { status: "failed" | "needs_client_registration"; error: string }
    | undefined
): McpServerStatus {
  if (status?.status === "connected") return { name, connected: true }
  const code =
    status?.status === "needs_auth" ||
    status?.status === "needs_client_registration"
      ? "mcp_authentication_unsupported"
      : status?.status === "failed"
        ? "mcp_connection_failed"
        : status?.status === "disabled"
          ? "mcp_disabled"
          : "mcp_status_unavailable"
  const message =
    status?.status === "needs_auth" ||
    status?.status === "needs_client_registration"
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
      retryable: status?.status === "failed" || status === undefined,
    },
  }
}

async function closeRuntimes(instance: StartedInstance): Promise<void> {
  const runtimes = [...instance.runtimes.values()]
  instance.runtimes.clear()
  await Promise.all(
    runtimes.map((runtime) =>
      Promise.resolve(runtime.close?.()).catch(() => undefined)
    )
  )
}

/**
 * Model variants come from SDK model metadata and are exposed as an
 * `OptionDescriptor` with id `variant` — options are per model, because one
 * model may offer variants while another does not.
 */
function variantDescriptor(model: OpencodeModel): OptionDescriptor[] {
  const names = Object.keys(model.variants ?? {})
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
  provider: OpencodeProvider,
  model: OpencodeModel,
  providerDefault: string | undefined
): HarnessModel {
  return {
    providerId: provider.id,
    modelId: model.id,
    displayName: model.name,
    ...(providerDefault === model.id ? { isDefault: true } : {}),
    optionDescriptors: variantDescriptor(model),
  }
}

/** Only agents the main loop can run are composer selections; subagents are a different axis. */
function toAgentOptions(agents: OpencodeAgent[]): SelectOption[] {
  return agents
    .filter((agent) => !agent.hidden && agent.mode !== "subagent")
    .map((agent, index) => ({
      id: agent.name,
      label: agent.name,
      ...(index === 0 ? { isDefault: true } : {}),
    }))
}

/**
 * Auth is surfaced, never stored or proxied. A provider counts as authenticated
 * when OpenCode reports a resolved credential for it.
 */
function authFromProviders(providers: OpencodeProvider[]): InstanceAuth {
  const authenticated = providers.filter(
    (provider) => Boolean(provider.key) || (provider.env?.length ?? 0) > 0
  )
  if (providers.length === 0) {
    return {
      status: "unauthenticated",
      type: "opencode",
      label: "No providers configured",
    }
  }
  if (authenticated.length === 0) {
    return {
      status: "unauthenticated",
      type: "opencode",
      label: "No authenticated providers",
    }
  }
  return {
    status: "authenticated",
    type: "opencode",
    label: `${authenticated.length} provider${authenticated.length === 1 ? "" : "s"}`,
    account: authenticated.map((provider) => provider.id).join(","),
  }
}

/**
 * A stable digest of what the composer can offer. It changes exactly when the
 * selectable surface changes, so a revision comparison is a meaningful cache
 * check.
 */
function inventoryRevision(
  models: HarnessModel[],
  agents: OpencodeAgent[]
): string {
  const surface = JSON.stringify({
    models: models
      .map((model) => `${model.providerId ?? ""}/${model.modelId}`)
      .sort(),
    agents: agents.map((agent) => agent.name).sort(),
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
