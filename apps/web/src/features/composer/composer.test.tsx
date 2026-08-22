import type { InstanceSnapshotEntry } from "@workspace/contracts"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { Composer } from "./composer"

function claudeInstance(
  overrides: Partial<InstanceSnapshotEntry> = {}
): InstanceSnapshotEntry {
  return {
    instanceId: "claude",
    driver: "claudeAgent",
    displayName: "Claude",
    enabled: true,
    autoStart: true,
    status: "ready",
    auth: { status: "authenticated" },
    inventory: {
      instanceId: "claude",
      driver: "claudeAgent",
      revision: "rev-1",
      discoveredAt: "2026-01-01T00:00:00.000Z",
      stale: false,
      capabilities: {
        inventoryScope: "runtime",
        agentSelection: false,
        interactionModes: [{ id: "build", label: "Build", isDefault: true }],
        sessionModelSwitch: "in-session",
        steer: true,
        interrupt: true,
        permissions: true,
        userInput: true,
        reasoningParts: true,
        mcp: {
          stdio: true,
          http: true,
          sse: true,
          inProcess: true,
          runtimeReconfigure: true,
        },
      },
      auth: { status: "authenticated" },
      models: [
        {
          modelId: "claude-opus-5",
          displayName: "Claude Opus 5",
          isDefault: true,
          optionDescriptors: [
            {
              id: "effort",
              label: "Effort",
              type: "select",
              options: [
                { id: "medium", label: "Medium" },
                { id: "high", label: "High" },
              ],
              defaultValue: "medium",
            },
          ],
        },
        {
          modelId: "claude-haiku-4-5",
          displayName: "Claude Haiku 4.5",
          optionDescriptors: [],
        },
      ],
      agents: [],
      interactionModes: [{ id: "build", label: "Build", isDefault: true }],
    },
    ...overrides,
  }
}

function selectByControl(controlId: string): HTMLSelectElement {
  const element = document.querySelector(`[data-control-id="${controlId}"]`)
  if (!element) throw new Error(`no control "${controlId}" is rendered`)
  return element as HTMLSelectElement
}

describe("Composer", () => {
  it("renders a select per reported control and sends the resolved selection", () => {
    const onSend = vi.fn()
    render(
      <Composer sources={{ instances: [claudeInstance()] }} onSend={onSend} />
    )

    expect(selectByControl("instance").value).toBe("claude")
    expect(selectByControl("model").value).toBe("claude-opus-5")
    expect(selectByControl("mode").value).toBe("build")
    expect(selectByControl("effort").value).toBe("medium")

    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "  write the middleware  " },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))

    expect(onSend).toHaveBeenCalledWith({
      content: "write the middleware",
      execution: {
        instanceId: "claude",
        driver: "claudeAgent",
        model: { modelId: "claude-opus-5" },
        interactionMode: "build",
        options: { effort: "medium" },
      },
    })
  })

  it("drops the option control when the newly selected model does not report it", () => {
    render(
      <Composer sources={{ instances: [claudeInstance()] }} onSend={vi.fn()} />
    )

    fireEvent.change(selectByControl("effort"), { target: { value: "high" } })
    expect(selectByControl("effort").value).toBe("high")

    fireEvent.change(selectByControl("model"), {
      target: { value: "claude-haiku-4-5" },
    })

    expect(
      document.querySelector('[data-control-id="effort"]')
    ).not.toBeInTheDocument()
  })

  it("blocks sending on an unauthenticated instance and says what to do", () => {
    render(
      <Composer
        sources={{
          instances: [claudeInstance({ auth: { status: "unauthenticated" } })],
        }}
        onSend={vi.fn()}
      />
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      /Sign in to this harness/
    )
    expect(screen.getByLabelText("Message")).toBeDisabled()
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled()
  })

  it("leaves an already-sent selection alone when the composer changes afterwards", () => {
    const onSend = vi.fn()
    render(
      <Composer sources={{ instances: [claudeInstance()] }} onSend={onSend} />
    )

    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "first" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    const sent = onSend.mock.calls[0]![0]

    fireEvent.change(selectByControl("effort"), { target: { value: "high" } })
    fireEvent.change(selectByControl("model"), {
      target: { value: "claude-haiku-4-5" },
    })

    // The captured selection travels with the message; the composer moving on
    // must not rewrite what was already dispatched.
    expect(sent.execution).toEqual({
      instanceId: "claude",
      driver: "claudeAgent",
      model: { modelId: "claude-opus-5" },
      interactionMode: "build",
      options: { effort: "medium" },
    })
  })

  it("clears the message but keeps the controls after a send", () => {
    render(
      <Composer sources={{ instances: [claudeInstance()] }} onSend={vi.fn()} />
    )

    fireEvent.change(selectByControl("effort"), { target: { value: "high" } })
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "go" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))

    expect(screen.getByLabelText("Message")).toHaveValue("")
    expect(selectByControl("effort").value).toBe("high")
  })

  it("disables every control while a command is in flight", () => {
    render(
      <Composer
        sources={{ instances: [claudeInstance()] }}
        disabled
        onSend={vi.fn()}
      />
    )

    expect(selectByControl("model")).toBeDisabled()
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled()
  })
})
