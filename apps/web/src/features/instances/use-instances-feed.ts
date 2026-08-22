import {
  useEffect,
  useEffectEvent,
  useState,
  useSyncExternalStore,
} from "react"

import type { InstancesEventsOptions } from "@/lib/transport/event-source"
import type { createReadClient } from "@/lib/transport/read-client"

import {
  createInstancesStore,
  type InstancesStoreState,
} from "./instances-store"

/**
 * The instances snapshot plus its event stream, as one subscription.
 *
 * Two places need this state — the operations panel and the composer — and a
 * second SSE subscription for the same data would be waste, so a single owner
 * calls this and hands the result down.
 */

type ReadClient = Pick<ReturnType<typeof createReadClient>, "getInstances">
type Subscribe = (options: InstancesEventsOptions) => { close(): void }

export type InstancesFeed = {
  state: InstancesStoreState
  loadError: string | undefined
  streamError: boolean
  retry: () => void
}

export function useInstancesFeed({
  readClient,
  subscribe,
  enabled = true,
}: {
  readClient: ReadClient
  subscribe: Subscribe
  /** Set false when a caller already has a feed and this one would duplicate it. */
  enabled?: boolean
}): InstancesFeed {
  const [store] = useState(createInstancesStore)
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [loadError, setLoadError] = useState<string>()
  const [streamError, setStreamError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const applyEvent = useEffectEvent(store.applyEvent)
  const applySnapshot = useEffectEvent(store.applySnapshot)

  useEffect(() => {
    if (!enabled) return
    let active = true
    let subscription: { close(): void } | undefined

    setLoadError(undefined)
    void readClient
      .getInstances()
      .then((snapshot) => {
        if (!active) return
        applySnapshot(snapshot)
        subscription = subscribe({
          afterSequence: snapshot.cursor.sequence,
          onEvent: applyEvent,
          onSnapshot: applySnapshot,
          onOpen: () => setStreamError(false),
          onError: () => setStreamError(true),
        })
      })
      .catch((error: unknown) => {
        if (active) setLoadError(errorMessage(error))
      })

    return () => {
      active = false
      subscription?.close()
    }
  }, [attempt, enabled, readClient, state.configRevision, store, subscribe])

  return {
    state,
    loadError,
    streamError,
    retry: () => setAttempt((current) => current + 1),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error"
}
