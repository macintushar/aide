import {
  eventFixtures,
  instancesSnapshotFixture,
  type InstancesSnapshot,
} from "@workspace/contracts"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { InstancesEventsOptions } from "@/lib/transport/event-source"

import { InstancesBoundary } from "./instances-boundary"

describe("InstancesBoundary", () => {
  it("loads a snapshot, subscribes from its cursor, and applies named events", async () => {
    const snapshot = fixture({ cursor: { sequence: 23 } })
    let options: InstancesEventsOptions | undefined
    const subscribe = vi.fn((next: InstancesEventsOptions) => {
      options = next
      return { close: vi.fn() }
    })

    render(
      <InstancesBoundary
        readClient={{ getInstances: vi.fn(async () => snapshot) }}
        commandClient={{ send: vi.fn() }}
        subscribe={subscribe}
      />
    )

    expect(screen.getByText("Loading harness instances…")).toBeInTheDocument()
    expect(
      (await screen.findAllByTestId("instance-status"))[0]
    ).toHaveTextContent("Ready")
    expect(subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ afterSequence: 23 })
    )

    const disconnected = eventFixtures().find(
      (event) => event.type === "harness.disconnected"
    )!
    act(() => options?.onEvent(disconnected))
    expect(screen.getAllByTestId("instance-status")[0]).toHaveTextContent(
      "Stopped"
    )
  })

  it("sends lifecycle commands and waits for events to change state", async () => {
    const user = userEvent.setup()
    const send = vi.fn(async () => ({}) as never)
    render(
      <InstancesBoundary
        readClient={{ getInstances: vi.fn(async () => fixture()) }}
        commandClient={{ send }}
        subscribe={() => ({ close: vi.fn() })}
      />
    )

    await user.click(await screen.findByRole("button", { name: "Stop" }))
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "instance.stop",
        instanceId: fixture().instances[0]!.instanceId,
      })
    )
    expect(screen.getAllByTestId("instance-status")[0]).toHaveTextContent(
      "Ready"
    )
  })

  it("refetches the authoritative snapshot after config.updated", async () => {
    const updated = fixture({ instances: [] })
    const getInstances = vi
      .fn()
      .mockResolvedValueOnce(fixture())
      .mockResolvedValueOnce(updated)
    let options: InstancesEventsOptions | undefined
    render(
      <InstancesBoundary
        readClient={{ getInstances }}
        commandClient={{ send: vi.fn() }}
        subscribe={(next) => {
          options = next
          return { close: vi.fn() }
        }}
      />
    )
    await screen.findAllByTestId("instance-status")

    const configUpdated = eventFixtures().find(
      (event) => event.type === "config.updated"
    )!
    act(() => options?.onEvent(configUpdated))

    await waitFor(() => expect(getInstances).toHaveBeenCalledTimes(2))
    expect(
      await screen.findByText(/No harness instances are configured/)
    ).toBeInTheDocument()
  })

  it("surfaces initial load failures with a retry action", async () => {
    render(
      <InstancesBoundary
        readClient={{
          getInstances: vi.fn(async () => Promise.reject(new Error("offline"))),
        }}
        commandClient={{ send: vi.fn() }}
        subscribe={() => ({ close: vi.fn() })}
      />
    )

    expect(await screen.findByRole("alert")).toHaveTextContent("offline")
    expect(
      screen.getByRole("button", { name: "Try again" })
    ).toBeInTheDocument()
  })
})

function fixture(
  overrides: Partial<InstancesSnapshot> = {}
): InstancesSnapshot {
  return { ...instancesSnapshotFixture(), ...overrides }
}
