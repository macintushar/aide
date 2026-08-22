import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { env } from "./env"

const envKeys = ["HOST", "PORT", "DB_FILE_NAME"] as const
const validEnv = {
  HOST: "127.0.0.1",
  PORT: "3000",
  DB_FILE_NAME: ":memory:",
}
const serverRoot = fileURLToPath(new URL("..", import.meta.url))
const printEnv =
  'import("./src/env.ts").then(({ env }) => console.log(JSON.stringify(env)))'

function loadEnv(
  overrides: Partial<Record<(typeof envKeys)[number], string>> = {},
  defaults = false
) {
  const childEnv = { ...process.env }
  for (const key of envKeys) delete childEnv[key]
  if (!defaults) Object.assign(childEnv, validEnv)
  Object.assign(childEnv, overrides)

  return spawnSync("bun", ["-e", printEnv], {
    cwd: serverRoot,
    encoding: "utf8",
    env: childEnv,
  })
}

describe("env", () => {
  it("validates process environment at boot", () => {
    expect(env.HOST).toBe("127.0.0.1")
    expect(env.PORT).toBe(3000)
    expect(env.DB_FILE_NAME).toBe(":memory:")
  })

  it("uses safe defaults when nothing is set", () => {
    const result = loadEnv({}, true)

    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      HOST: "127.0.0.1",
      PORT: 3000,
      DB_FILE_NAME: "./data/aide.sqlite",
    })
  })

  it.each(["127.0.0.1", "127.1.2.3", "localhost", "::1", "[::1]"])(
    "accepts explicit loopback host %s",
    (host) => {
      const result = loadEnv({ HOST: host })

      expect(result.status, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout).HOST).toBe(host)
    }
  )

  it.each([
    ["HOST", { HOST: "0.0.0.0" }],
    ["PORT", { PORT: "0" }],
    ["DB_FILE_NAME", { DB_FILE_NAME: " " }],
  ] as const)("fails fast for invalid %s", (key, overrides) => {
    const result = loadEnv(overrides)

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(key)
  })

  it("carries no credential in the environment", () => {
    // The bootstrap token is generated at boot and lives in the logs only.
    expect("AIDE_BEARER_TOKEN" in env).toBe(false)
  })
})
