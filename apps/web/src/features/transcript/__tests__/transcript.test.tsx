import {
  assistantMessageFixture,
  resolvedExecutionFixture,
  toolPartFixture,
  userMessageFixture,
  type AssistantMessage,
} from "@workspace/contracts"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { TranscriptActionsProvider } from ".././actions"
import { ExecutionDisplay } from ".././execution-display"
import { ToolPartView, Transcript } from ".././transcript"

describe("Transcript", () => {
  it("renders all five part variants in index order", () => {
    const assistant = assistantMessageFixture()
    const parts: AssistantMessage["parts"] = [
      ...assistant.parts,
      {
        id: "part_file_3",
        messageId: assistant.id,
        index: 3,
        type: "file",
        path: "src/settings.tsx",
        mime: "text/typescript",
      },
      {
        id: "part_agent_4",
        messageId: assistant.id,
        index: 4,
        type: "agent",
        name: "reviewer",
        status: "done",
      },
    ]
    parts.reverse()

    render(
      <Transcript messages={[{ ...assistant, parts }, userMessageFixture()]} />
    )

    const message = document.querySelector(
      '[data-message-id="msg_assistant_1"]'
    )
    expect(message).not.toBeNull()
    const content = within(message as HTMLElement).getByText(
      "Considered the component layout."
    )
    expect(content).toBeVisible()
    expect(
      within(message as HTMLElement).getByText(
        "Implemented the settings panel."
      )
    ).toBeVisible()
    expect(within(message as HTMLElement).getByText("bash")).toBeVisible()
    expect(
      within(message as HTMLElement).getByText("src/settings.tsx")
    ).toBeVisible()
    expect(within(message as HTMLElement).getByText("reviewer")).toBeVisible()
    expect(message?.textContent?.indexOf("Considered")).toBeLessThan(
      message?.textContent?.indexOf("Implemented") ?? 0
    )
  })

  it("orders messages by sequence and then id", () => {
    const user = userMessageFixture()
    const first = { ...user, id: "msg_b", seq: 2 }
    const second = { ...user, id: "msg_a", seq: 2 }

    render(<Transcript messages={[first, second]} />)

    expect(
      [...document.querySelectorAll("[data-message-id]")].map((node) =>
        node.getAttribute("data-message-id")
      )
    ).toEqual(["msg_a", "msg_b"])
  })

  it("uses the user execution display for its assistant child", () => {
    const user = userMessageFixture()
    const assistant = assistantMessageFixture()
    user.execution.display.modelName = "Historical model"
    user.execution.selection.model.modelId = "current-model-id"

    render(<Transcript messages={[assistant, user]} />)

    expect(screen.getAllByText("Historical model")).toHaveLength(2)
    expect(screen.queryByText("current-model-id")).not.toBeInTheDocument()
  })
})

describe("ToolPartView", () => {
  it("keeps artifact actions inside the disclosure and opens failures", async () => {
    const user = userEvent.setup()
    const openArtifact = vi.fn()
    const part = { ...toolPartFixture("completed"), artifactId: "art_full" }
    const view = (status: typeof part.status) => (
      <TranscriptActionsProvider value={{ openArtifact }}>
        <ToolPartView part={{ ...part, status }} />
      </TranscriptActionsProvider>
    )
    const { rerender } = render(view("completed"))
    const disclosure = document.querySelector("details")!
    expect(disclosure.open).toBe(false)
    await user.click(
      within(disclosure.querySelector("summary")!).getByText(part.name)
    )
    expect(disclosure.open).toBe(true)
    await user.click(screen.getByRole("button", { name: "View full output" }))
    expect(openArtifact).toHaveBeenCalledWith("art_full")
    await user.click(
      within(disclosure.querySelector("summary")!).getByText(part.name)
    )
    expect(disclosure.open).toBe(false)

    rerender(view("failed"))
    expect(document.querySelector("details")).toBe(disclosure)
    expect(disclosure.open).toBe(true)
  })

  it("rerenders status, output, and MCP server", () => {
    const part = {
      ...toolPartFixture("running"),
      source: { kind: "mcp" as const, server: "filesystem" },
      output: undefined,
    }
    const { rerender } = render(<ToolPartView part={part} />)

    expect(screen.getByText("running")).toBeInTheDocument()
    expect(screen.getByText("filesystem")).toBeInTheDocument()

    rerender(
      <ToolPartView part={{ ...part, status: "completed", output: "done" }} />
    )

    expect(screen.queryByText("running")).not.toBeInTheDocument()
    expect(screen.getByText("completed")).toBeInTheDocument()
    expect(screen.getByText("done")).toBeInTheDocument()
  })

  it("walks one card through the lifecycle rather than replacing it", () => {
    const part = {
      ...toolPartFixture("pending"),
      input: undefined,
      output: undefined,
    }
    const { rerender } = render(<ToolPartView part={part} />)
    const card = () => document.querySelector("[data-tool-status]")

    expect(card()?.getAttribute("data-tool-status")).toBe("pending")
    const pendingCard = card()

    rerender(
      <ToolPartView
        part={{ ...part, status: "running", input: { command: "bun test" } }}
      />
    )
    expect(card()?.getAttribute("data-tool-status")).toBe("running")
    // The same element throughout, so the transcript does not reflow.
    expect(card()).toBe(pendingCard)

    rerender(
      <ToolPartView
        part={{
          ...part,
          status: "failed",
          input: { command: "bun test" },
          output: "exit 1",
        }}
      />
    )
    expect(card()?.getAttribute("data-tool-status")).toBe("failed")
    expect(screen.getByTestId("tool-output")).toHaveTextContent("exit 1")
  })

  it("shows the streaming partial input verbatim and the settled input as JSON", () => {
    const part = { ...toolPartFixture("pending"), output: undefined }
    const { rerender } = render(
      <ToolPartView part={{ ...part, input: '{"command":' }} />
    )

    expect(screen.getByTestId("tool-input")).toHaveTextContent('{"command":')

    rerender(<ToolPartView part={{ ...part, input: { command: "ls" } }} />)
    expect(screen.getByTestId("tool-input")).toHaveTextContent(
      '"command": "ls"'
    )
  })

  it("names the artifact holding output that was too large to inline", () => {
    render(
      <ToolPartView
        part={{
          ...toolPartFixture("completed"),
          output: "first page…",
          artifactId: "art_1",
        }}
      />
    )

    expect(
      document.querySelector('[data-artifact-id="art_1"]')
    ).toBeInTheDocument()
  })
})

describe("reasoning parts", () => {
  it("renders reasoning as first-class transcript content", () => {
    const assistant = assistantMessageFixture()

    render(<Transcript messages={[assistant]} />)

    const reasoning = screen.getByTestId("reasoning-part")
    expect(reasoning).toBeVisible()
    expect(reasoning).toHaveTextContent("Considered the component layout.")
    // Suppressed from transfer, never from display.
    expect(reasoning.className).not.toMatch(/opacity-/)
  })
})

describe("ExecutionDisplay", () => {
  it("renders immutable display labels and options", () => {
    const execution = resolvedExecutionFixture()
    execution.display.instanceName = "Local Claude"
    execution.display.modelName = "Sonnet"
    execution.display.agentName = "Planner"
    execution.display.interactionModeName = "Review"
    execution.display.options = {
      effort: { label: "Effort", valueLabel: "High" },
    }
    execution.selection.model.modelId = "mutable-model-id"

    render(<ExecutionDisplay execution={execution} />)

    expect(screen.getByText("Local Claude")).toBeInTheDocument()
    expect(screen.getByText("Sonnet")).toBeInTheDocument()
    expect(screen.getByText("Planner")).toBeInTheDocument()
    expect(screen.getByText("Review")).toBeInTheDocument()
    expect(screen.getByText("Effort: High")).toBeInTheDocument()
    expect(screen.queryByText("mutable-model-id")).not.toBeInTheDocument()
  })
})

describe("Transcript turn extras", () => {
  it("shows usage, subagents, notices and per-turn actions", async () => {
    const { fireEvent } = await import("@testing-library/react")
    const { turnFixture } = await import("@workspace/contracts")
    const assistant = assistantMessageFixture()
    const withAgent = {
      ...assistant,
      usage: {
        inputTokens: 1200,
        outputTokens: 340,
        cacheReadTokens: 60,
        cacheWriteTokens: 20,
        costUsd: 0.0042,
      },
      parts: [
        ...assistant.parts,
        {
          id: "part_agent_9",
          messageId: assistant.id,
          index: 9,
          type: "agent" as const,
          name: "Explore",
          status: "completed",
          description: "Survey the repository",
          summary: "Found three entry points",
          progress: { toolUses: 4, totalTokens: 1500, durationMs: 5000 },
        },
      ],
    }
    const forks: string[] = []
    const restores: string[] = []

    render(
      <Transcript
        messages={[userMessageFixture(), withAgent]}
        turns={[turnFixture("completed")]}
        notices={[
          {
            id: "notice_1",
            turnId: "turn_1",
            title: "Context compacted",
            message: "Claude compacted its context.",
            level: "info",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ]}
        restorable={new Set(["turn_1"])}
        onFork={(turnId) => forks.push(turnId)}
        onRestore={(turnId) => restores.push(turnId)}
      />
    )

    expect(screen.getByTestId("message-usage")).toHaveTextContent(
      "1.2k in · 340 out · 80 cached · $0.0042"
    )
    const agent = screen.getByTestId("agent-part")
    expect(agent).toHaveTextContent("Explore")
    expect(agent).toHaveTextContent("Survey the repository")
    expect(agent).toHaveTextContent("4 tool calls · 1,500 tokens · 5.0s")
    expect(agent).toHaveTextContent("Found three entry points")
    expect(screen.getByTestId("notice")).toHaveTextContent("Context compacted")

    fireEvent.click(screen.getByRole("button", { name: "Fork from here" }))
    fireEvent.click(
      screen.getByRole("button", { name: "Restore files to before this turn" })
    )
    expect(forks).toEqual(["turn_1"])
    expect(restores).toEqual(["turn_1"])
  })

  it("marks invoked commands and steering messages", () => {
    const user = userMessageFixture()
    render(
      <Transcript
        messages={[
          { ...user, invocation: { kind: "command", name: "review" } },
          {
            ...user,
            id: "msg_user_steer",
            seq: 5,
            steer: { turnId: "turn_1" },
          },
        ]}
      />
    )
    expect(screen.getByText("/review")).toBeVisible()
    expect(screen.getByText("Steered the running turn")).toBeVisible()
  })

  it("offers no restore for a turn without a checkpoint", async () => {
    const { turnFixture } = await import("@workspace/contracts")
    render(
      <Transcript
        messages={[userMessageFixture(), assistantMessageFixture()]}
        turns={[turnFixture("completed")]}
        restorable={new Set()}
        onFork={() => undefined}
        onRestore={() => undefined}
      />
    )
    expect(
      screen.queryByRole("button", { name: /Restore files/ })
    ).not.toBeInTheDocument()
  })
})

describe("Transcript failed turns", () => {
  it("shows why a turn failed under its reply", async () => {
    const { turnFixture } = await import("@workspace/contracts")
    render(
      <Transcript
        messages={[userMessageFixture(), assistantMessageFixture()]}
        turns={[
          {
            ...turnFixture("failed"),
            error: {
              code: "opencode_session_error",
              message: "Provider request failed with HTTP 400",
              retryable: false,
            },
          },
        ]}
      />
    )
    expect(screen.getByTestId("turn-error")).toHaveTextContent(
      "Provider request failed with HTTP 400"
    )
  })
})

describe("Transcript handoffs", () => {
  function userOn(
    id: string,
    seq: number,
    instanceId: string,
    instanceName: string,
    modelId = "gpt-5"
  ) {
    const message = userMessageFixture()
    message.id = id
    message.seq = seq
    message.parts = message.parts.map((part) => ({ ...part, messageId: id }))
    message.execution.selection.instanceId = instanceId
    message.execution.selection.model.modelId = modelId
    message.execution.display.instanceName = instanceName
    message.execution.display.modelName = modelId
    return message
  }

  it("marks the seam where the conversation moves to another harness", () => {
    render(
      <Transcript
        messages={[
          userOn("m1", 0, "opencode", "OpenCode"),
          userOn("m2", 1, "opencode", "OpenCode"),
          userOn("m3", 2, "claude", "Claude Code", "opus-5"),
        ]}
      />
    )

    const seams = screen.getAllByTestId("handoff")
    expect(seams).toHaveLength(1)
    expect(seams[0]).toHaveAccessibleName("Continued with Claude Code · opus-5")
    expect(seams[0]).toHaveTextContent("Handed off to Claude Code")
  })

  it("calls a model change on the same harness a model switch", () => {
    render(
      <Transcript
        messages={[
          userOn("m1", 0, "claude", "Claude Code", "sonnet-5"),
          userOn("m2", 1, "claude", "Claude Code", "opus-5"),
        ]}
      />
    )

    expect(screen.getByTestId("handoff")).toHaveTextContent(
      "Switched model to opus-5"
    )
  })
})
