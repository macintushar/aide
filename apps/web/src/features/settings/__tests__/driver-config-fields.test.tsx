import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { emptyDraft } from ".././config-draft"
import { formatEnv, parseEnv } from ".././driver-config-fields"
import { SettingsForm } from ".././settings-form"

function withInstance(driver: "opencode" | "claudeAgent", config = {}) {
  return {
    ...emptyDraft(),
    instances: [
      { instanceId: "one", driver, enabled: true, autoStart: true, config },
    ],
  }
}

describe("Driver config fields", () => {
  it("writes OpenCode fields into the instance config", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <SettingsForm
        target={{ kind: "global" }}
        initial={withInstance("opencode")}
        onSubmit={onSubmit}
      />
    )
    await user.type(
      screen.getByRole("textbox", { name: "Server URL" }),
      "http://127.0.0.1:4096"
    )
    await user.click(
      screen.getByRole("checkbox", { name: "Allow version mismatch" })
    )
    await user.click(screen.getByRole("button", { name: "Save settings" }))

    const [payload] = onSubmit.mock.calls[0]!
    expect(payload.instances.one.config).toEqual({
      baseUrl: "http://127.0.0.1:4096",
      allowVersionMismatch: true,
    })
  })

  it("shows Claude fields and resets config when the driver changes", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <SettingsForm
        target={{ kind: "global" }}
        initial={withInstance("opencode", { baseUrl: "http://x" })}
        onSubmit={onSubmit}
      />
    )
    await user.selectOptions(screen.getByRole("combobox", { name: /Driver/ }), [
      "claudeAgent",
    ])
    expect(screen.queryByRole("textbox", { name: "Server URL" })).toBeNull()
    await user.type(
      screen.getByRole("textbox", { name: "Startup timeout (ms)" }),
      "5000"
    )
    await user.type(
      screen.getByRole("textbox", { name: "Environment" }),
      "CLAUDE_CONFIG_DIR=/acct"
    )
    await user.click(screen.getByRole("button", { name: "Save settings" }))

    const [payload] = onSubmit.mock.calls[0]!
    expect(payload.instances.one.config).toEqual({
      startupTimeoutMs: 5000,
      env: { CLAUDE_CONFIG_DIR: "/acct" },
    })
  })

  it("round-trips env text", () => {
    expect(parseEnv("A=1\n# note\n\nB=x=y\nbad")).toEqual({ A: "1", B: "x=y" })
    expect(parseEnv("  ")).toBeUndefined()
    expect(formatEnv({ A: "1", B: "2" })).toBe("A=1\nB=2")
  })
})
