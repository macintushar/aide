import type { DriverId } from "@workspace/contracts"

/**
 * Recents are browser-local "what did I open lately" state. The full list of
 * projects and sessions comes from the server (`GET /projects`, `GET
 * /projects/:id/sessions`) in the sidebar's project browser.
 */
export type RecentSession = {
  sessionId: string
  title?: string
  projectName?: string
  /** Preview of the latest message, capped so localStorage stays small. */
  lastMessage?: string
  /** Display name of the harness the session last ran on. */
  harnessName?: string
  /** Driver behind that harness, used to pick its vendor mark. */
  driver?: DriverId
  openedAt: number
}

const STORAGE_KEY = "aide.recent-sessions"
const LIMIT = 20

export function readRecentSessions(
  storage: Storage = localStorage
): RecentSession[] {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecentSession).slice(0, LIMIT)
  } catch {
    return []
  }
}

export function rememberSession(
  entry: Omit<RecentSession, "openedAt"> & { openedAt?: number },
  storage: Storage = localStorage
): RecentSession[] {
  const existing = readRecentSessions(storage)
  const previous = existing.find(
    (candidate) => candidate.sessionId === entry.sessionId
  )
  const merged: RecentSession = {
    sessionId: entry.sessionId,
    title: entry.title ?? previous?.title,
    projectName: entry.projectName ?? previous?.projectName,
    lastMessage: entry.lastMessage ?? previous?.lastMessage,
    harnessName: entry.harnessName ?? previous?.harnessName,
    driver: entry.driver ?? previous?.driver,
    openedAt: entry.openedAt ?? Date.now(),
  }
  const next: RecentSession[] = [
    merged,
    ...existing.filter((candidate) => candidate.sessionId !== entry.sessionId),
  ].slice(0, LIMIT)

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // A full or unavailable store must not break navigation.
  }

  return next
}

export function forgetSession(
  sessionId: string,
  storage: Storage = localStorage
): RecentSession[] {
  const next = readRecentSessions(storage).filter(
    (candidate) => candidate.sessionId !== sessionId
  )
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Ignore, as above.
  }
  return next
}

function isRecentSession(value: unknown): value is RecentSession {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.sessionId === "string" &&
    candidate.sessionId.length > 0 &&
    typeof candidate.openedAt === "number"
  )
}
