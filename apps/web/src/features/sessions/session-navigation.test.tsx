import {
  projectFixture,
  sessionFixture,
  type Command,
  type CommandReceipt,
} from "@workspace/contracts"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { SessionNavigation } from "./session-navigation"

function receiptFor(result: unknown): CommandReceipt {
  return {
    commandId: "cmd_1",
    commandName: "project.open",
    state: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    result,
  }
}

describe("SessionNavigation", () => {
  it("opens a project and creates a session from it", async () => {
    const project = projectFixture()
    const session = sessionFixture()
    const send = vi
      .fn<(command: Command) => Promise<CommandReceipt>>()
      .mockResolvedValueOnce(receiptFor(project))
      .mockResolvedValueOnce(receiptFor(session))
    const onSelectSession = vi.fn()
    render(
      <SessionNavigation
        commandClient={{ send }}
        onSelectSession={onSelectSession}
      />
    )

    fireEvent.change(screen.getByLabelText("Project directory"), {
      target: { value: "/tmp/aide" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Open" }))

    await waitFor(() =>
      expect(screen.getByText(project.name)).toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole("button", { name: "New session" }))

    await waitFor(() =>
      expect(onSelectSession).toHaveBeenCalledWith(session.id)
    )
    expect(send).toHaveBeenNthCalledWith(1, {
      name: "project.open",
      commandId: expect.any(String),
      directory: "/tmp/aide",
    })
    expect(send).toHaveBeenNthCalledWith(2, {
      name: "session.create",
      commandId: expect.any(String),
      projectId: project.id,
    })
  })

  it("opens an existing session by id", async () => {
    const send = vi.fn()
    const onSelectSession = vi.fn()
    render(
      <SessionNavigation
        commandClient={{ send }}
        onSelectSession={onSelectSession}
      />
    )

    fireEvent.change(screen.getByLabelText("Session ID"), {
      target: { value: "session_9" },
    })
    fireEvent.click(screen.getByRole("button", { name: "View session" }))

    expect(onSelectSession).toHaveBeenCalledWith("session_9")
    expect(send).not.toHaveBeenCalled()
  })

  it("surfaces navigation failures without selecting a session", async () => {
    const send = vi
      .fn<(command: Command) => Promise<CommandReceipt>>()
      .mockRejectedValue(new Error("no such directory"))
    const onSelectSession = vi.fn()
    render(
      <SessionNavigation
        commandClient={{ send }}
        onSelectSession={onSelectSession}
      />
    )

    fireEvent.change(screen.getByLabelText("Project directory"), {
      target: { value: "/missing" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Open" }))

    expect(
      await screen.findByText(/Navigation failed: no such directory/)
    ).toBeInTheDocument()
    expect(onSelectSession).not.toHaveBeenCalled()
  })
})
