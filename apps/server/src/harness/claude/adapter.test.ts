import { describe, expect, it } from "vitest"
import {
  harnessInventorySchema,
  type InstanceConfig,
} from "@workspace/contracts"

import { createClaudeAdapter } from "./adapter"
import {
  claudeConfigSchema,
  INTERACTION_MODE_TO_PERMISSION_MODE,
  isCompatibleRuntimeVersion,
} from "./config"
import type {
  ClaudeModelInfo,
  ClaudeSession,
  ClaudeSessionFactory,
} from "./query"

const MODELS: ClaudeModelInfo[] = [
  {
    value: "claude-opus-5",
    displayName: "Claude Opus 5",
    description: "Most capable",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    value: "claude-haiku-4-5-20251001",
    displayName: "Claude Haiku 4.5",
    supportsEffort: false,
  },
]

/** These lifecycle tests never send, so the message stream simply never yields. */
const never = new Promise<never>(() => {})

function createHarness(
  overrides: {
    version?: string
    models?: ClaudeModelInfo[]
    agents?: Array<{ name: string }>
    mcpStatuses?: Array<{ name: string; status: string }>
    account?: {
      email?: string
      apiProvider?: string
      subscriptionType?: string
      apiKeySource?: string
    }
    startError?: Error
    discoverError?: Error
  } = {}
) {
  const opened: Array<{ cwd?: string; timeoutMs: number }> = []
  const closedSessions: string[] = []
  let sessionCounter = 0

  const createSession: ClaudeSessionFactory = async ({ cwd, timeoutMs }) => {
    if (overrides.startError) throw overrides.startError
    opened.push({ cwd, timeoutMs })
    const id = `session-${++sessionCounter}`
    const session: ClaudeSession = {
      init: {
        sessionId: id,
        defaultModel: (overrides.models ?? MODELS)[0]?.value,
        account: overrides.account ?? {
          email: "harness@example.test",
          apiProvider: "firstParty",
          subscriptionType: "Claude Pro",
        },
        models: overrides.models ?? MODELS,
        agents: overrides.agents ?? [{ name: "Explore" }],
      },
      query: {
        async supportedModels() {
          if (overrides.discoverError) throw overrides.discoverError
          return overrides.models ?? MODELS
        },
        async supportedAgents() {
          return overrides.agents ?? [{ name: "Explore" }]
        },
        async mcpServerStatus() {
          return overrides.mcpStatuses ?? []
        },
        async interrupt() {
          return undefined
        },
        async setModel() {},
        async setPermissionMode() {},
        async setMcpServers() {
          return undefined
        },
      },
      messages() {
        return { [Symbol.asyncIterator]: () => ({ next: () => never }) }
      },
      prompt() {},
      async close() {
        closedSessions.push(id)
      },
    }
    return session
  }

  return { createSession, opened, closedSessions }
}

function instanceConfig(config: unknown = {}): InstanceConfig {
  return {
    instanceId: "claude",
    driver: "claudeAgent",
    enabled: true,
    autoStart: true,
    config,
  }
}

describe("claude configSchema", () => {
  it("accepts an empty config and rejects unknown keys", () => {
    expect(claudeConfigSchema.safeParse({}).success).toBe(true)
    expect(claudeConfigSchema.safeParse({ nope: 1 }).success).toBe(false)
  })

  it("rejects a non-string model", () => {
    expect(claudeConfigSchema.safeParse({ model: 42 }).success).toBe(false)
  })
})

describe("claude interaction mode mapping", () => {
  it("maps Aide modes onto SDK permission modes", () => {
    expect(INTERACTION_MODE_TO_PERMISSION_MODE.plan).toBe("plan")
    expect(INTERACTION_MODE_TO_PERMISSION_MODE.build).toBe("default")
  })
})

describe("claude version compatibility", () => {
  it("accepts the supported major line", () => {
    expect(isCompatibleRuntimeVersion("2.1.228")).toBe(true)
    expect(isCompatibleRuntimeVersion("2.9.0")).toBe(true)
  })

  it("rejects another major and unparseable input", () => {
    expect(isCompatibleRuntimeVersion("1.0.0")).toBe(false)
    expect(isCompatibleRuntimeVersion("")).toBe(false)
  })

  it("starts without a version, because the handshake does not carry one", async () => {
    const harness = createHarness()
    const adapter = createClaudeAdapter({
      createSession: harness.createSession,
    })

    const handle = await adapter.start({ instance: instanceConfig() })

    // The runtime reports its version on the first turn's system/init; until
    // then health reports none rather than claiming one.
    const health = await adapter.health({ handle })
    expect(health.status).toBe("ready")
    expect(health.version).toBeUndefined()
  })
})

describe("claude query lifecycle", () => {
  it("opens one live query per instance, scoped to the project directory", async () => {
    const harness = createHarness()
    const adapter = createClaudeAdapter({
      createSession: harness.createSession,
    })

    await adapter.start({
      instance: instanceConfig(),
      projectDirectory: "/work/repo",
    })
    expect(harness.opened).toEqual([{ cwd: "/work/repo", timeoutMs: 30_000 }])
  })

  it("honors a configured startup timeout", async () => {
    const harness = createHarness()
    const adapter = createClaudeAdapter({
      createSession: harness.createSession,
    })

    await adapter.start({
      instance: instanceConfig({ startupTimeoutMs: 5_000 }),
    })
    expect(harness.opened[0]?.timeoutMs).toBe(5_000)
  })

  it("closes the live query on stop", async () => {
    const harness = createHarness()
    const adapter = createClaudeAdapter({
      createSession: harness.createSession,
    })
    const handle = await adapter.start({ instance: instanceConfig() })

    await adapter.stop({ handle })
    expect(harness.closedSessions).toEqual(["session-1"])
    expect(await adapter.health({ handle })).toMatchObject({
      status: "stopped",
    })
  })

  it("reports a retryable start failure", async () => {
    const harness = createHarness({ startError: new Error("no executable") })
    const adapter = createClaudeAdapter({
      createSession: harness.createSession,
    })

    await expect(
      adapter.start({ instance: instanceConfig() })
    ).rejects.toMatchObject({
      aideError: { code: "start_failed", retryable: true },
    })
  })
})

describe("claude discovery", () => {
  it("is runtime-scoped and reports modes rather than agents", async () => {
    const harness = createHarness()
    const adapter = createClaudeAdapter({
      createSession: harness.createSession,
    })
    const handle = await adapter.start({ instance: instanceConfig() })

    const inventory = harnessInventorySchema.parse(
      await adapter.discover({ handle })
    )

    expect(inventory.capabilities.inventoryScope).toBe("runtime")
    expect(inventory.capabilities.agentSelection).toBe(false)
    expect(inventory.agents).toEqual([])
    expect(inventory.interactionModes.map((mode) => mode.id)).toEqual([
      "build",
      "plan",
    ])
  })

  it("exposes effort only on models that support it", async () => {
    const harness = createHarness()
    const adapter = createClaudeAdapter({
      createSession: harness.createSession,
    })
    const handle = await adapter.start({ instance: instanceConfig() })

    const inventory = await adapter.discover({ handle })
    const opus = inventory.models.find(
      (model) => model.modelId === "claude-opus-5"
    )
    const haiku = inventory.models.find((model) =>
      model.modelId.startsWith("claude-haiku")
    )

    expect(opus?.isDefault).toBe(true)
    expect(opus?.optionDescriptors).toEqual([
      {
        id: "effort",
        label: "Effort",
        type: "select",
        options: [
          { id: "low", label: "low" },
          { id: "medium", label: "medium", isDefault: true },
          { id: "high", label: "high" },
          { id: "xhigh", label: "xhigh" },
          { id: "max", label: "max" },
        ],
        defaultValue: "medium",
      },
    ])
    expect(haiku?.optionDescriptors).toEqual([])
  })

  it("uses the model's own effort levels when they are narrower", async () => {
    const harness = createHarness({
      models: [
        {
          value: "m",
          displayName: "M",
          supportsEffort: true,
          supportedEffortLevels: ["low", "high"],
        },
      ],
    })
    const adapter = createClaudeAdapter({
      createSession: harness.createSession,
    })
    const handle = await adapter.start({ instance: instanceConfig() })

    const inventory = await adapter.discover({ handle })
    const descriptor = inventory.models[0]?.optionDescriptors[0]
    expect(descriptor?.options.map((option) => option.id)).toEqual([
      "low",
      "high",
    ])
    // No `medium` to fall back on, so no default is asserted.
    expect(descriptor?.defaultValue).toBeUndefined()
  })

  it("raises a retryable error when the live query cannot answer", async () => {
    const harness = createHarness({ discoverError: new Error("query closed") })
    const adapter = createClaudeAdapter({
      createSession: harness.createSession,
    })
    const handle = await adapter.start({ instance: instanceConfig() })

    await expect(adapter.discover({ handle })).rejects.toMatchObject({
      aideError: { code: "inventory_discovery_failed", retryable: true },
    })
  })

  it("surfaces a first-party subscription without storing a credential", async () => {
    const harness = createHarness({
      account: {
        email: "user@example.test",
        apiProvider: "firstParty",
        subscriptionType: "Claude Pro",
      },
    })
    const adapter = createClaudeAdapter({
      createSession: harness.createSession,
    })
    const handle = await adapter.start({ instance: instanceConfig() })

    const inventory = await adapter.discover({ handle })
    expect(inventory.auth).toEqual({
      status: "authenticated",
      type: "firstParty",
      label: "Claude Pro",
      account: "user@example.test",
    })
    expect(JSON.stringify(inventory)).not.toContain("sk-")
  })

  it("surfaces an API key source without its value", async () => {
    const harness = createHarness({
      account: { apiKeySource: "ANTHROPIC_API_KEY", apiProvider: "firstParty" },
    })
    const adapter = createClaudeAdapter({
      createSession: harness.createSession,
    })
    const handle = await adapter.start({ instance: instanceConfig() })

    expect((await adapter.discover({ handle })).auth).toMatchObject({
      status: "authenticated",
      type: "ANTHROPIC_API_KEY",
    })
  })

  it("reports unknown auth when the account says nothing", async () => {
    const harness = createHarness({ account: {} })
    const adapter = createClaudeAdapter({
      createSession: harness.createSession,
    })
    const handle = await adapter.start({ instance: instanceConfig() })

    expect((await adapter.discover({ handle })).auth).toEqual({
      status: "unknown",
    })
  })
})

describe("claude mcp status", () => {
  it("maps every SDK status onto one Aide status per server", async () => {
    const harness = createHarness({
      mcpStatuses: [
        { name: "connected-one", status: "connected" },
        { name: "failed-one", status: "failed" },
        { name: "needs-auth-one", status: "needs-auth" },
        { name: "disabled-one", status: "disabled" },
      ],
    })
    const adapter = createClaudeAdapter({
      createSession: harness.createSession,
    })
    const handle = await adapter.start({ instance: instanceConfig() })

    const statuses = await adapter.mcpStatus({ handle })
    expect(statuses).toEqual([
      { name: "connected-one", connected: true },
      {
        name: "failed-one",
        connected: false,
        error: expect.objectContaining({ code: "mcp_failed", retryable: true }),
      },
      {
        name: "needs-auth-one",
        connected: false,
        error: expect.objectContaining({ code: "mcp_needs_auth" }),
      },
      {
        name: "disabled-one",
        connected: false,
        error: expect.objectContaining({
          code: "mcp_disabled",
          retryable: false,
        }),
      },
    ])
  })
})

describe("claude instance isolation", () => {
  it("gives each instance its own live query", async () => {
    const harness = createHarness()
    const adapter = createClaudeAdapter({
      createSession: harness.createSession,
    })

    const a = await adapter.start({
      instance: { ...instanceConfig(), instanceId: "a" },
    })
    await adapter.start({ instance: { ...instanceConfig(), instanceId: "b" } })

    expect(harness.opened).toHaveLength(2)
    await adapter.stop({ handle: a })
    expect(harness.closedSessions).toEqual(["session-1"])
  })
})
