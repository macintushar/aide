import {
  aideEventSchema,
  instancesSnapshotSchema,
  sessionSnapshotSchema,
  type AideEvent,
  type InstancesSnapshot,
  type SessionSnapshot,
} from "@workspace/contracts"

type EventSourceLike = {
  onopen: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent<string>) => void) | null
  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void
  ): void
  close(): void
}

export type EventSourceConstructor = new (url: string) => EventSourceLike

export type SubscriptionOptions<TSnapshot> = {
  baseUrl?: string
  afterSequence?: number
  EventSourceImpl?: EventSourceConstructor
  onEvent: (event: AideEvent) => void
  onSnapshot?: (snapshot: TSnapshot) => void
  onOpen?: (event: Event) => void
  onError?: (event: Event) => void
  onInvalidFrame?: (data: string, error: unknown) => void
}

export type SessionEventsOptions = SubscriptionOptions<SessionSnapshot> & {
  sessionId: string
}

export type InstancesEventsOptions = SubscriptionOptions<InstancesSnapshot>

export type EventSubscription = {
  close(): void
}

export function subscribeSessionEvents(
  options: SessionEventsOptions
): EventSubscription {
  return subscribe(
    `/sessions/${encodeURIComponent(options.sessionId)}/events`,
    options,
    sessionSnapshotSchema
  )
}

export function subscribeInstancesEvents(
  options: InstancesEventsOptions
): EventSubscription {
  return subscribe("/instances/events", options, instancesSnapshotSchema)
}

const EVENT_TYPES = [
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
] as const satisfies readonly AideEvent["type"][]

type Parser<T> = { parse(value: unknown): T }

function subscribe<TSnapshot>(
  path: string,
  options: SubscriptionOptions<TSnapshot>,
  snapshotSchema: Parser<TSnapshot>
): EventSubscription {
  const EventSourceImpl =
    options.EventSourceImpl ??
    (EventSource as unknown as EventSourceConstructor)
  const baseUrl = options.baseUrl?.replace(/\/$/, "") ?? ""
  const query =
    options.afterSequence === undefined
      ? ""
      : `?afterSequence=${encodeURIComponent(options.afterSequence)}`
  const source = new EventSourceImpl(`${baseUrl}${path}${query}`)

  source.onopen = options.onOpen ?? null
  source.onerror = options.onError ?? null

  const handleEvent = (frame: MessageEvent<string>) => {
    try {
      const event = aideEventSchema.parse(JSON.parse(frame.data) as unknown)
      options.onEvent(event)
    } catch (error) {
      options.onInvalidFrame?.(frame.data, error)
    }
  }
  source.onmessage = handleEvent
  for (const type of EVENT_TYPES) source.addEventListener(type, handleEvent)

  source.addEventListener("snapshot", (frame) => {
    try {
      const snapshot = snapshotSchema.parse(JSON.parse(frame.data) as unknown)
      options.onSnapshot?.(snapshot)
    } catch (error) {
      options.onInvalidFrame?.(frame.data, error)
    }
  })

  return { close: () => source.close() }
}
