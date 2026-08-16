import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { createDb, type AideDb } from "../db"
import { Database } from "../db/test/bun-sqlite-shim"

/**
 * Test-only helper: a migrated in-memory database. Each caller gets its own
 * client so suites stay isolated.
 */

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url)
)

export function applyMigrations(client: Database): void {
  for (const file of readdirSync(migrationsFolder)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const migration = readFileSync(`${migrationsFolder}/${file}`, "utf8")
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) client.exec(statement)
    }
  }
}

export function createTestDb(): { client: Database; db: AideDb } {
  const client = new Database(":memory:")
  client.exec("PRAGMA foreign_keys = ON")
  applyMigrations(client)
  return { client, db: createDb(client) }
}
