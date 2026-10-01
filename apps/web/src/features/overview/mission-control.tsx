import {
  RiArrowRightLine,
  RiHistoryLine,
  RiPlugLine,
  RiRadarLine,
  RiUserVoiceLine,
} from "@remixicon/react"
import type { ProjectList, SessionSummary } from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { HarnessMark } from "@workspace/ui/components/harness-mark"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { StatusDot } from "@workspace/ui/components/status-dot"
import { cn } from "@workspace/ui/lib/utils"
import { useState } from "react"

import { harnessMarkFor, useInstances } from "@/features/instances"
import type { RecentSession } from "@/lib/recent-sessions"
import { createCommandClient } from "@/lib/transport/command-client"

import { formatCost, groupByLane, type Lane } from "./activity"
import { useNow, useOverview } from "./overview-provider"
import { SessionCard } from "./session-card"
import { StartTask } from "./start-task"

type CommandClient = Pick<ReturnType<typeof createCommandClient>, "send">

const LANES: Array<{
  id: Lane
  label: string
  icon: typeof RiRadarLine
  tone: string
  empty: string
}> = [
  {
    id: "attention",
    label: "Needs you",
    icon: RiUserVoiceLine,
    tone: "text-warn",
    empty: "Nothing is waiting on you.",
  },
  {
    id: "active",
    label: "Running",
    icon: RiRadarLine,
    tone: "text-accent-ink",
    empty: "No agents running. Start one above.",
  },
  {
    id: "recent",
    label: "Recent",
    icon: RiHistoryLine,
    tone: "text-[var(--n6)]",
    empty: "Finished sessions land here.",
  },
]

const RECENT_LIMIT = 9

/**
 * Home. Start a task at the top; below, every session sorted into what needs
 * you, what is running, and what recently finished.
 */
export function MissionControl({
  commandClient,
  listProjects,
  recents,
  onSelectSession,
  onOpenSettings,
}: {
  commandClient: CommandClient
  listProjects?: () => Promise<ProjectList>
  /** Browser-local recents, shown when the server cannot list sessions. */
  recents: RecentSession[]
  onSelectSession: (sessionId: string) => void
  onOpenSettings: () => void
}) {
  const overview = useOverview()
  const { state: instancesState } = useInstances()
  const sessions = overview.sessions ?? []
  const lanes = groupByLane(sessions)
  const live = lanes.active.length > 0
  const now = useNow(live)
  const [showAll, setShowAll] = useState(false)

  const totalCost = sessions.reduce(
    (sum, summary) => sum + (summary.costUsd ?? 0),
    0
  )
  const readyHarnesses = instancesState.instances.filter(
    (instance) => instance.status === "ready" || instance.status === "degraded"
  )
  const needsSetup =
    instancesState.snapshotApplied && instancesState.instances.length === 0

  return (
    <ScrollArea className="flex-1">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-7 px-4 py-6 sm:px-8 sm:py-9">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-1.5">
            <p className="flex items-center gap-2 text-label text-accent-ink uppercase">
              <RiRadarLine className="size-3.5" aria-hidden="true" />
              Mission control
            </p>
            <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.025em] text-balance text-foreground">
              One conversation. Any agent.
            </h1>
          </div>
          {overview.available && sessions.length > 0 ? (
            <dl className="flex flex-wrap gap-2" aria-label="At a glance">
              <Stat
                label="running"
                value={lanes.active.length}
                dot={<StatusDot tone="accent" pulse={live} />}
              />
              <Stat
                label="need you"
                value={lanes.attention.length}
                dot={
                  <StatusDot
                    tone={lanes.attention.length > 0 ? "warn" : "idle"}
                  />
                }
              />
              <Stat label="sessions" value={sessions.length} />
              {totalCost > 0 ? (
                <Stat label="spent" value={formatCost(totalCost) ?? ""} />
              ) : null}
            </dl>
          ) : null}
        </header>

        {needsSetup ? <SetupCallout onOpenSettings={onOpenSettings} /> : null}

        <section aria-label="Start a task" className="flex flex-col gap-3">
          <StartTask
            commandClient={commandClient}
            {...(listProjects ? { listProjects } : {})}
            onStarted={(sessionId) => {
              overview.refresh()
              onSelectSession(sessionId)
            }}
          />
          {readyHarnesses.length > 0 ? (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 text-small text-[var(--n5)]">
              <span>Ready:</span>
              {readyHarnesses.map((instance) => (
                <span
                  key={instance.instanceId}
                  className="inline-flex items-center gap-1.5 text-[var(--n6)]"
                >
                  <HarnessMark
                    src={harnessMarkFor(instance.driver)}
                    name={instance.displayName ?? instance.instanceId}
                    size={12}
                    decorative
                  />
                  {instance.displayName ?? instance.instanceId}
                </span>
              ))}
            </p>
          ) : null}
        </section>

        {overview.available ? (
          <div className="grid items-start gap-6 lg:grid-cols-3 lg:gap-5">
            {LANES.map((lane) => {
              const items = lanes[lane.id]
              const visible =
                lane.id === "recent" && !showAll
                  ? items.slice(0, RECENT_LIMIT)
                  : items
              return (
                <section
                  key={lane.id}
                  aria-label={lane.label}
                  className="flex min-w-0 flex-col gap-3"
                >
                  <h2 className="flex items-center gap-2 px-1 text-ui font-medium text-foreground">
                    <lane.icon
                      className={cn("size-4", lane.tone)}
                      aria-hidden="true"
                    />
                    {lane.label}
                    <span className="rounded-full bg-[var(--n3)] px-1.5 font-mono text-[0.6875rem] text-[var(--n6)] tabular-nums">
                      {items.length}
                    </span>
                  </h2>
                  {overview.sessions === undefined && !overview.error ? (
                    <LaneSkeleton />
                  ) : items.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-[var(--line-strong)] px-4 py-6 text-center text-small text-[var(--n5)]">
                      {lane.empty}
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2.5">
                      {visible.map((summary: SessionSummary) => (
                        <SessionCard
                          key={summary.session.id}
                          summary={summary}
                          now={now}
                          onOpen={onSelectSession}
                        />
                      ))}
                      {lane.id === "recent" && items.length > RECENT_LIMIT ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="self-start"
                          onClick={() => setShowAll((current) => !current)}
                        >
                          {showAll
                            ? "Show fewer"
                            : `Show ${items.length - RECENT_LIMIT} more`}
                        </Button>
                      ) : null}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        ) : recents.length > 0 ? (
          <section aria-label="Recent sessions" className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 px-1 text-ui font-medium">
              <RiHistoryLine
                className="size-4 text-[var(--n6)]"
                aria-hidden="true"
              />
              Recent
            </h2>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {recents.slice(0, 9).map((recent) => (
                <button
                  key={recent.sessionId}
                  type="button"
                  onClick={() => onSelectSession(recent.sessionId)}
                  className="flex flex-col gap-1 rounded-xl border border-[var(--line)] bg-[var(--n2)] p-3.5 text-left shadow-card transition-colors hover:border-[var(--line-strong)]"
                >
                  <span className="truncate text-ui font-medium">
                    {recent.title ?? recent.sessionId}
                  </span>
                  {recent.lastMessage ? (
                    <span className="line-clamp-2 text-small text-muted-foreground">
                      {recent.lastMessage}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {overview.error ? (
          <p role="status" className="text-small text-warn">
            Session overview unavailable: {overview.error}
          </p>
        ) : null}
      </div>
    </ScrollArea>
  )
}

function Stat({
  label,
  value,
  dot,
}: {
  label: string
  value: number | string
  dot?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--n2)] py-1 pr-3 pl-2.5">
      {dot}
      <dd className="font-mono text-ui font-medium text-foreground tabular-nums">
        {value}
      </dd>
      <dt className="text-small text-muted-foreground">{label}</dt>
    </div>
  )
}

function LaneSkeleton() {
  return (
    <div className="flex flex-col gap-2.5" aria-hidden="true">
      {[0, 1].map((index) => (
        <div
          key={index}
          className="h-28 animate-pulse rounded-xl border border-[var(--line)] bg-[var(--n2)]"
        />
      ))}
    </div>
  )
}

function SetupCallout({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[var(--accent-dim)]/50 bg-[radial-gradient(120%_120%_at_0%_0%,var(--accent-subtle),transparent_60%)] p-5 sm:flex-row sm:items-center">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-subtle text-accent-ink">
        <RiPlugLine className="size-5" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-ui font-medium text-foreground">
          Connect your first harness
        </p>
        <p className="text-small text-muted-foreground">
          Add Claude Code or OpenCode in settings. aide starts it locally and
          you can switch between them on every message.
        </p>
      </div>
      <Button type="button" onClick={onOpenSettings}>
        Open settings
        <RiArrowRightLine data-icon="inline-end" aria-hidden="true" />
      </Button>
    </div>
  )
}
