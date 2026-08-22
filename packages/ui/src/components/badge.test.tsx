import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Badge } from "./badge"

describe("Badge", () => {
  it("defaults to the neutral tone", () => {
    render(<Badge>queued</Badge>)
    expect(screen.getByText("queued")).toHaveClass("text-[var(--n6)]")
  })

  it("carries status tone through tokens, never a raw palette color", () => {
    render(<Badge tone="warn">awaiting</Badge>)
    const badge = screen.getByText("awaiting")

    expect(badge).toHaveClass("bg-warn/12", "text-warn")
    expect(badge.className).not.toMatch(/amber|yellow|orange/)
  })
})
