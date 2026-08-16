import type {
  AideEvent,
  DurableCursor,
  InstancesSnapshot,
  InstanceSnapshotEntry,
} from "@workspace/contracts"

/**
 * Instance health is Aide-owned state that arrives as `harness.*` events.
 *
 * The UI must not poll adapters: it reads `GET /instances` once for initial
 * state, then applies events. The reducer is the same shape as the session
 * store's — apply event, replace the entry by instanceId.
 */

const MAX_EVENT_IDS = 500

export type InstancesStoreState = {
  instances: InstanceSnapshotEntry[]
  cursor: DurableCursor
  snapshotApplied: boolean
  /** Set when the last `config.update` changed something, so the UI can refetch. */
  configRevision: number
}

type Listener = (state: InstancesStoreState) => void

export function createInstancesStore() {
  let state = initialState()
  let eventIds = new Set<string>()
  const listeners = new Set<Listener>()

  const publish = () => {
    for (const listener of listeners) listener(state)
  }

  const patch = (
    instanceId: string | undefined,
    update: (entry: InstanceSnapshotEntry) => InstanceSnapshotEntry
  ) => {
    if (!instanceId) return
    const index = state.instances.findIndex(
      (entry) => entry.instanceId === instanceId
    )
    // An event for an instance the snapshot does not know about is ignored
    // rather than synthesised: the snapshot is the authority on what exists.
    if (index === -1) return
    state = {
      ...state,
      instances: state.instances.map((entry, entryIndex) =>
        entryIndex === index ? update(entry) : entry
      ),
    }
  }

  return {
    applySnapshot(snapshot: InstancesSnapshot) {
      eventIds = new Set()
      state = {
        instances: [...snapshot.instances],
        cursor: snapshot.cursor,
        snapshotApplied: true,
        configRevision: state.configRevision,
      }
      publish()
    },

    applyEvent(event: AideEvent) {
      if (eventIds.has(event.eventId)) return
      eventIds.add(event.eventId)
      if (eventIds.size > MAX_EVENT_IDS) {
        eventIds.delete(eventIds.values().next().value!)
      }

      if (event.delivery.durable) {
        state = {
          ...state,
          cursor: {
            sequence: Math.max(state.cursor.sequence, event.delivery.sequence),
          },
        }
      }

      switch (event.type) {
        case "harness.instance_starting":
          patch(event.instanceId, (entry) => ({
            ...entry,
            status: "starting",
            error: undefined,
          }))
          break
        case "harness.connected":
          patch(event.instanceId, (entry) => ({
            ...entry,
            status: "ready",
            error: undefined,
            ...(event.data.version ? { version: event.data.version } : {}),
            installed: true,
          }))
          break
        case "harness.reconnecting":
          patch(event.instanceId, (entry) => ({ ...entry, status: "starting" }))
          break
        case "harness.disconnected":
          patch(event.instanceId, (entry) => ({ ...entry, status: "stopped" }))
          break
        case "harness.instance_failed":
          patch(event.instanceId, (entry) => ({
            ...entry,
            status: "failed",
            error: event.data.error,
          }))
          break
        case "harness.auth_changed":
          patch(event.instanceId, (entry) => ({
            ...entry,
            auth: event.data.auth,
          }))
          break
        case "harness.inventory_updated":
          patch(event.instanceId, (entry) => ({
            ...entry,
            inventory: event.data.inventory,
            // Fresh inventory clears a degradation caused by a stale one.
            status: entry.status === "degraded" ? "ready" : entry.status,
            error: entry.status === "degraded" ? undefined : entry.error,
          }))
          break
        case "harness.inventory_failed":
          patch(event.instanceId, (entry) => ({
            ...entry,
            status: "degraded",
            error: event.data.error,
            ...(entry.inventory
              ? { inventory: { ...entry.inventory, stale: true } }
              : {}),
          }))
          break
        case "config.updated":
          state = { ...state, configRevision: state.configRevision + 1 }
          break
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
}

function initialState(): InstancesStoreState {
  return {
    instances: [],
    cursor: { sequence: 0 },
    snapshotApplied: false,
    configRevision: 0,
  }
}

/**
 * Sending is blocked on an unauthenticated instance, and the UI must say why
 * rather than failing at submit time.
 */
export function sendBlockedReason(
  entry: InstanceSnapshotEntry
): string | undefined {
  if (!entry.enabled) return "This instance is disabled in settings."
  if (entry.status === "failed") {
    return entry.error?.message ?? "This instance failed to start."
  }
  if (entry.auth.status === "unauthenticated") {
    return "Sign in to this harness to send. Aide surfaces auth but never stores it."
  }
  if (entry.auth.status === "expired") {
    return "This harness's credentials have expired. Re-authenticate to send."
  }
  if (!entry.inventory && entry.status === "degraded") {
    return (
      entry.error?.message ??
      "No inventory is available for this instance yet, so sending is disabled."
    )
  }
  return undefined
}
