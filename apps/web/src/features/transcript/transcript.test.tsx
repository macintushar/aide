import {
  assistantMessageFixture,
  resolvedExecutionFixture,
  toolPartFixture,
  userMessageFixture,
  type AssistantMessage,
} from "@workspace/contracts"
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ExecutionDisplay } from "./execution-display"
import { ToolPartView, Transcript } from "./transcript"

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
