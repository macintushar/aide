import { describe, expect, it } from "vitest"
import {
  harnessInventorySchema,
  type InstanceConfig,
} from "@workspace/contracts"

import { createOpencodeAdapter } from "./adapter"
import type {
  OpencodeApi,
  OpencodeRuntime,
  OpencodeRuntimeFactory,
} from "./client"
import { isCompatibleRuntimeVersion, opencodeConfigSchema } from "./config"

const PROJECT_DIRECTORY = "/work/repo"

type ProvidersPayload = NonNullable<
  Awaited<ReturnType<OpencodeApi["config"]["providers"]>>["data"]
>
type AgentsPayload = NonNullable<
  Awaited<ReturnType<OpencodeApi["app"]["agents"]>>["data"]
>

const PROVIDERS: ProvidersPayload = {
  providers: [
    {
      id: "anthropic",
      name: "Anthropic",
      source: "env",
      env: ["ANTHROPIC_API_KEY"],
      key: "set",
      models: {
        "claude-opus-5": {
          id: "claude-opus-5",
          providerID: "anthropic",
          name: "Claude Opus 5",
          variants: { standard: {}, thinking: {} },
        },
        "claude-sonnet-5": {
          id: "claude-sonnet-5",
          providerID: "anthropic",
          name: "Claude Sonnet 5",
        },
      },
    },
  ],
  default: { anthropic: "claude-opus-5" },
}

const AGENTS: AgentsPayload = [
  { name: "build", mode: "primary" },
  { name: "plan", mode: "primary" },
  { name: "explore", mode: "subagent" },
  { name: "internal", mode: "primary", hidden: true },
]

function createHarness(
  overrides: {
    version?: string
    providers?: ProvidersPayload
    agents?: AgentsPayload
    providersError?: unknown
    agentsError?: unknown
    healthError?: unknown
  } = {}
) {
  const created: Array<string | undefined> = []
  const closed: Array<string | undefined> = []
  const discoverDirectories: Array<string | undefined> = []

  const createRuntime: OpencodeRuntimeFactory = async ({ directory }) => {
    created.push(directory)
    const api: OpencodeApi = {
      global: {
        async health() {
          if (overrides.healthError) return { error: overrides.healthError }
          return {
            data: { healthy: true, version: overrides.version ?? "1.18.16" },
          }
        },
      },
      config: {
        async providers(parameters) {
          if (overrides.providersError) {
            return { error: overrides.providersError }
          }
          if (parameters?.directory !== undefined) {
            discoverDirectories.push(parameters.directory)
          }
          return { data: overrides.providers ?? PROVIDERS }
        },
      },
      app: {
        async agents() {
          if (overrides.agentsError) return { error: overrides.agentsError }
          return { data: overrides.agents ?? AGENTS }
        },
      },
    }
    const runtime: OpencodeRuntime = {
      api,
      close: () => {
        closed.push(directory)
      },
    }
    return runtime
  }

  return { createRuntime, created, closed, discoverDirectories }
}

function instanceConfig(config: unknown = {}): InstanceConfig {
  return {
    instanceId: "opencode",
    driver: "opencode",
    enabled: true,
    autoStart: true,
    config,
  }
}

describe("opencode configSchema", () => {
  it("accepts an empty config", () => {
    expect(opencodeConfigSchema.safeParse({}).success).toBe(true)
  })

  it("rejects unknown keys", () => {
    expect(opencodeConfigSchema.safeParse({ nope: 1 }).success).toBe(false)
  })

  it("rejects baseUrl combined with a managed-runtime bind", () => {
    expect(
      opencodeConfigSchema.safeParse({
        baseUrl: "http://127.0.0.1:4096",
        port: 4096,
      }).success
    ).toBe(false)
  })
})

describe("opencode version compatibility", () => {
  it("accepts the pinned minor line and later patches", () => {
    expect(isCompatibleRuntimeVersion("1.18.16")).toBe(true)
    expect(isCompatibleRuntimeVersion("1.19.0")).toBe(true)
  })

  it("rejects an older minor and a different major", () => {
    expect(isCompatibleRuntimeVersion("1.17.9")).toBe(false)
    expect(isCompatibleRuntimeVersion("2.0.0")).toBe(false)
    expect(isCompatibleRuntimeVersion("nonsense")).toBe(false)
  })

  it("fails start with an actionable error on an incompatible runtime", async () => {
    const harness = createHarness({ version: "0.9.1" })
    const adapter = createOpencodeAdapter({
      createRuntime: harness.createRuntime,
    })

    await expect(
      adapter.start({
        instance: instanceConfig(),
        projectDirectory: PROJECT_DIRECTORY,
      })
    ).rejects.toMatchObject({
      aideError: {
        code: "harness_version_incompatible",
        retryable: false,
        detail: { version: "0.9.1" },
      },
    })
  })

  it("proceeds anyway when the operator opts out", async () => {
    const harness = createHarness({ version: "0.9.1" })
    const adapter = createOpencodeAdapter({
      createRuntime: harness.createRuntime,
    })

    await expect(
      adapter.start({
        instance: instanceConfig({ allowVersionMismatch: true }),
        projectDirectory: PROJECT_DIRECTORY,
      })
    ).resolves.toMatchObject({ instanceId: "opencode" })
  })

  it("does not leak a runtime when start fails", async () => {
    const harness = createHarness({ version: "0.9.1" })
    const adapter = createOpencodeAdapter({
      createRuntime: harness.createRuntime,
    })

    await expect(
      adapter.start({ instance: instanceConfig() })
    ).rejects.toBeDefined()
    expect(harness.closed).toHaveLength(1)
  })
})

describe("opencode directory-scoped clients", () => {
  it("creates one runtime per directory and reuses it", async () => {
    const harness = createHarness()
    const adapter = createOpencodeAdapter({
      createRuntime: harness.createRuntime,
    })
    const handle = await adapter.start({
      instance: instanceConfig(),
      projectDirectory: PROJECT_DIRECTORY,
    })

    await adapter.discover({ handle, directory: PROJECT_DIRECTORY })
    await adapter.discover({ handle, directory: "/other/repo" })
    await adapter.discover({ handle, directory: PROJECT_DIRECTORY })

    expect(harness.created).toEqual([PROJECT_DIRECTORY, "/other/repo"])
  })

  it("closes every directory-scoped runtime on stop", async () => {
    const harness = createHarness()
    const adapter = createOpencodeAdapter({
      createRuntime: harness.createRuntime,
    })
    const handle = await adapter.start({
      instance: instanceConfig(),
      projectDirectory: PROJECT_DIRECTORY,
    })
    await adapter.discover({ handle, directory: "/other/repo" })

    await adapter.stop({ handle })
    expect(harness.closed.sort()).toEqual(
      [PROJECT_DIRECTORY, "/other/repo"].sort()
    )
  })

  it("scopes discovery to the requested directory", async () => {
    const harness = createHarness()
    const adapter = createOpencodeAdapter({
      createRuntime: harness.createRuntime,
    })
    const handle = await adapter.start({ instance: instanceConfig() })

    await adapter.discover({ handle, directory: "/scoped" })
    expect(harness.discoverDirectories).toEqual(["/scoped"])
  })
})

describe("opencode discovery", () => {
  it("maps providers and models into inventory with variant descriptors", async () => {
    const harness = createHarness()
    const adapter = createOpencodeAdapter({
      createRuntime: harness.createRuntime,
    })
    const handle = await adapter.start({
      instance: instanceConfig(),
      projectDirectory: PROJECT_DIRECTORY,
    })

    const inventory = harnessInventorySchema.parse(
      await adapter.discover({ handle, directory: PROJECT_DIRECTORY })
    )

    expect(inventory.capabilities.inventoryScope).toBe("directory")
    expect(inventory.capabilities.agentSelection).toBe(true)
    expect(inventory.interactionModes).toEqual([])

    const opus = inventory.models.find(
      (model) => model.modelId === "claude-opus-5"
    )
    expect(opus).toMatchObject({
      providerId: "anthropic",
      displayName: "Claude Opus 5",
      isDefault: true,
    })
    expect(opus?.optionDescriptors).toEqual([
      {
        id: "variant",
        label: "Variant",
        type: "select",
        options: [
          { id: "standard", label: "standard", isDefault: true },
          { id: "thinking", label: "thinking" },
        ],
        defaultValue: "standard",
      },
    ])

    // A model without variants reports no descriptors, not an empty select.
    expect(
      inventory.models.find((model) => model.modelId === "claude-sonnet-5")
        ?.optionDescriptors
    ).toEqual([])
  })

  it("reports only primary, non-hidden agents", async () => {
    const harness = createHarness()
    const adapter = createOpencodeAdapter({
      createRuntime: harness.createRuntime,
    })
    const handle = await adapter.start({ instance: instanceConfig() })

    const inventory = await adapter.discover({ handle })
    expect(inventory.agents.map((agent) => agent.id)).toEqual(["build", "plan"])
    expect(inventory.agents[0]?.isDefault).toBe(true)
  })

  it("produces a stable revision that changes only with the selectable surface", async () => {
    const first = createHarness()
    const adapterA = createOpencodeAdapter({
      createRuntime: first.createRuntime,
    })
    const handleA = await adapterA.start({ instance: instanceConfig() })
    const one = await adapterA.discover({ handle: handleA })
    const two = await adapterA.discover({ handle: handleA })
    expect(one.revision).toBe(two.revision)

    const changed = createHarness({
      agents: [{ name: "build", mode: "primary" }],
    })
    const adapterB = createOpencodeAdapter({
      createRuntime: changed.createRuntime,
    })
    const handleB = await adapterB.start({ instance: instanceConfig() })
    expect((await adapterB.discover({ handle: handleB })).revision).not.toBe(
      one.revision
    )
  })

  it("reports unauthenticated when no provider has a credential", async () => {
    const harness = createHarness({
      providers: {
        providers: [
          {
            id: "anthropic",
            name: "Anthropic",
            source: "config",
            env: [],
            models: {
              m: { id: "m", providerID: "anthropic", name: "M" },
            },
          },
        ],
        default: {},
      },
    })
    const adapter = createOpencodeAdapter({
      createRuntime: harness.createRuntime,
    })
    const handle = await adapter.start({ instance: instanceConfig() })

    const inventory = await adapter.discover({ handle })
    expect(inventory.auth.status).toBe("unauthenticated")
  })

  it("raises a retryable error when provider discovery fails", async () => {
    const harness = createHarness({ providersError: { message: "boom" } })
    const adapter = createOpencodeAdapter({
      createRuntime: harness.createRuntime,
    })
    const handle = await adapter.start({ instance: instanceConfig() })

    await expect(adapter.discover({ handle })).rejects.toMatchObject({
      aideError: { code: "inventory_discovery_failed", retryable: true },
    })
  })

  it("refuses discovery for an instance that was never started", async () => {
    const harness = createHarness()
    const adapter = createOpencodeAdapter({
      createRuntime: harness.createRuntime,
    })

    await expect(
      adapter.discover({ handle: { instanceId: "ghost", driver: "opencode" } })
    ).rejects.toMatchObject({ aideError: { code: "instance_not_started" } })
  })
})

describe("opencode health", () => {
  it("reports degraded rather than throwing when the runtime stops answering", async () => {
    const harness = createHarness()
    const adapter = createOpencodeAdapter({
      createRuntime: harness.createRuntime,
    })
    const handle = await adapter.start({ instance: instanceConfig() })

    const healthy = await adapter.health({ handle })
    expect(healthy).toMatchObject({ status: "ready", version: "1.18.16" })

    const broken = createHarness({ healthError: { message: "gone" } })
    const brokenAdapter = createOpencodeAdapter({
      createRuntime: broken.createRuntime,
    })
    const brokenHandle = await brokenAdapter
      .start({
        instance: instanceConfig({ allowVersionMismatch: true }),
      })
      .catch(() => undefined)
    expect(brokenHandle).toBeUndefined()
  })

  it("reports stopped for an unknown instance", async () => {
    const harness = createHarness()
    const adapter = createOpencodeAdapter({
      createRuntime: harness.createRuntime,
    })
    expect(
      await adapter.health({
        handle: { instanceId: "ghost", driver: "opencode" },
      })
    ).toMatchObject({ status: "stopped" })
  })
})

describe("opencode instance isolation", () => {
  it("keeps two instances of the same driver independent", async () => {
    const harness = createHarness()
    const adapter = createOpencodeAdapter({
      createRuntime: harness.createRuntime,
    })

    const a = await adapter.start({
      instance: { ...instanceConfig(), instanceId: "a" },
    })
    const b = await adapter.start({
      instance: { ...instanceConfig(), instanceId: "b" },
    })

    await adapter.stop({ handle: a })
    expect(await adapter.health({ handle: a })).toMatchObject({
      status: "stopped",
    })
    expect(await adapter.health({ handle: b })).toMatchObject({
      status: "ready",
    })
  })
})
