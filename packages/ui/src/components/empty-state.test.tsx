import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { EmptyState } from "./empty-state"

describe("EmptyState", () => {
  it("renders the title and optional description", () => {
    render(<EmptyState title="No messages yet" description="Send the first." />)

    expect(screen.getByText("No messages yet")).toBeInTheDocument()
    expect(screen.getByText("Send the first.")).toBeInTheDocument()
  })

  it("omits the description when there is nothing to add", () => {
    const { container } = render(<EmptyState title="No turns yet" />)
    expect(container.querySelectorAll("p")).toHaveLength(1)
  })
})
