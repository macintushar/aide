import { useCallback, useSyncExternalStore } from "react"

/**
 * Hash routing, so a session is linkable without the server needing an SPA
 * fallback route: `#/sessions/<id>`.
 */
const PREFIX = "#/sessions/"

export function readSessionIdFromHash(hash: string): string | undefined {
  if (!hash.startsWith(PREFIX)) return undefined
  const id = decodeURIComponent(hash.slice(PREFIX.length))
  return id || undefined
}

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange)
  return () => window.removeEventListener("hashchange", onChange)
}

export function useSessionRoute(): [
  string | undefined,
  (sessionId: string | undefined) => void,
] {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => ""
  )

  const setSessionId = useCallback((sessionId: string | undefined) => {
    const next = sessionId ? `${PREFIX}${encodeURIComponent(sessionId)}` : "#/"
    if (window.location.hash === next) return
    window.location.hash = next
  }, [])

  return [readSessionIdFromHash(hash), setSessionId]
}
