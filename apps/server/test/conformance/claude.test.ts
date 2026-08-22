import { describe, expect, it } from "vitest"
import type { InstanceConfig } from "@workspace/contracts"

import { createClaudeAdapter } from "../../src/harness/claude"
import { createClaudeSessionDoubleFactory } from "../../src/test/claude-sdk-double"
import { defineHarnessAdapterConformance } from "./adapter-conformance"

/**
 * The Claude adapter against the shared conformance suite — the same suite the
 * fake and the OpenCode adapter run, which is the whole point of having one.
 *
 * Full scope: the SDK is replaced by a double that speaks the SDK's own wire
 * shapes, so the adapter still has to do the part synthesis and the permission
 * inversion for real. A live query would need a Claude Code install and real
 * credentials.
 */

const PROJECT_DIRECTORY = "/tmp/aide-conformance-claude"

function subject() {
  const createSession = createClaudeSessionDoubleFactory({
    mcpStatuses: [
      { name: "conformance-stdio", status: "connected" },
      { name: "conformance-http", status: "failed" },
    ],
  })
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
  scope: "full",
  createSubject: subject,
  validConfig: { model: "claude-opus-5" },
  invalidConfig: { model: 42 },
})

describe("claude adapter: native session lifecycle", () => {
  it("refuses to resume a native session that has no live query", async () => {
    const { adapter, instanceConfig, projectDirectory } = subject()
    const handle = await adapter.start({
      instance: instanceConfig,
      projectDirectory,
    })

    await expect(
      adapter.resumeSession({
        handle,
        sessionId: "session-cold",
        nativeSessionId: "claude-native-cold",
      })
    ).rejects.toMatchObject({
      aideError: { code: "native_session_not_resumable", retryable: true },
    })
  })

  it("refuses a send against an unopened native session", async () => {
    const { adapter, instanceConfig, projectDirectory } = subject()
    const handle = await adapter.start({
      instance: instanceConfig,
      projectDirectory,
    })

    await expect(
      adapter.send({
        handle,
        nativeSession: { nativeSessionId: "missing" },
        commandId: "c1",
        turnId: "t1",
        userMessage: {} as never,
        execution: {} as never,
      })
    ).rejects.toMatchObject({
      aideError: { code: "native_session_not_found" },
    })
  })
})
