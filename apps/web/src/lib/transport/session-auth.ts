import { sessionCredentialSchema } from "@workspace/contracts"

/** Refresh a cached session this long before it actually expires. */
const EXPIRY_MARGIN_MS = 30_000
const STORAGE_KEY = "aide.session-token"
const URL_PARAM = "authToken"

export type SessionAuthOptions = {
  baseUrl?: string
  fetchImpl?: typeof fetch
  /**
   * The boot-generated bootstrap credential from the server logs / authed
   * URL. Optional: an already-stored session is enough to talk to the server.
   */
  bootstrapToken?: string
  storage?: SessionStorage
}

export type SessionStorage = {
  load(): string | undefined
  save(token: string): void
  clear(): void
}

function localStorageStorage(): SessionStorage {
  return {
    load: () => globalThis.localStorage?.getItem(STORAGE_KEY) ?? undefined,
    save: (token) => globalThis.localStorage?.setItem(STORAGE_KEY, token),
    clear: () => globalThis.localStorage?.removeItem(STORAGE_KEY),
  }
}

export type SessionAuth = {
  /** Resolves a live session token; exchanges lazily when possible. */
  bearer(): Promise<string>
  /** Drops the cached session so the next bearer() starts over. */
  invalidate(): void
  /** Whether a session credential is currently held. */
  hasSession(): boolean
  /** Exchanges an explicit bootstrap token (paste-in registration). */
  bootstrapWithToken(token: string): Promise<void>
  /**
   * Exchanges `?authToken=…` from the URL printed at boot, then strips the
   * token from the address bar so it never lands in history or referrers.
   * Returns whether a token was found.
   */
  bootstrapFromUrl(search?: string): Promise<boolean>
}

/**
 * Client half of the bootstrap/session split. The one-time token from the
 * server logs (`?authToken=`) or the previous session's stored credential is
 * exchanged for a durable session; only that session rides on data requests.
 */
export function createSessionAuth(
  options: SessionAuthOptions = {}
): SessionAuth {
  const baseUrl = options.baseUrl?.replace(/\/$/, "") ?? ""
  const fetchImpl = options.fetchImpl ?? fetch
  const storage = options.storage ?? localStorageStorage()
  let cached: { token: string; expiresAtMs: number } | undefined
  let inflight: Promise<string> | undefined

  async function exchange(bootstrapToken: string): Promise<string> {
    const response = await fetchImpl(`${baseUrl}/auth/session`, {
      method: "POST",
      headers: { authorization: `Bearer ${bootstrapToken}` },
    })
    const credential = sessionCredentialSchema.parse(await response.json())
    cached = {
      token: credential.sessionToken,
      expiresAtMs: Number.isNaN(Date.parse(credential.expiresAt))
        ? Number.MAX_SAFE_INTEGER
        : Date.parse(credential.expiresAt),
    }
    storage.save(credential.sessionToken)
    return credential.sessionToken
  }

  return {
    bearer() {
      const now = Date.now()
      if (cached && cached.expiresAtMs - EXPIRY_MARGIN_MS > now) {
        return Promise.resolve(cached.token)
      }
      const stored = storage.load()
      if (stored && !cached) {
        // A persisted session from a previous page load. Trust it until the
        // server says otherwise — a 401 triggers invalidate().
        cached = { token: stored, expiresAtMs: Number.MAX_SAFE_INTEGER }
        return Promise.resolve(stored)
      }
      if (!options.bootstrapToken) {
        return Promise.reject(new Error("No aide session; sign in again"))
      }
      inflight ??= exchange(options.bootstrapToken).finally(() => {
        inflight = undefined
      })
      return inflight
    },
    invalidate() {
      cached = undefined
      storage.clear()
    },
    hasSession() {
      return Boolean(cached || storage.load())
    },
    async bootstrapWithToken(token) {
      await exchange(token)
    },
    async bootstrapFromUrl(search = globalThis.location?.search ?? "") {
      const token = new URLSearchParams(search).get(URL_PARAM)
      if (!token) return false
      await exchange(token)
      const params = new URLSearchParams(search)
      params.delete(URL_PARAM)
      const query = params.toString()
      const url = `${globalThis.location?.pathname ?? "/"}${query ? `?${query}` : ""}${globalThis.location?.hash ?? ""}`
      globalThis.history?.replaceState(null, "", url)
      return true
    },
  }
}
