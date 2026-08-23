import type { Command } from "@workspace/contracts"
import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
  useSyncExternalStore,
} from "react"

import { createCommandClient } from "@/lib/transport/command-client"
import {
  subscribeInstancesEvents,
  type InstancesEventsOptions,
} from "@/lib/transport/event-source"
import { createReadClient } from "@/lib/transport/read-client"

import {
  createInstancesStore,
  type InstancesStoreState,
} from "./instances-store"

type ReadClient = Pick<ReturnType<typeof createReadClient>, "getInstances">
type CommandClient = Pick<ReturnType<typeof createCommandClient>, "send">
type Subscribe = (options: InstancesEventsOptions) => { close(): void }

export type InstancesContextValue = {
  state: InstancesStoreState
  loadError?: string
  streamError: boolean
  actionError?: string
  pendingAction?: string
  send: (command: Command) => Promise<void>
  retry: () => void
}

export type InstancesProviderProps = {
  readClient?: ReadClient
  commandClient?: CommandClient
  subscribe?: Subscribe
  children: React.ReactNode
}

const InstancesContext = createContext<InstancesContextValue | null>(null)

const defaultReadClient = createReadClient()
const defaultCommandClient = createCommandClient()

/**
 * One subscription for the whole app: the instances surface and the composer's
 * harness picker read the same store, so they can never disagree about which
 * instances exist or whether one can take a turn.
 */
export function InstancesProvider({
  readClient = defaultReadClient,
  commandClient = defaultCommandClient,
  subscribe = subscribeInstancesEvents,
  children,
}: InstancesProviderProps) {
  const [store] = useState(createInstancesStore)
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [loadError, setLoadError] = useState<string>()
  const [streamError, setStreamError] = useState(false)
  const [actionError, setActionError] = useState<string>()
  const [pendingAction, setPendingAction] = useState<string>()
  const [attempt, setAttempt] = useState(0)

  const applyEvent = useEffectEvent(store.applyEvent)
  const applySnapshot = useEffectEvent(store.applySnapshot)

  useEffect(() => {
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
  }, [attempt, readClient, state.configRevision, store, subscribe])

  async function send(command: Command) {
    setActionError(undefined)
    setPendingAction(
      `${command.name}:${"instanceId" in command ? command.instanceId : ""}`
    )
    try {
      await commandClient.send(command)
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setPendingAction(undefined)
    }
  }

  const value: InstancesContextValue = {
    state,
    loadError,
    streamError,
    actionError,
    pendingAction,
    send,
    retry: () => setAttempt((current) => current + 1),
  }

  return (
    <InstancesContext.Provider value={value}>
      {children}
    </InstancesContext.Provider>
  )
}

export function useInstances(): InstancesContextValue {
  const instances = useContext(InstancesContext)
  if (!instances) {
    throw new Error("useInstances must be used within an InstancesProvider")
  }
  return instances
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error"
}
