import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { sessionFixture, type SessionSummary } from "@workspace/contracts"
import { describe, expect, it, vi } from "vitest"

import { Sidebar } from "../sidebar"
import { ThemeProvider } from "@/components/theme-provider"
import { OverviewProvider } from "@/features/overview"
import type { RecentSession } from "@/lib/recent-sessions"

const recents: RecentSession[] = [
  {
    sessionId: "session_1",
    title: "Wire the settings panel",
    projectName: "aide",
    lastMessage: "Settings now persist.",
    harnessName: "OpenCode",
    driver: "opencode",
    openedAt: 3,
  },
  {
    sessionId: "session_2",
    title: "Port the adapter send path",
    projectName: "aide",
    lastMessage: "Execution resolves first.",
    harnessName: "OpenCode",
    driver: "opencode",
    openedAt: 2,
  },
  {
    sessionId: "session_3",
    title: "Investigate reconnect storm",
    projectName: "warrant",
    lastMessage: "A missing liveness check.",
    harnessName: "Claude Code",
    driver: "claudeAgent",
    openedAt: 1,
  },
]

function renderSidebar() {
  return render(
    <ThemeProvider>
      <TooltipProvider delay={0}>
        <Sidebar
          view="session"
          activeSessionId="session_1"
          recents={recents}
          onNewSession={() => {}}
          onOpenSettings={() => {}}
          onSelectSession={() => {}}
        />
      </TooltipProvider>
    </ThemeProvider>
  )
}

describe("Sidebar recents", () => {
  it("groups sessions under one header per project", () => {
    renderSidebar()

    expect(
      screen
        .getAllByRole("region", { hidden: true })
        .map((region) => region.getAttribute("aria-label"))
    ).toEqual(["aide", "warrant"])
    // Two aide sessions share a single "aide" header.
    const aideGroup = screen.getByRole("region", { name: "aide" })
    expect(within(aideGroup).getAllByText("aide")).toHaveLength(1)
  })

  it("shows the last message preview for each session", () => {
    renderSidebar()

    expect(screen.getByText("Settings now persist.")).toBeInTheDocument()
    expect(screen.getByText("A missing liveness check.")).toBeInTheDocument()
  })

  it("labels the harness symbol and reveals the name in a tooltip", async () => {
    const user = userEvent.setup()
    renderSidebar()

    const symbols = screen.getAllByRole("img", { name: /Harness: / })
    expect(symbols).toHaveLength(3)

    await user.hover(symbols[0]!)
    expect(await screen.findByText("OpenCode")).toBeInTheDocument()
  })
})

describe("Sidebar with the live session overview", () => {
  function summaries(): SessionSummary[] {
    const base = {
      project: { id: "proj_1", name: "aide", directory: "/code/aide" },
      openRequests: 0,
      turnCount: 1,
    }
    return [
      {
        ...base,
        session: { ...sessionFixture(), id: "s_wait", title: "Needs approval" },
        activity: "needs_input",
        openRequests: 1,
      },
      {
        ...base,
        session: { ...sessionFixture(), id: "s_run", title: "Busy agent" },
        activity: "running",
      },
      {
        ...base,
        session: { ...sessionFixture(), id: "s_done", title: "Finished work" },
        activity: "completed",
      },
    ]
  }

  it("lifts sessions that need you or are running above the projects", async () => {
    const onSelectSession = vi.fn()
    render(
      <ThemeProvider>
        <TooltipProvider delay={0}>
          <OverviewProvider
            listAllSessions={async () => ({ sessions: summaries() })}
          >
            <Sidebar
              view="welcome"
              recents={[]}
              onNewSession={() => {}}
              onOpenSettings={() => {}}
              onSelectSession={onSelectSession}
            />
          </OverviewProvider>
        </TooltipProvider>
      </ThemeProvider>
    )

    const needsYou = await screen.findByRole("region", { name: "Needs you" })
    expect(within(needsYou).getByText(/Needs approval/)).toBeInTheDocument()
    const running = screen.getByRole("region", { name: "Running" })
    expect(within(running).getByText(/Busy agent/)).toBeInTheDocument()
    const projects = screen.getByRole("region", { name: "Projects" })
    expect(within(projects).getByText("Finished work")).toBeInTheDocument()
    // The attention count rides on the Mission control entry.
    expect(
      screen.getByRole("button", { name: /Mission control/ })
    ).toHaveTextContent("1")

    await userEvent.click(within(running).getByRole("button"))
    expect(onSelectSession).toHaveBeenCalledWith("s_run")
  })
})
