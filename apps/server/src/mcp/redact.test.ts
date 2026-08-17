import { describe, expect, it } from "vitest"

import {
  REDACTED,
  redactMcpServer,
  redactSecrets,
  restoreRedactedDriverConfig,
  restoreRedactedMcpServers,
} from "./redact"

describe("MCP redaction", () => {
  it("redacts stdio environment values and HTTP-family headers", () => {
    expect(
      redactMcpServer({
        type: "stdio",
        command: "mcp",
        env: { TOKEN: "secret" },
      })
    ).toMatchObject({ env: { TOKEN: REDACTED } })
    expect(
      redactMcpServer({
        type: "http",
        url: "https://mcp.example.test",
        headers: { authorization: "Bearer secret" },
      })
    ).toMatchObject({ headers: { authorization: REDACTED } })
    expect(
      redactMcpServer({
        type: "sse",
        url: "https://mcp.example.test/events",
        headers: { cookie: "secret" },
      })
    ).toMatchObject({ headers: { cookie: REDACTED } })
    expect(redactMcpServer({ type: "aide", toolset: "tools" })).toEqual({
      type: "aide",
      toolset: "tools",
    })
  })

  it("restores only matching redacted secrets", () => {
    expect(
      restoreRedactedMcpServers(
        {
          kept: {
            type: "http",
            url: "https://mcp.example.test",
            headers: { authorization: REDACTED, added: "new" },
          },
          changed: { type: "sse", url: "https://mcp.example.test/events" },
        },
        {
          kept: {
            type: "http",
            url: "https://mcp.example.test",
            headers: { authorization: "Bearer existing" },
          },
          changed: {
            type: "http",
            url: "https://mcp.example.test",
            headers: { authorization: "Bearer existing" },
          },
        }
      )
    ).toEqual({
      kept: {
        type: "http",
        url: "https://mcp.example.test",
        headers: { authorization: "Bearer existing", added: "new" },
      },
      changed: { type: "sse", url: "https://mcp.example.test/events" },
    })
  })

  it("scrubs named secrets in unstructured diagnostics", () => {
    expect(
      redactSecrets({
        token: "secret",
        nested: [{ apiKey: "secret" }, { visible: "value" }],
      })
    ).toEqual({
      token: REDACTED,
      nested: [{ apiKey: REDACTED }, { visible: "value" }],
    })
  })

  it("redacts and restores opaque driver environment values at matching paths", () => {
    const stored = {
      env: { ANTHROPIC_API_KEY: "driver-secret", LABEL: "private" },
      accessToken: "token-secret",
      model: "claude",
    }
    expect(redactSecrets(stored)).toEqual({
      env: { ANTHROPIC_API_KEY: REDACTED, LABEL: REDACTED },
      accessToken: REDACTED,
      model: "claude",
    })
    expect(
      restoreRedactedDriverConfig(
        { env: { ANTHROPIC_API_KEY: REDACTED, NEW: REDACTED } },
        stored
      )
    ).toEqual({
      env: { ANTHROPIC_API_KEY: "driver-secret", NEW: REDACTED },
    })
    expect(restoreRedactedDriverConfig([REDACTED], ["array-secret"])).toEqual([
      "array-secret",
    ])
  })
})
