import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { emptyDraft, type ConfigDraft } from "./config-draft"
import { SettingsForm } from "./settings-form"

function draft(overrides: Partial<ConfigDraft> = {}): ConfigDraft {
  return { ...emptyDraft(), ...overrides }
}

describe("SettingsForm: instances CRUD", () => {
  it("adds an instance with sensible defaults", async () => {
    const user = userEvent.setup()
    render(<SettingsForm target={{ kind: "global" }} onSubmit={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "Add instance" }))

    expect(screen.getByDisplayValue("instance-1")).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: "Enabled" })).toBeChecked()
    expect(
      screen.getByRole("checkbox", { name: "Start at boot" })
    ).toBeChecked()
  })

  it("edits an instance id and driver", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <SettingsForm
        target={{ kind: "global" }}
        initial={draft({
          instances: [
            {
              instanceId: "one",
              driver: "opencode",
              enabled: true,
              autoStart: true,
              config: {},
            },
          ],
        })}
        onSubmit={onSubmit}
      />
    )

    const idField = screen.getByDisplayValue("one")
    await user.clear(idField)
    await user.type(idField, "renamed")
    await user.selectOptions(screen.getByRole("combobox", { name: /Driver/ }), [
      "claudeAgent",
    ])
    await user.click(screen.getByRole("button", { name: "Save settings" }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const [payload, target] = onSubmit.mock.calls[0]!
    expect(Object.keys(payload.instances)).toEqual(["renamed"])
    expect(payload.instances.renamed.driver).toBe("claudeAgent")
    expect(target).toEqual({ kind: "global" })
  })

  it("removes an instance", async () => {
    const user = userEvent.setup()
    render(
      <SettingsForm
        target={{ kind: "global" }}
        initial={draft({
          instances: [
            {
              instanceId: "gone",
              driver: "opencode",
              enabled: true,
              autoStart: true,
              config: {},
            },
          ],
        })}
        onSubmit={vi.fn()}
      />
    )

    await user.click(screen.getByRole("button", { name: "Remove instance" }))
    expect(screen.queryByDisplayValue("gone")).not.toBeInTheDocument()
  })

  it("toggles autoStart off for a lazily started instance", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <SettingsForm
        target={{ kind: "global" }}
        initial={draft({
          instances: [
            {
              instanceId: "lazy",
              driver: "opencode",
              enabled: true,
              autoStart: true,
              config: {},
            },
          ],
        })}
        onSubmit={onSubmit}
      />
    )

    await user.click(screen.getByRole("checkbox", { name: "Start at boot" }))
    await user.click(screen.getByRole("button", { name: "Save settings" }))

    expect(onSubmit.mock.calls[0]![0].instances.lazy).toMatchObject({
      enabled: true,
      autoStart: false,
    })
  })
})

describe("SettingsForm: MCP servers CRUD", () => {
  it("adds a server and switches its transport", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<SettingsForm target={{ kind: "global" }} onSubmit={onSubmit} />)

    await user.click(screen.getByRole("button", { name: "Add MCP server" }))
    await user.selectOptions(
      screen.getByRole("combobox", { name: /Transport/ }),
      ["http"]
    )
    await user.type(
      screen.getByRole("textbox", { name: /URL/ }),
      "https://example.test"
    )
    await user.click(screen.getByRole("button", { name: "Save settings" }))

    expect(onSubmit.mock.calls[0]![0].mcpServers).toEqual({
      "server-1": { type: "http", url: "https://example.test" },
    })
  })

  it("offers the Aide toolset transport", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<SettingsForm target={{ kind: "global" }} onSubmit={onSubmit} />)

    await user.click(screen.getByRole("button", { name: "Add MCP server" }))
    await user.selectOptions(
      screen.getByRole("combobox", { name: /Transport/ }),
      ["aide"]
    )
    await user.type(
      screen.getByRole("textbox", { name: /Toolset/ }),
      "workspace"
    )
    await user.click(screen.getByRole("button", { name: "Save settings" }))

    expect(onSubmit.mock.calls[0]![0].mcpServers["server-1"]).toEqual({
      type: "aide",
      toolset: "workspace",
    })
  })

  it("removes a server", async () => {
    const user = userEvent.setup()
    render(
      <SettingsForm
        target={{ kind: "global" }}
        initial={draft({
          mcpServers: [
            { name: "doomed", config: { type: "stdio", command: "x" } },
          ],
        })}
        onSubmit={vi.fn()}
      />
    )

    await user.click(screen.getByRole("button", { name: "Remove server" }))
    expect(screen.queryByDisplayValue("doomed")).not.toBeInTheDocument()
  })
})

describe("SettingsForm: project defaults", () => {
  it("titles the section for the project target", () => {
    render(
      <SettingsForm
        target={{ kind: "project", projectId: "proj_1" }}
        onSubmit={vi.fn()}
      />
    )
    expect(
      screen.getByRole("heading", { name: "Project defaults" })
    ).toBeInTheDocument()
  })

  it("submits against the project target", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <SettingsForm
        target={{ kind: "project", projectId: "proj_1" }}
        onSubmit={onSubmit}
      />
    )

    await user.click(screen.getByRole("button", { name: "Save settings" }))
    expect(onSubmit.mock.calls[0]![1]).toEqual({
      kind: "project",
      projectId: "proj_1",
    })
  })

  it("offers the configured instances as the default instance", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <SettingsForm
        target={{ kind: "global" }}
        initial={draft({
          instances: [
            {
              instanceId: "opencode",
              driver: "opencode",
              displayName: "OpenCode",
              enabled: true,
              autoStart: true,
              config: {},
            },
          ],
        })}
        onSubmit={onSubmit}
      />
    )

    await user.selectOptions(
      screen.getByRole("combobox", { name: /Default instance/ }),
      ["opencode"]
    )
    await user.click(screen.getByRole("button", { name: "Save settings" }))

    expect(onSubmit.mock.calls[0]![0].defaults).toEqual({
      instanceId: "opencode",
    })
  })
})

describe("SettingsForm: validation", () => {
  it("does not submit an invalid draft and explains why", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<SettingsForm target={{ kind: "global" }} onSubmit={onSubmit} />)

    // A freshly added stdio server has no command yet.
    await user.click(screen.getByRole("button", { name: "Add MCP server" }))
    await user.click(screen.getByRole("button", { name: "Save settings" }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toBeInTheDocument()
    expect(screen.getByText(/before saving/)).toBeInTheDocument()
  })

  it("stays quiet about issues until the first submit attempt", async () => {
    const user = userEvent.setup()
    render(<SettingsForm target={{ kind: "global" }} onSubmit={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "Add MCP server" }))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("submits once the issue is fixed", async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<SettingsForm target={{ kind: "global" }} onSubmit={onSubmit} />)

    await user.click(screen.getByRole("button", { name: "Add MCP server" }))
    await user.click(screen.getByRole("button", { name: "Save settings" }))
    expect(onSubmit).not.toHaveBeenCalled()

    await user.type(screen.getByRole("textbox", { name: /Command/ }), "mcp")
    await user.click(screen.getByRole("button", { name: "Save settings" }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]![0].mcpServers["server-1"]).toEqual({
      type: "stdio",
      command: "mcp",
    })
  })
})
