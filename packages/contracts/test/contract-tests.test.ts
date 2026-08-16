import { describe, expect, it } from "vitest"

import {
  aideEventSchema,
  assistantMessageFixture,
  commandFixtures,
  commandNameSchema,
  commandReceiptSchema,
  commandSchema,
  eventFixtures,
  inputRequestFixture,
  instancesSnapshotFixture,
  permissionRequestFixture,
  requestSchema,
  resolvedExecutionFixture,
  sessionSnapshotSchema,
  sessionSnapshotFixture,
  snapshotSchema,
} from "../src/index"
import { assistantMessageSchema } from "../src/domain"

const SESSION_EVENT_TYPES = new Set([
  "part.upserted",
  "part.delta",
  "part.removed",
  "message.upserted",
  "turn.queued",
  "turn.started",
  "turn.completed",
  "turn.interrupted",
  "turn.failed",
  "request.opened",
  "request.resolved",
  "request.cancelled",
])

const INSTANCES_EVENT_TYPES = new Set([
  "harness.instance_starting",
  "harness.connected",
  "harness.disconnected",
  "harness.reconnecting",
  "harness.instance_failed",
  "harness.inventory_updated",
  "harness.inventory_failed",
  "harness.auth_changed",
  "harness.mcp_status_changed",
  "config.updated",
  "notice.created",
  "error.occurred",
])

describe("command fixtures", () => {
  it("provides one fixture per command name, all schema-valid with unique commandIds", () => {
    const commands = commandFixtures()

    const names = commands.map((command) => command.name)
    expect(new Set(names).size).toBe(commandNameSchema.options.length)
    for (const name of commandNameSchema.options) {
      expect(names, `fixture exists for ${name}`).toContain(name)
    }

    const ids = commands.map((command) => command.commandId)
    expect(new Set(ids).size).toBe(commands.length)

    for (const command of commands) {
      const result = commandSchema.safeParse(command)
      expect(result.success, `command ${command.name} parses`).toBe(true)
    }
  })

  it("produces schema-valid receipts for command fixtures", () => {
    for (const command of commandFixtures()) {
      commandReceiptSchema.parse({
        commandId: command.commandId,
        commandName: command.name,
        state: "accepted",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      })
    }
  })
})

describe("event fixtures", () => {
  it("covers every event type with a schema-valid payload", () => {
    const events = eventFixtures()

    const types = new Set(events.map((event) => event.type))
    expect(types.size).toBe(
      SESSION_EVENT_TYPES.size + INSTANCES_EVENT_TYPES.size
    )
    for (const type of SESSION_EVENT_TYPES) {
      expect(types, `fixture exists for ${type}`).toContain(type)
    }
    for (const type of INSTANCES_EVENT_TYPES) {
      expect(types, `fixture exists for ${type}`).toContain(type)
    }

    for (const event of events) {
      aideEventSchema.parse(event)
    }

    const eventIds = events.map((event) => event.eventId)
    expect(new Set(eventIds).size).toBe(events.length)
  })

  it("keeps part.delta ephemeral and every other session event durable", () => {
    for (const event of eventFixtures()) {
      if (event.type === "part.delta") {
        if (event.delivery.durable) throw new Error("delta must be ephemeral")
        expect(event.delivery.streamOrdinal).toBeGreaterThanOrEqual(0)
      } else {
        if (!event.delivery.durable) throw new Error("expected durable")
        expect(event.delivery.sequence).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it("uses strictly increasing durable sequences within each scope", () => {
    const sessionSequences = eventFixtures()
      .filter((event) => event.scope.kind === "session")
      .flatMap((event) =>
        event.delivery.durable ? [event.delivery.sequence] : []
      )
    for (let i = 1; i < sessionSequences.length; i++) {
      expect(sessionSequences[i]).toBeGreaterThan(sessionSequences[i - 1])
    }

    const instancesSequences = eventFixtures()
      .filter((event) => event.scope.kind === "instances")
      .flatMap((event) =>
        event.delivery.durable ? [event.delivery.sequence] : []
      )
    for (let i = 1; i < instancesSequences.length; i++) {
      expect(instancesSequences[i]).toBeGreaterThan(instancesSequences[i - 1])
    }
  })

  it("scopes session events to sessions and runtime events to instances", () => {
    for (const event of eventFixtures()) {
      if (SESSION_EVENT_TYPES.has(event.type)) {
        expect(event.scope.kind).toBe("session")
      } else if (INSTANCES_EVENT_TYPES.has(event.type)) {
        expect(event.scope.kind).toBe("instances")
      }
    }
  })
})

describe("snapshot fixtures", () => {
  it("round-trips both snapshots through snapshotSchema", () => {
    snapshotSchema.parse(sessionSnapshotFixture())
    snapshotSchema.parse(instancesSnapshotFixture())
  })

  it("never embeds events in a session snapshot", () => {
    expect(
      Object.keys(sessionSnapshotSchema.shape),
      "snapshot schema has no events field"
    ).not.toContain("events")
    expect("events" in sessionSnapshotFixture()).toBe(false)
  })

  it("keeps part indexes ascending within the assistant message", () => {
    const parts = assistantMessageFixture().parts
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i].index).toBeGreaterThan(parts[i - 1].index)
    }
  })

  it("keeps resolved execution self-contained for history rendering", () => {
    const execution = resolvedExecutionFixture()
    expect(Object.keys(execution)).toEqual(
      expect.arrayContaining(["selection", "display", "inventoryRevision"])
    )
    expect(execution.display.modelName.length).toBeGreaterThan(0)
  })

  it("requires parentMessageId on assistant messages", () => {
    const { parentMessageId, ...orphan } = assistantMessageFixture()
    expect(parentMessageId).toBeDefined()
    const result = assistantMessageSchema.safeParse(orphan)
    expect(result.success).toBe(false)
  })

  it("normalizes multi-question input with multi-select and free text", () => {
    const request = inputRequestFixture()
    requestSchema.parse(request)
    const payload = request.payload
    if (payload.kind !== "input") throw new Error("unreachable")

    expect(payload.questions.length).toBeGreaterThanOrEqual(2)
    const multi = payload.questions.find((q) => q.allowMultiple)
    const freeText = payload.questions.find((q) => q.allowFreeText)
    expect(multi?.options?.length).toBeGreaterThan(1)
    expect(freeText?.allowFreeText).toBe(true)

    const resolution = request.resolution
    if (resolution?.kind !== "input") throw new Error("unreachable")
    expect(resolution.answers[multi!.id]?.optionIds?.length).toBeGreaterThan(0)
    expect(typeof resolution.answers[freeText!.id]?.text).toBe("string")
  })

  it("normalizes a permission request with options and resolution", () => {
    const request = permissionRequestFixture()
    requestSchema.parse(request)
    const payload = request.payload
    if (payload.kind !== "permission") throw new Error("unreachable")
    expect(payload.options.length).toBeGreaterThanOrEqual(2)
    const resolution = request.resolution
    if (resolution?.kind !== "permission") throw new Error("unreachable")
    expect(payload.options.map((o) => o.id)).toContain(resolution.optionId)
  })
})
