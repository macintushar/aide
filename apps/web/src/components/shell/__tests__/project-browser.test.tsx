import { projectFixture, sessionFixture } from "@workspace/contracts"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ProjectBrowser } from "../project-browser"

describe("ProjectBrowser", () => {
  it("lists projects and loads sessions when one is expanded", async () => {
    const user = userEvent.setup()
    const onSelectSession = vi.fn()
    const listSessions = vi.fn(async () => ({ sessions: [sessionFixture()] }))
    render(
      <ProjectBrowser
        client={{
          listProjects: async () => ({
            projects: [{ ...projectFixture(), sessionCount: 1 }],
          }),
          listSessions,
        }}
        onSelectSession={onSelectSession}
      />
    )

    const project = await screen.findByRole("button", {
      name: new RegExp(projectFixture().name),
    })
    expect(listSessions).not.toHaveBeenCalled()
    await user.click(project)
    expect(project).toHaveAttribute("aria-expanded", "true")
    await user.click(
      await screen.findByRole("button", { name: "Fixture session" })
    )
    expect(listSessions).toHaveBeenCalledWith(projectFixture().id)
    expect(onSelectSession).toHaveBeenCalledWith(sessionFixture().id)
  })

  it("explains an empty server", async () => {
    render(
      <ProjectBrowser
        client={{
          listProjects: async () => ({ projects: [] }),
          listSessions: vi.fn(),
        }}
        onSelectSession={vi.fn()}
      />
    )
    expect(
      await screen.findByText("Projects you open show up here.")
    ).toBeInTheDocument()
  })
})
