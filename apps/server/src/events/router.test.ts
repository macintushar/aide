import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  eventFixtures,
  projectFixture,
  sessionFixture,
  type AideEvent,
} from "@workspace/contracts"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createDb, projectsRepo, sessionsRepo } from "../db"
import { Database } from "../db/test/bun-sqlite-shim"
import { createEventRouter } from "./router"
import { EventService, type DurableEventInput } from "./service"
import { SnapshotService } from "./snapshot"
import { eventSseFrame } from "./sse"

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url)
)

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

function withoutDelivery(event: AideEvent): DurableEventInput {
  const { delivery: _delivery, ...input } = event
  return input as DurableEventInput
}

describe("event router", () => {
  let client: Database
  let app: Hono
  let eventService: EventService
  let snapshotService: SnapshotService

  beforeEach(() => {
    client = new Database(":memory:")
    client.exec("PRAGMA foreign_keys = ON")
    applyMigrations(client)
    const db = createDb(client)
    projectsRepo.upsertByDirectory(db, projectFixture())
    sessionsRepo.create(db, sessionFixture())
    eventService = new EventService(db)
    snapshotService = new SnapshotService(db)
    app = new Hono().route(
      "/",
      createEventRouter({ eventService, snapshotService })
    )
  })

  afterEach(() => client.close())

  it("serves a session snapshot and rejects invalid cursors", async () => {
    const response = await app.request("/sessions/ses_1")
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      scope: { kind: "session", sessionId: "ses_1" },
      cursor: { sequence: 0 },
    })

    for (const value of ["-1", "1.5", "nope"]) {
      const invalid = await app.request(
        `/sessions/ses_1/events?afterSequence=${value}`
      )
      expect(invalid.status).toBe(400)
    }
  })

  it("streams the first replay frame and closes when the reader cancels", async () => {
    const fixtures = eventFixtures()
    const firstEvent = eventService.appendDurable(withoutDelivery(fixtures[0]))
    eventService.appendDurable(withoutDelivery(fixtures[1]))

    const response = await app.request("/sessions/ses_1/events?afterSequence=0")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")

    const reader = response.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe(
      eventSseFrame(firstEvent)
    )
    await reader.cancel()
  })
})
