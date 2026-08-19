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

/**
 * A `part.delta` fragment. Live-only: it is never written into the persisted
 * part map and never advances the durable cursor, so a reload or a fresh
 * snapshot drops it, which is exactly what "not stored" has to mean.
 */
type LiveFragment = {
  field: "text" | "reasoning" | "input"
  text: string
  /** Arrival order, used to place live-only parts after the persisted ones. */
  order: number
}

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
  let liveByMessage = new Map<string, Map<string, LiveFragment>>()
  let liveOrder = 0
  let eventIds = new Set<string>()
  const listeners = new Set<Listener>()

  const publish = () => {
    for (const listener of listeners) listener(state)
  }

  return {
    applySnapshot(snapshot: SessionSnapshot) {
      partsByMessage = new Map()
      // The snapshot is the authority on what was persisted, so any fragment
      // still in flight is discarded rather than layered on top of it.
      liveByMessage = new Map()
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
          // The durable part supersedes whatever was streamed into it.
          liveByMessage.get(part.messageId)?.delete(part.id)
          replaceMessageParts(part.messageId)
          break
        }
        case "part.removed": {
          partsByMessage.get(event.data.messageId)?.delete(event.data.partId)
          liveByMessage.get(event.data.messageId)?.delete(event.data.partId)
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
        case "part.delta": {
          const { partId, messageId, field, text } = event.data
          const live =
            liveByMessage.get(messageId) ?? new Map<string, LiveFragment>()
          const existing = live.get(partId)
          live.set(partId, {
            field,
            text: (existing?.text ?? "") + text,
            order: existing?.order ?? liveOrder++,
          })
          liveByMessage.set(messageId, live)
          replaceMessageParts(messageId)
          break
        }
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

  /**
   * Persisted parts in index order, with live fragments layered on top: an
   * in-flight tool's streaming input attaches to its pending part, and a block
   * whose completed form has not arrived yet renders as a part of its own.
   */
  function orderedParts(messageId: string): Part[] {
    const persisted = [...(partsByMessage.get(messageId)?.values() ?? [])].sort(
      (left, right) =>
        left.index - right.index || left.id.localeCompare(right.id)
    )
    const live = liveByMessage.get(messageId)
    if (!live || live.size === 0) return persisted

    const merged = [...persisted]
    let nextIndex = persisted.reduce(
      (max, part) => Math.max(max, part.index),
      -1
    )
    const fragments = [...live.entries()].sort(
      ([, left], [, right]) => left.order - right.order
    )

    for (const [partId, fragment] of fragments) {
      const position = merged.findIndex((part) => part.id === partId)
      if (position !== -1) {
        const part = merged[position]
        // Only a tool's input streams onto a part that already exists; a text
        // or reasoning block's persisted form always wins over its fragments.
        if (fragment.field === "input" && part.type === "tool") {
          merged[position] = { ...part, input: fragment.text }
        }
        continue
      }
      if (fragment.field === "input") continue
      nextIndex += 1
      merged.push({
        id: partId,
        messageId,
        index: nextIndex,
        type: fragment.field === "reasoning" ? "reasoning" : "text",
        text: fragment.text,
      })
    }
    return merged
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
