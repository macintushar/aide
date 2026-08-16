import { describe, expect, it } from "vitest"
import type {
  AideConfig,
  InstanceConfig,
  ProjectConfigRecord,
} from "@workspace/contracts"

import { ConfigMergeError, emptyGlobalConfig, mergeConfig } from "./merge"

function instance(overrides: Partial<InstanceConfig> = {}): InstanceConfig {
  return {
    instanceId: "opencode",
    driver: "opencode",
    enabled: true,
    autoStart: true,
    config: {},
    ...overrides,
  }
}

function globalConfig(overrides: Partial<AideConfig> = {}): AideConfig {
  return { ...emptyGlobalConfig(), ...overrides }
}

describe("config merge: rule 1, scalar top-level fields", () => {
  it("prefers the project value over the global value", () => {
    const merged = mergeConfig({
      global: globalConfig({ projectsDirectory: "/global" }),
      project: { projectId: "p1", projectsDirectory: "/project" },
    })
    expect(merged.projectsDirectory).toBe("/project")
  })

  it("falls back to the global value when the project omits it", () => {
    const merged = mergeConfig({
      global: globalConfig({ projectsDirectory: "/global" }),
      project: { projectId: "p1" },
    })
    expect(merged.projectsDirectory).toBe("/global")
  })

  it("leaves the field absent when neither record supplies one", () => {
    const merged = mergeConfig({ global: globalConfig() })
    expect(merged.projectsDirectory).toBeUndefined()
  })
})

describe("config merge: rule 2, instances by instanceId", () => {
  it("replaces the matching global entry as a complete record", () => {
    const merged = mergeConfig({
      global: globalConfig({
        instances: {
          opencode: instance({ displayName: "Global", autoStart: true }),
        },
      }),
      project: {
        projectId: "p1",
        instances: {
          opencode: instance({ enabled: false, autoStart: false }),
        },
      },
    })

    // displayName is NOT inherited: the project entry replaced the whole record.
    expect(merged.instances.opencode).toEqual(
      instance({ enabled: false, autoStart: false })
    )
    expect(merged.instances.opencode?.displayName).toBeUndefined()
  })

  it("keeps global-only and project-only instances side by side", () => {
    const merged = mergeConfig({
      global: globalConfig({
        instances: { opencode: instance() },
      }),
      project: {
        projectId: "p1",
        instances: {
          claude: instance({ instanceId: "claude", driver: "claudeAgent" }),
        },
      },
    })
    expect(Object.keys(merged.instances).sort()).toEqual(["claude", "opencode"])
  })
})

describe("config merge: rule 3, defaults by documented field", () => {
  it("merges field by field with the project winning", () => {
    const merged = mergeConfig({
      global: globalConfig({
        defaults: { instanceId: "opencode", agent: "build" },
      }),
      project: {
        projectId: "p1",
        defaults: { agent: "plan" },
      },
    })
    expect(merged.defaults).toEqual({ instanceId: "opencode", agent: "plan" })
  })

  it("rejects unknown default fields", () => {
    expect(() =>
      mergeConfig({
        global: globalConfig({
          defaults: { nonsense: true } as never,
        }),
      })
    ).toThrow(ConfigMergeError)
  })
})

describe("config merge: rule 4, top-level mcpServers additively by name", () => {
  it("unions by name with the project winning on conflict", () => {
    const merged = mergeConfig({
      global: globalConfig({
        mcpServers: {
          shared: { type: "stdio", command: "global" },
          onlyGlobal: { type: "stdio", command: "g" },
        },
      }),
      project: {
        projectId: "p1",
        mcpServers: {
          shared: { type: "stdio", command: "project" },
          onlyProject: { type: "stdio", command: "p" },
        },
      },
    })

    expect(Object.keys(merged.mcpServers).sort()).toEqual([
      "onlyGlobal",
      "onlyProject",
      "shared",
    ])
    expect(merged.mcpServers.shared).toEqual({
      type: "stdio",
      command: "project",
    })
  })
})

describe("config merge: per-instance validation isolation", () => {
  it("disables only the malformed instance and keeps the healthy ones", () => {
    const merged = mergeConfig({
      global: globalConfig({
        instances: {
          healthy: instance({ instanceId: "healthy" }),
          broken: { instanceId: "broken", driver: "nope" } as never,
        },
      }),
    })

    expect(Object.keys(merged.instances)).toEqual(["healthy"])
    expect(merged.failures).toHaveLength(1)
    expect(merged.failures[0]).toMatchObject({
      instanceId: "broken",
      error: { code: "invalid_instance_config", instanceId: "broken" },
    })
  })

  it("rejects a map-key / instanceId mismatch for that instance alone", () => {
    const merged = mergeConfig({
      global: globalConfig({
        instances: {
          healthy: instance({ instanceId: "healthy" }),
          mismatched: instance({ instanceId: "something-else" }),
        },
      }),
    })

    expect(Object.keys(merged.instances)).toEqual(["healthy"])
    expect(merged.failures[0]?.error.message).toContain(
      'must equal instanceId "something-else"'
    )
  })

  it("never throws for a malformed instance, so the server can still start", () => {
    expect(() =>
      mergeConfig({
        global: globalConfig({
          instances: { broken: {} as never },
        }),
      })
    ).not.toThrow()
  })
})

describe("config merge: determinism", () => {
  it("produces an identical result for identical inputs", () => {
    const global = globalConfig({
      projectsDirectory: "~/projects",
      instances: {
        b: instance({ instanceId: "b" }),
        a: instance({ instanceId: "a", driver: "claudeAgent" }),
      },
      mcpServers: { one: { type: "http", url: "https://example.test" } },
      defaults: { agent: "build" },
    })
    const project: ProjectConfigRecord = {
      projectId: "p1",
      defaults: { instanceId: "a" },
    }

    expect(mergeConfig({ global, project })).toEqual(
      mergeConfig({ global, project })
    )
  })

  it("orders instances stably regardless of insertion order", () => {
    const first = mergeConfig({
      global: globalConfig({
        instances: {
          z: instance({ instanceId: "z" }),
          a: instance({ instanceId: "a" }),
        },
      }),
    })
    const second = mergeConfig({
      global: globalConfig({
        instances: {
          a: instance({ instanceId: "a" }),
          z: instance({ instanceId: "z" }),
        },
      }),
    })
    expect(Object.keys(first.instances)).toEqual(Object.keys(second.instances))
  })
})
