import {
  instancesSnapshotFixture,
  inventoryFixture,
} from "@workspace/contracts"
import type { InstanceSnapshotEntry } from "@workspace/contracts"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { InstanceCard, InstancesPanel } from "./instances-panel"

function entry(
  overrides: Partial<InstanceSnapshotEntry> = {}
): InstanceSnapshotEntry {
  return {
    ...instancesSnapshotFixture().instances[0]!,
    instanceId: "opencode",
    displayName: "OpenCode",
    enabled: true,
    autoStart: true,
    status: "ready",
    version: "1.18.16",
    installed: true,
    auth: { status: "authenticated", type: "oauth", label: "Claude account" },
    inventory: undefined,
    error: undefined,
    ...overrides,
  }
}

describe("InstancesPanel", () => {
  it("explains the empty state instead of rendering nothing", () => {
    render(<InstancesPanel instances={[]} />)
    expect(
      screen.getByText(/No harness instances are configured/i)
    ).toBeInTheDocument()
  })

  it("renders one card per instance", () => {
    render(
      <InstancesPanel
        instances={[
          entry({ instanceId: "a", displayName: "A" }),
          entry({ instanceId: "b", displayName: "B" }),
        ]}
      />
    )
    expect(screen.getAllByTestId("instance-status")).toHaveLength(2)
  })
})

describe("InstanceCard", () => {
  it("shows status, driver, and version", () => {
    render(<InstanceCard instance={entry()} />)
    expect(screen.getByTestId("instance-status")).toHaveTextContent("Ready")
    expect(screen.getByText(/opencode · v1\.18\.16/)).toBeInTheDocument()
  })

  it("surfaces auth state and its label", () => {
    render(<InstanceCard instance={entry()} />)
    expect(screen.getByText("Signed in")).toBeInTheDocument()
    expect(screen.getByText(/Claude account/)).toBeInTheDocument()
  })

  it("shows an actionable message for an unauthenticated instance", () => {
    render(
      <InstanceCard instance={entry({ auth: { status: "unauthenticated" } })} />
    )
    expect(screen.getByText("Not signed in")).toBeInTheDocument()
    expect(
      screen.getByText(/Sign in to this harness to send/)
    ).toBeInTheDocument()
  })

  it("reports a failure error to assistive technology", () => {
    render(
      <InstanceCard
        instance={entry({
          status: "failed",
          error: {
            code: "start_failed",
            message: "OpenCode runtime is not installed",
            retryable: true,
          },
        })}
      />
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "OpenCode runtime is not installed"
    )
  })

  it("counts models and flags a stale inventory", () => {
    render(
      <InstanceCard
        instance={entry({
          status: "degraded",
          inventory: { ...inventoryFixture(), stale: true },
        })}
      />
    )
    expect(screen.getByText(/inventory stale/)).toBeInTheDocument()
    expect(screen.getByTestId("instance-status")).toHaveTextContent("Degraded")
  })

  it("says so when nothing has been discovered yet", () => {
    render(<InstanceCard instance={entry({ status: "configured" })} />)
    expect(screen.getByText(/No inventory discovered yet/)).toBeInTheDocument()
  })

  it("offers Stop while running and Start while not", () => {
    const { rerender } = render(<InstanceCard instance={entry()} />)
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument()

    rerender(<InstanceCard instance={entry({ status: "stopped" })} />)
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument()
  })

  it("disables Start for a disabled instance", () => {
    render(
      <InstanceCard
        instance={entry({ enabled: false, status: "configured" })}
      />
    )
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled()
  })

  it("disables inventory refresh unless the instance is running", () => {
    render(<InstanceCard instance={entry({ status: "stopped" })} />)
    expect(
      screen.getByRole("button", { name: "Refresh inventory" })
    ).toBeDisabled()
  })

  it("invokes the lifecycle actions with the instance id", async () => {
    const user = userEvent.setup()
    const actions = {
      onStop: vi.fn(),
      onRestart: vi.fn(),
      onRefreshInventory: vi.fn(),
    }
    render(<InstanceCard instance={entry()} actions={actions} />)

    await user.click(screen.getByRole("button", { name: "Stop" }))
    await user.click(screen.getByRole("button", { name: "Restart" }))
    await user.click(screen.getByRole("button", { name: "Refresh inventory" }))

    expect(actions.onStop).toHaveBeenCalledWith("opencode")
    expect(actions.onRestart).toHaveBeenCalledWith("opencode")
    expect(actions.onRefreshInventory).toHaveBeenCalledWith("opencode")
  })
})
