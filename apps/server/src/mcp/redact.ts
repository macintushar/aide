import type { McpServerConfig } from "@workspace/contracts"

/**
 * Secrets in MCP configuration (headers, env) must be redacted from every
 * diagnostic, event, and log. Redaction happens on the way out, so the stored
 * configuration keeps the real values and only the projection is scrubbed.
 */

export const REDACTED = "[redacted]"

function redactValues(
  values: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!values) return undefined
  return Object.fromEntries(Object.keys(values).map((key) => [key, REDACTED]))
}

/**
 * Returns a copy safe to log. Structural fields (transport, command, url,
 * toolset, arg vector) survive because they are what makes a diagnostic useful;
 * every header and env value is replaced.
 */
export function redactMcpServer(config: McpServerConfig): McpServerConfig {
  switch (config.type) {
    case "stdio":
      return {
        ...config,
        ...(config.env ? { env: redactValues(config.env) } : {}),
      }
    case "http":
    case "sse":
      return {
        ...config,
        ...(config.headers ? { headers: redactValues(config.headers) } : {}),
      }
    case "aide":
      return { ...config }
  }
}

export function redactMcpServers(
  servers: Record<string, McpServerConfig>
): Record<string, McpServerConfig> {
  return Object.fromEntries(
    Object.entries(servers).map(([name, config]) => [
      name,
      redactMcpServer(config),
    ])
  )
}

const SECRET_KEY_PATTERN =
  /(token|secret|password|passwd|api[-_]?key|authorization|credential)/i

/**
 * Best-effort scrub for free-form diagnostic payloads that may embed MCP
 * configuration — adapter errors, for instance, which Aide does not control the
 * shape of.
 */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? REDACTED : redactSecrets(entry),
      ])
    )
  }
  return value
}
