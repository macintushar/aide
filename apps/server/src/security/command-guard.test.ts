import { Hono } from "hono"
import { describe, expect, it } from "vitest"

import { createCommandGuard } from "./command-guard"
import { isLoopbackHost, loopbackOrigins } from "./loopback"

const bearerToken = "test-bearer-token"
const allowedOrigins = loopbackOrigins(3000)

function createApp() {
  const app = new Hono()
  app.use("/commands/*", createCommandGuard({ bearerToken, allowedOrigins }))
  app.post("/commands/test", (c) => c.json({ ok: true }))
  app.get("/", (c) => c.text("root"))
  return app
}

describe("command guard", () => {
  it("rejects a missing Authorization header with 401", async () => {
    const res = await createApp().request("/commands/test", { method: "POST" })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "unauthorized" })
  })

  it("rejects a wrong bearer token with 401", async () => {
    const res = await createApp().request("/commands/test", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-token" },
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "unauthorized" })
  })

  it("rejects a non-Bearer Authorization scheme with 401", async () => {
    const res = await createApp().request("/commands/test", {
      method: "POST",
      headers: { Authorization: `Basic ${bearerToken}` },
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "unauthorized" })
  })

  it("allows a correct token without an Origin header", async () => {
    const res = await createApp().request("/commands/test", {
      method: "POST",
      headers: { Authorization: `Bearer ${bearerToken}` },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it("rejects a disallowed Origin with 403", async () => {
    const res = await createApp().request("/commands/test", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Origin: "https://evil.example",
      },
    })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "origin_not_allowed" })
  })

  it("allows an allowed Origin", async () => {
    const app = createApp()

    for (const origin of allowedOrigins) {
      const res = await app.request("/commands/test", {
        method: "POST",
        headers: { Authorization: `Bearer ${bearerToken}`, Origin: origin },
      })

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
    }
  })

  it("leaves unguarded routes unaffected", async () => {
    const res = await createApp().request("/")

    expect(res.status).toBe(200)
    expect(await res.text()).toBe("root")
  })
})

describe("isLoopbackHost", () => {
  it("accepts loopback hosts", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true)
    expect(isLoopbackHost("127.0.0.0")).toBe(true)
    expect(isLoopbackHost("127.255.255.255")).toBe(true)
    expect(isLoopbackHost("127.1.2.3")).toBe(true)
    expect(isLoopbackHost("::1")).toBe(true)
    expect(isLoopbackHost("[::1]")).toBe(true)
    expect(isLoopbackHost("localhost")).toBe(true)
    expect(isLoopbackHost("LocalHost")).toBe(true)
    expect(isLoopbackHost("LOCALHOST")).toBe(true)
  })

  it("rejects non-loopback hosts", () => {
    expect(isLoopbackHost("0.0.0.0")).toBe(false)
    expect(isLoopbackHost("10.0.0.1")).toBe(false)
    expect(isLoopbackHost("192.168.1.1")).toBe(false)
    expect(isLoopbackHost("172.16.0.1")).toBe(false)
    expect(isLoopbackHost("::")).toBe(false)
    expect(isLoopbackHost("::ffff:127.0.0.1")).toBe(false)
    expect(isLoopbackHost("localhost.evil.example")).toBe(false)
    expect(isLoopbackHost("sub.localhost")).toBe(false)
    expect(isLoopbackHost("127.0.0.1.evil.example")).toBe(false)
    expect(isLoopbackHost("1270.0.0.1")).toBe(false)
    expect(isLoopbackHost("example.com")).toBe(false)
    expect(isLoopbackHost("")).toBe(false)
  })
})

describe("loopbackOrigins", () => {
  it("returns the loopback origins for a port", () => {
    expect(loopbackOrigins(3000)).toEqual([
      "http://127.0.0.1:3000",
      "http://localhost:3000",
      "http://[::1]:3000",
    ])
  })
})
