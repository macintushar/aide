import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import {
  CommandPalette,
  matchesQuery,
  type PaletteItem,
} from "../command-palette"

function items(run = vi.fn()): PaletteItem[] {
  return [
    {
      id: "s1",
      group: "Sessions",
      label: "Rate-limit the API",
      detail: "aide",
      run: () => run("s1"),
    },
    {
      id: "s2",
      group: "Sessions",
      label: "Fix flaky test",
      detail: "warrant",
      run: () => run("s2"),
    },
    {
      id: "settings",
      group: "Actions",
      label: "Open settings",
      run: () => run("settings"),
    },
  ]
}

describe("matchesQuery", () => {
  it("needs every word somewhere in the label, detail or group", () => {
    const [first] = items()
    expect(matchesQuery(first!, "rate aide")).toBe(true)
    expect(matchesQuery(first!, "rate warrant")).toBe(false)
    expect(matchesQuery(first!, "SESSIONS")).toBe(true)
  })
})

describe("CommandPalette", () => {
  it("filters as you type and runs the highlighted entry on Enter", () => {
    const run = vi.fn()
    const onClose = vi.fn()
    render(<CommandPalette items={items(run)} onClose={onClose} />)

    const input = screen.getByRole("combobox", {
      name: "Search sessions and actions",
    })
    expect(input).toHaveFocus()
    fireEvent.change(input, { target: { value: "flaky" } })
    expect(screen.getAllByRole("option")).toHaveLength(1)
    fireEvent.keyDown(input, { key: "Enter" })

    expect(onClose).toHaveBeenCalled()
    expect(run).toHaveBeenCalledWith("s2")
  })

  it("moves the highlight with the arrow keys", () => {
    const run = vi.fn()
    render(<CommandPalette items={items(run)} onClose={vi.fn()} />)
    const input = screen.getByRole("combobox")

    fireEvent.keyDown(input, { key: "ArrowDown" })
    fireEvent.keyDown(input, { key: "ArrowDown" })
    expect(screen.getAllByRole("option")[2]).toHaveAttribute(
      "aria-selected",
      "true"
    )
    fireEvent.keyDown(input, { key: "ArrowUp" })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(run).toHaveBeenCalledWith("s2")
  })

  it("offers to open a pasted session id", () => {
    const opened = vi.fn()
    render(
      <CommandPalette
        items={items()}
        onClose={vi.fn()}
        openById={(id) => ({
          id: `open:${id}`,
          group: "Open by ID",
          label: `Open ${id}`,
          run: () => opened(id),
        })}
      />
    )
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "session_abc123" },
    })
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" })
    expect(opened).toHaveBeenCalledWith("session_abc123")
  })

  it("closes on Escape", () => {
    const onClose = vi.fn()
    render(<CommandPalette items={items()} onClose={onClose} />)
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" })
    expect(onClose).toHaveBeenCalled()
  })
})
