import {
  RiArrowRightUpLine,
  RiChatNewLine,
  RiContrast2Line,
  RiKeyLine,
  RiLayoutLeftLine,
  RiLayoutRightLine,
  RiPulseLine,
  RiRadarLine,
  RiSettings3Line,
  RiStackLine,
  RiTerminalBoxLine,
} from "@remixicon/react"
import { EmptyState } from "@workspace/ui/components/empty-state"
import { AideTile } from "@workspace/ui/components/logo"
import { HarnessMark } from "@workspace/ui/components/harness-mark"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { StatusDot } from "@workspace/ui/components/status-dot"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { useCallback, useEffect, useMemo, useState } from "react"

import { CommandPalette, type PaletteItem } from "@/components/command-palette"
import { AppShell } from "@/components/shell/app-shell"
import { Sidebar, type SidebarView } from "@/components/shell/sidebar"
import { SurfacePanel } from "@/components/shell/surface-panel"
import { ThreadHeader, ThreadTitle } from "@/components/shell/thread-header"
import {
  InstancesProvider,
  InstancesView,
  harnessMarkFor,
  type InstancesProviderProps,
} from "@/features/instances"
import {
  ACTIVITY_META,
  MissionControl,
  OverviewProvider,
  useOverview,
} from "@/features/overview"
import { useTheme } from "@/components/theme-provider"
import {
  SessionActivity,
  SessionProject,
  SessionTitle,
  SessionActions,
  SessionProvider,
  SessionStatus,
  SessionThread,
  useSession,
  type SessionProviderProps,
} from "@/features/sessions"
import {
  SettingsBoundary,
  type SettingsBoundaryProps,
} from "@/features/settings"
import { latestExecution } from "@/features/sessions/session-selectors"
import type { Message } from "@workspace/contracts"
import { apiBaseUrl } from "@/lib/transport/base-url"
import { createCommandClient } from "@/lib/transport/command-client"
import {
  subscribeInstancesEvents,
  subscribeSessionEvents,
  type InstancesEventsOptions,
  type SessionEventsOptions,
} from "@/lib/transport/event-source"
import { createReadClient } from "@/lib/transport/read-client"
import { createSessionAuth } from "@/lib/transport/session-auth"
import {
  forgetSession,
  readRecentSessions,
  rememberSession,
  type RecentSession,
} from "@/lib/recent-sessions"
import { useSessionRoute } from "@/lib/session-route"
import type { ProjectBrowserClient } from "@/components/shell/project-browser"
import { useWorkspaceState } from "@/lib/workspace-state"

export type AppProps = {
  readClient?: InstancesProviderProps["readClient"] &
    SettingsBoundaryProps["readClient"] &
    NonNullable<SessionProviderProps["readClient"]> &
    Partial<ProjectBrowserClient> & {
      listAllSessions?: ReturnType<typeof createReadClient>["listAllSessions"]
    }
  commandClient?: InstancesProviderProps["commandClient"] &
    SettingsBoundaryProps["commandClient"]
  subscribeInstances?: InstancesProviderProps["subscribe"]
  subscribeSession?: SessionProviderProps["subscribe"]
  initialSessionId?: string
  /** Overrides sign-in detection (tests, embedded hosts). */
  authenticated?: boolean
}
// The one-time credential arrives via the URL the server prints at boot;
// only the resulting durable session is ever sent on data requests.
const auth = createSessionAuth({ baseUrl: apiBaseUrl() })
const readClient = createReadClient({ baseUrl: apiBaseUrl(), auth })
const commandClient = createCommandClient({ baseUrl: apiBaseUrl(), auth })

function defaultSubscribeInstances(options: InstancesEventsOptions) {
  return subscribeInstancesEvents({ ...options, baseUrl: apiBaseUrl() })
}

function defaultSubscribeSession(options: SessionEventsOptions) {
  return subscribeSessionEvents({ ...options, baseUrl: apiBaseUrl() })
}

export function App({
  readClient: reads = readClient,
  commandClient: commands = commandClient,
  subscribeInstances = defaultSubscribeInstances,
  subscribeSession = defaultSubscribeSession,
  initialSessionId,
  authenticated: authenticatedOverride,
}: AppProps) {
  const [authenticatedState, setAuthenticatedState] = useState(() =>
    auth.hasSession()
  )
  const authenticated = authenticatedOverride ?? authenticatedState

  useEffect(() => {
    if (authenticatedOverride !== undefined) return
    let active = true
    void auth.bootstrapFromUrl().finally(() => {
      if (active) setAuthenticatedState(auth.hasSession())
    })
    // A session that dies mid-use (expired server-side → 401 → invalidated)
    // must drop the shell back to the signed-out gate, not strand it.
    const unsubscribe = auth.onInvalidated(() => {
      if (active && !auth.hasSession()) setAuthenticatedState(false)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [authenticatedOverride])

  const workspace = useWorkspaceState()
  const [routeSessionId, setRouteSessionId] = useSessionRoute()
  const sessionId = routeSessionId ?? initialSessionId
  const [view, setView] = useState<SidebarView>(
    sessionId ? "session" : "welcome"
  )
  const [recents, setRecents] = useState<RecentSession[]>(readRecentSessions)

  useEffect(() => {
    if (routeSessionId) setView("session")
  }, [routeSessionId])

  function selectSession(nextSessionId: string) {
    workspace.dismissFloatingSidebar()
    setRouteSessionId(nextSessionId)
    setRecents(rememberSession({ sessionId: nextSessionId }))
    setView("session")
  }

  const showSession = view === "session" && Boolean(sessionId)
  const projectBrowser = useMemo<ProjectBrowserClient | undefined>(
    () =>
      reads.listProjects && reads.listSessions
        ? {
            listProjects: reads.listProjects.bind(reads),
            listSessions: reads.listSessions.bind(reads),
          }
        : undefined,
    [reads]
  )
  // Any navigation may have created or removed a project or session.
  const [projectsRefresh, setProjectsRefresh] = useState(0)
  useEffect(() => {
    setProjectsRefresh((count) => count + 1)
  }, [sessionId, view])

  const listAllSessions = useMemo(
    () => reads.listAllSessions?.bind(reads),
    [reads]
  )
  const [paletteOpen, setPaletteOpen] = useState(false)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  function goHome() {
    workspace.dismissFloatingSidebar()
    setRouteSessionId(undefined)
    setView("welcome")
  }

  function sessionDeleted() {
    if (sessionId) setRecents(forgetSession(sessionId))
    setRouteSessionId(undefined)
    setView("welcome")
  }

  if (!authenticated) return <SignedOut />

  return (
    <TooltipProvider>
      <InstancesProvider
        readClient={reads}
        commandClient={commands}
        subscribe={subscribeInstances}
      >
        <OverviewProvider
          {...(listAllSessions ? { listAllSessions } : {})}
          refreshKey={projectsRefresh}
        >
          <SessionProvider
            sessionId={showSession ? sessionId : undefined}
            readClient={reads}
            commandClient={commands}
            subscribe={subscribeSession}
            openSession={selectSession}
            onSessionDeleted={sessionDeleted}
          >
            <SessionRecorder onRemember={setRecents} />
            {paletteOpen ? (
              <AppPalette
                recents={recents}
                onClose={() => setPaletteOpen(false)}
                onSelectSession={selectSession}
                onHome={goHome}
                onOpenSettings={() => setView("settings")}
                onToggleSidebar={workspace.toggleSidebar}
                onTogglePanel={workspace.togglePanel}
                onOpenSurface={workspace.openSurface}
              />
            ) : null}
            <AppShell
              sidebarOpen={workspace.sidebarOpen}
              panelOpen={workspace.panelOpen}
              onDismissSidebar={workspace.toggleSidebar}
              onDismissPanel={workspace.togglePanel}
              sidebar={
                <Sidebar
                  view={view}
                  activeSessionId={showSession ? sessionId : undefined}
                  recents={recents}
                  onNewSession={goHome}
                  onOpenSettings={() => {
                    workspace.dismissFloatingSidebar()
                    setView("settings")
                  }}
                  onSelectSession={selectSession}
                  onOpenSearch={() => setPaletteOpen(true)}
                  projects={projectBrowser}
                  projectsRefreshKey={projectsRefresh}
                />
              }
              panel={
                workspace.panelOpen ? (
                  <SurfacePanel
                    surface={workspace.surface}
                    onOpenSurface={workspace.openSurface}
                    onCloseSurface={workspace.closeSurface}
                    onClosePanel={workspace.togglePanel}
                  >
                    {workspace.surface === "activity" ? (
                      <SessionActivity />
                    ) : null}
                    {workspace.surface === "instances" ? (
                      <InstancesView />
                    ) : null}
                  </SurfacePanel>
                ) : null
              }
            >
              <ThreadHeader
                sidebarOpen={workspace.sidebarOpen}
                onToggleSidebar={workspace.toggleSidebar}
                panelOpen={workspace.panelOpen}
                onTogglePanel={workspace.togglePanel}
                title={
                  showSession ? (
                    <SessionTitle />
                  ) : (
                    <ThreadTitle>
                      {view === "settings" ? "Settings" : "Mission control"}
                    </ThreadTitle>
                  )
                }
                meta={showSession ? <SessionProject /> : null}
                status={showSession ? <SessionStatus /> : null}
                actions={showSession ? <SessionActions /> : null}
              />

              {showSession ? (
                <SessionThread />
              ) : view === "settings" ? (
                <ScrollArea className="flex-1">
                  <div className="mx-auto max-w-3xl px-4 pt-8 sm:px-8 sm:pt-10">
                    <header className="mb-8 flex flex-col gap-1.5">
                      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.025em]">
                        Settings
                      </h1>
                      <p className="text-body text-muted-foreground">
                        Harnesses, MCP servers and the defaults every new
                        session starts from. Saved locally by your aide server.
                      </p>
                    </header>
                    <SettingsBoundary
                      readClient={reads}
                      commandClient={commands}
                    />
                  </div>
                </ScrollArea>
              ) : (
                <MissionControl
                  commandClient={commands}
                  {...(projectBrowser
                    ? { listProjects: projectBrowser.listProjects }
                    : {})}
                  recents={recents}
                  onSelectSession={selectSession}
                  onOpenSettings={() => setView("settings")}
                />
              )}
            </AppShell>
          </SessionProvider>
        </OverviewProvider>
      </InstancesProvider>
    </TooltipProvider>
  )
}

/** ⌘K: sessions from the live overview (or recents), then app actions. */
function AppPalette({
  recents,
  onClose,
  onSelectSession,
  onHome,
  onOpenSettings,
  onToggleSidebar,
  onTogglePanel,
  onOpenSurface,
}: {
  recents: RecentSession[]
  onClose: () => void
  onSelectSession: (sessionId: string) => void
  onHome: () => void
  onOpenSettings: () => void
  onToggleSidebar: () => void
  onTogglePanel: () => void
  onOpenSurface: (surface: "activity" | "instances") => void
}) {
  const overview = useOverview()
  const { theme, setTheme } = useTheme()
  const close = useCallback(() => onClose(), [onClose])

  const sessions: PaletteItem[] = overview.sessions
    ? overview.sessions.map((summary) => {
        const meta = ACTIVITY_META[summary.activity]
        return {
          id: summary.session.id,
          group: "Sessions",
          label: summary.session.title,
          detail: summary.project.name,
          icon: <StatusDot tone={meta.dot} pulse={meta.pulse} />,
          hint: summary.latestExecution ? (
            <HarnessMark
              src={harnessMarkFor(summary.latestExecution.driver)}
              name={summary.latestExecution.instanceName}
              size={13}
              decorative
            />
          ) : (
            meta.label
          ),
          run: () => onSelectSession(summary.session.id),
        }
      })
    : recents.map((recent) => ({
        id: recent.sessionId,
        group: "Recent sessions",
        label: recent.title ?? recent.sessionId,
        ...(recent.projectName ? { detail: recent.projectName } : {}),
        icon: <RiChatNewLine className="size-4" aria-hidden="true" />,
        run: () => onSelectSession(recent.sessionId),
      }))

  const actions: PaletteItem[] = [
    {
      id: "action:home",
      group: "Actions",
      label: "Start a new task",
      detail: "Mission control",
      icon: <RiRadarLine className="size-4" aria-hidden="true" />,
      run: onHome,
    },
    {
      id: "action:settings",
      group: "Actions",
      label: "Open settings",
      detail: "Harness instances, MCP servers, defaults",
      icon: <RiSettings3Line className="size-4" aria-hidden="true" />,
      run: onOpenSettings,
    },
    {
      id: "action:activity",
      group: "Actions",
      label: "Show session activity",
      icon: <RiPulseLine className="size-4" aria-hidden="true" />,
      run: () => onOpenSurface("activity"),
    },
    {
      id: "action:instances",
      group: "Actions",
      label: "Show harness instances",
      icon: <RiStackLine className="size-4" aria-hidden="true" />,
      run: () => onOpenSurface("instances"),
    },
    {
      id: "action:sidebar",
      group: "Actions",
      label: "Toggle sidebar",
      icon: <RiLayoutLeftLine className="size-4" aria-hidden="true" />,
      hint: "[",
      run: onToggleSidebar,
    },
    {
      id: "action:panel",
      group: "Actions",
      label: "Toggle panel",
      icon: <RiLayoutRightLine className="size-4" aria-hidden="true" />,
      hint: "]",
      run: onTogglePanel,
    },
    {
      id: "action:theme",
      group: "Actions",
      label: `Switch to ${theme === "dark" ? "light" : "dark"} theme`,
      icon: <RiContrast2Line className="size-4" aria-hidden="true" />,
      run: () => setTheme(theme === "dark" ? "light" : "dark"),
    },
  ]

  return (
    <CommandPalette
      items={[...sessions, ...actions]}
      onClose={close}
      openById={(id) => ({
        id: `open:${id}`,
        group: "Open by ID",
        label: `Open ${id}`,
        icon: <RiArrowRightUpLine className="size-4" aria-hidden="true" />,
        run: () => onSelectSession(id),
      })}
    />
  )
}

/** Remembers the open session in the browser-local recents. */
function SessionRecorder({
  onRemember,
}: {
  onRemember: (recents: RecentSession[]) => void
}) {
  const session = useSession()
  const sessionId = session?.sessionId
  const title = session?.state.session?.title
  const projectName = session?.state.project?.name
  const messages = session?.state.messages
  const lastMessage = messages ? lastMessagePreview(messages) : undefined
  const execution = messages ? latestExecution(messages) : undefined
  const harnessName = execution?.display.instanceName
  const driver = execution?.selection.driver

  useEffect(() => {
    if (!sessionId) return
    onRemember(
      rememberSession({
        sessionId,
        title,
        projectName,
        lastMessage,
        harnessName,
        driver,
      })
    )
  }, [
    driver,
    harnessName,
    lastMessage,
    onRemember,
    projectName,
    sessionId,
    title,
  ])

  return null
}

/** The sidebar previews the latest message text, capped for localStorage. */
function lastMessagePreview(messages: Message[]): string | undefined {
  const last = [...messages]
    .sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id))
    .at(-1)
  const text = last?.parts.find((part) => part.type === "text")
  return text?.type === "text" ? text.text.slice(0, 160) : undefined
}

/** The gate before the server has exchanged its one-time sign-in link. */
function SignedOut() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-frame bg-[radial-gradient(60%_50%_at_50%_0%,var(--accent-subtle),transparent)] p-6">
      <div className="flex w-full max-w-md animate-rise flex-col items-center gap-6 text-center">
        <AideTile size={56} />
        <div className="flex flex-col gap-2">
          <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.025em]">
            Not signed in
          </h1>
          <p className="text-body text-muted-foreground">
            Start the aide server and open the URL it prints to sign this
            browser in.
          </p>
        </div>
        <div className="w-full rounded-xl border border-[var(--line)] bg-[var(--n2)] p-4 text-left shadow-card">
          <p className="flex items-center gap-2 text-small text-[var(--n5)]">
            <RiKeyLine className="size-3.5" aria-hidden="true" />
            In your terminal
          </p>
          <pre className="mt-2 overflow-x-auto font-mono text-mono text-[var(--n7)]">
            <span className="text-[var(--n5)]">$ </span>bun run dev{"\n"}
            <span className="text-ok">[aide]</span> ready — open
            http://127.0.0.1:3000/?authToken=…
          </pre>
        </div>
      </div>
    </main>
  )
}

export function AppFallback() {
  return (
    <EmptyState
      icon={<RiTerminalBoxLine />}
      title="aide could not start"
      description="Reload the page to try again."
    />
  )
}
