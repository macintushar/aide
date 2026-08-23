import { RiKeyLine, RiTerminalBoxLine } from "@remixicon/react"
import { AideMark } from "@workspace/ui/components/logo"
import { EmptyState } from "@workspace/ui/components/empty-state"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { useEffect, useState } from "react"

import { AppShell } from "@/components/shell/app-shell"
import { Sidebar, type SidebarView } from "@/components/shell/sidebar"
import { SurfacePanel } from "@/components/shell/surface-panel"
import { ThreadHeader, ThreadTitle } from "@/components/shell/thread-header"
import {
<<<<<<< HEAD
  InstancesProvider,
  InstancesView,
  type InstancesProviderProps,
=======
  InstancesBoundary,
  useInstancesFeed,
  type InstancesBoundaryProps,
>>>>>>> origin/main
} from "@/features/instances"
import {
  SessionActivity,
  SessionProject,
  SessionTitle,
  SessionActions,
  SessionNavigation,
  SessionProvider,
  SessionThread,
  useSession,
  type SessionProviderProps,
} from "@/features/sessions"
import {
  SettingsBoundary,
  type SettingsBoundaryProps,
} from "@/features/settings"
<<<<<<< HEAD
import { latestExecution } from "@/features/sessions/session-selectors"
import type { Message } from "@workspace/contracts"
=======
import { apiBaseUrl } from "@/lib/transport/base-url"
>>>>>>> origin/main
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
  readRecentSessions,
  rememberSession,
  type RecentSession,
} from "@/lib/recent-sessions"
import { useSessionRoute } from "@/lib/session-route"
import { useWorkspaceState } from "@/lib/workspace-state"

export type AppProps = {
  readClient?: InstancesProviderProps["readClient"] &
    SettingsBoundaryProps["readClient"] &
    NonNullable<SessionProviderProps["readClient"]>
  commandClient?: InstancesProviderProps["commandClient"] &
    SettingsBoundaryProps["commandClient"]
  subscribeInstances?: InstancesProviderProps["subscribe"]
  subscribeSession?: SessionProviderProps["subscribe"]
  initialSessionId?: string
  /** Overrides sign-in detection (tests, embedded hosts). */
  authenticated?: boolean
}
<<<<<<< HEAD
// The one-time credential arrives via the URL the server prints at boot;
// only the resulting durable session is ever sent on data requests.
const auth = createSessionAuth()
const readClient = createReadClient({ auth })
const commandClient = createCommandClient({ auth })
=======

const token = import.meta.env.VITE_AIDE_BEARER_TOKEN
const transport = {
  baseUrl: apiBaseUrl(),
  ...(token ? { bearerToken: token } : {}),
}
const readClient = createReadClient(transport)
const commandClient = createCommandClient(transport)

function defaultSubscribeInstances(options: InstancesEventsOptions) {
  return subscribeInstancesEvents({ ...options, baseUrl: transport.baseUrl })
}

function defaultSubscribeSession(options: SessionEventsOptions) {
  return subscribeSessionEvents({ ...options, baseUrl: transport.baseUrl })
}

>>>>>>> origin/main
export function App({
  readClient: reads = readClient,
  commandClient: commands = commandClient,
  subscribeInstances = defaultSubscribeInstances,
  subscribeSession = defaultSubscribeSession,
  initialSessionId,
  authenticated: authenticatedOverride,
}: AppProps) {
<<<<<<< HEAD
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
    setRouteSessionId(nextSessionId)
    setRecents(rememberSession({ sessionId: nextSessionId }))
    setView("session")
  }

  const showSession = view === "session" && Boolean(sessionId)

  if (!authenticated) {
    return (
      <EmptyState
        icon={<RiKeyLine />}
        title="Not signed in"
        description="Start the aide server and open the URL it prints to sign this browser in."
      />
    )
  }

  return (
    <TooltipProvider>
      <InstancesProvider
        readClient={reads}
        commandClient={commands}
        subscribe={subscribeInstances}
      >
        <SessionProvider
          sessionId={showSession ? sessionId : undefined}
          readClient={reads}
          commandClient={commands}
          subscribe={subscribeSession}
        >
          <SessionRecorder onRemember={setRecents} />
          <AppShell
            sidebarOpen={workspace.sidebarOpen}
            panelOpen={workspace.panelOpen}
            sidebar={
              <Sidebar
                view={view}
                activeSessionId={showSession ? sessionId : undefined}
                recents={recents}
                onNewSession={() => {
                  setRouteSessionId(undefined)
                  setView("welcome")
                }}
                onOpenSettings={() => setView("settings")}
                onSelectSession={selectSession}
              />
            }
            panel={
              workspace.panelOpen ? (
                <SurfacePanel
                  surface={workspace.surface}
                  onOpenSurface={workspace.openSurface}
                  onCloseSurface={workspace.closeSurface}
                  onClosePanel={workspace.togglePanel}
=======
  const [sessionId, setSessionId] = useState(initialSessionId)
  // One feed for both consumers: the operations panel renders it, and the
  // composer needs the same inventory to describe its controls.
  const instancesFeed = useInstancesFeed({
    readClient: reads,
    subscribe: subscribeInstances,
  })

  return (
    <div className="min-h-svh bg-[radial-gradient(circle_at_top_left,var(--color-primary)_0,transparent_24rem)] bg-fixed">
      <div className="min-h-svh bg-background/94">
        <header className="border-b border-border bg-background/80 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <RiTerminalBoxLine className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h1 className="font-heading text-lg font-semibold tracking-tight">
                  Aide
                </h1>
                <p className="text-[0.68rem] font-medium tracking-[0.18em] text-muted-foreground uppercase">
                  Control plane
                </p>
              </div>
            </div>
            <span className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
              Wave 3 · Local operations
            </span>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
          <section
            aria-labelledby="workspace-heading"
            className="mb-10 min-w-0 rounded-3xl border border-border bg-background/90 p-5 shadow-sm sm:p-6 lg:p-8"
          >
            <div className="mb-6 flex items-center gap-3 border-b border-border pb-5">
              <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
                <RiQuestionAnswerLine className="size-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase">
                  Project workspace
                </p>
                <h2
                  id="workspace-heading"
                  className="font-heading text-2xl font-medium"
>>>>>>> origin/main
                >
                  {workspace.surface === "activity" ? (
                    <SessionActivity />
                  ) : null}
                  {workspace.surface === "instances" ? <InstancesView /> : null}
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
                    {view === "settings" ? "Settings" : "New session"}
                  </ThreadTitle>
                )
              }
              meta={showSession ? <SessionProject /> : null}
              actions={showSession ? <SessionActions /> : null}
            />

<<<<<<< HEAD
            {showSession ? (
              <SessionThread />
            ) : view === "settings" ? (
              <ScrollArea className="flex-1">
                <div className="mx-auto max-w-3xl px-4 py-6">
                  <SettingsBoundary
                    readClient={reads}
                    commandClient={commands}
                  />
                </div>
              </ScrollArea>
=======
            {sessionId ? (
              <div className="mt-8 border-t border-border pt-8">
                <SessionBoundary
                  sessionId={sessionId}
                  readClient={reads}
                  commandClient={commands}
                  subscribe={subscribeSession}
                  instances={instancesFeed.state.instances}
                />
              </div>
>>>>>>> origin/main
            ) : (
              <WelcomeView
                commandClient={commands}
<<<<<<< HEAD
                onSelectSession={selectSession}
=======
                subscribe={subscribeInstances}
                feed={instancesFeed}
>>>>>>> origin/main
              />
            )}
          </AppShell>
        </SessionProvider>
      </InstancesProvider>
    </TooltipProvider>
  )
}

function WelcomeView({
  commandClient,
  onSelectSession,
}: {
  commandClient: NonNullable<AppProps["commandClient"]>
  onSelectSession: (sessionId: string) => void
}) {
  return (
    <ScrollArea className="flex-1">
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-16">
        <div className="flex flex-col items-center gap-3 text-center">
          <AideMark size={32} aria-hidden="true" />
          <h1 className="text-h2">One conversation. Any agent.</h1>
          <p className="max-w-md text-body text-muted-foreground">
            Open a project directory to start a session, or resume one you
            already have.
          </p>
        </div>
        <SessionNavigation
          commandClient={commandClient}
          onSelectSession={onSelectSession}
        />
      </div>
    </ScrollArea>
  )
}

/** Recents are browser-local until the server exposes a session list. */
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

export function AppFallback() {
  return (
    <EmptyState
      icon={<RiTerminalBoxLine />}
      title="aide could not start"
      description="Reload the page to try again."
    />
  )
}
