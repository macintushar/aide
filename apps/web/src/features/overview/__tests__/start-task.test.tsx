import {
  instancesSnapshotFixture,
  projectFixture,
  sessionFixture,
  type Command,
  type CommandReceipt,
} from "@workspace/contracts"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { InstancesProvider } from "@/features/instances"

import { StartTask, titleFromPrompt } from "../start-task"

function receiptFor(result: unknown): CommandReceipt {
  return {
    commandId: "cmd_1",
    commandName: "session.create",
    state: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    result,
  }
}

function renderStartTask(send: (command: Command) => Promise<CommandReceipt>) {
  const onStarted = vi.fn()
  const project = { ...projectFixture(), sessionCount: 0 }
  render(
    <InstancesProvider
      readClient={{ getInstances: vi.fn(async () => instancesSnapshotFixture()) }}
      commandClient={{ send: vi.fn() }}
      subscribe={() => ({ close: vi.fn() })}
    >
      <StartTask
        commandClient={{ send }}
        listProjects={async () => ({ projects: [project] })}
        onStarted={onStarted}
      />
    </InstancesProvider>
  )
  return { onStarted, project }
}

describe("titleFromPrompt", () => {
  it("uses the first non-empty line, capped", () => {
    expect(titleFromPrompt("\n  Fix the login bug \nmore detail")).toBe(
      "Fix the login bug"
    )
    expect(titleFromPrompt("x".repeat(80))).toHaveLength(62)
    expect(titleFromPrompt("   ")).toBeUndefined()
  })
})

describe("StartTask", () => {
  beforeEach(() => localStorage.clear())

  it("creates a session in the chosen project and sends the first message", async () => {
    const session = sessionFixture()
    const send = vi
      .fn<(command: Command) => Promise<CommandReceipt>>()
      .mockResolvedValueOnce(receiptFor(session))
      .mockResolvedValueOnce(receiptFor({}))
    const { onStarted, project } = renderStartTask(send)

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Project" })).toHaveTextContent(
        project.name
      )
    )
    const message = screen.getByLabelText("Message")
    await waitFor(() => expect(message).toBeEnabled())
    fireEvent.change(message, {
      target: { value: "Add rate limiting\nwith a sliding window" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(session.id))
    expect(send).toHaveBeenNthCalledWith(1, {
      name: "session.create",
      commandId: expect.any(String),
      projectId: project.id,
      title: "Add rate limiting",
    })
    expect(send).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        name: "turn.send",
        sessionId: session.id,
        content: "Add rate limiting\nwith a sliding window",
        execution: expect.objectContaining({ instanceId: "opencode" }),
      })
    )
  })

  it("asks for a worktree when the toggle is on", async () => {
    const send = vi
      .fn<(command: Command) => Promise<CommandReceipt>>()
      .mockResolvedValueOnce(receiptFor(sessionFixture()))
      .mockResolvedValueOnce(receiptFor({}))
    renderStartTask(send)

    const toggle = screen.getByRole("button", { name: "Worktree" })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute("aria-pressed", "true")
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Project" })).toHaveTextContent(
        "aide"
      )
    )
    const message = screen.getByLabelText("Message")
    await waitFor(() => expect(message).toBeEnabled())
    fireEvent.change(message, { target: { value: "Try it isolated" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))

    await waitFor(() =>
      expect(send).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ name: "session.create", worktree: {} })
      )
    )
  })

  it("surfaces a failed start without opening anything", async () => {
    const send = vi
      .fn<(command: Command) => Promise<CommandReceipt>>()
      .mockRejectedValueOnce(new Error("project is gone"))
    const { onStarted } = renderStartTask(send)

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Project" })).toHaveTextContent(
        "aide"
      )
    )
    const message = screen.getByLabelText("Message")
    await waitFor(() => expect(message).toBeEnabled())
    fireEvent.change(message, { target: { value: "Do the thing" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))

    expect(
      await screen.findByText(/Unable to start the task: project is gone/)
    ).toBeInTheDocument()
    expect(onStarted).not.toHaveBeenCalled()
  })
})
