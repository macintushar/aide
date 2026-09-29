import {
  instancesSnapshotFixture,
  sessionSnapshotFixture,
  type Command,
  type CommandReceipt,
} from "@workspace/contracts"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { InstancesProvider } from "@/features/instances"
import { SessionProvider } from "../session-provider"
import { SessionActions, SessionTitle } from "../session-summary"

function receipt(command: Command, result?: unknown): CommandReceipt {
  return {
    commandId: command.commandId,
    commandName: command.name,
    state: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...(result === undefined ? {} : { result }),
  }
}

function renderHeader(
  options: {
    worktree?: boolean
    onSessionDeleted?: () => void
    result?: (command: Command) => unknown
  } = {}
) {
  const snapshot = sessionSnapshotFixture()
  if (options.worktree) {
    snapshot.session = {
      ...snapshot.session,
      worktree: {
        path: "/data/worktrees/p/s",
        branch: "aide/feature",
        baseRef: "main",
      },
    } as typeof snapshot.session
  }
  const send = vi.fn(async (command: Command) =>
    receipt(command, options.result?.(command))
  )
  render(
    <InstancesProvider
      readClient={{ getInstances: async () => instancesSnapshotFixture() }}
      commandClient={{ send: vi.fn() }}
      subscribe={() => ({ close: vi.fn() })}
    >
      <SessionProvider
        sessionId={snapshot.session.id}
        readClient={{ getSession: async () => snapshot }}
        commandClient={{ send }}
        subscribe={() => ({ close: vi.fn() })}
        {...(options.onSessionDeleted
          ? { onSessionDeleted: options.onSessionDeleted }
          : {})}
      >
        <SessionTitle />
        <SessionActions />
      </SessionProvider>
    </InstancesProvider>
  )
  return { send, snapshot }
}

describe("Session header", () => {
  it("renames the session in place", async () => {
    const user = userEvent.setup()
    const { send, snapshot } = renderHeader({
      result: (command) =>
        command.name === "session.rename"
          ? { ...snapshot.session, title: "Renamed" }
          : undefined,
    })
    await user.click(
      await screen.findByRole("button", { name: snapshot.session.title })
    )
    const field = screen.getByRole("textbox", { name: "Session title" })
    await user.clear(field)
    await user.type(field, "Renamed{Enter}")

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ name: "session.rename", title: "Renamed" })
      )
    )
    expect(
      await screen.findByRole("button", { name: "Renamed" })
    ).toBeInTheDocument()
  })

  it("deletes the session after confirming", async () => {
    const user = userEvent.setup()
    const onSessionDeleted = vi.fn()
    const { send } = renderHeader({ onSessionDeleted })
    await user.click(
      await screen.findByRole("button", { name: "Session actions" })
    )
    await user.click(screen.getByRole("menuitem", { name: "Delete session…" }))
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete session",
      })
    )
    await waitFor(() => expect(onSessionDeleted).toHaveBeenCalled())
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ name: "session.delete" })
    )
  })

  it("removes a worktree and can delete its branch", async () => {
    const user = userEvent.setup()
    const { send } = renderHeader({ worktree: true })
    expect(await screen.findByTestId("worktree-badge")).toHaveTextContent(
      "aide/feature"
    )
    await user.click(screen.getByRole("button", { name: "Session actions" }))
    await user.click(screen.getByRole("menuitem", { name: "Remove worktree…" }))
    await user.click(
      screen.getByRole("checkbox", { name: /delete the branch/ })
    )
    await user.click(screen.getByRole("button", { name: "Remove worktree" }))
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ name: "worktree.remove", deleteBranch: true })
      )
    )
  })
})
