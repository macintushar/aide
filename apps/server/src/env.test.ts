import { describe, expect, it } from "vitest"

import { env } from "./env"

describe("env", () => {
  it("validates process environment at boot", () => {
    expect(env.HOST).toBe("127.0.0.1")
    expect(env.PORT).toBe(3000)
    expect(env.AIDE_BEARER_TOKEN).toBe("test-bearer-token")
    expect(env.DB_FILE_NAME).toBe(":memory:")
  })
})
