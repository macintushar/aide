import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  assistantMessageFixture,
  eventFixtures,
  inputRequestFixture,
  inventoryFixture,
  projectFixture,
  resolvedExecutionFixture,
  sessionFixture,
  userMessageFixture,
  type AideConfig,
  type AideEvent,
} from "@workspace/contracts"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  configRepo,
  createDb,
  inventoryCacheRepo,
  messagesRepo,
  projectsRepo,
  receiptsRepo,
  requestsRepo,
  sessionsRepo,
  turnsRepo,
} from "../db"
import { Database } from "../db/test/bun-sqlite-shim"
import {
  EventService,
  type DurableEventInput,
  type PartDeltaEventInput,
} from "./service"
import { SnapshotService } from "./snapshot"
import { eventSseFrame, heartbeatSseFrame } from "./sse"

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url)
)
const timestamp = "2026-01-01T00:00:00.000Z"

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

describe("event and snapshot services", () => {
  let client: Database
  let db: ReturnType<typeof createDb>
  let events: EventService
  let snapshots: SnapshotService

  beforeEach(() => {
    client = new Database(":memory:")
    client.exec("PRAGMA foreign_keys = ON")
    applyMigrations(client)
    db = createDb(client)
    events = new EventService(db)
    snapshots = new SnapshotService(db)
  })

  afterEach(() => client.close())

  function createSessionRecords(): void {
    projectsRepo.upsertByDirectory(db, projectFixture())
    sessionsRepo.create(db, sessionFixture())
  }

  it("persists and replays independently sequenced durable scopes", () => {
    const fixtures = eventFixtures()
    const firstSession = events.appendDurable(withoutDelivery(fixtures[0]))
    const secondSession = events.appendDurable(withoutDelivery(fixtures[1]))
    const instances = events.appendDurable(
      withoutDelivery(
        fixtures.find((event) => event.type === "harness.connected")!
      )
    )
    const otherInput = withoutDelivery(fixtures[0]) as Extract<
      DurableEventInput,
      { type: "turn.queued" }
    >
    const otherSession = events.appendDurable({
      ...otherInput,
      eventId: "evt_other_session",
      scope: {
        kind: "session",
        projectId: "proj_1",
        sessionId: "ses_2",
      },
      data: {
        turn: {
          ...otherInput.data.turn,
          sessionId: "ses_2",
        },
      },
    })

    expect(firstSession.delivery).toEqual({ durable: true, sequence: 1 })
    expect(secondSession.delivery).toEqual({ durable: true, sequence: 2 })
    expect(instances.delivery).toEqual({ durable: true, sequence: 1 })
    expect(otherSession.delivery).toEqual({ durable: true, sequence: 1 })
    expect(
      events.listDurable({
        scope: { kind: "session", sessionId: "ses_1" },
        cursor: events.cursor({ kind: "session", sessionId: "ses_1" }, 0),
      })
    ).toEqual([firstSession, secondSession])
  })

  it("deduplicates exact event IDs and rejects conflicting or ephemeral appends", () => {
    const input = withoutDelivery(eventFixtures()[0])
    const first = events.appendDurable(input)

    expect(events.appendDurable(input)).toEqual(first)
    expect(() =>
      events.appendDurable({ ...input, timestamp: "2026-01-02T00:00:00.000Z" })
    ).toThrowError(expect.objectContaining({ code: "duplicate_event_id" }))

    const delta = eventFixtures().find((event) => event.type === "part.delta")!
    const { delivery: _delivery, ...deltaInput } = delta
    expect(() =>
      events.appendDurable(deltaInput as unknown as DurableEventInput)
    ).toThrowError(expect.objectContaining({ code: "ephemeral_event" }))
  })

  it("broadcasts the exact durable event after persistence", async () => {
    const subscription = events.subscribe({
      kind: "session",
      sessionId: "ses_1",
    })
    const persisted = events.appendDurable(withoutDelivery(eventFixtures()[0]))

    expect((await subscription.next()).value).toBe(persisted)
    expect(events.latestSequence({ kind: "session", sessionId: "ses_1" })).toBe(
      1
    )
    await subscription.return()
  })

  it("assigns ephemeral ordinals per subscriber without persistence or cursor movement", async () => {
    const scope = { kind: "session" as const, sessionId: "ses_1" }
    const first = events.subscribe(scope)
    const second = events.subscribe(scope)
    const delta = eventFixtures().find((event) => event.type === "part.delta")!
    const { delivery: _delivery, ...input } = delta

    events.publishEphemeral(input as PartDeltaEventInput)
    events.publishEphemeral({
      ...(input as PartDeltaEventInput),
      eventId: "evt_delta_2",
    })

    expect((await first.next()).value?.delivery).toEqual({
      durable: false,
      streamOrdinal: 0,
    })
    expect((await second.next()).value?.delivery).toEqual({
      durable: false,
      streamOrdinal: 0,
    })
    expect((await first.next()).value?.delivery).toEqual({
      durable: false,
      streamOrdinal: 1,
    })
    expect(events.latestSequence(scope)).toBe(0)

    await first.return()
    await second.return()
  })

  it("cleans up aborted subscriptions", async () => {
    const controller = new AbortController()
    const subscription = events.subscribe(
      { kind: "instances" },
      { signal: controller.signal }
    )
    const pending = subscription.next()
    controller.abort()
    await expect(pending).resolves.toEqual({ done: true, value: undefined })

    const alreadyAborted = events.subscribe(
      { kind: "instances" },
      { signal: controller.signal }
    )
    await expect(alreadyAborted.next()).resolves.toEqual({
      done: true,
      value: undefined,
    })
  })

  it("rejects a cursor from another scope", () => {
    const sessionScope = { kind: "session" as const, sessionId: "ses_1" }
    const instancesCursor = events.cursor({ kind: "instances" }, 0)

    expect(() =>
      events.listDurable({
        scope: sessionScope,
        cursor: instancesCursor as unknown as ReturnType<
          typeof events.cursor<typeof sessionScope>
        >,
      })
    ).toThrowError(
      expect.objectContaining({
        code: "cursor_scope_mismatch",
      })
    )
  })

  it("returns a snapshot when replay is too large or ahead of the latest event", () => {
    const scope = { kind: "session" as const, sessionId: "ses_1" }
    const fixtures = eventFixtures().filter(
      (event) => event.scope.kind === "session" && event.type !== "part.delta"
    )
    for (const event of fixtures.slice(0, 3)) {
      events.appendDurable(withoutDelivery(event))
    }

    expect(
      events.replayOrSnapshot({
        scope,
        afterSequence: 0,
        maxReplay: 1,
        snapshot: () => "fresh",
      })
    ).toMatchObject({ mode: "snapshot", snapshot: "fresh" })
    expect(
      events.replayOrSnapshot({
        scope,
        afterSequence: 99,
        snapshot: () => "ahead",
      })
    ).toMatchObject({ mode: "snapshot", snapshot: "ahead" })
  })

  it("assembles validated session and instances snapshots in stable order", () => {
    createSessionRecords()
    const { seq: _userSeq, ...user } = userMessageFixture()
    const { seq: _assistantSeq, ...assistant } = assistantMessageFixture()
    messagesRepo.createUser(db, user)
    messagesRepo.createAssistant(db, {
      ...assistant,
      parts: [...assistant.parts].reverse(),
    })
    receiptsRepo.upsertAccepted(db, {
      commandId: "cmd_0001",
      commandName: "turn.send",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    turnsRepo.create(db, {
      id: "turn_1",
      sessionId: "ses_1",
      execution: resolvedExecutionFixture(),
      commandId: "cmd_0001",
      userMessageId: "msg_user_1",
      assistantMessageId: "msg_assistant_1",
    })
    turnsRepo.update(db, "turn_1", {
      status: "completed",
      endedAt: timestamp,
    })
    requestsRepo.upsert(db, inputRequestFixture())

    const session = snapshots.sessionSnapshot("ses_1")
    expect(session.messages.map((message) => message.seq)).toEqual([0, 1])
    expect(session.messages[1]?.parts.map((part) => part.index)).toEqual([
      0, 1, 2,
    ])
    expect(session.turns.map((turn) => turn.seq)).toEqual([0])
    expect(session.requests.map((request) => request.id)).toEqual([
      "req_input_1",
    ])

    const inventory = { ...inventoryFixture(), stale: true }
    inventoryCacheRepo.put(db, "/tmp/aide", inventory)
    const config: AideConfig = {
      instances: {
        claude: {
          instanceId: "claude",
          driver: "claudeAgent",
          displayName: "Claude",
          enabled: true,
          autoStart: true,
          config: {},
        },
      },
      mcpServers: {},
      defaults: {},
    }
    configRepo.put(db, config, timestamp)

    expect(snapshots.instancesSnapshot().instances).toMatchObject([
      { instanceId: "claude", status: "configured" },
      {
        instanceId: "opencode",
        status: "degraded",
        inventory: { stale: true },
      },
    ])
  })

  it("frames durable, ephemeral, and heartbeat SSE exactly", () => {
    const durable = events.appendDurable(withoutDelivery(eventFixtures()[0]))
    const delta = eventFixtures().find((event) => event.type === "part.delta")!

    expect(eventSseFrame(durable)).toBe(
      `id: 1\nevent: turn.queued\ndata: ${JSON.stringify(durable)}\n\n`
    )
    expect(eventSseFrame(delta)).toBe(
      `event: part.delta\ndata: ${JSON.stringify(delta)}\n\n`
    )
    expect(eventSseFrame(delta)).not.toContain("id:")
    expect(heartbeatSseFrame()).toBe(": heartbeat\n\n")
  })
})
