import type { Request, Turn } from "@workspace/contracts"
import { Badge } from "@workspace/ui/components/badge"
import { StatusDot } from "@workspace/ui/components/status-dot"
import { cn } from "@workspace/ui/lib/utils"

/**
 * DESIGN.md §5. `interrupted` is deliberately neutral: it is a user action,
 * not an error, and colouring it red trains people to ignore red.
 */
export type TurnDisplayState =
  | "queued"
  | "streaming"
  | "awaiting"
  | "completed"
  | "interrupted"
  | "failed"

type StateMeta = {
  label: string
  dot: React.ComponentProps<typeof StatusDot>["tone"]
  badge: React.ComponentProps<typeof Badge>["tone"]
  pulse: boolean
  /** Completed is the resting case, so its badge fades out. */
  settles: boolean
}

export const TURN_STATE_META: Record<TurnDisplayState, StateMeta> = {
  queued: {
    label: "queued",
    dot: "idle",
    badge: "neutral",
    pulse: false,
    settles: false,
  },
  streaming: {
    label: "streaming",
    dot: "accent",
    badge: "accent",
    pulse: true,
    settles: false,
  },
  awaiting: {
    label: "awaiting",
    dot: "warn",
    badge: "warn",
    pulse: false,
    settles: false,
  },
  completed: {
    label: "done",
    dot: "ok",
    badge: "ok",
    pulse: false,
    settles: true,
  },
  interrupted: {
    label: "stopped",
    dot: "quiet",
    badge: "neutral",
    pulse: false,
    settles: false,
  },
  failed: {
    label: "failed",
    dot: "danger",
    badge: "danger",
    pulse: false,
    settles: false,
  },
}

export function turnDisplayState(
  turn: Turn,
  requests: Request[] = []
): TurnDisplayState {
  if (turn.status === "running") {
    const blocked = requests.some(
      (request) => request.turnId === turn.id && request.status === "open"
    )
    return blocked ? "awaiting" : "streaming"
  }

  return turn.status
}

export function TurnStateDot({ state }: { state: TurnDisplayState }) {
  const meta = TURN_STATE_META[state]
  return <StatusDot tone={meta.dot} pulse={meta.pulse} />
}

export function TurnStateBadge({
  state,
  className,
}: {
  state: TurnDisplayState
  className?: string
}) {
  const meta = TURN_STATE_META[state]

  return (
    <Badge
      tone={meta.badge}
      data-state={state}
      className={cn(
        meta.settles && "animate-badge-settle motion-reduce:animate-none",
        className
      )}
    >
      <StatusDot tone={meta.dot} pulse={meta.pulse} className="size-1.5" />
      {meta.label}
    </Badge>
  )
}
