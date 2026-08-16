import {
  eventFixtures,
  instancesSnapshotFixture,
  sessionSnapshotFixture,
} from "@workspace/contracts"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  subscribeInstancesEvents,
  subscribeSessionEvents,
  type EventSourceConstructor,
} from "./event-source"

class FakeEventSource {
  static instances: FakeEventSource[] = []

  readonly url: string
  readonly close = vi.fn()
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  readonly listeners = new Map<
    string,
    Array<(event: MessageEvent<string>) => void>
  >()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void
  ) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  emit(type: string, data: string) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data }))
    }
  }

  emitMessage(data: string) {
    this.onmessage?.(new MessageEvent("message", { data }))
  }

  open() {
    this.onopen?.(new Event("open"))
  }

  fail() {
    this.onerror?.(new Event("error"))
  }
}

const EventSourceImpl = FakeEventSource as EventSourceConstructor

afterEach(() => vi.unstubAllGlobals())

describe("event source subscriptions", () => {
  it("builds the session URL with an encoded id and cursor", () => {
    FakeEventSource.instances = []

    subscribeSessionEvents({
      baseUrl: "http://localhost:3000/",
      sessionId: "session/one",
      afterSequence: 12,
      EventSourceImpl,
      onEvent: vi.fn(),
    })

    expect(FakeEventSource.instances[0]?.url).toBe(
      "http://localhost:3000/sessions/session%2Fone/events?afterSequence=12"
    )
  })

  it("delivers every named Aide event and reports invalid frames", () => {
    FakeEventSource.instances = []
    const onEvent = vi.fn()
    const onInvalidFrame = vi.fn()
    subscribeInstancesEvents({ EventSourceImpl, onEvent, onInvalidFrame })
    const source = FakeEventSource.instances[0]!
    const events = eventFixtures()

    for (const event of events) source.emit(event.type, JSON.stringify(event))
    source.emitMessage('{"type":"unknown"}')

    expect(onEvent.mock.calls.map(([event]) => event)).toEqual(events)
    expect(onInvalidFrame).toHaveBeenCalledOnce()
    expect(onInvalidFrame.mock.calls[0]?.[0]).toBe('{"type":"unknown"}')
  })

  it("parses snapshots with the schema for each subscription", () => {
    FakeEventSource.instances = []
    const onInstancesSnapshot = vi.fn()
    const onSessionSnapshot = vi.fn()
    const onInvalidFrame = vi.fn()
    subscribeInstancesEvents({
      EventSourceImpl,
      onEvent: vi.fn(),
      onSnapshot: onInstancesSnapshot,
      onInvalidFrame,
    })
    subscribeSessionEvents({
      sessionId: "ses_1",
      EventSourceImpl,
      onEvent: vi.fn(),
      onSnapshot: onSessionSnapshot,
      onInvalidFrame,
    })

    FakeEventSource.instances[0]!.emit(
      "snapshot",
      JSON.stringify(instancesSnapshotFixture())
    )
    FakeEventSource.instances[1]!.emit(
      "snapshot",
      JSON.stringify(sessionSnapshotFixture())
    )
    FakeEventSource.instances[0]!.emit(
      "snapshot",
      JSON.stringify(sessionSnapshotFixture())
    )

    expect(onInstancesSnapshot).toHaveBeenCalledWith(instancesSnapshotFixture())
    expect(onSessionSnapshot).toHaveBeenCalledWith(sessionSnapshotFixture())
    expect(onInvalidFrame).toHaveBeenCalledOnce()
  })

  it("forwards connection open and error events", () => {
    FakeEventSource.instances = []
    const onOpen = vi.fn()
    const onError = vi.fn()
    subscribeInstancesEvents({
      EventSourceImpl,
      onEvent: vi.fn(),
      onOpen,
      onError,
    })
    const source = FakeEventSource.instances[0]!

    source.open()
    source.fail()

    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ type: "open" })
    )
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error" })
    )
  })

  it("uses the default EventSource and instances URL", () => {
    FakeEventSource.instances = []
    vi.stubGlobal("EventSource", FakeEventSource)

    const subscription = subscribeInstancesEvents({ onEvent: vi.fn() })

    expect(FakeEventSource.instances[0]?.url).toBe("/instances/events")
    subscription.close()
  })

  it("closes the underlying EventSource", () => {
    FakeEventSource.instances = []
    const subscription = subscribeInstancesEvents({
      afterSequence: 4,
      EventSourceImpl,
      onEvent: vi.fn(),
    })

    expect(FakeEventSource.instances[0]?.url).toBe(
      "/instances/events?afterSequence=4"
    )
    subscription.close()
    expect(FakeEventSource.instances[0]?.close).toHaveBeenCalledOnce()
  })
})
