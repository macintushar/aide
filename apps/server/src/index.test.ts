import { describe, expect, it } from "vitest"

import app from "./index"

describe("server", () => {
  it("GET / responds with the greeting", async () => {
    const res = await app.request("/")

    expect(res.status).toBe(200)
    expect(await res.text()).toBe("Hello Hono!")
  })
})
