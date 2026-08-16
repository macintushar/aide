import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  eventFixtures,
  projectFixture,
  sessionFixture,
  type AideEvent,
} from "@workspace/contracts"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createDb, projectsRepo, sessionsRepo } from "../db"
import { Database } from "../db/test/bun-sqlite-shim"
import { createEventRouter } from "./router"
import { EventService, type DurableEventInput } from "./service"
import { SnapshotService } from "./snapshot"
import { eventSseFrame, snapshotSseFrame } from "./sse"

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

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<string> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("SSE read timed out")),
          1_000
        )
      }),
    ])
    return new TextDecoder().decode(result.value)
  } finally {
    clearTimeout(timeout)
  }
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

    for (const value of ["-1", "1.5", "nope", "9007199254740992"]) {
      const invalid = await app.request(
        `/sessions/ses_1/events?afterSequence=${value}`
      )
      expect(invalid.status).toBe(400)
    }
  })

  it("returns 404 for missing session snapshots and event streams", async () => {
    const snapshot = await app.request("/sessions/missing")
    expect(snapshot.status).toBe(404)
    await expect(snapshot.json()).resolves.toEqual({
      error: "session_not_found",
    })

    const events = await app.request("/sessions/missing/events")
    expect(events.status).toBe(404)
    await expect(events.json()).resolves.toEqual({ error: "session_not_found" })
  })

  it("defaults afterSequence to zero and parses a valid cursor", async () => {
    const fixtures = eventFixtures()
    const first = eventService.appendDurable(withoutDelivery(fixtures[0]))
    const second = eventService.appendDurable(withoutDelivery(fixtures[1]))

    const defaultResponse = await app.request("/sessions/ses_1/events")
    const defaultReader = defaultResponse.body!.getReader()
    try {
      expect(await readChunk(defaultReader)).toBe(eventSseFrame(first))
    } finally {
      await defaultReader.cancel()
    }

    const parsedResponse = await app.request(
      "/sessions/ses_1/events?afterSequence=1"
    )
    const parsedReader = parsedResponse.body!.getReader()
    try {
      expect(await readChunk(parsedReader)).toBe(eventSseFrame(second))
    } finally {
      await parsedReader.cancel()
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

  it("replays all session frames in order", async () => {
    const fixtures = eventFixtures()
    const replayed = fixtures
      .slice(0, 3)
      .map((event) => eventService.appendDurable(withoutDelivery(event)))
    const response = await app.request("/sessions/ses_1/events")
    const reader = response.body!.getReader()
    try {
      for (const event of replayed) {
        expect(await readChunk(reader)).toBe(eventSseFrame(event))
      }
    } finally {
      await reader.cancel()
    }
  })

  it.each([
    ["a replay gap larger than maxReplay", 0],
    ["a cursor ahead of the durable log", 99],
  ])("falls back to a session snapshot for %s", async (_reason, after) => {
    const fixtures = eventFixtures()
    eventService.appendDurable(withoutDelivery(fixtures[0]))
    eventService.appendDurable(withoutDelivery(fixtures[1]))
    app = new Hono().route(
      "/",
      createEventRouter({ eventService, snapshotService, maxReplay: 1 })
    )

    const response = await app.request(
      `/sessions/ses_1/events?afterSequence=${after}`
    )
    const reader = response.body!.getReader()
    try {
      expect(await readChunk(reader)).toBe(
        snapshotSseFrame(snapshotService.sessionSnapshot("ses_1"))
      )
    } finally {
      await reader.cancel()
    }
  })

  it("hands off without duplicating an event published during replay", async () => {
    const scope = { kind: "session" as const, sessionId: "ses_1" }
    const fixtures = eventFixtures()
    const first = eventService.appendDurable(withoutDelivery(fixtures[0]))
    const replayOrSnapshot = eventService.replayOrSnapshot.bind(eventService)
    let duringReplay: ReturnType<typeof eventService.appendDurable>
    vi.spyOn(eventService, "replayOrSnapshot").mockImplementation((input) => {
      duringReplay = eventService.appendDurable(withoutDelivery(fixtures[1]))
      return replayOrSnapshot(input)
    })

    const response = await app.request("/sessions/ses_1/events")
    const reader = response.body!.getReader()
    try {
      expect(await readChunk(reader)).toBe(eventSseFrame(first))
      expect(await readChunk(reader)).toBe(eventSseFrame(duringReplay!))

      const live = eventService.appendDurable(withoutDelivery(fixtures[2]))
      expect(await readChunk(reader)).toBe(eventSseFrame(live))
      expect(eventService.latestSequence(scope)).toBe(3)
    } finally {
      await reader.cancel()
    }
  })

  it("serves replay and live frames from the instances route", async () => {
    const fixture = eventFixtures().find(
      (event) => event.type === "harness.connected"
    )!
    const replayed = eventService.appendDurable(withoutDelivery(fixture))
    const response = await app.request("/instances/events?afterSequence=0")
    const reader = response.body!.getReader()
    try {
      expect(await readChunk(reader)).toBe(eventSseFrame(replayed))

      const live = eventService.appendDurable(
        withoutDelivery({ ...fixture, eventId: "evt_instances_live" })
      )
      expect(await readChunk(reader)).toBe(eventSseFrame(live))
    } finally {
      await reader.cancel()
    }
  })

  it("validates instances cursors and snapshots when the cursor is stale", async () => {
    const invalid = await app.request("/instances/events?afterSequence=-1")
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toEqual({
      error: "invalid_after_sequence",
    })

    const fixture = eventFixtures().find(
      (event) => event.type === "harness.connected"
    )!
    eventService.appendDurable(withoutDelivery(fixture))
    app = new Hono().route(
      "/",
      createEventRouter({ eventService, snapshotService, maxReplay: 0 })
    )
    const response = await app.request("/instances/events")
    const reader = response.body!.getReader()
    try {
      expect(await readChunk(reader)).toBe(
        snapshotSseFrame(snapshotService.instancesSnapshot())
      )
    } finally {
      await reader.cancel()
    }
  })

  it("closes the router subscription when the response reader is cancelled", async () => {
    const subscribe = vi.spyOn(eventService, "subscribe")
    const response = await app.request("/sessions/ses_1/events")
    const subscription = subscribe.mock.results[0]!.value
    const close = vi.spyOn(subscription, "return")
    const reader = response.body!.getReader()

    await reader.cancel()

    expect(close).toHaveBeenCalled()
  })
})
