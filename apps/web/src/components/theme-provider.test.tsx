import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"

import { ThemeProvider, useTheme } from "./theme-provider"

function ThemeConsumer() {
  const { theme } = useTheme()
  return <span data-testid="theme">{theme}</span>
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove("light", "dark")
  })

  it("defaults to the system theme and applies it to the document", () => {
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>
    )

    expect(screen.getByTestId("theme")).toHaveTextContent("system")
    // matchMedia is stubbed to light in src/test/setup.ts
    expect(document.documentElement).toHaveClass("light")
  })

  it("toggles between dark and light when pressing d", async () => {
    const user = userEvent.setup()
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>
    )

    await user.keyboard("d")
    expect(screen.getByTestId("theme")).toHaveTextContent("dark")
    expect(document.documentElement).toHaveClass("dark")
    expect(localStorage.getItem("theme")).toBe("dark")

    await user.keyboard("d")
    expect(screen.getByTestId("theme")).toHaveTextContent("light")
    expect(document.documentElement).toHaveClass("light")
    expect(localStorage.getItem("theme")).toBe("light")
  })

  it("restores a stored theme instead of the default", () => {
    localStorage.setItem("theme", "dark")

    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>
    )

    expect(screen.getByTestId("theme")).toHaveTextContent("dark")
    expect(document.documentElement).toHaveClass("dark")
  })
})
