import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createDb } from "../db"
import { Database } from "../db/test/bun-sqlite-shim"
import { createSessionAuth, createSessionGuard } from "../security/session-auth"
import { createCommandDispatcher } from "./dispatcher"
import { createCommandRouter } from "./router"

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url)
)
let bearer = ""
const headers = () => ({
  Authorization: bearer,
  "Content-Type": "application/json",
})

function applyMigrations(client: Database): void {
  for (const file of readdirSync(migrationsFolder)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const migration = readFileSync(`${migrationsFolder}/${file}`, "utf8")
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) client.exec(statement)
    }
  }
}

describe("command router", () => {
  let client: Database
  let app: Hono

  beforeEach(() => {
    client = new Database(":memory:")
    applyMigrations(client)
    const dispatcher = createCommandDispatcher({
      db: createDb(client),
      handlers: {
        "session.delete": {
          kind: "local",
          handle: (command) => ({ sessionId: command.sessionId }),
        },
        "instance.start": {
          kind: "external",
          handle: (_command, context) => {
            context.markDispatching()
          },
        },
      },
    })
    app = new Hono()
    const auth = createSessionAuth({ bootstrapToken: "test-token" })
    const { sessionToken } = auth.exchange("test-token")!
    bearer = `Bearer ${sessionToken}`
    app.use("/commands/*", createSessionGuard(auth, ["http://localhost:3000"]))
    app.route("/", createCommandRouter({ dispatcher }))
  })

  afterEach(() => client.close())

  it("validates HTTP commands and maps receipt states to statuses", async () => {
    const completed = await app.request("/commands/session.delete", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ commandId: "cmd-http-1", sessionId: "session-1" }),
    })
    expect(completed.status).toBe(200)
    expect(await completed.json()).toMatchObject({
      commandName: "session.delete",
      state: "completed",
    })

    const uncertain = await app.request("/commands/instance.start", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ commandId: "cmd-http-2", instanceId: "one" }),
    })
    expect(uncertain.status).toBe(202)
    expect(await uncertain.json()).toMatchObject({ state: "uncertain" })

    const mismatch = await app.request("/commands/session.delete", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        commandId: "cmd-http-3",
        name: "instance.start",
        sessionId: "session-1",
      }),
    })
    expect(mismatch.status).toBe(400)
    expect(await mismatch.json()).toEqual({ error: "command_name_mismatch" })

    const invalid = await app.request("/commands/session.delete", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ commandId: "cmd-http-4" }),
    })
    expect(invalid.status).toBe(400)
  })

  it("remains compatible with the command security guard", async () => {
    const unauthorized = await app.request("/commands/session.delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commandId: "cmd-http-5", sessionId: "session-1" }),
    })
    expect(unauthorized.status).toBe(401)

    const forbidden = await app.request("/commands/session.delete", {
      method: "POST",
      headers: { ...headers(), Origin: "https://evil.example" },
      body: JSON.stringify({ commandId: "cmd-http-6", sessionId: "session-1" }),
    })
    expect(forbidden.status).toBe(403)
  })
})
