import { EmptyState } from "@workspace/ui/components/empty-state"
import { RiPulseLine } from "@remixicon/react"

import { useSession } from "@/features/sessions/session-provider"
import { turnDisplayState } from "@/features/transcript/turn-state"
import { TurnStateBadge } from "@/features/transcript/turn-state"

/** The Activity surface: every turn in this session and how it ended. */
export function SessionActivity() {
  const session = useSession()

  if (!session) {
    return (
      <EmptyState
        icon={<RiPulseLine />}
        title="No session open"
        description="Open a session to see its turns."
      />
    )
  }

  const turns = [...session.state.turns].sort(
    (left, right) => right.seq - left.seq
  )

  if (turns.length === 0) {
    return (
      <EmptyState
        icon={<RiPulseLine />}
        title="No turns yet"
        description="Turns appear here as soon as the first message is sent."
      />
    )
  }

  return (
    <ol className="flex flex-col gap-2">
      {turns.map((turn) => (
        <li
          key={turn.id}
          className="rounded-lg border border-border bg-card p-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-ui font-medium">
              {turn.execution.display.instanceName}
            </span>
            <TurnStateBadge
              state={turnDisplayState(turn, session.state.requests)}
            />
          </div>
          <p className="mt-1 truncate text-small text-muted-foreground">
            {turn.execution.display.modelName}
            {turn.startedAt ? ` · ${formatTime(turn.startedAt)}` : null}
          </p>
          {turn.error ? (
            <p className="mt-2 rounded-md bg-danger/10 px-2 py-1 text-small text-danger">
              {turn.error.message}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  )
}

function formatTime(timestamp: string): string {
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) return timestamp
  return parsed.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })
}
