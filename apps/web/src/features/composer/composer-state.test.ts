import type {
  HarnessInventory,
  HarnessModel,
  InstanceSnapshotEntry,
} from "@workspace/contracts"
import { describe, expect, it } from "vitest"

import {
  applyComposerChange,
  resolveComposer,
  type ComposerSources,
} from "./composer-state"

const OPUS: HarnessModel = {
  modelId: "claude-opus-5",
  displayName: "Claude Opus 5",
  isDefault: true,
  optionDescriptors: [
    {
      id: "effort",
      label: "Effort",
      type: "select",
      options: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
      ],
      defaultValue: "medium",
    },
  ],
}

const HAIKU: HarnessModel = {
  modelId: "claude-haiku-4-5",
  displayName: "Claude Haiku 4.5",
  optionDescriptors: [],
}

function inventory(
  overrides: Partial<HarnessInventory> = {}
): HarnessInventory {
  return {
    instanceId: "claude",
    driver: "claudeAgent",
    revision: "rev-1",
    discoveredAt: "2026-01-01T00:00:00.000Z",
    stale: false,
    capabilities: {
      inventoryScope: "runtime",
      agentSelection: false,
      interactionModes: [
        { id: "build", label: "Build", isDefault: true },
        { id: "plan", label: "Plan" },
      ],
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
        inProcess: true,
        runtimeReconfigure: true,
      },
    },
    auth: { status: "authenticated", type: "oauth", label: "Claude account" },
    models: [OPUS, HAIKU],
    agents: [],
    interactionModes: [
      { id: "build", label: "Build", isDefault: true },
      { id: "plan", label: "Plan" },
    ],
    ...overrides,
  }
}

function instance(
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

/** An OpenCode-shaped instance: agents, no modes. */
function openCodeInstance(): InstanceSnapshotEntry {
  return {
    instanceId: "opencode",
    driver: "opencode",
    displayName: "OpenCode",
    enabled: true,
    autoStart: true,
    status: "ready",
    auth: { status: "authenticated" },
    inventory: inventory({
      instanceId: "opencode",
      driver: "opencode",
      capabilities: {
        ...inventory().capabilities,
        agentSelection: true,
        interactionModes: [],
      },
      models: [
        {
          providerId: "anthropic",
          modelId: "sonnet",
          displayName: "Sonnet",
          isDefault: true,
          optionDescriptors: [],
        },
      ],
      agents: [
        { id: "build", label: "Build", isDefault: true },
        { id: "plan", label: "Plan" },
      ],
      interactionModes: [],
    }),
  }
}

function sources(overrides: Partial<ComposerSources> = {}): ComposerSources {
  return { instances: [instance()], ...overrides }
}

function controlIds(view: ReturnType<typeof resolveComposer>): string[] {
  return view.controls.map((control) => control.id)
}

describe("composer: capability-driven controls", () => {
  it("shows mode for an instance that reports modes and no agent control", () => {
    const view = resolveComposer(sources())

    expect(controlIds(view)).toEqual(["instance", "model", "mode", "effort"])
  })

  it("shows agent for an instance that reports agents and no mode control", () => {
    const view = resolveComposer({ instances: [openCodeInstance()] })

    expect(controlIds(view)).toEqual(["instance", "model", "agent"])
  })

  it("generates one control per descriptor without naming any descriptor id", () => {
    const withTwoAxes = instance({
      inventory: inventory({
        models: [
          {
            modelId: "gpt-5-codex",
            displayName: "Codex",
            isDefault: true,
            optionDescriptors: [
              {
                id: "reasoning",
                label: "Reasoning",
                type: "select",
                options: [{ id: "low", label: "Low", isDefault: true }],
              },
              {
                id: "service_tier",
                label: "Service tier",
                type: "select",
                options: [
                  { id: "flex", label: "Flex" },
                  { id: "priority", label: "Priority" },
                ],
              },
            ],
          },
        ],
      }),
    })

    const view = resolveComposer({ instances: [withTwoAxes] })

    expect(controlIds(view)).toEqual([
      "instance",
      "model",
      "mode",
      "reasoning",
      "service_tier",
    ])
    // "reasoning" reports a default and gets one; "service_tier" reports none,
    // so the composer leaves it for the user rather than inventing a value.
    expect(view.selection?.options).toEqual({ reasoning: "low" })
    expect(
      view.controls.find((control) => control.id === "service_tier")?.value
    ).toBeUndefined()
  })

  it("offers no controls beyond instance when the instance reports no inventory", () => {
    const view = resolveComposer({
      instances: [instance({ inventory: undefined, status: "starting" })],
    })

    expect(controlIds(view)).toEqual(["instance", "model"])
    expect(view.selection).toBeUndefined()
    expect(view.blockedReason).toMatch(/has not reported a model/)
  })
})

describe("composer: selection precedence", () => {
  it("falls back to the harness-reported defaults when nothing else applies", () => {
    const view = resolveComposer(sources())

    expect(view.selection).toMatchObject({
      instanceId: "claude",
      model: { modelId: "claude-opus-5" },
      interactionMode: "build",
      options: { effort: "medium" },
    })
  })

  it("prefers user config defaults over what the harness reports", () => {
    const view = resolveComposer(
      sources({
        userDefaults: {
          model: { modelId: "claude-haiku-4-5" },
          interactionMode: "plan",
        },
      })
    )

    expect(view.selection).toMatchObject({
      model: { modelId: "claude-haiku-4-5" },
      interactionMode: "plan",
    })
  })

  it("prefers project defaults over user config defaults", () => {
    const view = resolveComposer(
      sources({
        userDefaults: { interactionMode: "plan" },
        projectDefaults: { interactionMode: "build" },
      })
    )

    expect(view.selection?.interactionMode).toBe("build")
  })

  it("prefers the most recent send over configured defaults", () => {
    const view = resolveComposer(
      sources({
        projectDefaults: { interactionMode: "build" },
        lastSent: {
          instanceId: "claude",
          driver: "claudeAgent",
          model: { modelId: "claude-haiku-4-5" },
          interactionMode: "plan",
          options: {},
        },
      })
    )

    expect(view.selection).toMatchObject({
      model: { modelId: "claude-haiku-4-5" },
      interactionMode: "plan",
    })
  })

  it("prefers the current composer selection over everything else", () => {
    const view = resolveComposer(
      sources({
        lastSent: {
          instanceId: "claude",
          driver: "claudeAgent",
          model: { modelId: "claude-haiku-4-5" },
          interactionMode: "plan",
          options: {},
        },
      }),
      { interactionMode: "build" }
    )

    expect(view.selection?.interactionMode).toBe("build")
  })

  it("ignores a default naming a value the harness does not report", () => {
    const view = resolveComposer(
      sources({ userDefaults: { model: { modelId: "a-model-that-left" } } })
    )

    // Never invented, never carried forward: it falls back to a reported value.
    expect(view.selection?.model.modelId).toBe("claude-opus-5")
  })
})

describe("composer: invalidation on model change", () => {
  it("drops option values the new model does not offer and applies its defaults", () => {
    const first = resolveComposer(sources(), { options: { effort: "high" } })
    expect(first.selection?.options).toEqual({ effort: "high" })

    const draft = applyComposerChange(
      { options: { effort: "high" } },
      "model",
      "claude-haiku-4-5"
    )
    const second = resolveComposer(sources(), draft)

    // Haiku reports no descriptors, so the effort control and its value go away.
    expect(controlIds(second)).toEqual(["instance", "model", "mode"])
    expect(second.selection?.options).toEqual({})
  })

  it("restores a still-valid option value from the reported default", () => {
    const narrowed = instance({
      inventory: inventory({
        models: [
          OPUS,
          {
            modelId: "claude-sonnet-5",
            displayName: "Sonnet 5",
            optionDescriptors: [
              {
                id: "effort",
                label: "Effort",
                type: "select",
                options: [{ id: "low", label: "Low" }],
                defaultValue: "low",
              },
            ],
          },
        ],
      }),
    })
    const draft = applyComposerChange(
      { options: { effort: "high" } },
      "model",
      "claude-sonnet-5"
    )

    const view = resolveComposer({ instances: [narrowed] }, draft)

    // "high" is not offered by Sonnet, so its descriptor default takes over.
    expect(view.selection?.options).toEqual({ effort: "low" })
  })

  it("preserves a mode that is still valid after a model change", () => {
    const draft = applyComposerChange(
      { interactionMode: "plan" },
      "model",
      "claude-haiku-4-5"
    )

    expect(resolveComposer(sources(), draft).selection?.interactionMode).toBe(
      "plan"
    )
  })

  it("resets the draft entirely when the instance changes", () => {
    const draft = applyComposerChange(
      { modelId: "claude-haiku-4-5", interactionMode: "plan" },
      "instance",
      "opencode"
    )

    expect(draft).toEqual({ instanceId: "opencode" })
  })

  it("drops an agent the newly selected model does not support", () => {
    const restricted = openCodeInstance()
    restricted.inventory = {
      ...restricted.inventory!,
      models: [
        {
          modelId: "sonnet",
          displayName: "Sonnet",
          isDefault: true,
          optionDescriptors: [],
          supportedAgents: ["build"],
        },
      ],
    }

    const view = resolveComposer({ instances: [restricted] }, { agent: "plan" })

    expect(
      view.controls.find((control) => control.id === "agent")?.options
    ).toEqual([{ id: "build", label: "Build", isDefault: true }])
    expect(view.selection?.agent).toBe("build")
  })
})

describe("composer: send gating", () => {
  it("blocks an unauthenticated instance with an actionable message", () => {
    const view = resolveComposer({
      instances: [instance({ auth: { status: "unauthenticated" } })],
    })

    expect(view.selection).toBeUndefined()
    expect(view.blockedReason).toMatch(/Sign in to this harness/)
  })

  it("blocks an instance whose credentials expired", () => {
    const view = resolveComposer({
      instances: [instance({ auth: { status: "expired" } })],
    })

    expect(view.blockedReason).toMatch(/expired/)
  })

  it("blocks when no enabled instance is configured", () => {
    expect(resolveComposer({ instances: [] }).blockedReason).toMatch(
      /No enabled harness instance/
    )
    expect(
      resolveComposer({ instances: [instance({ enabled: false })] })
        .blockedReason
    ).toMatch(/No enabled harness instance/)
  })

  it("blocks a failed instance with the reason it failed", () => {
    const view = resolveComposer({
      instances: [
        instance({
          status: "failed",
          error: {
            code: "start_failed",
            message: "claude executable not found",
            retryable: true,
          },
        }),
      ],
    })

    expect(view.blockedReason).toBe("claude executable not found")
  })
})
