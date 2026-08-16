import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { App } from "./App"

describe("App", () => {
  it("renders the fixture session transcript and requests", () => {
    render(<App />)

    expect(screen.getByRole("heading", { name: "Aide" })).toBeInTheDocument()
    expect(
      screen.getByText("Implement the settings panel.")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Requests" })
    ).toBeInTheDocument()
    expect(screen.getByText("Run bun test?")).toBeInTheDocument()
  })
})
