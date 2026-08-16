import {
  assistantMessageFixture,
  eventFixtures,
  permissionRequestFixture,
  sessionSnapshotFixture,
  textPartFixture,
  toolPartFixture,
  turnFixture,
  type AideEvent,
  type Part,
} from "@workspace/contracts"
import { describe, expect, it, vi } from "vitest"

import { createSessionStore } from "./event-store"

describe("createSessionStore", () => {
  it("applies and replaces snapshots with ordered messages and parts", () => {
    const store = createSessionStore()
    const snapshot = sessionSnapshotFixture()
    snapshot.messages.reverse()
    snapshot.messages[0]!.parts.reverse()
    store.applySnapshot(snapshot)

    expect(store.getState()).toMatchObject({
      project: { id: "proj_1" },
      session: { id: "ses_1" },
      cursor: { sequence: 12 },
      snapshotApplied: true,
    })
    expect(store.getState().messages.map((message) => message.id)).toEqual([
      "msg_user_1",
      "msg_assistant_1",
    ])
    expect(
      store.getState().messages[1]?.parts.map((part) => part.index)
    ).toEqual([0, 1, 2])

    const replacement = sessionSnapshotFixture()
    replacement.messages = [replacement.messages[0]!]
    replacement.turns = []
    replacement.requests = []
    store.applySnapshot(replacement)
    expect(store.getState().messages).toHaveLength(1)
    expect(store.getState().turns).toEqual([])
  })

  it("upserts out-of-order parts by id, orders them, and removes them", () => {
    const store = createSessionStore()
    const message = assistantMessageFixture()
    const messageEvent = fixtureEvent("message.upserted")
    messageEvent.data.message = { ...message, parts: undefined } as never
    delete (messageEvent.data.message as { parts?: Part[] }).parts
    store.applyEvent(messageEvent)

    const high = toolPartFixture("running", 2)
    const low = textPartFixture(1)
    store.applyEvent(partEvent(high, "evt_part_high", 2))
    store.applyEvent(partEvent(low, "evt_part_low", 3))
    store.applyEvent(
      partEvent({ ...high, status: "completed" }, "evt_part_replace", 4)
    )

    expect(store.getState().messages[0]?.parts.map((part) => part.id)).toEqual([
      low.id,
      high.id,
    ])
    expect(store.getState().messages[0]?.parts[1]).toMatchObject({
      status: "completed",
    })

    const removed = fixtureEvent("part.removed")
    removed.data = { messageId: high.messageId, partId: low.id }
    store.applyEvent(removed)
    expect(store.getState().messages[0]?.parts.map((part) => part.id)).toEqual([
      high.id,
    ])
  })

  it("upserts turn and request replacements and advances the durable cursor", () => {
    const store = createSessionStore()
    const queued = fixtureEvent("turn.queued")
    const completed = fixtureEvent("turn.completed")
    const opened = fixtureEvent("request.opened")
    const resolved = fixtureEvent("request.resolved")
    queued.data = { turn: turnFixture("queued") }
    completed.data = { turn: turnFixture("completed") }
    opened.data = {
      request: {
        ...permissionRequestFixture(),
        status: "open",
        resolution: undefined,
      },
    }
    resolved.data = { request: permissionRequestFixture() }

    for (const event of [queued, opened, completed, resolved])
      store.applyEvent(event)

    expect(store.getState().turns).toEqual([turnFixture("completed")])
    expect(store.getState().requests).toEqual([permissionRequestFixture()])
    expect(store.getState().cursor.sequence).toBe(
      Math.max(
        queued.delivery.sequence,
        opened.delivery.sequence,
        completed.delivery.sequence,
        resolved.delivery.sequence
      )
    )
  })

  it("deduplicates event ids, counts deltas without changing parts, and notifies", () => {
    const store = createSessionStore()
    store.applySnapshot(sessionSnapshotFixture())
    const listener = vi.fn()
    store.subscribe(listener)
    const delta = fixtureEvent("part.delta")
    const before = store.getState().messages

    store.applyEvent(delta)
    store.applyEvent(delta)

    expect(store.getState().messages).toBe(before)
    expect(store.getState().streamOrdinalsSeen).toBe(1)
    expect(store.getState().cursor.sequence).toBe(12)
    expect(listener).toHaveBeenCalledOnce()
  })

  it("bounds event-id deduplication to the latest 500 ids", () => {
    const store = createSessionStore()
    const event = fixtureEvent("turn.completed")

    for (let index = 0; index <= 500; index++) {
      store.applyEvent({ ...event, eventId: `evt_bound_${index}` })
    }
    const listener = vi.fn()
    store.subscribe(listener)
    store.applyEvent({ ...event, eventId: "evt_bound_0" })

    expect(listener).toHaveBeenCalledOnce()
  })
})

function fixtureEvent<T extends AideEvent["type"]>(
  type: T
): Extract<AideEvent, { type: T }> {
  return structuredClone(
    eventFixtures().find((event) => event.type === type)!
  ) as Extract<AideEvent, { type: T }>
}

function partEvent(part: Part, eventId: string, sequence: number): AideEvent {
  const event = fixtureEvent("part.upserted")
  event.eventId = eventId
  event.delivery = { durable: true, sequence }
  event.data = { part }
  return event
}
