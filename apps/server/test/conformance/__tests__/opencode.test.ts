import type { InstanceConfig } from "@workspace/contracts"

import { createOpencodeAdapter } from "../../../src/harness/opencode"
import type {
  OpencodeAgent,
  OpencodeApi,
  OpencodeRuntimeFactory,
} from "../../../src/harness/opencode"
import { createOpencodeSdkDouble } from "../../../src/test/opencode-sdk-double"
import { defineHarnessAdapterConformance } from ".././adapter-conformance"

/**
 * The OpenCode adapter against the shared conformance suite.
 *
 * The SDK is replaced by a double rather than a live OpenCode server: the
 * adapter's own contract is what is under test, and a suite that needed a real
 * runtime and real provider credentials would not run in CI.
 */

const PROJECT_DIRECTORY = "/tmp/aide-conformance-opencode"

export function createFakeOpencodeApi(
  overrides: {
    version?: string
    models?: OpencodeModels
    agents?: OpencodeAgent[]
  } = {}
): { api: OpencodeApi; calls: { directories: Array<string | undefined> } } {
  return createOpencodeSdkDouble(overrides)
}

type OpencodeModels = Awaited<ReturnType<OpencodeApi["model"]["list"]>>["data"]

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
  scope: "full",
  createSubject: subject,
  validConfig: { baseUrl: "http://127.0.0.1:4096" },
  invalidConfig: {
    baseUrl: "http://127.0.0.1:4096",
    databasePath: "/tmp/opencode.sqlite",
  },
})
