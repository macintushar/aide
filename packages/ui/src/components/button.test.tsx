import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Button, IconButton } from "./button"
import { TooltipProvider } from "./tooltip"

describe("IconButton", () => {
  it("uses its label as the accessible name so a symbol never ships bare", () => {
    render(
      <IconButton label="Hide sidebar">
        <svg aria-hidden="true" />
      </IconButton>
    )

    expect(
      screen.getByRole("button", { name: "Hide sidebar" })
    ).toBeInTheDocument()
  })

  it("surfaces the same text on hover", async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider delay={0}>
        <IconButton label="New session">
          <svg aria-hidden="true" />
        </IconButton>
      </TooltipProvider>
    )

    await user.hover(screen.getByRole("button", { name: "New session" }))
    expect(await screen.findByText("New session")).toHaveAttribute(
      "data-slot",
      "tooltip-content"
    )
  })
})

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
