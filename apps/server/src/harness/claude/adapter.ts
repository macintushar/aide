import { randomUUID } from "node:crypto"

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
  createClaudeRuntime,
  ClaudeRuntimeFailure,
  type ClaudeRuntime,
} from "./session"
import {
  claudeConfigSchema,
  DEFAULT_STARTUP_TIMEOUT_MS,
  isCompatibleRuntimeVersion,
  PINNED_CLAUDE_SDK_VERSION,
  type ClaudeInstanceConfig,
} from "./config"
import {
  createClaudeSession,
  type ClaudeAccountInfo,
  type ClaudeModelInfo,
  type ClaudeSession,
  type ClaudeSessionFactory,
} from "./query"

/**
 * Claude Agent SDK adapter — lifecycle, configuration, and discovery.
 *
 * Structurally different from the OpenCode adapter, which is the point: it is
 * what proves the Aide contract is harness-neutral. The difference that shows
 * up already in Wave 2 is that inventory is runtime-scoped — there is no way to
 * ask what models exist without a live query, so `start` opens one and holds it.
 *
 * The send path holds a second live query per Aide session — see `session.ts`,
 * which owns part synthesis, the `canUseTool` inversion, and the effort reopen.
 */

export class ClaudeAdapterError extends Error {
  readonly aideError: AideError

  constructor(aideError: AideError) {
    super(aideError.message)
    this.name = "ClaudeAdapterError"
    this.aideError = aideError
  }
}

function adapterError(
  code: string,
  message: string,
  instanceId: string,
  retryable = false,
  detail?: unknown
): ClaudeAdapterError {
  return new ClaudeAdapterError({
    code,
    message,
    instanceId,
    retryable,
    ...(detail === undefined ? {} : { detail }),
  })
}

const INTERACTION_MODES: SelectOption[] = [
  { id: "build", label: "Build", isDefault: true },
  { id: "plan", label: "Plan" },
]

const CAPABILITIES: HarnessCapabilities = {
  // supportedModels()/supportedAgents() are methods on a live Query.
  inventoryScope: "runtime",
  // options.agents defines subagents the main loop delegates to; that is a
  // different axis and is not a composer control.
  agentSelection: false,
  interactionModes: INTERACTION_MODES,
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
    // createSdkMcpServer() hosts an Aide toolset with no subprocess.
    inProcess: true,
    runtimeReconfigure: true,
  },
}

const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const

type StartedInstance = {
  instanceId: string
  config: ClaudeInstanceConfig
  status: InstanceRuntimeStatus
  projectDirectory: string | undefined
  /** Learned from the first turn's `system/init`; unknown until then. */
  runtimeVersion: string | undefined
  error: AideError | undefined
  /** The inventory query: `supportedModels()` only exists on a live `Query`. */
  session: ClaudeSession
  bus: EventBus
  /** One runtime, and therefore one more live query, per Aide session. */
  runtimes: Map<string, ClaudeRuntime>
  mcpServers: Record<string, McpServerConfig>
}

export type ClaudeAdapterOptions = {
  createSession?: ClaudeSessionFactory
  now?: () => string
}

export function createClaudeAdapter(
  options: ClaudeAdapterOptions = {}
): HarnessAdapter {
  const createSession = options.createSession ?? createClaudeSession
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
        `Claude instance "${handle.instanceId}" is not started`,
        handle.instanceId
      )
    }
    return instance
  }

  const requireRuntime = (
    handle: InstanceHandle,
    nativeSession: NativeSession
  ): ClaudeRuntime => {
    const instance = requireInstance(handle)
    const runtime = instance.runtimes.get(nativeSession.nativeSessionId)
    if (!runtime) {
      throw adapterError(
        "native_session_not_found",
        `Claude native session "${nativeSession.nativeSessionId}" is not open`,
        handle.instanceId
      )
    }
    return runtime
  }

  /**
   * The runtime version only reaches us on a turn's `system/init`, so the
   * compatibility gate runs here rather than at start. An incompatible runtime
   * degrades the instance and surfaces the reason instead of failing the turn
   * that just revealed it — the user cannot act on it mid-turn, and the turn
   * itself may well succeed.
   */
  const noteRuntimeVersion = (
    instance: StartedInstance,
    version: string
  ): string | undefined => {
    if (instance.runtimeVersion === version) return instance.error?.message
    instance.runtimeVersion = version
    if (instance.config.allowVersionMismatch) return undefined
    if (isCompatibleRuntimeVersion(version)) {
      if (instance.status === "degraded") {
        instance.status = "ready"
        instance.error = undefined
      }
      return undefined
    }
    const message = `Claude Code ${version} is not compatible with this adapter, which targets SDK ${PINNED_CLAUDE_SDK_VERSION}. Upgrade the runtime, or set allowVersionMismatch to proceed anyway.`
    instance.status = "degraded"
    instance.error = {
      code: "harness_version_incompatible",
      message,
      instanceId: instance.instanceId,
      retryable: false,
      detail: { version, pinnedSdkVersion: PINNED_CLAUDE_SDK_VERSION },
    }
    return message
  }

  /** Adapter failures raised deeper in the runtime already carry an AideError. */
  const rethrow = (error: unknown, instanceId: string): never => {
    if (error instanceof ClaudeRuntimeFailure) {
      throw new ClaudeAdapterError(error.aideError)
    }
    throw adapterError(
      "claude_adapter_failed",
      error instanceof Error ? error.message : String(error),
      instanceId
    )
  }

  const adapter: HarnessAdapter = {
    driver: "claudeAgent",
    configSchema: claudeConfigSchema as unknown as StandardSchemaV1,

    capabilities() {
      return CAPABILITIES
    },

    async start(input: StartInstanceInput) {
      const parsed = claudeConfigSchema.safeParse(input.instance.config)
      if (!parsed.success) {
        throw adapterError(
          "invalid_instance_config",
          `Claude instance "${input.instance.instanceId}" has invalid config`,
          input.instance.instanceId,
          false,
          parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          }))
        )
      }

      const config = parsed.data
      const instanceId = input.instance.instanceId

      let session: ClaudeSession
      try {
        session = await createSession({
          config,
          ...(input.projectDirectory ? { cwd: input.projectDirectory } : {}),
          timeoutMs: config.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
        })
      } catch (error) {
        throw adapterError(
          "start_failed",
          `Claude runtime for "${instanceId}" failed to start: ${
            error instanceof Error ? error.message : String(error)
          }`,
          instanceId,
          true
        )
      }

      instances.set(instanceId, {
        instanceId,
        config,
        status: "ready",
        projectDirectory: input.projectDirectory,
        runtimeVersion: undefined,
        error: undefined,
        session,
        bus: createEventBus(),
        runtimes: new Map(),
        mcpServers: {},
      })
      return { instanceId, driver: "claudeAgent" }
    },

    async stop(input: StopInstanceInput) {
      const instance = instances.get(input.handle.instanceId)
      if (!instance) return
      instance.status = "stopped"
      instances.delete(instance.instanceId)
      // Closing a runtime fails any turn it still had in flight, which is what
      // keeps the core from waiting on a stream that has gone away.
      await Promise.all(
        [...instance.runtimes.values()].map((runtime) =>
          runtime.close().catch(() => undefined)
        )
      )
      instance.runtimes.clear()
      instance.bus.close()
      await instance.session.close().catch(() => undefined)
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
      return {
        status: instance.status,
        // Undefined until a turn has reported it; the handshake carries no
        // version, so claiming one here would be inventing it.
        ...(instance.runtimeVersion
          ? { version: instance.runtimeVersion }
          : {}),
        installed: true,
        auth: authFromAccount(instance.session.init.account),
        ...(instance.error ? { error: instance.error } : {}),
      }
    },

    /**
     * Runtime-scoped discovery. `directory` is deliberately unused: the live
     * query was opened against a working directory at start, and the SDK owns
     * inventory for that runtime.
     */
    async discover(input: DiscoverInput): Promise<HarnessInventory> {
      const instance = requireInstance(input.handle)

      let models: ClaudeModelInfo[]
      let agents: Array<{ name: string }>
      try {
        ;[models, agents] = await Promise.all([
          instance.session.query.supportedModels(),
          instance.session.query.supportedAgents(),
        ])
      } catch (error) {
        throw adapterError(
          "inventory_discovery_failed",
          `Claude inventory discovery failed for "${instance.instanceId}": ${
            error instanceof Error ? error.message : String(error)
          }`,
          instance.instanceId,
          true
        )
      }

      const harnessModels = models.map((model) =>
        toHarnessModel(model, instance.session.init.defaultModel)
      )

      return {
        instanceId: instance.instanceId,
        driver: "claudeAgent",
        revision: inventoryRevision(harnessModels, agents),
        discoveredAt: now(),
        stale: false,
        capabilities: CAPABILITIES,
        auth: authFromAccount(instance.session.init.account),
        models: harnessModels,
        // agentSelection is false; subagents are not a composer control.
        agents: [],
        interactionModes: INTERACTION_MODES,
      }
    },

    async openSession(input: OpenSessionInput) {
      const instance = requireInstance(input.handle)
      try {
        const runtime = await createClaudeRuntime({
          instanceId: instance.instanceId,
          aideSessionId: input.sessionId,
          nativeSessionId: randomUUID(),
          projectDirectory:
            input.projectDirectory ??
            instance.projectDirectory ??
            instance.config.cwd ??
            process.cwd(),
          config: instance.config,
          createSession,
          startupTimeoutMs:
            instance.config.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
          execution: input.execution,
          mcpServers: toSdkMcpServers(instance.mcpServers),
          now,
          nextId,
          onVersion: (version) => noteRuntimeVersion(instance, version),
        })
        instance.runtimes.set(runtime.nativeSessionId, runtime)
        return {
          nativeSessionId: runtime.nativeSessionId,
          ...(runtime.resumeCursor
            ? { resumeCursor: runtime.resumeCursor }
            : {}),
        }
      } catch (error) {
        return rethrow(error, instance.instanceId)
      }
    },

    /**
     * The SDK owns its own session store, so a resume point is a message uuid
     * rather than a generic cursor. A live runtime is reused as-is; a cold one
     * is reopened against the stored native session. Resuming at a point that
     * is not the tip forks, because writing new turns onto an abandoned branch
     * would rewrite history the transcript already shows.
     */
    async resumeSession(input: ResumeSessionInput) {
      const instance = requireInstance(input.handle)
      const live = instance.runtimes.get(input.nativeSessionId)
      if (live) {
        return {
          nativeSessionId: live.nativeSessionId,
          ...((input.resumeCursor ?? live.resumeCursor)
            ? { resumeCursor: input.resumeCursor ?? live.resumeCursor }
            : {}),
        }
      }
      throw adapterError(
        "native_session_not_resumable",
        `Claude native session "${input.nativeSessionId}" has no live query; open a session instead`,
        instance.instanceId,
        true
      )
    },

    async send(input: SendTurnInput) {
      const runtime = requireRuntime(input.handle, input.nativeSession)
      try {
        await runtime.send({
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
      const runtime = requireRuntime(input.handle, input.nativeSession)
      const turnId = runtime.activeTurnId()
      return turnId ? { turnId } : undefined
    },

    async interrupt(input: InterruptTurnInput) {
      const runtime = requireRuntime(input.handle, input.nativeSession)
      await runtime.interrupt(input.turnId)
    },

    async respondToPermission(input: PermissionResponseInput) {
      const runtime = requireRuntime(input.handle, input.nativeSession)
      if (input.request.kind !== "permission") {
        throw adapterError(
          "request_kind_mismatch",
          "respondToPermission requires a permission request",
          input.handle.instanceId
        )
      }
      try {
        runtime.respondToPermission(input.request)
      } catch (error) {
        rethrow(error, input.handle.instanceId)
      }
    },

    async respondToInput(input: InputResponseInput) {
      const runtime = requireRuntime(input.handle, input.nativeSession)
      if (input.request.kind !== "input") {
        throw adapterError(
          "request_kind_mismatch",
          "respondToInput requires an input request",
          input.handle.instanceId
        )
      }
      try {
        runtime.respondToInput(input.request)
      } catch (error) {
        rethrow(error, input.handle.instanceId)
      }
    },

    async setMcpServers(input: SetMcpServersInput) {
      const instance = requireInstance(input.handle)
      instance.mcpServers = { ...input.servers }
      const servers = toSdkMcpServers(instance.mcpServers)
      await Promise.all(
        [...instance.runtimes.values()].map((runtime) =>
          runtime.setMcpServers(servers)
        )
      )
    },

    async mcpStatus(input: McpStatusInput): Promise<McpServerStatus[]> {
      const instance = requireInstance(input.handle)
      const statuses = await instance.session.query.mcpServerStatus()
      return statuses.map((status) => ({
        name: status.name,
        connected: status.status === "connected",
        ...(status.status === "connected"
          ? {}
          : {
              error: {
                code: `mcp_${status.status.replace(/-/g, "_")}`,
                message: `MCP server "${status.name}" is ${status.status}`,
                instanceId: instance.instanceId,
                retryable: status.status !== "disabled",
              },
            }),
      }))
    },

    events(input: HarnessEventsInput): AsyncIterable<AideEvent> {
      const instance = requireInstance(input.handle)
      if (!input.nativeSession) return instance.bus.subscribe()
      return requireRuntime(input.handle, input.nativeSession).bus.subscribe()
    },

    async dispose(input: DisposeInput) {
      await adapter.stop({ handle: input.handle })
    },
  }

  return adapter
}

/**
 * Reasoning effort is a per-model option, gated on `ModelInfo.supportsEffort` —
 * one Claude model may support effort while another does not, which is exactly
 * why descriptors are per model rather than per harness.
 */
function effortDescriptor(model: ClaudeModelInfo): OptionDescriptor[] {
  if (!model.supportsEffort) return []
  const levels = (model.supportedEffortLevels ?? EFFORT_LEVELS).filter(
    (level): level is string => typeof level === "string"
  )
  if (levels.length === 0) return []
  return [
    {
      id: "effort",
      label: "Effort",
      type: "select",
      options: levels.map((level) => ({
        id: level,
        label: level,
        ...(level === "medium" ? { isDefault: true } : {}),
      })),
      ...(levels.includes("medium") ? { defaultValue: "medium" } : {}),
    },
  ]
}

function toHarnessModel(
  model: ClaudeModelInfo,
  defaultModel: string | undefined
): HarnessModel {
  return {
    modelId: model.value,
    displayName: model.displayName,
    ...(model.description ? { description: model.description } : {}),
    ...(model.value === defaultModel ? { isDefault: true } : {}),
    optionDescriptors: effortDescriptor(model),
  }
}

/**
 * Auth is surfaced, never stored or proxied by Aide.
 *
 * A first-party OAuth login reports a subscription and no `apiKeySource`; an
 * API key or a third-party provider reports the source instead. An account
 * with neither is reported unknown rather than guessed at.
 */
function authFromAccount(account: ClaudeAccountInfo): InstanceAuth {
  const source = account.apiKeySource ?? account.tokenSource
  const provider = account.apiProvider
  if (!source && !provider && !account.email) return { status: "unknown" }
  return {
    status: "authenticated",
    ...((source ?? provider) ? { type: source ?? provider! } : {}),
    label:
      provider === "firstParty"
        ? (account.subscriptionType ?? "Claude account")
        : (provider ?? `API key (${source})`),
    ...(account.email ? { account: account.email } : {}),
  }
}

function inventoryRevision(
  models: HarnessModel[],
  agents: Array<{ name: string }>
): string {
  const surface = JSON.stringify({
    models: models.map((model) => model.modelId).sort(),
    agents: agents.map((agent) => agent.name).sort(),
  })
  let hash = 5381
  for (let index = 0; index < surface.length; index += 1) {
    hash = ((hash << 5) + hash + surface.charCodeAt(index)) >>> 0
  }
  return `claude-${hash.toString(16)}`
}

/**
 * Aide's normalized MCP config into the SDK's shape.
 *
 * `{ type: "aide" }` denotes a toolset Aide itself hosts. The SDK can host one
 * in process via `createSdkMcpServer()`, but building those toolsets is P4.2,
 * so they are left out here rather than translated into something they are not.
 */
function toSdkMcpServers(
  servers: Record<string, McpServerConfig>
): Record<string, unknown> {
  const translated: Record<string, unknown> = {}
  for (const [name, server] of Object.entries(servers)) {
    switch (server.type) {
      case "stdio":
        translated[name] = {
          type: "stdio",
          command: server.command,
          ...(server.args ? { args: server.args } : {}),
          ...(server.env ? { env: server.env } : {}),
        }
        break
      case "http":
      case "sse":
        translated[name] = {
          type: server.type,
          url: server.url,
          ...(server.headers ? { headers: server.headers } : {}),
        }
        break
      case "aide":
        break
    }
  }
  return translated
}
