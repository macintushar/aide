import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { AideLockup, AideMark, AideTile, AideWordmark } from "../logo"

describe("AideMark", () => {
  it("thickens the stroke and pulls the legs in at 16px", () => {
    const { container } = render(<AideMark size={16} />)
    const [legs, bar] = [...container.querySelectorAll("path")]

    expect(legs).toHaveAttribute("stroke-width", "4.2")
    expect(legs).toHaveAttribute("d", "M6.5 26 L16 6.5 L25.5 26")
    expect(bar).toHaveAttribute("d", "M11.5 19 H20.5")
  })

  it("uses the 20px drawing between 18px and 26px", () => {
    const { container } = render(<AideMark size={20} />)
    const [legs] = [...container.querySelectorAll("path")]

    expect(legs).toHaveAttribute("stroke-width", "3.6")
    expect(legs).toHaveAttribute("d", "M6 26 L16 6 L26 26")
  })

  it("uses the full drawing at 32px and above", () => {
    const { container } = render(<AideMark size={64} />)
    const [legs] = [...container.querySelectorAll("path")]

    expect(legs).toHaveAttribute("stroke-width", "3.2")
  })

  it("renders at the requested size", () => {
    render(<AideMark size={48} />)
    const mark = screen.getByRole("img", { name: "aide" })

    expect(mark).toHaveAttribute("width", "48")
    expect(mark).toHaveAttribute("height", "48")
  })
})

describe("AideTile", () => {
  it("paints a flat accent tile with no ids that could collide", () => {
    const { container } = render(
      <>
        <AideTile />
        <AideTile />
      </>
    )

    expect(container.querySelectorAll("[id]")).toHaveLength(0)
    for (const rect of container.querySelectorAll("rect")) {
      expect(rect).toHaveClass("fill-[var(--accent-base)]")
    }
  })
})

describe("AideWordmark", () => {
  it("is always lowercase", () => {
    render(<AideWordmark />)
    expect(screen.getByText("aide")).toBeInTheDocument()
  })
})

describe("AideLockup", () => {
  it("gaps the mark and wordmark by three stroke widths", () => {
    const { container } = render(<AideLockup size={20} />)
    const lockup = container.querySelector('[data-slot="aide-lockup"]')

    // 20px mark → 3.6 stroke → 10.8px gap (§8.5).
    expect(lockup).toHaveStyle({ gap: "10.8px" })
  })
})
