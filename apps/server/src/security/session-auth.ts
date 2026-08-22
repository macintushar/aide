import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import type { MiddlewareHandler } from "hono"

import type { SessionCredential } from "@workspace/contracts"

const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000

export function matchesBearerToken(
  received: string,
  expected: string
): boolean {
  const receivedBytes = Buffer.from(received, "utf8")
  const expectedBytes = Buffer.from(expected, "utf8")
  if (receivedBytes.length !== expectedBytes.length) {
    return false
  }
  return timingSafeEqual(receivedBytes, expectedBytes)
}

export function bearerFromHeader(
  authorization: string | undefined
): string | undefined {
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined
}

/** Only SHA-256 hashes of session tokens cross the storage boundary. */
function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

/**
 * Where live session credentials live. The default keeps them in memory;
 * production persists hashed tokens so sessions survive restarts.
 */
export type SessionTokenStore = {
  put(tokenHash: string, expiresAtMs: number): void
  expiresAtMsOf(tokenHash: string): number | undefined
  deleteExpired(nowMs: number): void
}

function inMemoryTokenStore(): SessionTokenStore {
  // token hash -> absolute expiry in epoch ms
  const sessions = new Map<string, number>()
  return {
    put(hash, expiresAtMs) {
      sessions.set(hash, expiresAtMs)
    },
    expiresAtMsOf(hash) {
      const expiresAtMs = sessions.get(hash)
      if (expiresAtMs === undefined) return undefined
      // ISO timestamps only carry millisecond precision; keep the lookup and
      // deletion consistent by comparing in the same units the caller uses.
      return expiresAtMs
    },
    deleteExpired(nowMs) {
      for (const [hash, expiresAtMs] of sessions) {
        if (expiresAtMs <= nowMs) sessions.delete(hash)
      }
    },
  }
}

export type SessionAuthOptions = {
  /**
   * Short-lived, high-trust credential minted at boot (surfaced in the logs).
   * Optional: a valid session can always mint another session.
   */
  bootstrapToken?: string
  store?: SessionTokenStore
  sessionTtlMs?: number
  now?: () => number
  generateToken?: () => string
}

/**
 * Bootstrap/session split. A bootstrap token only mints sessions; a session
 * token is what data routes accept, and can also mint further sessions (e.g.
 * pairing a second browser from a logged-in one). Tokens are stored hashed.
 */
export function createSessionAuth(options: SessionAuthOptions) {
  const ttlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS
  const now = options.now ?? (() => Date.now())
  const generateToken =
    options.generateToken ?? (() => randomBytes(32).toString("hex"))
  const store = options.store ?? inMemoryTokenStore()

  function mint(): SessionCredential {
    const sessionToken = generateToken()
    const expiresAtMs = now() + ttlMs
    store.put(hashToken(sessionToken), expiresAtMs)
    return { sessionToken, expiresAt: new Date(expiresAtMs).toISOString() }
  }

  function verify(bearer: string | undefined): boolean {
    if (bearer === undefined) return false
    store.deleteExpired(now())
    const stored = store.expiresAtMsOf(hashToken(bearer))
    return stored !== undefined && stored > now()
  }

  function exchange(bearer: string | undefined): SessionCredential | undefined {
    if (bearer === undefined) return undefined
    if (
      options.bootstrapToken !== undefined &&
      matchesBearerToken(bearer, options.bootstrapToken)
    ) {
      return mint()
    }
    // An already-authenticated client can register another client.
    if (verify(bearer)) return mint()
    return undefined
  }

  return { exchange, verify }
}

export type SessionAuth = ReturnType<typeof createSessionAuth>

function originAllowed(
  origin: string | undefined,
  allowedOrigins: string[]
): boolean {
  return origin === undefined || allowedOrigins.includes(origin)
}

/**
 * Route class "bootstrap": exchanges a bootstrap or session credential for a
 * fresh session credential. Nothing else — no state access.
 */
export function createBootstrapHandler(
  auth: SessionAuth,
  allowedOrigins: string[]
): MiddlewareHandler {
  return async (c) => {
    const origin = c.req.header("Origin")
    if (!originAllowed(origin, allowedOrigins)) {
      return c.json({ error: "origin_not_allowed" }, 403)
    }
    const credential = auth.exchange(
      bearerFromHeader(c.req.header("Authorization"))
    )
    if (!credential) {
      return c.json({ error: "unauthorized" }, 401)
    }
    return c.json(credential, 201)
  }
}

/**
 * Route class "authenticated": every route that reads or mutates state.
 * Accepts only live session credentials.
 */
export function createSessionGuard(
  auth: SessionAuth,
  allowedOrigins: string[]
): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header("Origin")
    if (!originAllowed(origin, allowedOrigins)) {
      return c.json({ error: "origin_not_allowed" }, 403)
    }
    if (!auth.verify(bearerFromHeader(c.req.header("Authorization")))) {
      return c.json({ error: "unauthorized" }, 401)
    }
    await next()
  }
}
