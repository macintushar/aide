import { describe, expect, it } from "vitest"

import { emptyGlobalConfig, mergeConfig } from "./merge"
import {
  expandEnvironment,
  expandTilde,
  resolveCommandPath,
  resolveConfigPaths,
  type ResolutionEnvironment,
} from "./paths"

const environment: ResolutionEnvironment = {
  homeDirectory: "/home/dev",
  variables: { TOKEN: "s3cret", EMPTYISH: "" },
  baseDirectory: "/work/repo",
}

describe("expandEnvironment", () => {
  it("expands both braced and bare references", () => {
    expect(expandEnvironment("${TOKEN}/$TOKEN", environment.variables)).toBe(
      "s3cret/s3cret"
    )
  })

  it("resolves an undefined variable to an empty string", () => {
    expect(expandEnvironment("a${MISSING}b", environment.variables)).toBe("ab")
  })
})

describe("expandTilde", () => {
  it("expands a bare tilde and a tilde path", () => {
    expect(expandTilde("~", "/home/dev")).toBe("/home/dev")
    expect(expandTilde("~/projects", "/home/dev")).toBe("/home/dev/projects")
  })

  it("leaves a ~user form alone", () => {
    expect(expandTilde("~other/projects", "/home/dev")).toBe("~other/projects")
  })
})

describe("resolveCommandPath", () => {
  it("leaves a bare command for PATH lookup", () => {
    expect(resolveCommandPath("uvx", environment)).toBe("uvx")
  })

  it("makes a relative path absolute against the base directory", () => {
    expect(resolveCommandPath("./bin/server", environment)).toBe(
      "/work/repo/bin/server"
    )
  })

  it("keeps an absolute path unchanged", () => {
    expect(resolveCommandPath("/usr/bin/node", environment)).toBe(
      "/usr/bin/node"
    )
  })

  it("expands a tilde command path", () => {
    expect(resolveCommandPath("~/bin/server", environment)).toBe(
      "/home/dev/bin/server"
    )
  })
})

describe("resolveConfigPaths", () => {
  it("resolves only after assembly, and resolves every layer's survivors", () => {
    const merged = mergeConfig({
      global: {
        ...emptyGlobalConfig(),
        projectsDirectory: "~/projects",
        mcpServers: {
          local: {
            type: "stdio",
            command: "./bin/mcp",
            args: ["--token", "${TOKEN}"],
            env: { AUTH: "${TOKEN}" },
          },
          remote: {
            type: "http",
            url: "https://example.test",
            headers: { Authorization: "Bearer ${TOKEN}" },
          },
        },
        instances: {
          opencode: {
            instanceId: "opencode",
            driver: "opencode",
            enabled: true,
            autoStart: true,
            config: { directory: "~/untouched" },
            mcpServers: {
              scoped: { type: "stdio", command: "~/bin/scoped" },
            },
          },
        },
      },
    })

    // Before resolution the assembled values are still literal.
    expect(merged.projectsDirectory).toBe("~/projects")

    const resolved = resolveConfigPaths(merged, environment)

    expect(resolved.projectsDirectory).toBe("/home/dev/projects")
    expect(resolved.mcpServers.local).toEqual({
      type: "stdio",
      command: "/work/repo/bin/mcp",
      args: ["--token", "s3cret"],
      env: { AUTH: "s3cret" },
    })
    expect(resolved.mcpServers.remote).toMatchObject({
      headers: { Authorization: "Bearer s3cret" },
    })
    expect(resolved.instances.opencode?.mcpServers?.scoped).toEqual({
      type: "stdio",
      command: "/home/dev/bin/scoped",
    })
  })

  it("leaves driver-specific instance config opaque", () => {
    const merged = mergeConfig({
      global: {
        ...emptyGlobalConfig(),
        instances: {
          opencode: {
            instanceId: "opencode",
            driver: "opencode",
            enabled: true,
            autoStart: true,
            config: { directory: "~/mine" },
          },
        },
      },
    })
    const resolved = resolveConfigPaths(merged, environment)
    expect(resolved.instances.opencode?.config).toEqual({
      directory: "~/mine",
    })
  })

  it("is idempotent, so a recompute equals boot", () => {
    const merged = mergeConfig({
      global: {
        ...emptyGlobalConfig(),
        projectsDirectory: "~/projects",
        mcpServers: { local: { type: "stdio", command: "/abs/mcp" } },
      },
    })
    const once = resolveConfigPaths(merged, environment)
    expect(resolveConfigPaths(once, environment)).toEqual(once)
  })
})
