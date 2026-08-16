import type { Database as BunDatabase } from "bun:sqlite"
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite/driver"
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

export function getDb(): AideDb {
  if (db) return db

  const { Database } = require("bun:sqlite") as typeof import("bun:sqlite")
  const client = new Database(env.DB_FILE_NAME, { create: true })
  client.exec("PRAGMA journal_mode = WAL")
  client.exec("PRAGMA foreign_keys = ON")
  db = createDb(client)
  return db
}

export * from "./repo-error"
export * from "./repos"
