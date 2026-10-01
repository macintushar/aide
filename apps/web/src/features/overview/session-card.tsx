import {
  RiArrowRightLine,
  RiFolder3Line,
  RiGitBranchLine,
} from "@remixicon/react"
import type { SessionSummary } from "@workspace/contracts"
import { HarnessMark } from "@workspace/ui/components/harness-mark"
import { StatusDot } from "@workspace/ui/components/status-dot"
import { cn } from "@workspace/ui/lib/utils"

import { harnessMarkFor } from "@/features/instances/harness-marks"

import { ACTIVITY_META, elapsed, formatCost, relativeTime } from "./activity"

const STATUS_TEXT: Record<SessionSummary["activity"], string> = {
  needs_input: "text-warn",
  running: "text-accent-ink",
  queued: "text-[var(--n6)]",
  failed: "text-danger",
  interrupted: "text-[var(--n6)]",
  completed: "text-ok",
  idle: "text-[var(--n5)]",
}

/** One session on the board: its state first, then what it is, then who ran it. */
export function SessionCard({
  summary,
  now,
  active,
  onOpen,
}: {
  summary: SessionSummary
  now: number
  active?: boolean
  onOpen: (sessionId: string) => void
}) {
  const { session, project, activity, latestExecution, lastMessage } = summary
  const meta = ACTIVITY_META[activity]
  const cost = formatCost(summary.costUsd)
  const clock =
    activity === "running" && summary.runningSince
      ? elapsed(summary.runningSince, now)
      : relativeTime(session.updatedAt, now)

  return (
    <button
      type="button"
      data-activity={activity}
      aria-current={active ? "page" : undefined}
      onClick={() => onOpen(session.id)}
      className={cn(
        "group/card relative flex w-full animate-rise flex-col gap-2.5 overflow-hidden rounded-xl border bg-[var(--n2)] p-3.5 text-left shadow-card transition-[border-color,background-color,transform] duration-[var(--dur-base)] outline-none hover:-translate-y-px hover:bg-[color-mix(in_oklch,var(--n2),var(--n3)_50%)] focus-visible:ring-3 focus-visible:ring-[var(--accent-glow)] motion-reduce:hover:translate-y-0",
        activity === "needs_input"
          ? "border-warn/35 hover:border-warn/60"
          : activity === "running"
            ? "border-[var(--accent-dim)]/60 hover:border-[var(--accent-dim)]"
            : activity === "failed"
              ? "border-danger/30 hover:border-danger/55"
              : "border-[var(--line)] hover:border-[var(--line-strong)]",
        active && "ring-2 ring-[var(--accent-dim)]"
      )}
    >
      {activity === "running" ? (
        // A thin scanning line along the top edge marks live work.
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--accent-base),transparent)] bg-[length:50%_100%] bg-no-repeat motion-safe:animate-shimmer"
        />
      ) : null}

      <div className="flex items-center gap-2">
        <StatusDot tone={meta.dot} pulse={meta.pulse} />
        <span className={cn("text-small font-medium", STATUS_TEXT[activity])}>
          {meta.label}
          {activity === "needs_input" && summary.openRequests > 1
            ? ` · ${summary.openRequests}`
            : null}
        </span>
        <span className="ml-auto font-mono text-[0.6875rem] text-[var(--n5)] tabular-nums">
          {clock}
        </span>
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="line-clamp-2 text-ui font-medium text-foreground">
          {session.title}
        </h3>
        {lastMessage ? (
          <p className="line-clamp-2 text-small text-muted-foreground">
            {lastMessage.role === "user" ? (
              <span className="text-[var(--n5)]">You: </span>
            ) : null}
            {lastMessage.text}
          </p>
        ) : (
          <p className="text-small text-[var(--n5)] italic">No messages yet</p>
        )}
      </div>

      <div className="flex min-w-0 items-center gap-2 border-t border-[var(--line)] pt-2.5 text-small text-[var(--n5)]">
        {latestExecution ? (
          <span
            className="flex min-w-0 shrink items-center gap-1.5"
            title={`${latestExecution.instanceName} · ${latestExecution.modelName}`}
          >
            <HarnessMark
              src={harnessMarkFor(latestExecution.driver)}
              name={latestExecution.instanceName}
              size={13}
              decorative
            />
            <span className="truncate text-[var(--n6)]">
              {latestExecution.modelName}
            </span>
          </span>
        ) : null}
        <span
          className="flex min-w-0 shrink items-center gap-1"
          title={project.directory}
        >
          <RiFolder3Line className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{project.name}</span>
        </span>
        {session.worktree ? (
          <span
            className="flex min-w-0 shrink items-center gap-1"
            title={session.worktree.path}
          >
            <RiGitBranchLine className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate font-mono text-[0.6875rem]">
              {session.worktree.branch}
            </span>
          </span>
        ) : null}
        {cost ? (
          <span className="ml-auto shrink-0 font-mono text-[0.6875rem] tabular-nums">
            {cost}
          </span>
        ) : null}
      </div>

      {activity === "needs_input" ? (
        <span className="flex items-center gap-1 text-small font-medium text-warn">
          Respond
          <RiArrowRightLine
            className="size-3.5 transition-transform duration-[var(--dur-fast)] group-hover/card:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
      ) : null}
    </button>
  )
}
