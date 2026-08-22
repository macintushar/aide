import { describe, expect, it, vi } from "vitest"

import { createSessionAuth, type SessionStorage } from "./session-auth"

const credential = (sessionToken: string) => ({
  sessionToken,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function memoryStorage(seed?: string): SessionStorage & { size(): number } {
  const map = new Map<string, string>()
  if (seed) map.set("aide.session-token", seed)
  return {
    load: () => map.get("aide.session-token"),
    save: (token) => void map.set("aide.session-token", token),
    clear: () => void map.delete("aide.session-token"),
    size: () => map.size,
  }
}

describe("createSessionAuth", () => {
  it("exchanges the bootstrap token once and caches the session", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(credential("session-1"), 201))
    const auth = createSessionAuth({
      baseUrl: "http://localhost:3000/",
      fetchImpl,
      bootstrapToken: "bootstrap-secret",
      storage: memoryStorage(),
    })

    await expect(auth.bearer()).resolves.toBe("session-1")
    await expect(auth.bearer()).resolves.toBe("session-1")
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe("http://localhost:3000/auth/session")
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer bootstrap-secret"
    )
    expect(auth.hasSession()).toBe(true)
  })

  it("shares a single in-flight exchange across concurrent callers", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve(jsonResponse(credential("session-1"), 201)),
              0
            )
          )
      )
    const auth = createSessionAuth({
      fetchImpl,
      bootstrapToken: "b",
      storage: memoryStorage(),
    })

    const [first, second] = await Promise.all([auth.bearer(), auth.bearer()])
    expect(first).toBe("session-1")
    expect(second).toBe("session-1")
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("re-exchanges after invalidate", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(credential("session-1"), 201))
      .mockResolvedValueOnce(jsonResponse(credential("session-2"), 201))
    const auth = createSessionAuth({
      fetchImpl,
      bootstrapToken: "b",
      storage: memoryStorage(),
    })

    await auth.bearer()
    auth.invalidate()
    await expect(auth.bearer()).resolves.toBe("session-2")
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("re-exchanges once the session is inside the expiry margin", async () => {
    const expiresSoon = {
      sessionToken: "session-1",
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    }
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(expiresSoon, 201))
      .mockResolvedValueOnce(jsonResponse(credential("session-2"), 201))
    const auth = createSessionAuth({
      fetchImpl,
      bootstrapToken: "b",
      storage: memoryStorage(),
    })

    await expect(auth.bearer()).resolves.toBe("session-1")
    await expect(auth.bearer()).resolves.toBe("session-2")
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("rejects when there is neither a session nor a bootstrap token", async () => {
    const auth = createSessionAuth({ storage: memoryStorage() })

    await expect(auth.bearer()).rejects.toThrow(/sign in/)
  })

  it("rejects when the server refuses the bootstrap token", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401))
    const auth = createSessionAuth({
      fetchImpl,
      bootstrapToken: "b",
      storage: memoryStorage(),
    })

    await expect(auth.bearer()).rejects.toThrow()
  })
})

describe("session persistence", () => {
  it("restores a persisted session without exchanging", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const storage = memoryStorage("stored-session")
    const auth = createSessionAuth({ fetchImpl, storage })

    expect(auth.hasSession()).toBe(true)
    await expect(auth.bearer()).resolves.toBe("stored-session")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("clears the stored session on invalidate and reports the empty state", async () => {
    const storage = memoryStorage("stored-session")
    const auth = createSessionAuth({ storage })

    expect(auth.hasSession()).toBe(true)
    auth.invalidate()
    expect(auth.hasSession()).toBe(false)
    expect(storage.size()).toBe(0)
    await expect(auth.bearer()).rejects.toThrow(/sign in/)
  })
})

describe("bootstrapFromUrl", () => {
  function stubLocation(search: string) {
    const historyReplaceState = vi.fn()
    vi.stubGlobal("location", { search, pathname: "/", hash: "" })
    vi.stubGlobal("history", { replaceState: historyReplaceState })
    return historyReplaceState
  }

  it("exchanges the URL token, stores the session, and strips the param", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(credential("url-session"), 201))
    const storage = memoryStorage()
    const historyReplaceState = stubLocation("?authToken=one-time&tab=2")
    try {
      const auth = createSessionAuth({ fetchImpl, storage })

      await expect(auth.bootstrapFromUrl()).resolves.toBe(true)
      expect(storage.load()).toBe("url-session")
      expect(historyReplaceState).toHaveBeenCalledWith(null, "", "/?tab=2")
      // The one-time token was used exactly once, on /auth/session.
      const [url] = fetchImpl.mock.calls[0]!
      expect(String(url)).toContain("/auth/session")
      expect(fetchImpl).toHaveBeenCalledOnce()
      // And the app is now authenticated without needing the token again.
      await expect(auth.bearer()).resolves.toBe("url-session")
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("reports false when no token is present", async () => {
    stubLocation("")
    try {
      const auth = createSessionAuth({ storage: memoryStorage() })

      await expect(auth.bootstrapFromUrl()).resolves.toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("leaves other query params intact when stripping", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(credential("url-session"), 201))
    const historyReplaceState = stubLocation("?authToken=t")
    try {
      const auth = createSessionAuth({
        fetchImpl,
        storage: memoryStorage(),
      })

      await auth.bootstrapFromUrl()
      expect(historyReplaceState).toHaveBeenCalledWith(null, "", "/")
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
