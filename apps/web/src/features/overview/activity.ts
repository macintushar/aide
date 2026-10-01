import type { SessionActivity, SessionSummary } from "@workspace/contracts"
import type { StatusDot } from "@workspace/ui/components/status-dot"
import type { Badge } from "@workspace/ui/components/badge"

/**
 * One vocabulary for where a session stands, used by the board, the sidebar
 * and the command palette alike. Status is the main colour language of the
 * app: accent while an agent works, amber when it waits on you, green when it
 * finished, red when it failed. Everything else stays neutral.
 */
type ActivityMeta = {
  label: string
  dot: React.ComponentProps<typeof StatusDot>["tone"]
  badge: React.ComponentProps<typeof Badge>["tone"]
  pulse: boolean
}

export const ACTIVITY_META: Record<SessionActivity, ActivityMeta> = {
  needs_input: { label: "Needs you", dot: "warn", badge: "warn", pulse: false },
  running: { label: "Running", dot: "accent", badge: "accent", pulse: true },
  queued: { label: "Queued", dot: "idle", badge: "neutral", pulse: false },
  failed: { label: "Failed", dot: "danger", badge: "danger", pulse: false },
  interrupted: {
    label: "Stopped",
    dot: "quiet",
    badge: "neutral",
    pulse: false,
  },
  completed: { label: "Done", dot: "ok", badge: "ok", pulse: false },
  idle: { label: "New", dot: "idle", badge: "outline", pulse: false },
}

export type Lane = "attention" | "active" | "recent"

/** Which board lane a session belongs in. Failures ask for attention too. */
export function laneOf(activity: SessionActivity): Lane {
  switch (activity) {
    case "needs_input":
    case "failed":
      return "attention"
    case "running":
    case "queued":
      return "active"
    default:
      return "recent"
  }
}

export function groupByLane(
  sessions: SessionSummary[]
): Record<Lane, SessionSummary[]> {
  const lanes: Record<Lane, SessionSummary[]> = {
    attention: [],
    active: [],
    recent: [],
  }
  for (const summary of sessions) lanes[laneOf(summary.activity)].push(summary)
  return lanes
}

/** "just now", "4m", "3h", "2d" — compact enough for a dense row. */
export function relativeTime(timestamp: string, now = Date.now()): string {
  const then = new Date(timestamp).getTime()
  if (Number.isNaN(then)) return ""
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 45) return "just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

/** Elapsed time for a running turn: "42s", "3m 05s", "1h 12m". */
export function elapsed(since: string, now = Date.now()): string {
  const start = new Date(since).getTime()
  if (Number.isNaN(start)) return ""
  const seconds = Math.max(0, Math.floor((now - start) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60)
    return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`
}

export function formatCost(costUsd: number | undefined): string | undefined {
  if (costUsd === undefined) return undefined
  if (costUsd > 0 && costUsd < 0.01) return "<$0.01"
  return `$${costUsd.toFixed(2)}`
}
