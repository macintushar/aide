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

function partsOf(
  store: ReturnType<typeof createSessionStore>,
  messageId: string
): Part[] {
  return (
    store.getState().messages.find((message) => message.id === messageId)
      ?.parts ?? []
  )
}

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
        durableSequence(queued),
        durableSequence(opened),
        durableSequence(completed),
        durableSequence(resolved)
      )
    )
  })

  it("merges message metadata without discarding existing parts", () => {
    const store = createSessionStore()
    store.applySnapshot(sessionSnapshotFixture())
    const event = fixtureEvent("message.upserted")
    const message = assistantMessageFixture()
    const parts = store.getState().messages[1]!.parts
    event.data.message = {
      ...message,
      usage: { outputTokens: 99 },
      completedAt: "2026-01-02T00:00:00.000Z",
    }

    store.applyEvent(event)

    expect(store.getState().messages[1]).toMatchObject({
      usage: { outputTokens: 99 },
      completedAt: "2026-01-02T00:00:00.000Z",
    })
    expect(store.getState().messages[1]?.parts).toEqual(parts)
  })

  it("ignores part changes for an unknown message", () => {
    const store = createSessionStore()
    const upserted = fixtureEvent("part.upserted")
    upserted.data.part = {
      ...textPartFixture(),
      messageId: "msg_missing",
    }
    const removed = fixtureEvent("part.removed")
    removed.data = { messageId: "msg_missing", partId: "part_missing" }

    store.applyEvent(upserted)
    store.applyEvent(removed)

    expect(store.getState().messages).toEqual([])
  })

  it("deduplicates event ids and leaves the durable cursor where it was", () => {
    const store = createSessionStore()
    store.applySnapshot(sessionSnapshotFixture())
    const listener = vi.fn()
    store.subscribe(listener)
    const delta = fixtureEvent("part.delta")

    store.applyEvent(delta)
    store.applyEvent(delta)

    expect(store.getState().streamOrdinalsSeen).toBe(1)
    // Ephemeral delivery: a delta never advances the cursor a reconnect
    // resumes from, or the durable events it covers would be skipped.
    expect(store.getState().cursor.sequence).toBe(12)
    expect(listener).toHaveBeenCalledOnce()
  })

  it("renders a delta as a live part and lets the persisted part supersede it", () => {
    const store = createSessionStore()
    store.applySnapshot(sessionSnapshotFixture())
    const delta = fixtureEvent("part.delta")
    delta.data = {
      partId: "part_live",
      messageId: "msg_assistant_1",
      field: "text",
      text: "half ",
    }

    store.applyEvent(delta)
    store.applyEvent({
      ...delta,
      eventId: "evt_delta_2",
      data: { ...delta.data, text: "written" },
    })

    const live = partsOf(store, "msg_assistant_1").find(
      (part) => part.id === "part_live"
    )
    expect(live).toMatchObject({ type: "text", text: "half written" })

    const upserted = fixtureEvent("part.upserted")
    upserted.data.part = {
      ...textPartFixture(),
      id: "part_live",
      messageId: "msg_assistant_1",
      index: 9,
      text: "half written, then settled",
    }
    store.applyEvent(upserted)

    const settled = partsOf(store, "msg_assistant_1").filter(
      (part) => part.id === "part_live"
    )
    // One part throughout: the durable form replaces the fragments, and no
    // duplicate is left behind.
    expect(settled).toHaveLength(1)
    expect(settled[0]).toMatchObject({ text: "half written, then settled" })
  })

  it("renders a reasoning delta as a reasoning part", () => {
    const store = createSessionStore()
    store.applySnapshot(sessionSnapshotFixture())
    const delta = fixtureEvent("part.delta")
    delta.data = {
      partId: "part_thinking",
      messageId: "msg_assistant_1",
      field: "reasoning",
      text: "weighing it up",
    }

    store.applyEvent(delta)

    expect(
      partsOf(store, "msg_assistant_1").find(
        (part) => part.id === "part_thinking"
      )
    ).toMatchObject({ type: "reasoning", text: "weighing it up" })
  })

  it("streams a tool's partial input onto its pending part", () => {
    const store = createSessionStore()
    store.applySnapshot(sessionSnapshotFixture())
    const pending = fixtureEvent("part.upserted")
    pending.data.part = {
      ...toolPartFixture(),
      id: "part_tool_live",
      messageId: "msg_assistant_1",
      index: 8,
      status: "pending",
      input: undefined,
      output: undefined,
    }
    store.applyEvent(pending)

    const delta = fixtureEvent("part.delta")
    delta.data = {
      partId: "part_tool_live",
      messageId: "msg_assistant_1",
      field: "input",
      text: '{"command":',
    }
    store.applyEvent(delta)

    const part = partsOf(store, "msg_assistant_1").find(
      (candidate) => candidate.id === "part_tool_live"
    )
    expect(part).toMatchObject({ type: "tool", input: '{"command":' })
    // The fragment attaches to the existing part rather than inventing one.
    expect(
      partsOf(store, "msg_assistant_1").filter(
        (candidate) => candidate.id === "part_tool_live"
      )
    ).toHaveLength(1)
  })

  it("drops live fragments when a snapshot replaces the session", () => {
    const store = createSessionStore()
    store.applySnapshot(sessionSnapshotFixture())
    const delta = fixtureEvent("part.delta")
    delta.data = {
      partId: "part_live",
      messageId: "msg_assistant_1",
      field: "text",
      text: "in flight",
    }
    store.applyEvent(delta)
    expect(
      partsOf(store, "msg_assistant_1").some((part) => part.id === "part_live")
    ).toBe(true)

    store.applySnapshot(sessionSnapshotFixture())

    // A fragment was never persisted, so the snapshot is the authority.
    expect(
      partsOf(store, "msg_assistant_1").some((part) => part.id === "part_live")
    ).toBe(false)
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
    store.applyEvent({ ...event, eventId: "evt_bound_500" })

    expect(listener).toHaveBeenCalledOnce()
  })

  it("notifies snapshot listeners until they unsubscribe", () => {
    const store = createSessionStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.applySnapshot(sessionSnapshotFixture())
    unsubscribe()
    store.applyEvent(fixtureEvent("turn.completed"))

    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(store.getState())
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

function durableSequence(event: AideEvent): number {
  expect(event.delivery.durable).toBe(true)
  if (!event.delivery.durable) throw new Error("Expected durable event")
  return event.delivery.sequence
}
