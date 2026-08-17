import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Database, type Database as BunDatabase } from "bun:sqlite"
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite/driver"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { SQLiteBunSession } from "drizzle-orm/bun-sqlite/session"
import {
  createTableRelationsHelpers,
  extractTablesRelationalConfig,
} from "drizzle-orm/relations"
import { BaseSQLiteDatabase, SQLiteSyncDialect } from "drizzle-orm/sqlite-core"

import { env } from "../env"
import * as schema from "./schema"

export function createDb<TClient>(client: TClient) {
  const dialect = new SQLiteSyncDialect()
  const tablesConfig = extractTablesRelationalConfig(
    schema,
    createTableRelationsHelpers
  )
  const relationalSchema = {
    fullSchema: schema,
    schema: tablesConfig.tables,
    tableNamesMap: tablesConfig.tableNamesMap,
  }
  const session = new SQLiteBunSession(
    client as BunDatabase,
    dialect,
    relationalSchema
  )
  const db = new BaseSQLiteDatabase(
    "sync",
    dialect,
    session,
    relationalSchema
  ) as BunSQLiteDatabase<typeof schema> & { $client: TClient }
  db.$client = client
  return db
}

export type AideDb = ReturnType<typeof createDb>

let db: AideDb | undefined

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url)
)

export function initializeDb(fileName = env.DB_FILE_NAME): AideDb {
  if (fileName !== ":memory:") mkdirSync(dirname(fileName), { recursive: true })

  const client = new Database(fileName, { create: true })
  client.exec("PRAGMA journal_mode = WAL")
  client.exec("PRAGMA foreign_keys = ON")
  const initialized = createDb(client)
  try {
    migrate(initialized, { migrationsFolder })
    return initialized
  } catch (error) {
    client.close()
    throw error
  }
}

export function getDb(): AideDb {
  if (db) return db
  db = initializeDb()
  return db
}

export function closeDb(): void {
  if (!db) return
  ;(db.$client as BunDatabase).close()
  db = undefined
}

/** Clears the production singleton so tests can initialize it again. */
export function resetDb(): void {
  closeDb()
}

export * from "./repo-error"
export * from "./repos"
