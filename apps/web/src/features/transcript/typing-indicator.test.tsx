import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { TypingIndicator } from "./typing-indicator"

describe("TypingIndicator", () => {
  it("announces itself as a polite status without readable text", () => {
    render(<TypingIndicator />)

    expect(
      screen.getByRole("status", { name: "Assistant is typing" })
    ).toBeInTheDocument()
  })
})
