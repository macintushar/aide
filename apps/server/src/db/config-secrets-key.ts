import { readFileSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"

import { ConfigSecretsCipher } from "./config-secrets"
import type { ConfigSecrets } from "./repos"

let cached: ConfigSecrets | undefined

/**
 * Loads (or creates) the local config-encryption key file and returns the
 * process-wide cipher. Returns undefined only when the key file cannot be
 * secured, in which case configuration is stored unencrypted rather than
 * blocking startup.
 */
export function loadConfigSecrets(keyPath: string): ConfigSecrets | undefined {
  if (cached) return cached
  try {
    let key: Buffer
    try {
      key = Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64")
    } catch {
      key = randomBytes(32)
      writeFileSync(keyPath, `${key.toString("base64")}\n`, { mode: 0o600 })
    }
    if (key.length !== 32) return undefined
    const cipher = new ConfigSecretsCipher(key)
    cached = {
      encrypt: (value) => cipher.encrypt(value),
      decrypt: (value) => cipher.decrypt(value),
    }
    return cached
  } catch {
    return undefined
  }
}

/** Test-only: clears the memoized cipher. */
export function resetConfigSecrets(): void {
  cached = undefined
}
