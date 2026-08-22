import { Hono } from "hono"
import { describe, expect, it } from "vitest"

import {
  bearerFromHeader,
  createSessionAuth,
  createBootstrapHandler,
  createSessionGuard,
  type SessionTokenStore,
} from "./session-auth"
import { loopbackOrigins } from "./loopback"
import { createDbTokenStore } from "./db-token-store"
import { createTestDb } from "../test/db"

const bootstrapToken = "bootstrap-token"
const allowedOrigins = loopbackOrigins(3000)

function createApp(
  options: {
    now?: () => number
    bootstrapToken?: string
    store?: SessionTokenStore
  } = {}
) {
  const auth = createSessionAuth({
    ...(options.bootstrapToken !== undefined
      ? { bootstrapToken: options.bootstrapToken }
      : {}),
    ...(options.store ? { store: options.store } : {}),
    now: options.now,
  })
  const app = new Hono()
  app.post("/auth/session", createBootstrapHandler(auth, allowedOrigins))
  app.use("/commands/*", createSessionGuard(auth, allowedOrigins))
  app.post("/commands/test", (c) => c.json({ ok: true }))
  app.get("/", (c) => c.text("root"))
  return { app, auth }
}

async function exchange(
  app: Hono,
  authorization?: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.request("/auth/session", {
    method: "POST",
    headers: authorization ? { Authorization: authorization } : {},
  })
  return { status: res.status, body: await res.json() }
}

describe("bootstrap exchange", () => {
  it("issues a session credential for the bootstrap token with 201", async () => {
    const { app } = createApp({ bootstrapToken })
    const { status, body } = await exchange(app, `Bearer ${bootstrapToken}`)

    expect(status).toBe(201)
    expect(body.sessionToken).toEqual(expect.any(String))
    expect(body.sessionToken).not.toEqual(bootstrapToken)
    expect(new Date(body.expiresAt as string).getTime()).toBeGreaterThan(
      Date.now()
    )
  })

  it("rejects a missing or wrong bootstrap token with 401", async () => {
    const { app } = createApp({ bootstrapToken })

    expect((await exchange(app)).status).toBe(401)
    expect((await exchange(app, "Bearer wrong")).status).toBe(401)
    expect((await exchange(app, `Basic ${bootstrapToken}`)).status).toBe(401)
  })

  it("rejects a disallowed Origin with 403 before checking the token", async () => {
    const { app } = createApp({ bootstrapToken })
    const res = await app.request("/auth/session", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bootstrapToken}`,
        Origin: "https://evil.example",
      },
    })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "origin_not_allowed" })
  })

  it("mints a distinct session per exchange", async () => {
    const { app } = createApp({ bootstrapToken })
    const first = await exchange(app, `Bearer ${bootstrapToken}`)
    const second = await exchange(app, `Bearer ${bootstrapToken}`)

    expect(first.body.sessionToken).not.toEqual(second.body.sessionToken)
  })

  it("works without a bootstrap token configured", async () => {
    const { app } = createApp()

    // Nothing can mint a session yet: the server is locked until a
    // credential arrives from somewhere trusted.
    expect((await exchange(app)).status).toBe(401)
  })

  it("lets a logged-in session mint another session", async () => {
    const { app, auth } = createApp({ bootstrapToken })
    const { body } = await exchange(app, `Bearer ${bootstrapToken}`)
    const first = body.sessionToken as string

    const paired = await exchange(app, `Bearer ${first}`)
    expect(paired.status).toBe(201)

    const second = paired.body.sessionToken as string
    expect(second).not.toEqual(first)
    const res = await app.request("/commands/test", {
      method: "POST",
      headers: { Authorization: `Bearer ${second}` },
    })
    expect(res.status).toBe(200)
    expect(auth.verify(`Bearer ${first}`.slice("Bearer ".length))).toBe(true)
  })
})

describe("session guard", () => {
  it("accepts a request carrying an issued session credential", async () => {
    const { app } = createApp({ bootstrapToken })
    const { body } = await exchange(app, `Bearer ${bootstrapToken}`)
    const res = await app.request("/commands/test", {
      method: "POST",
      headers: { Authorization: `Bearer ${body.sessionToken}` },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it("rejects missing and unknown credentials with 401", async () => {
    const { app } = createApp({ bootstrapToken })

    for (const authorization of [
      undefined,
      "Bearer unknown-session-token",
      `Basic ${bootstrapToken}`,
    ]) {
      const res = await app.request("/commands/test", {
        method: "POST",
        headers: authorization ? { Authorization: authorization } : {},
      })
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: "unauthorized" })
    }
  })

  it("never accepts the bootstrap token on a data route", async () => {
    const { app } = createApp({ bootstrapToken })
    const res = await app.request("/commands/test", {
      method: "POST",
      headers: { Authorization: `Bearer ${bootstrapToken}` },
    })

    expect(res.status).toBe(401)
  })

  it("rejects expired sessions with 401", async () => {
    let time = 1_000_000
    const { app } = createApp({
      bootstrapToken,
      now: () => time,
    })
    const { body } = await exchange(app, `Bearer ${bootstrapToken}`)
    const headers = { Authorization: `Bearer ${body.sessionToken}` }

    time += 1000
    const live = await app.request("/commands/test", {
      method: "POST",
      headers,
    })
    expect(live.status).toBe(200)

    time += 12 * 60 * 60 * 1000
    const expired = await app.request("/commands/test", {
      method: "POST",
      headers,
    })
    expect(expired.status).toBe(401)
  })

  it("persists sessions across a restart via the db store", async () => {
    const { client, db } = createTestDb()
    try {
      const store = createDbTokenStore(db)
      let time = 1_000_000
      const first = createApp({ bootstrapToken, now: () => time, store })
      const { body } = await exchange(first.app, `Bearer ${bootstrapToken}`)
      const token = body.sessionToken as string

      // "Restart": a brand-new auth service over the same database.
      time += 5_000
      const restarted = createApp({ now: () => time, store })
      expect(restarted.auth.verify(token)).toBe(true)
      const res = await restarted.app.request("/commands/test", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.status).toBe(200)

      // And the old boot's bootstrap token no longer exists to be guessed.
      expect(
        (await exchange(restarted.app, `Bearer ${bootstrapToken}`)).status
      ).toBe(401)
    } finally {
      client.close()
    }
  })

  it("rejects a disallowed Origin with 403", async () => {
    const { app } = createApp({ bootstrapToken })
    const { body } = await exchange(app, `Bearer ${bootstrapToken}`)
    const res = await app.request("/commands/test", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${body.sessionToken}`,
        Origin: "https://evil.example",
      },
    })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "origin_not_allowed" })
  })

  it("leaves unguarded routes unaffected", async () => {
    const { app } = createApp()
    const res = await app.request("/")

    expect(res.status).toBe(200)
    expect(await res.text()).toBe("root")
  })
})

describe("bearerFromHeader", () => {
  it("extracts the bearer value and rejects other schemes", () => {
    expect(bearerFromHeader("Bearer abc")).toBe("abc")
    expect(bearerFromHeader("Basic abc")).toBeUndefined()
    expect(bearerFromHeader(undefined)).toBeUndefined()
    expect(bearerFromHeader("Bearer")).toBeUndefined()
  })
})
