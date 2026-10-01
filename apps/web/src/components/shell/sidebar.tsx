import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiComputerLine,
  RiFolder3Line,
  RiMoonLine,
  RiRadarLine,
  RiSearchLine,
  RiSettings3Line,
  RiSunLine,
  type RemixiconComponentType,
} from "@remixicon/react"
import type { SessionSummary } from "@workspace/contracts"
import { AideLockup } from "@workspace/ui/components/logo"
import { IconButton } from "@workspace/ui/components/button"
import { Kbd } from "@workspace/ui/components/kbd"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { StatusDot } from "@workspace/ui/components/status-dot"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { HarnessMark } from "@workspace/ui/components/harness-mark"
import { cn } from "@workspace/ui/lib/utils"
import { useState } from "react"

import {
  ProjectBrowser,
  type ProjectBrowserClient,
} from "@/components/shell/project-browser"
import { useTheme } from "@/components/theme-provider"
import { harnessMarkFor } from "@/features/instances/harness-marks"
import { useOptionalInstances } from "@/features/instances/instances-provider"
import { ACTIVITY_META, relativeTime } from "@/features/overview/activity"
import { useOverview } from "@/features/overview/overview-provider"
import type { RecentSession } from "@/lib/recent-sessions"

export type SidebarView = "welcome" | "session" | "settings"

const PROJECT_LIMIT = 6

export function Sidebar({
  view,
  activeSessionId,
  recents,
  onNewSession,
  onOpenSettings,
  onSelectSession,
  onOpenSearch,
  projects,
  projectsRefreshKey,
}: {
  view: SidebarView
  activeSessionId?: string
  recents: RecentSession[]
  onNewSession: () => void
  onOpenSettings: () => void
  onSelectSession: (sessionId: string) => void
  /** Opens the command palette; omitted where there is none. */
  onOpenSearch?: () => void
  /** Server-backed project browser; omitted where no server is reachable. */
  projects?: ProjectBrowserClient
  projectsRefreshKey?: unknown
}) {
  const overview = useOverview()
  const summaries = overview.sessions
  const attention = summaries?.filter(
    (summary) =>
      summary.activity === "needs_input" || summary.activity === "failed"
  )
  const running = summaries?.filter(
    (summary) => summary.activity === "running" || summary.activity === "queued"
  )

  return (
    <>
      <div className="flex h-13 shrink-0 items-center justify-between gap-2 pr-2 pl-4">
        <AideLockup size={20} />
        <IconButton
          type="button"
          variant="ghost"
          size="icon-sm"
          label="New session"
          onClick={onNewSession}
        >
          <RiAddLine aria-hidden="true" />
        </IconButton>
      </div>

      {onOpenSearch ? (
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={onOpenSearch}
            className="flex h-8 w-full items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--n1)] px-2.5 text-ui text-[var(--n5)] transition-colors duration-[var(--dur-fast)] outline-none hover:border-[var(--line-strong)] hover:text-[var(--n6)] focus-visible:ring-3 focus-visible:ring-[var(--accent-glow)]"
          >
            <RiSearchLine className="size-3.5" aria-hidden="true" />
            <span className="flex-1 text-left">Search</span>
            <span className="flex gap-0.5">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
        </div>
      ) : null}

      <nav className="flex flex-col gap-0.5 px-2" aria-label="Primary">
        <NavItem
          icon={RiRadarLine}
          label="Mission control"
          active={view === "welcome"}
          count={attention?.length}
          onClick={onNewSession}
        />
        <NavItem
          icon={RiSettings3Line}
          label="Settings"
          active={view === "settings"}
          onClick={onOpenSettings}
        />
      </nav>

      <ScrollArea className="mt-3 flex-1">
        <div className="flex flex-col gap-4 px-2 pb-4">
          {summaries ? (
            <>
              {attention && attention.length > 0 ? (
                <SummarySection
                  label="Needs you"
                  summaries={attention}
                  activeSessionId={activeSessionId}
                  onSelectSession={onSelectSession}
                />
              ) : null}
              {running && running.length > 0 ? (
                <SummarySection
                  label="Running"
                  summaries={running}
                  activeSessionId={activeSessionId}
                  onSelectSession={onSelectSession}
                />
              ) : null}
              <ProjectSections
                summaries={summaries}
                activeSessionId={activeSessionId}
                onSelectSession={onSelectSession}
              />
            </>
          ) : (
            <>
              <RecentsSection
                recents={recents}
                activeSessionId={activeSessionId}
                onSelectSession={onSelectSession}
              />
              {projects ? (
                <section aria-label="All projects">
                  <SectionLabel>Projects</SectionLabel>
                  <ProjectBrowser
                    client={projects}
                    activeSessionId={activeSessionId}
                    refreshKey={projectsRefreshKey}
                    onSelectSession={onSelectSession}
                  />
                </section>
              ) : null}
            </>
          )}
        </div>
      </ScrollArea>

      <SidebarFooter />
    </>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 pb-1 text-label text-[var(--n5)] uppercase">
      {children}
    </p>
  )
}

function SummarySection({
  label,
  summaries,
  activeSessionId,
  onSelectSession,
}: {
  label: string
  summaries: SessionSummary[]
  activeSessionId?: string
  onSelectSession: (sessionId: string) => void
}) {
  return (
    <section aria-label={label}>
      <SectionLabel>{label}</SectionLabel>
      <ul className="flex flex-col gap-px">
        {summaries.map((summary) => (
          <li key={summary.session.id}>
            <SummaryRow
              summary={summary}
              showProject
              active={summary.session.id === activeSessionId}
              onSelect={() => onSelectSession(summary.session.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Every session, grouped under its project, most recently touched first. */
function ProjectSections({
  summaries,
  activeSessionId,
  onSelectSession,
}: {
  summaries: SessionSummary[]
  activeSessionId?: string
  onSelectSession: (sessionId: string) => void
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const groups = new Map<
    string,
    { name: string; directory: string; sessions: SessionSummary[] }
  >()
  for (const summary of summaries) {
    const group = groups.get(summary.project.id)
    if (group) group.sessions.push(summary)
    else
      groups.set(summary.project.id, {
        name: summary.project.name,
        directory: summary.project.directory,
        sessions: [summary],
      })
  }

  if (groups.size === 0) {
    return (
      <p className="px-2 py-1 text-small text-[var(--n5)]">
        Sessions you start show up here.
      </p>
    )
  }

  return (
    <section aria-label="Projects" className="flex flex-col gap-2">
      <SectionLabel>Projects</SectionLabel>
      {[...groups].map(([projectId, group]) => {
        const closed = collapsed[projectId] === true
        const showAll = expanded[projectId] === true
        const visible = showAll
          ? group.sessions
          : group.sessions.slice(0, PROJECT_LIMIT)
        const Chevron = closed ? RiArrowRightSLine : RiArrowDownSLine
        return (
          <div key={projectId}>
            <button
              type="button"
              aria-expanded={!closed}
              title={group.directory}
              onClick={() =>
                setCollapsed((current) => ({
                  ...current,
                  [projectId]: !closed,
                }))
              }
              className="group/project flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-ui text-[var(--n6)] outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-[var(--accent-glow)]"
            >
              <RiFolder3Line className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate font-medium">
                {group.name}
              </span>
              <span className="font-mono text-[0.6875rem] text-[var(--n5)] tabular-nums group-hover/project:hidden">
                {group.sessions.length}
              </span>
              <Chevron
                className="hidden size-3.5 shrink-0 group-hover/project:block"
                aria-hidden="true"
              />
            </button>
            {closed ? null : (
              <ul className="mt-px flex flex-col gap-px">
                {visible.map((summary) => (
                  <li key={summary.session.id}>
                    <SummaryRow
                      summary={summary}
                      active={summary.session.id === activeSessionId}
                      onSelect={() => onSelectSession(summary.session.id)}
                    />
                  </li>
                ))}
                {group.sessions.length > PROJECT_LIMIT ? (
                  <li>
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((current) => ({
                          ...current,
                          [projectId]: !showAll,
                        }))
                      }
                      className="h-7 w-full rounded-md pl-7 text-left text-small text-[var(--n5)] hover:text-foreground"
                    >
                      {showAll
                        ? "Show fewer"
                        : `${group.sessions.length - PROJECT_LIMIT} more`}
                    </button>
                  </li>
                ) : null}
              </ul>
            )}
          </div>
        )
      })}
    </section>
  )
}

function SummaryRow({
  summary,
  active,
  showProject,
  onSelect,
}: {
  summary: SessionSummary
  active: boolean
  showProject?: boolean
  onSelect: () => void
}) {
  const meta = ACTIVITY_META[summary.activity]
  const execution = summary.latestExecution
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      title={summary.session.title}
      onClick={onSelect}
      className={cn(
        "group/row flex h-8 w-full items-center gap-2 rounded-lg pr-2 pl-2.5 text-left text-ui transition-colors duration-[var(--dur-fast)] outline-none focus-visible:ring-3 focus-visible:ring-[var(--accent-glow)]",
        active
          ? "bg-[var(--n2)] text-foreground shadow-card"
          : "text-[var(--n6)] hover:bg-[var(--n2)] hover:text-foreground"
      )}
    >
      <span className="flex w-2.5 shrink-0 justify-center">
        <StatusDot tone={meta.dot} pulse={meta.pulse} className="size-1.5" />
      </span>
      <span className="sr-only">{meta.label}: </span>
      <span className="min-w-0 flex-1 truncate">
        {summary.session.title}
        {showProject ? (
          <span className="text-[var(--n5)]"> · {summary.project.name}</span>
        ) : null}
      </span>
      <span className="font-mono text-[0.625rem] text-[var(--n5)] tabular-nums opacity-0 group-hover/row:opacity-100">
        {relativeTime(summary.session.updatedAt).replace(" ago", "")}
      </span>
      {execution ? (
        <HarnessMark
          src={harnessMarkFor(execution.driver)}
          name={execution.instanceName}
          size={12}
          decorative
          className="opacity-70 group-hover/row:opacity-100"
        />
      ) : null}
    </button>
  )
}

function RecentsSection({
  recents,
  activeSessionId,
  onSelectSession,
}: {
  recents: RecentSession[]
  activeSessionId?: string
  onSelectSession: (sessionId: string) => void
}) {
  const groups = groupByProject(recents)
  return (
    <div>
      <SectionLabel>Recents</SectionLabel>
      {groups.length === 0 ? (
        <p className="px-2 py-1 text-small text-[var(--n5)]">
          Sessions you open show up here.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <section
              key={group.project || "no-project"}
              aria-label={group.project || "No project"}
            >
              <p className="flex min-w-0 items-center gap-1.5 px-2 pb-1 text-ui font-medium text-[var(--n6)]">
                <RiFolder3Line
                  className="size-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span className="truncate">
                  {group.project || "No project"}
                </span>
              </p>
              <ul className="flex flex-col gap-px">
                {group.sessions.map((session) => (
                  <li key={session.sessionId}>
                    <SessionItem
                      session={session}
                      active={session.sessionId === activeSessionId}
                      onSelect={() => onSelectSession(session.sessionId)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

/** Recents arrive most-recent first, so groups inherit that order. */
function groupByProject(
  sessions: RecentSession[]
): { project: string; sessions: RecentSession[] }[] {
  const groups = new Map<string, RecentSession[]>()
  for (const session of sessions) {
    const project = session.projectName ?? ""
    const group = groups.get(project)
    if (group) group.push(session)
    else groups.set(project, [session])
  }
  return [...groups].map(([project, grouped]) => ({
    project,
    sessions: grouped,
  }))
}

export function NavItem({
  icon: Icon,
  label,
  active,
  count,
  onClick,
}: {
  icon: RemixiconComponentType
  label: string
  active?: boolean
  /** A count that wants attention, shown as an amber pill. */
  count?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-ui transition-colors duration-[var(--dur-fast)] outline-none focus-visible:ring-3 focus-visible:ring-[var(--accent-glow)]",
        active
          ? "bg-[var(--n2)] text-foreground shadow-card"
          : "text-[var(--n6)] hover:bg-[var(--n2)] hover:text-foreground"
      )}
    >
      <Icon
        className={cn("size-4 shrink-0", active && "text-accent-ink")}
        aria-hidden="true"
      />
      <span className="flex-1 truncate text-left">{label}</span>
      {count ? (
        <span className="rounded-full bg-warn/15 px-1.5 font-mono text-[0.6875rem] font-medium text-warn tabular-nums">
          {count}
        </span>
      ) : null}
    </button>
  )
}

function SessionItem({
  session,
  active,
  onSelect,
}: {
  session: RecentSession
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-1.5 text-left transition-colors duration-[var(--dur-fast)] outline-none focus-visible:ring-3 focus-visible:ring-[var(--accent-glow)]",
        active
          ? "bg-[var(--n2)] text-foreground shadow-card"
          : "text-[var(--n6)] hover:bg-[var(--n2)] hover:text-foreground"
      )}
    >
      <span className="flex w-full items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-ui">
          {session.title ?? session.sessionId}
        </span>
        {session.harnessName && session.driver ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  role="img"
                  aria-label={`Harness: ${session.harnessName}`}
                  className="inline-flex shrink-0"
                />
              }
            >
              <HarnessMark
                src={harnessMarkFor(session.driver)}
                name={session.harnessName}
                size={12}
                decorative
              />
            </TooltipTrigger>
            <TooltipContent>{session.harnessName}</TooltipContent>
          </Tooltip>
        ) : null}
      </span>
      {session.lastMessage ? (
        <span className="w-full truncate text-small text-[var(--n5)]">
          {session.lastMessage}
        </span>
      ) : null}
    </button>
  )
}

const THEME_ICON: Record<string, RemixiconComponentType> = {
  dark: RiMoonLine,
  light: RiSunLine,
  system: RiComputerLine,
}

function SidebarFooter() {
  const { theme, setTheme } = useTheme()
  const instances = useOptionalInstances()?.state.instances ?? []
  const Icon = THEME_ICON[theme] ?? RiComputerLine

  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-t border-[var(--line)] pr-2 pl-4">
      <span className="flex min-w-0 items-center gap-2 text-small text-[var(--n5)]">
        <span className="relative flex size-1.5">
          <span className="size-1.5 rounded-full bg-ok" aria-hidden="true" />
        </span>
        <span className="truncate">Local · 127.0.0.1</span>
      </span>
      <span className="flex items-center gap-1">
        {instances.map((instance) => {
          const ready =
            instance.status === "ready" || instance.status === "degraded"
          const name = instance.displayName ?? instance.instanceId
          return (
            <Tooltip key={instance.instanceId}>
              <TooltipTrigger
                render={
                  <span
                    role="img"
                    aria-label={`${name}: ${instance.status}`}
                    className="relative inline-flex size-6 items-center justify-center"
                  />
                }
              >
                <HarnessMark
                  src={harnessMarkFor(instance.driver)}
                  name={name}
                  size={13}
                  muted={!ready}
                  decorative
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute right-0.5 bottom-0.5 size-1.5 rounded-full ring-2 ring-[var(--n0)]",
                    ready
                      ? "bg-ok"
                      : instance.status === "failed"
                        ? "bg-danger"
                        : "bg-[var(--n4)]"
                  )}
                />
              </TooltipTrigger>
              <TooltipContent side="top">
                {name} · {instance.status}
              </TooltipContent>
            </Tooltip>
          )
        })}
        <IconButton
          type="button"
          variant="ghost"
          size="icon-sm"
          label={`Theme: ${theme}`}
          side="top"
          onClick={() =>
            setTheme(
              theme === "dark" ? "light" : theme === "light" ? "system" : "dark"
            )
          }
        >
          <Icon aria-hidden="true" />
        </IconButton>
      </span>
    </div>
  )
}
