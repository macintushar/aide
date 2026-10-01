import type { SessionSummaryList, SessionSummary } from "@workspace/contracts"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

/**
 * Every session and where it stands, shared by the board, the sidebar and the
 * command palette so they agree and the server is asked once.
 *
 * The summary list has no event stream of its own, so it is polled: briskly
 * while anything is running or waiting, lazily otherwise, and not at all while
 * the tab is hidden. `refreshKey` forces an immediate reload after navigation
 * that may have created or removed a session.
 */

export type OverviewState = {
  /** Undefined until the first load, and always when no server is wired. */
  sessions: SessionSummary[] | undefined
  error: string | undefined
  /** False when the app has no way to list sessions (tests, embeds). */
  available: boolean
  refresh: () => void
}

const OverviewContext = createContext<OverviewState>({
  sessions: undefined,
  error: undefined,
  available: false,
  refresh: () => {},
})

const BUSY_INTERVAL_MS = 2500
const IDLE_INTERVAL_MS = 10000

export function OverviewProvider({
  listAllSessions,
  refreshKey,
  children,
}: {
  listAllSessions?: () => Promise<SessionSummaryList>
  refreshKey?: unknown
  children: React.ReactNode
}) {
  const [sessions, setSessions] = useState<SessionSummary[]>()
  const [error, setError] = useState<string>()
  const [tick, setTick] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const refresh = useCallback(() => setTick((count) => count + 1), [])

  useEffect(() => {
    if (!listAllSessions) return
    let active = true
    clearTimeout(timer.current)

    const load = () => {
      if (document.visibilityState === "hidden") {
        timer.current = setTimeout(load, IDLE_INTERVAL_MS)
        return
      }
      listAllSessions()
        .then((list) => {
          if (!active) return
          setSessions(list.sessions)
          setError(undefined)
          const busy = list.sessions.some(
            (summary) =>
              summary.activity === "running" ||
              summary.activity === "queued" ||
              summary.activity === "needs_input"
          )
          timer.current = setTimeout(
            load,
            busy ? BUSY_INTERVAL_MS : IDLE_INTERVAL_MS
          )
        })
        .catch((cause: unknown) => {
          if (!active) return
          setError(cause instanceof Error ? cause.message : "Unknown error")
          timer.current = setTimeout(load, IDLE_INTERVAL_MS)
        })
    }
    load()

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer.current)
        load()
      }
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      active = false
      clearTimeout(timer.current)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [listAllSessions, refreshKey, tick])

  const value = useMemo<OverviewState>(
    () => ({
      sessions,
      error,
      available: listAllSessions !== undefined,
      refresh,
    }),
    [error, listAllSessions, refresh, sessions]
  )

  return (
    <OverviewContext.Provider value={value}>
      {children}
    </OverviewContext.Provider>
  )
}

export function useOverview(): OverviewState {
  return useContext(OverviewContext)
}

/** A clock for elapsed timers; ticks only while `enabled`. */
export function useNow(enabled: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [enabled, intervalMs])
  return now
}
