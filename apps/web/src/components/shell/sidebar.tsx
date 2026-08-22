import {
  RiAddLine,
  RiComputerLine,
  RiMoonLine,
  RiSearchLine,
  RiSettings3Line,
  RiSunLine,
  type RemixiconComponentType,
} from "@remixicon/react"
import { AideLockup } from "@workspace/ui/components/logo"
import { IconButton } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { HarnessMark } from "@workspace/ui/components/harness-mark"
import { cn } from "@workspace/ui/lib/utils"
import { useState } from "react"

import { useTheme } from "@/components/theme-provider"
import { harnessMarkFor } from "@/features/instances/harness-marks"
import type { RecentSession } from "@/lib/recent-sessions"

export type SidebarView = "welcome" | "session" | "settings"

export function Sidebar({
  view,
  activeSessionId,
  recents,
  onNewSession,
  onOpenSettings,
  onSelectSession,
}: {
  view: SidebarView
  activeSessionId?: string
  recents: RecentSession[]
  onNewSession: () => void
  onOpenSettings: () => void
  onSelectSession: (sessionId: string) => void
}) {
  const [query, setQuery] = useState("")
  const needle = query.trim().toLowerCase()
  const filtered = needle
    ? recents.filter((session) =>
        `${session.title ?? ""} ${session.projectName ?? ""} ${session.lastMessage ?? ""} ${session.sessionId}`
          .toLowerCase()
          .includes(needle)
      )
    : recents
  const groups = groupByProject(filtered)

  return (
    <>
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 pr-2 pl-3">
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

      <div className="px-3 pb-2">
        <div className="relative">
          <RiSearchLine
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-[var(--n5)]"
            aria-hidden="true"
          />
          <Input
            value={query}
            aria-label="Search sessions"
            placeholder="Search sessions"
            className="pl-7"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <nav className="flex flex-col gap-0.5 px-2" aria-label="Primary">
        <NavItem
          icon={RiAddLine}
          label="New session"
          active={view === "welcome"}
          onClick={onNewSession}
        />
        <NavItem
          icon={RiSettings3Line}
          label="Settings"
          active={view === "settings"}
          onClick={onOpenSettings}
        />
      </nav>

      <ScrollArea className="mt-4 flex-1">
        <div className="px-2 pb-4">
          <p className="px-2 pb-1 text-label text-muted-foreground uppercase">
            Recents
          </p>
          {groups.length === 0 ? (
            <p className="px-2 py-2 text-small text-muted-foreground">
              {recents.length === 0
                ? "Sessions you open show up here."
                : "No session matches that search."}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {groups.map((group) => (
                <section
                  key={group.project || "no-project"}
                  aria-label={group.project || "No project"}
                >
                  <p className="truncate px-2 pb-1 text-label text-muted-foreground uppercase">
                    {group.project || "No project"}
                  </p>
                  <ul className="flex flex-col gap-0.5">
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
      </ScrollArea>

      <SidebarFooter />
    </>
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
  onClick,
}: {
  icon: RemixiconComponentType
  label: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-2 rounded-md px-2 text-ui transition-colors duration-[var(--dur-fast)] outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
        active
          ? "bg-accent-subtle text-primary"
          : "text-[var(--n6)] hover:bg-[var(--n2)] hover:text-foreground"
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
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
        "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors duration-[var(--dur-fast)] outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
        active
          ? "bg-accent-subtle text-primary"
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
                size={14}
                decorative
              />
            </TooltipTrigger>
            <TooltipContent>{session.harnessName}</TooltipContent>
          </Tooltip>
        ) : null}
      </span>
      {session.lastMessage ? (
        <span className="w-full truncate text-small text-muted-foreground">
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
  const Icon = THEME_ICON[theme] ?? RiComputerLine

  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-t border-border pr-2 pl-3">
      <span className="flex items-center gap-1.5 text-small text-muted-foreground">
        <span className="size-1.5 rounded-full bg-ok" aria-hidden="true" />
        Local · 127.0.0.1
      </span>
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
    </div>
  )
}
