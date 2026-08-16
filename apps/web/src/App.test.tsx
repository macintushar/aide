import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { App } from "./App"

describe("App", () => {
  it("renders the ready message and example button", () => {
    render(<App />)

    expect(
      screen.getByRole("heading", { name: "Project ready!" })
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Button" })).toBeInTheDocument()
  })
})
