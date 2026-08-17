import type { AideError, McpServerConfig } from "@workspace/contracts"

import { partitionByCapability, type UnsupportedMcpServer } from "./registry"
import type { HarnessCapabilities } from "@workspace/contracts"

/**
 * The seam between Aide's normalized MCP configuration and a harness's native
 * shape. Each adapter implements one translator; nothing outside the adapter
 * directory knows what the native shape looks like.
 */
export interface McpTranslator<TNative> {
  /** Transports and hosting modes this adapter accepts. */
  readonly capabilities: HarnessCapabilities["mcp"]
  /**
   * Translate one normalized server. Returning `undefined` means "this adapter
   * declines the server" and is equivalent to reporting it unsupported.
   */
  translate(name: string, config: McpServerConfig): TNative | undefined
}

export type McpTranslationResult<TNative> = {
  readonly servers: Record<string, TNative>
  readonly unsupported: UnsupportedMcpServer[]
}

/**
 * Applies a translator to the resolved server record. Servers the adapter
 * cannot accept are reported, never thrown: a server that fails to connect
 * disables its own tools and raises a notice, and the turn still runs.
 */
export function translateMcpServers<TNative>(
  servers: Record<string, McpServerConfig>,
  translator: McpTranslator<TNative>,
  capabilities: HarnessCapabilities
): McpTranslationResult<TNative> {
  const partition = partitionByCapability(servers, capabilities)
  const translated: Record<string, TNative> = {}
  const unsupported = [...partition.unsupported]

  for (const [name, config] of Object.entries(partition.supported)) {
    const native = translator.translate(name, config)
    if (native === undefined) {
      unsupported.push({
        name,
        transport: config.type,
        reason: "adapter declined the server configuration",
      })
      continue
    }
    translated[name] = native
  }

  return { servers: translated, unsupported }
}

/** Notice-shaped error for a server the active adapter cannot accept. */
export function unsupportedMcpError(
  instanceId: string,
  server: UnsupportedMcpServer
): AideError {
  return {
    code: "mcp_transport_unsupported",
    message: `MCP server "${server.name}" was skipped: ${server.reason}`,
    instanceId,
    retryable: false,
    detail: { server: server.name, transport: server.transport },
  }
}
