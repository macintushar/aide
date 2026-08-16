import type { GlobalConfigRecord } from "@workspace/contracts"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { SettingsBoundary } from "./settings-boundary"

const config: GlobalConfigRecord = {
  projectsDirectory: "/workspace",
  instances: {},
  mcpServers: {},
  defaults: {},
}

describe("SettingsBoundary", () => {
  it("loads raw config, converts it to a draft, and submits config.update", async () => {
    const user = userEvent.setup()
    const send = vi.fn(async () => ({}) as never)
    render(
      <SettingsBoundary
        readClient={{
          getConfig: vi.fn(async () => config),
          getProjectConfig: vi.fn(),
        }}
        commandClient={{ send }}
      />
    )

    expect(screen.getByText("Loading settings…")).toBeInTheDocument()
    expect(await screen.findByDisplayValue("/workspace")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Save settings" }))

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "config.update",
        target: { kind: "global" },
        config: expect.objectContaining({ instances: {}, mcpServers: {} }),
      })
    )
    expect(await screen.findByText("Settings saved.")).toBeInTheDocument()
  })

  it("surfaces config load and save errors", async () => {
    const { rerender } = render(
      <SettingsBoundary
        readClient={{
          getConfig: vi.fn(async () =>
            Promise.reject(new Error("missing route"))
          ),
          getProjectConfig: vi.fn(),
        }}
        commandClient={{ send: vi.fn() }}
      />
    )
    expect(await screen.findByRole("alert")).toHaveTextContent("missing route")

    const user = userEvent.setup()
    rerender(
      <SettingsBoundary
        readClient={{
          getConfig: vi.fn(async () => config),
          getProjectConfig: vi.fn(),
        }}
        commandClient={{
          send: vi.fn(async () => Promise.reject(new Error("denied"))),
        }}
      />
    )
    await screen.findByDisplayValue("/workspace")
    await user.click(screen.getByRole("button", { name: "Save settings" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("denied")
  })
})
