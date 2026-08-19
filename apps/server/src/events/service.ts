import { aideEventSchema, type AideEvent } from "@workspace/contracts"

import type { AideDb } from "../db"
import { eventLogRepo, withTransaction, type EventScopeTarget } from "../db"

type WithoutDelivery<T> = T extends AideEvent ? Omit<T, "delivery"> : never

export type DurableEvent = Exclude<AideEvent, { type: "part.delta" }>
export type DurableEventInput = WithoutDelivery<DurableEvent>
export type PartDeltaEvent = Extract<AideEvent, { type: "part.delta" }>
export type PartDeltaEventInput = Omit<PartDeltaEvent, "delivery">

export type ScopedCursor<S extends EventScopeTarget = EventScopeTarget> = {
  readonly scope: S
  readonly sequence: number
}

export type ReplayResult<T> =
  | {
      mode: "events"
      events: DurableEvent[]
      cursor: ScopedCursor
    }
  | {
      mode: "snapshot"
      snapshot: T
      cursor: ScopedCursor
    }

export type EventServiceErrorCode =
  | "cursor_scope_mismatch"
  | "duplicate_event_id"
  | "ephemeral_event"
  | "invalid_cursor"

export class EventServiceError extends Error {
  readonly code: EventServiceErrorCode

  constructor(code: EventServiceErrorCode, message: string) {
    super(message)
    this.name = "EventServiceError"
    this.code = code
  }
}

export interface EventSubscription extends AsyncIterableIterator<AideEvent> {
  return(): Promise<IteratorResult<AideEvent>>
}

type Subscriber = {
  streamOrdinal: number
  push(event: AideEvent): void
  subscription: EventSubscription
}

function scopeKey(scope: EventScopeTarget): string {
  return scope.kind === "instances" ? "instances" : `session:${scope.sessionId}`
}

function eventTarget(event: AideEvent): EventScopeTarget {
  return event.scope.kind === "instances"
    ? { kind: "instances" }
    : { kind: "session", sessionId: event.scope.sessionId }
}

function sameScope(left: EventScopeTarget, right: EventScopeTarget): boolean {
  return scopeKey(left) === scopeKey(right)
}

function validateSequence(sequence: number): void {
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new EventServiceError(
      "invalid_cursor",
      "Event cursors must be nonnegative safe integers"
    )
  }
}

function withoutDelivery(
  event: AideEvent
): DurableEventInput | PartDeltaEventInput {
  const { delivery: _delivery, ...input } = event
  return input
}

function createSubscription(
  onClose: () => void,
  signal?: AbortSignal
): { subscriber: Subscriber; close: () => void } {
  const queue: AideEvent[] = []
  let pending: ((result: IteratorResult<AideEvent>) => void) | undefined
  let closed = false

  const close = () => {
    if (closed) return
    closed = true
    signal?.removeEventListener("abort", close)
    pending?.({ done: true, value: undefined })
    pending = undefined
    onClose()
  }

  const subscription: EventSubscription = {
    [Symbol.asyncIterator]() {
      return this
    },
    next() {
      const event = queue.shift()
      if (event) return Promise.resolve({ done: false, value: event })
      if (closed) {
        return Promise.resolve({ done: true, value: undefined })
      }
      return new Promise((resolve) => {
        pending = resolve
      })
    },
    return() {
      close()
      return Promise.resolve({ done: true, value: undefined })
    },
  }

  const subscriber: Subscriber = {
    streamOrdinal: 0,
    subscription,
    push(event) {
      if (closed) return
      if (pending) {
        const resolve = pending
        pending = undefined
        resolve({ done: false, value: event })
        return
      }
      queue.push(event)
    },
  }

  if (signal?.aborted) close()
  else signal?.addEventListener("abort", close, { once: true })

  return { subscriber, close }
}

export class EventService {
  readonly #db: AideDb
  readonly #subscribers = new Map<string, Set<Subscriber>>()

  constructor(db: AideDb) {
    this.#db = db
  }

  cursor<S extends EventScopeTarget>(
    scope: S,
    sequence: number
  ): ScopedCursor<S> {
    validateSequence(sequence)
    return { scope, sequence }
  }

  appendDurable(input: DurableEventInput): DurableEvent {
    const persisted = this.persistDurable(this.#db, input)
    this.broadcastDurable(persisted)
    return persisted
  }

  /**
   * Runs a domain mutation with a durable-event collector in one immediate
   * transaction. Domain rows and event rows commit atomically, and collected
   * events are broadcast only after the transaction commits. If `fn` throws,
   * nothing is persisted and nothing is broadcast.
   */
  runTransactional<T>(
    fn: (tx: AideDb, emit: (event: DurableEventInput) => DurableEvent) => T
  ): { result: T; events: DurableEvent[] } {
    const collected: DurableEvent[] = []
    const result = withTransaction(this.#db, (tx) =>
      fn(tx, (event) => {
        const persisted = this.persistDurable(tx, event)
        collected.push(persisted)
        return persisted
      })
    )
    for (const event of collected) this.broadcastDurable(event)
    return { result, events: collected }
  }

  persistDurable(db: AideDb, input: DurableEventInput): DurableEvent {
    if ((input as { type?: string }).type === "part.delta") {
      throw new EventServiceError(
        "ephemeral_event",
        "part.delta cannot be appended as a durable event"
      )
    }

    const parsed = aideEventSchema.parse({
      ...input,
      delivery: { durable: true, sequence: 0 },
    })
    if (parsed.type === "part.delta") {
      throw new EventServiceError(
        "ephemeral_event",
        "part.delta cannot be appended as a durable event"
      )
    }

    const existing = eventLogRepo.getByEventId(db, parsed.eventId)
    if (existing) {
      if (
        JSON.stringify(withoutDelivery(existing)) !==
        JSON.stringify(withoutDelivery(parsed))
      ) {
        throw new EventServiceError(
          "duplicate_event_id",
          `Event ID ${parsed.eventId} is already used by a different event`
        )
      }
      return existing as DurableEvent
    }

    return eventLogRepo.append(db, parsed) as DurableEvent
  }

  broadcastDurable(event: DurableEvent): void {
    this.#broadcast(event)
  }

  publishEphemeral(input: PartDeltaEventInput): void {
    const validated = aideEventSchema.parse({
      ...input,
      delivery: { durable: false, streamOrdinal: 0 },
    })
    if (validated.type !== "part.delta") {
      throw new EventServiceError(
        "ephemeral_event",
        "Only part.delta may use ephemeral delivery"
      )
    }

    const subscribers = this.#subscribers.get(scopeKey(eventTarget(validated)))
    if (!subscribers) return
    for (const subscriber of subscribers) {
      const event = aideEventSchema.parse({
        ...input,
        delivery: {
          durable: false,
          streamOrdinal: subscriber.streamOrdinal++,
        },
      })
      subscriber.push(event)
    }
  }

  subscribe(
    scope: EventScopeTarget,
    options: { signal?: AbortSignal } = {}
  ): EventSubscription {
    const key = scopeKey(scope)
    let subscriber: Subscriber
    const created = createSubscription(
      () => {
        const subscribers = this.#subscribers.get(key)
        subscribers?.delete(subscriber)
        if (subscribers?.size === 0) this.#subscribers.delete(key)
      },
      options.signal?.aborted ? undefined : options.signal
    )
    subscriber = created.subscriber

    if (options.signal?.aborted) {
      created.close()
    } else {
      const subscribers = this.#subscribers.get(key) ?? new Set<Subscriber>()
      subscribers.add(subscriber)
      this.#subscribers.set(key, subscribers)
    }
    return subscriber.subscription
  }

  listDurable<S extends EventScopeTarget>(input: {
    scope: S
    cursor: ScopedCursor<S>
    limit?: number
  }): DurableEvent[] {
    if (!sameScope(input.scope, input.cursor.scope)) {
      throw new EventServiceError(
        "cursor_scope_mismatch",
        "An event cursor cannot be used with a different scope"
      )
    }
    validateSequence(input.cursor.sequence)
    const limit = input.limit ?? 500
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new EventServiceError(
        "invalid_cursor",
        "Replay limit must be positive"
      )
    }
    return eventLogRepo.listAfter(
      this.#db,
      input.scope,
      input.cursor.sequence,
      limit
    ) as DurableEvent[]
  }

  latestSequence(scope: EventScopeTarget): number {
    return eventLogRepo.latestSequence(this.#db, scope)
  }

  findDurable(eventId: string): DurableEvent | undefined {
    return eventLogRepo.getByEventId(this.#db, eventId) as
      | DurableEvent
      | undefined
  }

  replayOrSnapshot<T>(input: {
    scope: EventScopeTarget
    afterSequence: number
    maxReplay?: number
    snapshot: () => T
  }): ReplayResult<T> {
    validateSequence(input.afterSequence)
    const maxReplay = input.maxReplay ?? 500
    if (!Number.isSafeInteger(maxReplay) || maxReplay < 0) {
      throw new EventServiceError(
        "invalid_cursor",
        "Maximum replay size must be nonnegative"
      )
    }

    const latest = this.latestSequence(input.scope)
    if (
      input.afterSequence > latest ||
      latest - input.afterSequence > maxReplay
    ) {
      const snapshot = input.snapshot()
      const sequence = Math.max(0, this.latestSequence(input.scope))
      return {
        mode: "snapshot",
        snapshot,
        cursor: this.cursor(input.scope, sequence),
      }
    }

    return {
      mode: "events",
      events: eventLogRepo.listAfter(
        this.#db,
        input.scope,
        input.afterSequence,
        maxReplay
      ) as DurableEvent[],
      cursor: this.cursor(input.scope, Math.max(0, latest)),
    }
  }

  #broadcast(event: DurableEvent): void {
    const subscribers = this.#subscribers.get(scopeKey(eventTarget(event)))
    if (!subscribers) return
    for (const subscriber of subscribers) subscriber.push(event)
  }
}
