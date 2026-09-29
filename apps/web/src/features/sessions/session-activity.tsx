import { EmptyState } from "@workspace/ui/components/empty-state"
import { RiPulseLine } from "@remixicon/react"

import { useSession } from "@/features/sessions/session-provider"
import { turnDisplayState } from "@/features/transcript/turn-state"
import { TurnStateBadge } from "@/features/transcript/turn-state"
import { formatUsage, sumUsage } from "@/features/transcript/usage"

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

  const usageByTurn = new Map(
    turns.flatMap((turn) => {
      const message = session.state.messages.find(
        (candidate) => candidate.id === turn.assistantMessageId
      )
      return message?.role === "assistant" && message.usage
        ? [[turn.id, message.usage] as const]
        : []
    })
  )
  const total = sumUsage([...usageByTurn.values()])

  return (
    <div className="flex flex-col gap-3">
      {total ? (
        <p
          data-testid="session-usage"
          className="rounded-lg bg-muted/50 px-2.5 py-2 text-small text-muted-foreground"
        >
          <span className="font-medium text-foreground">Session usage</span>{" "}
          {formatUsage(total)}
        </p>
      ) : null}
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
            {usageByTurn.has(turn.id) ? (
              <p className="mt-1 text-small text-muted-foreground">
                {formatUsage(usageByTurn.get(turn.id)!)}
              </p>
            ) : null}
            {turn.error ? (
              <p className="mt-2 rounded-md bg-danger/10 px-2 py-1 text-small text-danger">
                {turn.error.message}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
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
