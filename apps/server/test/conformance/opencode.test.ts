import { describe, expect, it } from "vitest"
import type { InstanceConfig } from "@workspace/contracts"

import { createOpencodeAdapter } from "../../src/harness/opencode"
import type {
  OpencodeApi,
  OpencodeRuntimeFactory,
} from "../../src/harness/opencode"
import { defineHarnessAdapterConformance } from "./adapter-conformance"

/**
 * The OpenCode adapter against the shared conformance suite.
 *
 * The suite runs at `lifecycle` scope because Wave 2 owns configuration,
 * start/stop/health, and discovery; the send path is Wave 3 and flips this to
 * `full`.
 *
 * The SDK is replaced by a double rather than a live OpenCode server: the
 * adapter's own contract is what is under test, and a suite that needed a real
 * runtime and real provider credentials would not run in CI.
 */

const PROJECT_DIRECTORY = "/tmp/aide-conformance-opencode"

export function createFakeOpencodeApi(
  overrides: {
    version?: string
    providers?: OpencodeProviders
    agents?: OpencodeAgents
  } = {}
): { api: OpencodeApi; calls: { directories: Array<string | undefined> } } {
  const calls = { directories: [] as Array<string | undefined> }
  const api: OpencodeApi = {
    global: {
      async health() {
        return {
          data: { healthy: true, version: overrides.version ?? "1.18.16" },
        }
      },
    },
    config: {
      async providers(parameters) {
        calls.directories.push(parameters?.directory)
        return {
          data: overrides.providers ?? {
            providers: [
              {
                id: "anthropic",
                name: "Anthropic",
                source: "env",
                env: ["ANTHROPIC_API_KEY"],
                key: "set",
                models: {
                  "claude-opus-5": {
                    id: "claude-opus-5",
                    providerID: "anthropic",
                    name: "Claude Opus 5",
                    variants: { standard: {}, thinking: {} },
                  },
                  "claude-sonnet-5": {
                    id: "claude-sonnet-5",
                    providerID: "anthropic",
                    name: "Claude Sonnet 5",
                  },
                },
              },
            ],
            default: { anthropic: "claude-opus-5" },
          },
        }
      },
    },
    app: {
      async agents() {
        return {
          data: overrides.agents ?? [
            { name: "build", mode: "primary" },
            { name: "plan", mode: "primary" },
            { name: "explore", mode: "subagent" },
            { name: "internal", mode: "primary", hidden: true },
          ],
        }
      },
    },
  }
  return { api, calls }
}

type OpencodeProviders = NonNullable<
  Awaited<ReturnType<OpencodeApi["config"]["providers"]>>["data"]
>
type OpencodeAgents = NonNullable<
  Awaited<ReturnType<OpencodeApi["app"]["agents"]>>["data"]
>

function subject() {
  const { api } = createFakeOpencodeApi()
  const createRuntime: OpencodeRuntimeFactory = async () => ({ api })
  const instanceConfig: InstanceConfig = {
    instanceId: "opencode-primary",
    driver: "opencode",
    displayName: "OpenCode Primary",
    enabled: true,
    autoStart: true,
    config: {},
  }
  return {
    adapter: createOpencodeAdapter({ createRuntime }),
    instanceConfig,
    projectDirectory: PROJECT_DIRECTORY,
  }
}

defineHarnessAdapterConformance({
  name: "opencode",
  scope: "lifecycle",
  createSubject: subject,
  validConfig: { baseUrl: "http://127.0.0.1:4096" },
  invalidConfig: { baseUrl: "http://127.0.0.1:4096", port: 4096 },
})

describe("opencode adapter: Wave 3 surface", () => {
  it("refuses the send path with a structured not_implemented error", async () => {
    const { adapter, instanceConfig, projectDirectory } = subject()
    const handle = await adapter.start({
      instance: instanceConfig,
      projectDirectory,
    })

    await expect(
      adapter.openSession({
        handle,
        sessionId: "s1",
        projectDirectory,
        execution: {} as never,
      })
    ).rejects.toMatchObject({ aideError: { code: "not_implemented" } })
  })
})
