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
  subscribeSessionEvents,
  type SessionEventsOptions,
} from "@/lib/transport/event-source"
import { createReadClient } from "@/lib/transport/read-client"
import { createSessionStore, type SessionStoreState } from "@/store/event-store"

type ReadClient = Pick<ReturnType<typeof createReadClient>, "getSession">
type CommandClient = Pick<ReturnType<typeof createCommandClient>, "send">
type Subscribe = (options: SessionEventsOptions) => { close(): void }

export type SessionContextValue = {
  sessionId: string
  state: SessionStoreState
  loadError?: string
  streamError: boolean
  commandError: string | undefined
  pending: boolean
  send: (command: Command) => Promise<void>
  retry: () => void
}

export type SessionProviderProps = {
  sessionId?: string
  readClient?: ReadClient
  commandClient?: CommandClient
  subscribe?: Subscribe
  reconnectDelayMs?: number
  children: React.ReactNode
}

const SessionContext = createContext<SessionContextValue | null>(null)

const defaultReadClient = createReadClient()
const defaultCommandClient = createCommandClient()

/** Null while no session is open; the shell still renders around it. */
export function useSession(): SessionContextValue | null {
  return useContext(SessionContext)
}

export function useRequiredSession(): SessionContextValue {
  const session = useContext(SessionContext)
  if (!session) {
    throw new Error("useRequiredSession must be used within a SessionProvider")
  }
  return session
}

export function SessionProvider({
  sessionId,
  children,
  ...options
}: SessionProviderProps) {
  if (!sessionId) {
    return (
      <SessionContext.Provider value={null}>{children}</SessionContext.Provider>
    )
  }

  return (
    <SessionController key={sessionId} sessionId={sessionId} {...options}>
      {children}
    </SessionController>
  )
}

function SessionController({
  sessionId,
  readClient = defaultReadClient,
  commandClient = defaultCommandClient,
  subscribe = subscribeSessionEvents,
  reconnectDelayMs = 1_000,
  children,
}: SessionProviderProps & { sessionId: string }) {
  const [store] = useState(createSessionStore)
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [loadError, setLoadError] = useState<string>()
  const [streamError, setStreamError] = useState(false)
  const [commandError, setCommandError] = useState<string>()
  const [pending, setPending] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const applyEvent = useEffectEvent(store.applyEvent)
  const applySnapshot = useEffectEvent(store.applySnapshot)

  useEffect(() => {
    let active = true
    let subscription: { close(): void } | undefined
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      if (!active) return
      subscription = subscribe({
        sessionId,
        afterSequence: store.getState().cursor.sequence,
        onEvent: applyEvent,
        onSnapshot: applySnapshot,
        onOpen: () => setStreamError(false),
        onError: () => {
          if (!active || reconnectTimer) return
          setStreamError(true)
          subscription?.close()
          reconnectTimer = setTimeout(() => {
            reconnectTimer = undefined
            connect()
          }, reconnectDelayMs)
        },
      })
    }

    setLoadError(undefined)
    void readClient
      .getSession(sessionId)
      .then((snapshot) => {
        if (!active) return
        applySnapshot(snapshot)
        connect()
      })
      .catch((error: unknown) => {
        if (active) setLoadError(errorMessage(error))
      })

    return () => {
      active = false
      if (reconnectTimer) clearTimeout(reconnectTimer)
      subscription?.close()
    }
  }, [attempt, readClient, reconnectDelayMs, sessionId, store, subscribe])

  async function send(command: Command) {
    setCommandError(undefined)
    setPending(true)
    try {
      await commandClient.send(command)
    } catch (error) {
      setCommandError(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  const value: SessionContextValue = {
    sessionId,
    state,
    loadError,
    streamError,
    commandError,
    pending,
    send,
    retry: () => setAttempt((current) => current + 1),
  }

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error"
}
