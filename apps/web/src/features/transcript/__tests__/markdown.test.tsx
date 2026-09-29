import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { isFileLink, Markdown } from ".././markdown"

describe("Markdown", () => {
  it("renders emphasis, lists and code", () => {
    render(<Markdown text={"**bold** text\n\n- one\n- two\n\n`code`"} />)
    expect(screen.getByText("bold").tagName).toBe("STRONG")
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
    expect(screen.getByText("code").tagName).toBe("CODE")
  })

  it("escapes raw HTML instead of rendering it", () => {
    const { container } = render(
      <Markdown text={"<img src=x onerror=alert(1)>"} />
    )
    expect(container.querySelector("img")).toBeNull()
  })

  it("opens relative file links in the preview", async () => {
    const user = userEvent.setup()
    const onOpenFile = vi.fn()
    render(
      <Markdown text={"See [the app](src/App.tsx)."} onOpenFile={onOpenFile} />
    )
    await user.click(screen.getByRole("button", { name: "the app" }))
    expect(onOpenFile).toHaveBeenCalledWith("src/App.tsx")
  })

  it("opens web links in a new tab", () => {
    render(
      <Markdown text={"[docs](https://example.com)"} onOpenFile={vi.fn()} />
    )
    const link = screen.getByRole("link", { name: "docs" })
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"))
  })

  it("tells file links from web and anchor links", () => {
    expect(isFileLink("src/a.ts")).toBe(true)
    expect(isFileLink("https://example.com")).toBe(false)
    expect(isFileLink("mailto:a@b.c")).toBe(false)
    expect(isFileLink("#heading")).toBe(false)
    expect(isFileLink(undefined)).toBe(false)
  })
})
