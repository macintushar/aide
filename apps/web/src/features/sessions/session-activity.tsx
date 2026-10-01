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
          className="flex flex-col gap-0.5 rounded-xl border border-[var(--line)] bg-[var(--n2)] px-3.5 py-3 text-small text-muted-foreground"
        >
          <span className="font-medium text-foreground">Session usage</span>{" "}
          <span className="font-mono text-[0.6875rem]">
            {formatUsage(total)}
          </span>
        </p>
      ) : null}
      <ol className="relative flex flex-col gap-2 before:absolute before:top-3 before:bottom-3 before:left-[0.6875rem] before:w-px before:bg-[var(--line-strong)]">
        {turns.map((turn) => (
          <li
            key={turn.id}
            className="relative ml-6 rounded-xl border border-[var(--line)] bg-[var(--n2)] px-3 py-2.5 before:absolute before:top-4 before:-left-[1.0625rem] before:size-2 before:rounded-full before:bg-[var(--n4)] before:ring-4 before:ring-[var(--n1)]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-ui font-medium">
                {turn.execution.display.instanceName}
              </span>
              <TurnStateBadge
                state={turnDisplayState(turn, session.state.requests)}
              />
            </div>
            <p className="mt-0.5 truncate text-small text-muted-foreground">
              {turn.execution.display.modelName}
              {turn.startedAt ? ` · ${formatTime(turn.startedAt)}` : null}
            </p>
            {usageByTurn.has(turn.id) ? (
              <p className="mt-1 font-mono text-[0.6875rem] text-[var(--n5)]">
                {formatUsage(usageByTurn.get(turn.id)!)}
              </p>
            ) : null}
            {turn.error ? (
              <p className="mt-2 rounded-lg bg-danger/10 px-2.5 py-1.5 text-small text-danger">
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
