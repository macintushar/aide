import { describe, expect, it } from "vitest"
import type { InstanceConfig } from "@workspace/contracts"

import { createClaudeAdapter } from "../../src/harness/claude"
import type {
  ClaudeModelInfo,
  ClaudeSession,
  ClaudeSessionFactory,
} from "../../src/harness/claude"
import { defineHarnessAdapterConformance } from "./adapter-conformance"

/**
 * The Claude adapter against the shared conformance suite — the same suite the
 * fake and the OpenCode adapter run, which is the whole point of having one.
 *
 * Lifecycle scope for Wave 2. The SDK is replaced by a double: a live query
 * would need a real Claude Code install and real credentials.
 */

const PROJECT_DIRECTORY = "/tmp/aide-conformance-claude"

export const DEFAULT_CLAUDE_MODELS: ClaudeModelInfo[] = [
  {
    value: "claude-opus-5",
    displayName: "Claude Opus 5",
    description: "Most capable",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    value: "claude-haiku-4-5-20251001",
    displayName: "Claude Haiku 4.5",
    description: "Fastest",
    supportsEffort: false,
  },
]

export function createFakeClaudeSession(
  overrides: {
    version?: string
    models?: ClaudeModelInfo[]
    agents?: Array<{ name: string }>
    mcpStatuses?: Array<{ name: string; status: string }>
    onDiscover?: () => void
  } = {}
): { session: ClaudeSession; closed: () => boolean } {
  let closed = false
  const session: ClaudeSession = {
    init: {
      version: overrides.version ?? "2.1.228",
      model: "claude-opus-5",
      apiKeySource: "oauth",
      sessionId: "native-claude-session",
    },
    query: {
      async supportedModels() {
        overrides.onDiscover?.()
        return overrides.models ?? DEFAULT_CLAUDE_MODELS
      },
      async supportedAgents() {
        return overrides.agents ?? [{ name: "Explore" }]
      },
      async mcpServerStatus() {
        return overrides.mcpStatuses ?? []
      },
      async interrupt() {
        return undefined
      },
    },
    async close() {
      closed = true
    },
  }
  return { session, closed: () => closed }
}

function subject() {
  // One live query per instance, created lazily by the adapter's start().
  const createSession: ClaudeSessionFactory = async () => {
    const { session } = createFakeClaudeSession({
      mcpStatuses: [
        { name: "conformance-stdio", status: "connected" },
        { name: "conformance-http", status: "failed" },
      ],
    })
    return session
  }
  const instanceConfig: InstanceConfig = {
    instanceId: "claude-primary",
    driver: "claudeAgent",
    displayName: "Claude Primary",
    enabled: true,
    autoStart: true,
    config: {},
  }
  return {
    adapter: createClaudeAdapter({ createSession }),
    instanceConfig,
    projectDirectory: PROJECT_DIRECTORY,
  }
}

defineHarnessAdapterConformance({
  name: "claudeAgent",
  scope: "lifecycle",
  createSubject: subject,
  validConfig: { model: "claude-opus-5" },
  invalidConfig: { model: 42 },
})

describe("claude adapter: Wave 3 surface", () => {
  it("refuses the send path with a structured not_implemented error", async () => {
    const { adapter, instanceConfig, projectDirectory } = subject()
    const handle = await adapter.start({
      instance: instanceConfig,
      projectDirectory,
    })

    await expect(
      adapter.send({
        handle,
        nativeSession: { nativeSessionId: "n1" },
        commandId: "c1",
        turnId: "t1",
        userMessage: {} as never,
        execution: {} as never,
      })
    ).rejects.toMatchObject({ aideError: { code: "not_implemented" } })
  })
})
