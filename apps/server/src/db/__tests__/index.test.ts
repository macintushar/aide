import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"

import { closeDb, configRepo, getDb, initializeDb, resetDb } from ".././index"
import { Database } from ".././test/bun-sqlite-shim"

const migrationsFolder = fileURLToPath(
  new URL("../../../drizzle", import.meta.url)
)

function applySqlFile(client: Database, name: string): void {
  const migration = readFileSync(join(migrationsFolder, name), "utf8")
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) client.exec(statement)
  }
}

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

  it("applies 0001 when the parent-message unique index already exists", () => {
    const directory = mkdtempSync(join(tmpdir(), "aide-db-"))
    directories.push(directory)
    const fileName = join(directory, "aide.sqlite")
    const client = new Database(fileName)
    applySqlFile(client, "0000_romantic_harpoon.sql")
    client.exec(
      "CREATE UNIQUE INDEX `messages_parent_message_id_unique` ON `messages` (`parent_message_id`)"
    )
    client.exec(`
      CREATE TABLE __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash text NOT NULL,
        created_at numeric
      );
      INSERT INTO __drizzle_migrations (hash, created_at)
      VALUES ('0000', 1786888121098), ('stale-0001', 1787048400000);
    `)
    client.close()

    const db = initializeDb(fileName)
    const tables = (db.$client as unknown as Database)
      .prepare(
        "SELECT name FROM sqlite_master WHERE name = 'session_file_changes'"
      )
      .all()
    expect(tables).toEqual([{ name: "session_file_changes" }])
    ;(db.$client as unknown as Database).close()
  })

  it("rebuilds a referenced table when rows already point at it", () => {
    const directory = mkdtempSync(join(tmpdir(), "aide-db-"))
    directories.push(directory)
    const fileName = join(directory, "aide.sqlite")
    const first = initializeDb(fileName)
    const client = first.$client as unknown as Database
    const at = "2026-01-01T00:00:00.000Z"
    client.exec(`
      INSERT INTO projects (id, name, directory, created_at, last_opened_at)
        VALUES ('p', 'p', '/p', '${at}', '${at}');
      INSERT INTO sessions (id, project_id, title, created_at, updated_at)
        VALUES ('s', 'p', 't', '${at}', '${at}');
      INSERT INTO messages (id, session_id, seq, role, execution_json, created_at)
        VALUES ('m', 's', 0, 'user', '{}', '${at}');
      INSERT INTO command_receipts (command_id, command_name, state, created_at, updated_at)
        VALUES ('c', 'turn.send', 'completed', '${at}', '${at}');
      INSERT INTO turns (id, session_id, seq, status, execution_json, command_id, user_message_id)
        VALUES ('t', 's', 0, 'completed', '{}', 'c', 'm');
    `)
    // Forget the latest migration so the next open re-applies its rebuild.
    client.exec(
      "DELETE FROM __drizzle_migrations WHERE id = (SELECT max(id) FROM __drizzle_migrations)"
    )
    client.close()

    const db = initializeDb(fileName)
    const reopened = db.$client as unknown as Database
    expect(reopened.prepare("SELECT id FROM turns").all()).toEqual([
      { id: "t" },
    ])
    expect(reopened.prepare("PRAGMA foreign_keys").get()).toEqual({
      foreign_keys: 1,
    })
    reopened.close()
  })

  it("closes and resets the singleton for isolated tests", () => {
    const first = getDb()
    resetDb()
    const second = getDb()

    expect(second).not.toBe(first)
  })
})
