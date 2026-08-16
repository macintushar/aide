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

/**
 * OpenCode v2 adapter — lifecycle, configuration, and discovery.
 *
 * Wave 2 scope. The send path (prompt admission, session events, permission and
 * question replies, interrupt) is Wave 3; those members throw a structured
 * `not_implemented` rather than silently doing nothing, so a caller wiring them
 * early fails loudly.
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

function notImplemented(instanceId: string, member: string): never {
  throw adapterError(
    "not_implemented",
    `OpenCode adapter ${member} lands in Wave 3`,
    instanceId
  )
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
  mcpServers: Record<string, unknown>
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
    const existing = instance.runtimes.get(key)
    if (existing) return existing
    const runtime = await createRuntime({
      config: instance.config,
      ...(key ? { directory: key } : {}),
    })
    instance.runtimes.set(key, runtime)
    return runtime
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
        mcpServers: {},
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
      await closeRuntimes(instance)
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
      return Object.keys(instance.mcpServers).map((name) => ({
        name,
        connected: false,
        error: {
          code: "mcp_status_unavailable",
          message:
            "OpenCode MCP runtime status arrives with the Wave 3 event stream",
          instanceId: instance.instanceId,
          retryable: false,
        },
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
