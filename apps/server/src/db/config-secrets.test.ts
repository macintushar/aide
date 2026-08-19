import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ConfigSecretsCipher } from "./config-secrets"
import { resetConfigSecrets, loadConfigSecrets } from "./config-secrets-key"

describe("ConfigSecretsCipher", () => {
  it("round-trips secret values with authenticated encryption", () => {
    const cipher = new ConfigSecretsCipher(ConfigSecretsCipher.generateKey())
    const secret = "sk-live-abc123 / with specials"
    const ciphertext = cipher.encrypt(secret)

    expect(ciphertext).not.toContain(secret)
    expect(ciphertext.startsWith("v1.")).toBe(true)
    expect(cipher.decrypt(ciphertext)).toBe(secret)
  })

  it("produces distinct ciphertexts per call and fails closed on tampering", () => {
    const cipher = new ConfigSecretsCipher(ConfigSecretsCipher.generateKey())
    const first = cipher.encrypt("same-secret")
    const second = cipher.encrypt("same-secret")
    expect(first).not.toBe(second)

    const parts = first.split(".")
    const tampered = [
      parts[0],
      parts[1],
      parts[2],
      Buffer.from("tampered").toString("base64"),
    ].join(".")
    expect(() => cipher.decrypt(tampered)).toThrow(/decrypt/)
  })

  it("rejects foreign keys and malformed payloads", () => {
    const encrypter = new ConfigSecretsCipher(ConfigSecretsCipher.generateKey())
    const decrypter = new ConfigSecretsCipher(ConfigSecretsCipher.generateKey())
    expect(() => decrypter.decrypt(encrypter.encrypt("secret"))).toThrow(
      /decrypt/
    )
    expect(() => decrypter.decrypt("not-a-ciphertext")).toThrow(/v1/)
    expect(() => new ConfigSecretsCipher(Buffer.alloc(8))).toThrow(/32 bytes/)
  })
})

describe("loadConfigSecrets", () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "aide-secrets-"))
    resetConfigSecrets()
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
    resetConfigSecrets()
  })

  it("creates then reloads the same key file", () => {
    const keyPath = join(directory, "key.b64")
    const first = loadConfigSecrets(keyPath)
    const second = loadConfigSecrets(keyPath)

    expect(first).toBeDefined()
    expect(second).toBeDefined()
    const secret = "config-secret"
    expect(second!.decrypt(first!.encrypt(secret))).toBe(secret)
  })
})
