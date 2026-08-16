import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Button } from "./button"

describe("Button", () => {
  it("renders children with the default variant and size", () => {
    render(<Button>Save</Button>)

    const button = screen.getByRole("button", { name: "Save" })
    expect(button).toBeInTheDocument()
    expect(button).toHaveClass("bg-primary", "h-8")
  })

  it("applies variant and size classes", () => {
    render(
      <Button variant="destructive" size="sm">
        Delete
      </Button>
    )

    const button = screen.getByRole("button", { name: "Delete" })
    expect(button).toHaveClass("bg-destructive/10", "h-7")
  })

  it("calls onClick when clicked", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Click me</Button>)

    await user.click(screen.getByRole("button", { name: "Click me" }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("ignores clicks when disabled", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Click me
      </Button>
    )

    const button = screen.getByRole("button", { name: "Click me" })
    expect(button).toBeDisabled()

    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
})
