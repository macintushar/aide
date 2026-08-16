import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { closeDb, configRepo, getDb, initializeDb, resetDb } from "./index"
import type { Database } from "./test/bun-sqlite-shim"

describe("production database initialization", () => {
  const directories: string[] = []

  afterEach(() => {
    closeDb()
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("creates parent directories and applies module-relative migrations", () => {
    const directory = mkdtempSync(join(tmpdir(), "aide-db-"))
    directories.push(directory)
    const fileName = join(directory, "nested", "aide.sqlite")
    const db = initializeDb(fileName)

    expect(existsSync(fileName)).toBe(true)
    expect(configRepo.get(db, { kind: "global" })).toBeUndefined()
    ;(db.$client as unknown as Database).close()
  })

  it("closes and resets the singleton for isolated tests", () => {
    const first = getDb()
    resetDb()
    const second = getDb()

    expect(second).not.toBe(first)
  })
})
