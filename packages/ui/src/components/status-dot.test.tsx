import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { StatusDot } from "./status-dot"

function dotIn(container: HTMLElement) {
  return container.querySelector('[data-slot="status-dot"]')
}

describe("StatusDot", () => {
  it("is decorative, so the label beside it is the only announcement", () => {
    const { container } = render(<StatusDot />)
    expect(dotIn(container)).toHaveAttribute("aria-hidden", "true")
  })

  it("animates only when pulsing, and drops the loop for reduced motion", () => {
    const { container } = render(<StatusDot tone="accent" pulse />)
    expect(dotIn(container)).toHaveClass(
      "animate-pulse-dot",
      "motion-reduce:animate-none"
    )
  })

  it("stays static otherwise", () => {
    const { container } = render(<StatusDot tone="idle" />)
    expect(dotIn(container)?.className).not.toMatch(/animate-pulse-dot/)
  })
})
