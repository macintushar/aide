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
  InstancesProvider,
  InstancesView,
  type InstancesProviderProps,
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
import { latestExecution } from "@/features/sessions/session-selectors"
import type { Message } from "@workspace/contracts"
import { createCommandClient } from "@/lib/transport/command-client"
import {
  subscribeInstancesEvents,
  subscribeSessionEvents,
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
// The one-time credential arrives via the URL the server prints at boot;
// only the resulting durable session is ever sent on data requests.
const auth = createSessionAuth()
const readClient = createReadClient({ auth })
const commandClient = createCommandClient({ auth })
export function App({
  readClient: reads = readClient,
  commandClient: commands = commandClient,
  subscribeInstances = subscribeInstancesEvents,
  subscribeSession = subscribeSessionEvents,
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
    return () => {
      active = false
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
            ) : (
              <WelcomeView
                commandClient={commands}
                onSelectSession={selectSession}
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
