import type {
  AideEvent,
  DurableCursor,
  Message,
  Part,
  Project,
  Request,
  Session,
  SessionSnapshot,
  Turn,
} from "@workspace/contracts"

const MAX_EVENT_IDS = 500

export type SessionStoreState = {
  project: Project | undefined
  session: Session | undefined
  messages: Message[]
  turns: Turn[]
  requests: Request[]
  cursor: DurableCursor
  snapshotApplied: boolean
  streamOrdinalsSeen: number
}

type Listener = (state: SessionStoreState) => void

export function createSessionStore() {
  let state = initialState()
  let partsByMessage = new Map<string, Map<string, Part>>()
  let eventIds = new Set<string>()
  const listeners = new Set<Listener>()

  const publish = () => {
    for (const listener of listeners) listener(state)
  }

  return {
    applySnapshot(snapshot: SessionSnapshot) {
      partsByMessage = new Map()
      for (const message of snapshot.messages) {
        partsByMessage.set(
          message.id,
          new Map(message.parts.map((part) => [part.id, part]))
        )
      }
      eventIds = new Set()
      state = {
        project: snapshot.project,
        session: snapshot.session,
        messages: sortMessages(snapshot.messages.map(withOrderedParts)),
        turns: sortTurns(snapshot.turns),
        requests: [...snapshot.requests],
        cursor: snapshot.cursor,
        snapshotApplied: true,
        streamOrdinalsSeen: 0,
      }
      publish()
    },

    applyEvent(event: AideEvent) {
      if (eventIds.has(event.eventId)) return
      eventIds.add(event.eventId)
      if (eventIds.size > MAX_EVENT_IDS) {
        eventIds.delete(eventIds.values().next().value!)
      }

      const cursor = event.delivery.durable
        ? { sequence: Math.max(state.cursor.sequence, event.delivery.sequence) }
        : state.cursor
      const streamOrdinalsSeen = event.delivery.durable
        ? state.streamOrdinalsSeen
        : state.streamOrdinalsSeen + 1

      state = { ...state, cursor, streamOrdinalsSeen }

      switch (event.type) {
        case "message.upserted": {
          const existing = state.messages.find(
            (message) => message.id === event.data.message.id
          )
          const message = {
            ...existing,
            ...event.data.message,
            parts: orderedParts(event.data.message.id),
          } as Message
          state = {
            ...state,
            messages: sortMessages(upsert(state.messages, message)),
          }
          break
        }
        case "part.upserted": {
          const part = event.data.part
          const parts = partsByMessage.get(part.messageId) ?? new Map()
          parts.set(part.id, part)
          partsByMessage.set(part.messageId, parts)
          replaceMessageParts(part.messageId)
          break
        }
        case "part.removed": {
          partsByMessage.get(event.data.messageId)?.delete(event.data.partId)
          replaceMessageParts(event.data.messageId)
          break
        }
        case "turn.queued":
        case "turn.started":
        case "turn.completed":
        case "turn.interrupted":
        case "turn.failed":
          state = {
            ...state,
            turns: sortTurns(upsert(state.turns, event.data.turn)),
          }
          break
        case "request.opened":
        case "request.resolved":
        case "request.cancelled":
          state = {
            ...state,
            requests: upsert(state.requests, event.data.request),
          }
          break
        case "part.delta":
        default:
          break
      }

      publish()
    },

    getState() {
      return state
    },

    subscribe(listener: Listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  function orderedParts(messageId: string): Part[] {
    return [...(partsByMessage.get(messageId)?.values() ?? [])].sort(
      (left, right) =>
        left.index - right.index || left.id.localeCompare(right.id)
    )
  }

  function withOrderedParts(message: Message): Message {
    return { ...message, parts: orderedParts(message.id) }
  }

  function replaceMessageParts(messageId: string) {
    const message = state.messages.find(
      (candidate) => candidate.id === messageId
    )
    if (!message) return
    state = {
      ...state,
      messages: state.messages.map((candidate) =>
        candidate.id === messageId ? withOrderedParts(message) : candidate
      ),
    }
  }
}

function initialState(): SessionStoreState {
  return {
    project: undefined,
    session: undefined,
    messages: [],
    turns: [],
    requests: [],
    cursor: { sequence: 0 },
    snapshotApplied: false,
    streamOrdinalsSeen: 0,
  }
}

function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((candidate) => candidate.id === item.id)
  if (index === -1) return [...items, item]
  return items.map((candidate, candidateIndex) =>
    candidateIndex === index ? item : candidate
  )
}

function sortMessages(messages: Message[]): Message[] {
  return [...messages].sort(
    (left, right) => left.seq - right.seq || left.id.localeCompare(right.id)
  )
}

function sortTurns(turns: Turn[]): Turn[] {
  return [...turns].sort(
    (left, right) => left.seq - right.seq || left.id.localeCompare(right.id)
  )
}
