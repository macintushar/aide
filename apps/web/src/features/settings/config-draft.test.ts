import { describe, expect, it } from "vitest"

import {
  emptyDraft,
  issuesFor,
  newInstance,
  newMcpServer,
  validateDraft,
  type ConfigDraft,
} from "./config-draft"

function draft(overrides: Partial<ConfigDraft> = {}): ConfigDraft {
  return { ...emptyDraft(), ...overrides }
}

describe("validateDraft", () => {
  it("accepts an empty draft and omits an unset projects directory", () => {
    const validation = validateDraft(draft())
    expect(validation.issues).toEqual([])
    expect(validation.payload).toEqual({
      instances: {},
      mcpServers: {},
      defaults: {},
    })
  })

  it("keys instances by instanceId so the map key always matches", () => {
    const validation = validateDraft(
      draft({
        instances: [{ ...newInstance(0), instanceId: "  opencode  " }],
      })
    )
    expect(Object.keys(validation.payload!.instances)).toEqual(["opencode"])
    expect(validation.payload!.instances.opencode?.instanceId).toBe("opencode")
  })

  it("rejects a duplicate instance id", () => {
    const validation = validateDraft(
      draft({
        instances: [
          { ...newInstance(0), instanceId: "same" },
          { ...newInstance(1), instanceId: "same" },
        ],
      })
    )
    expect(issuesFor(validation, "instances")[0]?.message).toContain(
      "Duplicate instance id"
    )
    expect(validation.payload).toBeUndefined()
  })

  it("rejects an instance with no id", () => {
    const validation = validateDraft(
      draft({ instances: [{ ...newInstance(0), instanceId: "   " }] })
    )
    expect(issuesFor(validation, "instances")).toHaveLength(1)
  })

  it("rejects a duplicate MCP server name", () => {
    const validation = validateDraft(
      draft({
        mcpServers: [
          { name: "dup", config: { type: "stdio", command: "a" } },
          { name: "dup", config: { type: "stdio", command: "b" } },
        ],
      })
    )
    expect(issuesFor(validation, "mcpServers")[0]?.message).toContain(
      "Duplicate MCP server name"
    )
  })

  it("rejects an MCP server missing its transport field", () => {
    const validation = validateDraft(draft({ mcpServers: [newMcpServer(0)] }))
    // A freshly added stdio row has an empty command.
    expect(issuesFor(validation, "mcpServers").length).toBeGreaterThan(0)
    expect(validation.payload).toBeUndefined()
  })

  it("accepts each transport once its own field is filled in", () => {
    const validation = validateDraft(
      draft({
        mcpServers: [
          { name: "s", config: { type: "stdio", command: "mcp" } },
          { name: "h", config: { type: "http", url: "https://a.test" } },
          { name: "e", config: { type: "sse", url: "https://b.test" } },
          { name: "a", config: { type: "aide", toolset: "workspace" } },
        ],
      })
    )
    expect(validation.issues).toEqual([])
    expect(Object.keys(validation.payload!.mcpServers).sort()).toEqual([
      "a",
      "e",
      "h",
      "s",
    ])
  })

  it("treats blank default fields as unset rather than empty strings", () => {
    const validation = validateDraft(
      draft({
        defaults: { agent: "", interactionMode: "plan" } as never,
      })
    )
    expect(validation.payload!.defaults).toEqual({ interactionMode: "plan" })
  })

  it("rejects an unknown default field", () => {
    const validation = validateDraft(
      draft({ defaults: { nonsense: "x" } as never })
    )
    expect(issuesFor(validation, "defaults").length).toBeGreaterThan(0)
  })

  it("trims the projects directory and drops it when blank", () => {
    expect(
      validateDraft(draft({ projectsDirectory: "  ~/projects " })).payload
        ?.projectsDirectory
    ).toBe("~/projects")
    expect(
      validateDraft(draft({ projectsDirectory: "   " })).payload
        ?.projectsDirectory
    ).toBeUndefined()
  })

  it("reports every issue at once rather than stopping at the first", () => {
    const validation = validateDraft(
      draft({
        instances: [
          { ...newInstance(0), instanceId: "same" },
          { ...newInstance(1), instanceId: "same" },
        ],
        mcpServers: [{ name: "", config: { type: "stdio", command: "a" } }],
        defaults: { nonsense: true } as never,
      })
    )
    const paths = validation.issues.map((issue) => issue.path)
    expect(paths).toContain("instances.same")
    expect(paths).toContain("mcpServers")
    expect(paths).toContain("defaults")
  })
})
