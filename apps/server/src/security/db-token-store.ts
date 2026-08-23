import type { AideDb } from "../db"
import { authSessionsRepo } from "../db"

import type { SessionTokenStore } from "./session-auth"

/**
 * Persists hashed session tokens so authenticated clients survive server
 * restarts. Only hashes reach the database (schema.ts).
 */
export function createDbTokenStore(db: AideDb): SessionTokenStore {
  return {
    put(tokenHash, expiresAtMs) {
      const expiresAt = new Date(expiresAtMs).toISOString()
      authSessionsRepo.put(db, tokenHash, new Date().toISOString(), expiresAt)
    },

    expiresAtMsOf(tokenHash) {
      const stored = authSessionsRepo.expiresAt(db, tokenHash)
      if (stored === undefined) return undefined
      const parsed = Date.parse(stored)
      return Number.isNaN(parsed) ? undefined : parsed
    },

    deleteExpired(nowMs) {
      authSessionsRepo.deleteExpired(db, new Date(nowMs).toISOString())
    },
  }
}
