import type { StandardSchemaV1 } from "@standard-schema/spec"
import type {
  AideError,
  AideEvent,
  HarnessCapabilities,
  HarnessInventory,
  HarnessModel,
  InstanceAuth,
  InstanceRuntimeStatus,
  McpServerStatus,
  OptionDescriptor,
  SelectOption,
} from "@workspace/contracts"

import type {
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
  OpenSessionInput,
  PermissionResponseInput,
  ResumeSessionInput,
  SendTurnInput,
  SetMcpServersInput,
  StartInstanceInput,
  StopInstanceInput,
} from "../types"
import {
  claudeConfigSchema,
  DEFAULT_STARTUP_TIMEOUT_MS,
  isCompatibleRuntimeVersion,
  PINNED_CLAUDE_SDK_VERSION,
  type ClaudeInstanceConfig,
} from "./config"
import {
  createClaudeSession,
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
 * The send path (streaming parts, part synthesis, `canUseTool` inversion,
 * resume/fork) is Wave 3.
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

function notImplemented(instanceId: string, member: string): never {
  throw adapterError(
    "not_implemented",
    `Claude adapter ${member} lands in Wave 3`,
    instanceId
  )
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
  session: ClaudeSession
  mcpServers: Record<string, unknown>
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

      if (
        !config.allowVersionMismatch &&
        !isCompatibleRuntimeVersion(session.init.version)
      ) {
        await session.close().catch(() => undefined)
        throw adapterError(
          "harness_version_incompatible",
          `Claude Code ${session.init.version} is not compatible with this adapter, which targets SDK ${PINNED_CLAUDE_SDK_VERSION}. Upgrade the runtime, or set allowVersionMismatch to proceed anyway.`,
          instanceId,
          false,
          {
            version: session.init.version,
            pinnedSdkVersion: PINNED_CLAUDE_SDK_VERSION,
          }
        )
      }

      instances.set(instanceId, {
        instanceId,
        config,
        status: "ready",
        session,
        mcpServers: {},
      })
      return { instanceId, driver: "claudeAgent" }
    },

    async stop(input: StopInstanceInput) {
      const instance = instances.get(input.handle.instanceId)
      if (!instance) return
      instance.status = "stopped"
      instances.delete(instance.instanceId)
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
        version: instance.session.init.version,
        installed: true,
        auth: authFromInit(instance.session.init.apiKeySource),
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
        toHarnessModel(model, instance.session.init.model)
      )

      return {
        instanceId: instance.instanceId,
        driver: "claudeAgent",
        revision: inventoryRevision(harnessModels, agents),
        discoveredAt: now(),
        stale: false,
        capabilities: CAPABILITIES,
        auth: authFromInit(instance.session.init.apiKeySource),
        models: harnessModels,
        // agentSelection is false; subagents are not a composer control.
        agents: [],
        interactionModes: INTERACTION_MODES,
      }
    },

    async openSession(input: OpenSessionInput) {
      return notImplemented(input.handle.instanceId, "openSession")
    },

    async resumeSession(input: ResumeSessionInput) {
      return notImplemented(input.handle.instanceId, "resumeSession")
    },

    async send(input: SendTurnInput) {
      return notImplemented(input.handle.instanceId, "send")
    },

    async interrupt(input: InterruptTurnInput) {
      return notImplemented(input.handle.instanceId, "interrupt")
    },

    async respondToPermission(input: PermissionResponseInput) {
      return notImplemented(input.handle.instanceId, "respondToPermission")
    },

    async respondToInput(input: InputResponseInput) {
      return notImplemented(input.handle.instanceId, "respondToInput")
    },

    async setMcpServers(input: SetMcpServersInput) {
      const instance = requireInstance(input.handle)
      instance.mcpServers = { ...input.servers }
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
      requireInstance(input.handle)
      return notImplemented(input.handle.instanceId, "events")
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
  defaultModel: string
): HarnessModel {
  return {
    modelId: model.value,
    displayName: model.displayName,
    ...(model.description ? { description: model.description } : {}),
    ...(model.value === defaultModel ? { isDefault: true } : {}),
    optionDescriptors: effortDescriptor(model),
  }
}

/** Auth is surfaced, never stored or proxied by Aide. */
function authFromInit(apiKeySource: string): InstanceAuth {
  if (!apiKeySource) return { status: "unknown" }
  return {
    status: "authenticated",
    type: apiKeySource,
    label:
      apiKeySource === "oauth" ? "Claude account" : `API key (${apiKeySource})`,
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
