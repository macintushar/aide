import {
  instancesSnapshotFixture,
  sessionSnapshotFixture,
  type GlobalConfigRecord,
} from "@workspace/contracts"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { App } from "./App"

const config: GlobalConfigRecord = {
  instances: {},
  mcpServers: {},
  defaults: {},
}

describe("App", () => {
  it("mounts the live instances and settings surfaces", async () => {
    render(
      <App
        readClient={{
          getInstances: vi.fn(async () => instancesSnapshotFixture()),
          getSession: vi.fn(async () => sessionSnapshotFixture()),
          getConfig: vi.fn(async () => config),
          getProjectConfig: vi.fn(),
        }}
        commandClient={{ send: vi.fn() }}
        subscribeInstances={() => ({ close: vi.fn() })}
      />
    )

    expect(screen.getByRole("heading", { name: "Aide" })).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Instances" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Settings" })
    ).toBeInTheDocument()
    expect(
      (await screen.findAllByTestId("instance-status"))[0]
    ).toBeInTheDocument()
    expect(
      await screen.findByRole("button", { name: "Save settings" })
    ).toBeInTheDocument()
    expect(
      screen.queryByText("Implement the settings panel.")
    ).not.toBeInTheDocument()
  })
})
