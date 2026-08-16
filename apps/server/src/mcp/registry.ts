import type { HarnessCapabilities, McpServerConfig } from "@workspace/contracts"

/**
 * Aide owns a normalized `McpServerConfig`. This module resolves the four
 * configuration layers into one record keyed by server name, and reports which
 * of the resolved servers a given adapter can actually accept.
 *
 * Adapters translate the normalized form into their native shape; they never
 * read the layers themselves, and Aide never mutates a harness's own config
 * file to inject servers.
 */

export type McpServerSource = "global" | "project" | "instance" | "aide"

export type ResolvedMcpServer = {
  readonly name: string
  readonly config: McpServerConfig
  /** Layer that supplied the winning entry. */
  readonly source: McpServerSource
}

export type McpResolutionLayers = {
  global?: Record<string, McpServerConfig>
  project?: Record<string, McpServerConfig>
  instance?: Record<string, McpServerConfig>
  /** Aide-hosted toolsets, applied last. */
  aide?: Record<string, McpServerConfig>
}

/**
 * Resolution order for a given send, merged additively by server name:
 * global, then project, then instance, then Aide-provided toolsets.
 *
 * The merge is additive: a name present in only one layer survives. A name
 * present in several is replaced wholesale by the later layer — an
 * `McpServerConfig` is a discriminated union, so field-level inheritance
 * across transports would be meaningless.
 */
export function resolveMcpServers(
  layers: McpResolutionLayers
): Record<string, ResolvedMcpServer> {
  const resolved: Record<string, ResolvedMcpServer> = {}
  const ordered: Array<[McpServerSource, Record<string, McpServerConfig>]> = [
    ["global", layers.global ?? {}],
    ["project", layers.project ?? {}],
    ["instance", layers.instance ?? {}],
    ["aide", layers.aide ?? {}],
  ]

  for (const [source, servers] of ordered) {
    for (const [name, config] of Object.entries(servers)) {
      resolved[name] = { name, config, source }
    }
  }

  return resolved
}

/** Drops the provenance, leaving the plain record adapters are handed. */
export function toServerRecord(
  resolved: Record<string, ResolvedMcpServer>
): Record<string, McpServerConfig> {
  return Object.fromEntries(
    Object.entries(resolved).map(([name, entry]) => [name, entry.config])
  )
}

export type UnsupportedMcpServer = {
  readonly name: string
  readonly transport: McpServerConfig["type"]
  readonly reason: string
}

export type McpCapabilityPartition = {
  readonly supported: Record<string, McpServerConfig>
  readonly unsupported: UnsupportedMcpServer[]
}

function supportsTransport(
  mcp: HarnessCapabilities["mcp"],
  type: McpServerConfig["type"]
): boolean {
  switch (type) {
    case "stdio":
      return mcp.stdio
    case "http":
      return mcp.http
    case "sse":
      return mcp.sse
    case "aide":
      // An Aide toolset needs either in-process hosting or an HTTP fallback
      // Aide can bind on loopback and pass as an `http` config instead.
      return mcp.inProcess || mcp.http
  }
}

/**
 * Splits resolved servers by what the adapter reports it can accept. A server
 * the adapter cannot take is not a fatal error: it is dropped from the send and
 * surfaced as a notice, per the non-fatal MCP failure policy.
 */
export function partitionByCapability(
  servers: Record<string, McpServerConfig>,
  capabilities: HarnessCapabilities
): McpCapabilityPartition {
  const supported: Record<string, McpServerConfig> = {}
  const unsupported: UnsupportedMcpServer[] = []

  for (const [name, config] of Object.entries(servers)) {
    if (supportsTransport(capabilities.mcp, config.type)) {
      supported[name] = config
      continue
    }
    unsupported.push({
      name,
      transport: config.type,
      reason:
        config.type === "aide"
          ? "adapter supports neither in-process toolsets nor an http fallback"
          : `adapter does not support the ${config.type} transport`,
    })
  }

  return { supported, unsupported }
}
