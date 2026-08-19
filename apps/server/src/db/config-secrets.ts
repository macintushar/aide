import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ALGORITHM = "aes-256-gcm"

export class ConfigSecretsError extends Error {
  constructor(
    message: string,
    readonly code: "key_unavailable" | "decrypt_failed" | "invalid_ciphertext"
  ) {
    super(message)
    this.name = "ConfigSecretsError"
  }
}

/**
 * AES-256-GCM encryption for configuration secrets at rest.
 *
 * The key never leaves the process. A local key file is created on first use
 * with restrictive permissions; ciphertext embeds a random IV and an auth tag
 * so tampering fails closed.
 */
export class ConfigSecretsCipher {
  readonly #key: Buffer

  constructor(key: Buffer) {
    if (key.length !== 32) {
      throw new ConfigSecretsError(
        "Config encryption key must be 32 bytes",
        "key_unavailable"
      )
    }
    this.#key = key
  }

  static generateKey(): Buffer {
    return randomBytes(32)
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv(ALGORITHM, this.#key, iv)
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ])
    const tag = cipher.getAuthTag()
    return [
      "v1",
      iv.toString("base64"),
      tag.toString("base64"),
      encrypted.toString("base64"),
    ].join(".")
  }

  decrypt(payload: string): string {
    const parts = payload.split(".")
    if (parts.length !== 4 || parts[0] !== "v1") {
      throw new ConfigSecretsError(
        "Ciphertext is not a v1 encrypted secret",
        "invalid_ciphertext"
      )
    }
    try {
      const iv = Buffer.from(parts[1]!, "base64")
      const tag = Buffer.from(parts[2]!, "base64")
      const encrypted = Buffer.from(parts[3]!, "base64")
      const decipher = createDecipheriv(ALGORITHM, this.#key, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]).toString("utf8")
    } catch {
      throw new ConfigSecretsError(
        "Ciphertext could not be decrypted with the local key",
        "decrypt_failed"
      )
    }
  }
}
