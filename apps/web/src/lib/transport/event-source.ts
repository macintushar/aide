import { aideEventSchema, type AideEvent } from "@workspace/contracts"

type EventSourceLike = {
  onmessage: ((event: MessageEvent<string>) => void) | null
  close(): void
}

export type EventSourceConstructor = new (url: string) => EventSourceLike

type SubscriptionOptions = {
  baseUrl?: string
  afterSequence?: number
  EventSourceImpl?: EventSourceConstructor
  onEvent: (event: AideEvent) => void
  onInvalidFrame?: (data: string, error: unknown) => void
}

export type SessionEventsOptions = SubscriptionOptions & {
  sessionId: string
}

export type EventSubscription = {
  close(): void
}

export function subscribeSessionEvents(
  options: SessionEventsOptions
): EventSubscription {
  return subscribe(
    `/sessions/${encodeURIComponent(options.sessionId)}/events`,
    options
  )
}

export function subscribeInstancesEvents(
  options: SubscriptionOptions
): EventSubscription {
  return subscribe("/instances/events", options)
}

function subscribe(
  path: string,
  options: SubscriptionOptions
): EventSubscription {
  const EventSourceImpl = options.EventSourceImpl ?? EventSource
  const baseUrl = options.baseUrl?.replace(/\/$/, "") ?? ""
  const query =
    options.afterSequence === undefined
      ? ""
      : `?afterSequence=${encodeURIComponent(options.afterSequence)}`
  const source = new EventSourceImpl(`${baseUrl}${path}${query}`)

  source.onmessage = (frame) => {
    try {
      const event = aideEventSchema.parse(JSON.parse(frame.data) as unknown)
      options.onEvent(event)
    } catch (error) {
      options.onInvalidFrame?.(frame.data, error)
    }
  }

  return { close: () => source.close() }
}
