import type {
  ExecutionSelection,
  HarnessInventory,
  HarnessModel,
  InstanceSnapshotEntry,
} from "@workspace/contracts"
import { inventoryFixture } from "@workspace/contracts"
import { describe, expect, it } from "vitest"

import {
  findModel,
  harnessDefaultSelection,
  pickableInstances,
  resolveInitialSelection,
  selectModel,
} from "./selection"

const OPUS: HarnessModel = {
  providerId: "anthropic",
  modelId: "opus-5",
  displayName: "Claude Opus 5",
  isDefault: true,
  optionDescriptors: [
    {
      id: "effort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "low", label: "Low" },
        { id: "high", label: "High", isDefault: true },
      ],
      defaultValue: "high",
    },
  ],
}

const SONNET: HarnessModel = {
  providerId: "anthropic",
  modelId: "sonnet-5",
  displayName: "Claude Sonnet 5",
  optionDescriptors: [
    {
      id: "effort",
      label: "Reasoning",
      type: "select",
      options: [{ id: "low", label: "Low" }],
      defaultValue: "low",
    },
  ],
  supportedAgents: ["build"],
}

function inventory(
  overrides: Partial<HarnessInventory> = {}
): HarnessInventory {
  return {
    ...inventoryFixture(),
    instanceId: "claude",
    driver: "claudeAgent",
    models: [OPUS, SONNET],
    agents: [
      { id: "build", label: "Build", isDefault: true },
      { id: "plan", label: "Plan" },
    ],
    ...overrides,
  }
}

function entry(
  overrides: Partial<InstanceSnapshotEntry> = {}
): InstanceSnapshotEntry {
  return {
    instanceId: "claude",
    driver: "claudeAgent",
    displayName: "Claude",
    enabled: true,
    autoStart: true,
    status: "ready",
    auth: { status: "authenticated" },
    inventory: inventory(),
    ...overrides,
  }
}

describe("pickableInstances", () => {
  it("skips instances with no inventory to offer", () => {
    const picked = pickableInstances([
      entry(),
      entry({ instanceId: "pending", inventory: undefined }),
    ])

    expect(picked.map((instance) => instance.entry.instanceId)).toEqual([
      "claude",
    ])
  })

  it("keeps unauthenticated instances visible but marks why they are blocked", () => {
    const [picked] = pickableInstances([
      entry({ auth: { status: "unauthenticated" } }),
    ])

    expect(picked?.blockedReason).toMatch(/Sign in/)
  })
})

describe("harnessDefaultSelection", () => {
  it("takes the default model, agent, and option values from inventory", () => {
    const [instance] = pickableInstances([entry()])

    expect(harnessDefaultSelection(instance!)).toEqual({
      instanceId: "claude",
      driver: "claudeAgent",
      model: { providerId: "anthropic", modelId: "opus-5" },
      agent: "build",
      interactionMode: undefined,
      options: { effort: "high" },
    })
  })
})

describe("resolveInitialSelection", () => {
  const instances = pickableInstances([entry()])

  it("prefers the last sent selection over configured defaults", () => {
    const lastSent: ExecutionSelection = {
      instanceId: "claude",
      driver: "claudeAgent",
      model: { providerId: "anthropic", modelId: "sonnet-5" },
      agent: "build",
      options: { effort: "low" },
    }

    const resolved = resolveInitialSelection({
      instances,
      lastSent,
      projectDefaults: { model: { modelId: "opus-5" } },
      userDefaults: { model: { modelId: "opus-5" } },
    })

    expect(resolved?.model.modelId).toBe("sonnet-5")
  })

  it("falls back to project defaults, then user defaults", () => {
    expect(
      resolveInitialSelection({
        instances,
        projectDefaults: {
          instanceId: "claude",
          model: { providerId: "anthropic", modelId: "sonnet-5" },
        },
        userDefaults: {
          instanceId: "claude",
          model: { providerId: "anthropic", modelId: "opus-5" },
        },
      })?.model.modelId
    ).toBe("sonnet-5")

    expect(
      resolveInitialSelection({
        instances,
        userDefaults: {
          instanceId: "claude",
          model: { providerId: "anthropic", modelId: "sonnet-5" },
        },
      })?.model.modelId
    ).toBe("sonnet-5")
  })

  it("ignores defaults naming an instance that is no longer configured", () => {
    const resolved = resolveInitialSelection({
      instances,
      userDefaults: { instanceId: "retired" },
    })

    expect(resolved?.instanceId).toBe("claude")
    expect(resolved?.model.modelId).toBe("opus-5")
  })

  it("prefers an instance that can actually send", () => {
    const mixed = pickableInstances([
      entry({ instanceId: "blocked", auth: { status: "unauthenticated" } }),
      entry({ instanceId: "ready" }),
    ])

    expect(resolveInitialSelection({ instances: mixed })?.instanceId).toBe(
      "ready"
    )
  })

  it("returns nothing when no instance has inventory", () => {
    expect(resolveInitialSelection({ instances: [] })).toBeUndefined()
  })
})

describe("selectModel", () => {
  const [instance] = pickableInstances([entry()])

  it("keeps a still-valid agent and option value", () => {
    const current = harnessDefaultSelection(instance!)!
    const next = selectModel(current, instance!, SONNET)

    expect(next?.agent).toBe("build")
    expect(next?.model.modelId).toBe("sonnet-5")
  })

  it("clears an option the new model does not accept, then defaults it", () => {
    const current: ExecutionSelection = {
      ...harnessDefaultSelection(instance!)!,
      options: { effort: "high" },
    }

    // Sonnet only offers "low", so the carried "high" cannot survive.
    expect(selectModel(current, instance!, SONNET)?.options).toEqual({
      effort: "low",
    })
  })

  it("drops an agent the new model does not support", () => {
    const current: ExecutionSelection = {
      ...harnessDefaultSelection(instance!)!,
      agent: "plan",
    }

    // Sonnet supports only "build".
    expect(selectModel(current, instance!, SONNET)?.agent).toBe("build")
  })

  it("resets agent and options when the instance changes", () => {
    const other = pickableInstances([
      entry({
        instanceId: "second",
        inventory: inventory({
          instanceId: "second",
          agents: [{ id: "plan", label: "Plan", isDefault: true }],
        }),
      }),
    ])[0]!
    const current: ExecutionSelection = {
      ...harnessDefaultSelection(instance!)!,
      agent: "build",
    }

    const next = selectModel(current, other, OPUS)

    expect(next?.instanceId).toBe("second")
    expect(next?.agent).toBe("plan")
  })
})

describe("findModel", () => {
  it("matches on provider and model id together", () => {
    const [instance] = pickableInstances([entry()])

    expect(
      findModel(instance, { providerId: "anthropic", modelId: "sonnet-5" })
        ?.displayName
    ).toBe("Claude Sonnet 5")
    expect(findModel(instance, { modelId: "sonnet-5" })).toBeUndefined()
  })
})
