import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"

import { env } from "../env"
import * as schema from "./schema"

const sqlite = new Database(env.DB_FILE_NAME, {
  create: true,
})

export const db = drizzle({ client: sqlite, schema })
