import {
  instancesSnapshotFixture,
  sessionSnapshotFixture,
  type GlobalConfigRecord,
} from "@workspace/contracts"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { App } from "./App"
import { ThemeProvider } from "@/components/theme-provider"

const config: GlobalConfigRecord = {
  instances: {},
  mcpServers: {},
  defaults: {},
}

function renderApp() {
  return render(
    <ThemeProvider>
      <App
        authenticated
        readClient={{
          getInstances: vi.fn(async () => instancesSnapshotFixture()),
          getSession: vi.fn(async () => sessionSnapshotFixture()),
          getConfig: vi.fn(async () => config),
          getProjectConfig: vi.fn(),
        }}
        commandClient={{ send: vi.fn() }}
        subscribeInstances={() => ({ close: vi.fn() })}
        subscribeSession={() => ({ close: vi.fn() })}
      />
    </ThemeProvider>
  )
}

describe("App", () => {
  beforeEach(() => {
    localStorage.clear()
    window.location.hash = ""
  })

  it("opens on the welcome view with the panel closed", () => {
    renderApp()

    expect(
      screen.getByRole("heading", { name: "One conversation. Any agent." })
    ).toBeInTheDocument()
    expect(
      screen.getByText("Sessions you open show up here.")
    ).toBeInTheDocument()
    expect(screen.queryByText("Open a surface")).not.toBeInTheDocument()
  })

  it("opens the panel and mounts the instances surface", async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(screen.getByRole("button", { name: "Show panel" }))
    expect(screen.getByText("Open a surface")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Instances/ }))
    expect(
      (await screen.findAllByTestId("instance-status"))[0]
    ).toBeInTheDocument()
  })

  it("navigates to settings from the sidebar", async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(screen.getByRole("button", { name: "Settings" }))
    expect(
      await screen.findByRole("button", { name: "Save settings" })
    ).toBeInTheDocument()
  })
})
