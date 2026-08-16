import { describe, expect, it } from "vitest"
import type { HarnessCapabilities, McpServerConfig } from "@workspace/contracts"

import {
  partitionByCapability,
  resolveMcpServers,
  toServerRecord,
} from "./registry"
import { redactMcpServers, redactSecrets, REDACTED } from "./redact"
import { translateMcpServers, type McpTranslator } from "./translation"

function capabilities(
  mcp: Partial<HarnessCapabilities["mcp"]>
): HarnessCapabilities {
  return {
    inventoryScope: "directory",
    agentSelection: true,
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
      inProcess: false,
      runtimeReconfigure: true,
      ...mcp,
    },
  }
}

const stdio: McpServerConfig = { type: "stdio", command: "mcp" }

describe("resolveMcpServers", () => {
  it("merges additively by name in global, project, instance, aide order", () => {
    const resolved = resolveMcpServers({
      global: { a: stdio, shared: { type: "stdio", command: "global" } },
      project: { b: stdio, shared: { type: "stdio", command: "project" } },
      instance: { c: stdio, shared: { type: "stdio", command: "instance" } },
      aide: { d: { type: "aide", toolset: "workspace" } },
    })

    expect(Object.keys(resolved).sort()).toEqual(["a", "b", "c", "d", "shared"])
    expect(resolved.shared?.source).toBe("instance")
    expect(resolved.shared?.config).toEqual({
      type: "stdio",
      command: "instance",
    })
  })

  it("lets an Aide toolset win last", () => {
    const resolved = resolveMcpServers({
      instance: { tools: stdio },
      aide: { tools: { type: "aide", toolset: "workspace" } },
    })
    expect(resolved.tools?.source).toBe("aide")
  })

  it("replaces wholesale rather than merging across transports", () => {
    const resolved = resolveMcpServers({
      global: {
        one: { type: "http", url: "https://a.test", headers: { A: "1" } },
      },
      project: { one: { type: "stdio", command: "b" } },
    })
    expect(resolved.one?.config).toEqual({ type: "stdio", command: "b" })
  })

  it("drops provenance for the adapter-facing record", () => {
    const resolved = resolveMcpServers({ global: { a: stdio } })
    expect(toServerRecord(resolved)).toEqual({ a: stdio })
  })
})

describe("partitionByCapability", () => {
  it("reports a transport the adapter does not support", () => {
    const partition = partitionByCapability(
      { local: stdio, remote: { type: "sse", url: "https://a.test" } },
      capabilities({ sse: false })
    )
    expect(Object.keys(partition.supported)).toEqual(["local"])
    expect(partition.unsupported).toEqual([
      {
        name: "remote",
        transport: "sse",
        reason: "adapter does not support the sse transport",
      },
    ])
  })

  it("accepts an aide toolset when the adapter can host it in process", () => {
    const partition = partitionByCapability(
      { tools: { type: "aide", toolset: "workspace" } },
      capabilities({ inProcess: true, http: false })
    )
    expect(Object.keys(partition.supported)).toEqual(["tools"])
  })

  it("accepts an aide toolset over the loopback http fallback", () => {
    const partition = partitionByCapability(
      { tools: { type: "aide", toolset: "workspace" } },
      capabilities({ inProcess: false, http: true })
    )
    expect(Object.keys(partition.supported)).toEqual(["tools"])
  })

  it("reports an aide toolset the adapter can host neither way", () => {
    const partition = partitionByCapability(
      { tools: { type: "aide", toolset: "workspace" } },
      capabilities({ inProcess: false, http: false })
    )
    expect(partition.supported).toEqual({})
    expect(partition.unsupported[0]?.reason).toContain("neither in-process")
  })
})

describe("translateMcpServers", () => {
  const translator: McpTranslator<{ kind: string }> = {
    capabilities: capabilities({}).mcp,
    translate(_name, config) {
      return config.type === "aide" ? undefined : { kind: config.type }
    },
  }

  it("translates supported servers and reports declined ones", () => {
    const result = translateMcpServers(
      {
        local: stdio,
        tools: { type: "aide", toolset: "workspace" },
      },
      translator,
      capabilities({ http: true })
    )

    expect(result.servers).toEqual({ local: { kind: "stdio" } })
    expect(result.unsupported[0]).toMatchObject({
      name: "tools",
      reason: "adapter declined the server configuration",
    })
  })

  it("never throws, so a bad server does not stop the turn", () => {
    expect(() =>
      translateMcpServers(
        { remote: { type: "sse", url: "https://a.test" } },
        translator,
        capabilities({ sse: false })
      )
    ).not.toThrow()
  })
})

describe("secret redaction", () => {
  it("redacts env and header values but keeps the structure", () => {
    const redacted = redactMcpServers({
      local: {
        type: "stdio",
        command: "mcp",
        args: ["--flag"],
        env: { TOKEN: "s3cret" },
      },
      remote: {
        type: "http",
        url: "https://a.test",
        headers: { Authorization: "Bearer s3cret" },
      },
      tools: { type: "aide", toolset: "workspace" },
    })

    expect(redacted.local).toEqual({
      type: "stdio",
      command: "mcp",
      args: ["--flag"],
      env: { TOKEN: REDACTED },
    })
    expect(redacted.remote).toEqual({
      type: "http",
      url: "https://a.test",
      headers: { Authorization: REDACTED },
    })
    expect(redacted.tools).toEqual({ type: "aide", toolset: "workspace" })
  })

  it("leaves a server without secrets untouched", () => {
    expect(redactMcpServers({ local: stdio }).local).toEqual(stdio)
  })

  it("scrubs secret-looking keys from free-form diagnostics", () => {
    expect(
      redactSecrets({
        detail: { apiKey: "abc", nested: { password: "x", safe: "keep" } },
        list: [{ token: "t" }],
      })
    ).toEqual({
      detail: {
        apiKey: REDACTED,
        nested: { password: REDACTED, safe: "keep" },
      },
      list: [{ token: REDACTED }],
    })
  })
})
