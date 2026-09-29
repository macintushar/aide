import { describe, expect, it } from "vitest"

import {
  fileLink,
  filterSlashEntries,
  insertFileLink,
  mentionAt,
  parseSend,
  slashEntries,
  slashQuery,
} from "../composer-text"

const entries = slashEntries(
  [
    { name: "review", description: "Review changes", argumentHint: "<pr>" },
    { name: "compact" },
  ],
  [{ id: "pdf", name: "pdf", description: "Work with PDFs" }]
)

describe("slash commands", () => {
  it("opens only while the name is being typed", () => {
    expect(slashQuery("/")).toBe("")
    expect(slashQuery("/rev")).toBe("rev")
    expect(slashQuery("/review ")).toBeUndefined()
    expect(slashQuery("hello /rev")).toBeUndefined()
  })

  it("lists prefix matches before substring matches", () => {
    expect(filterSlashEntries(entries, "p").map((entry) => entry.name)).toEqual(
      ["pdf", "compact"]
    )
  })

  it("turns an offered name into an invocation with the rest as arguments", () => {
    expect(parseSend("/review  42 ", entries)).toEqual({
      content: "42",
      invocation: { kind: "command", name: "review" },
    })
    expect(parseSend("/pdf", entries)).toEqual({
      content: "",
      invocation: { kind: "skill", name: "pdf" },
    })
    // A slash the instance does not offer is just text.
    expect(parseSend("/etc/hosts is odd", entries)).toEqual({
      content: "/etc/hosts is odd",
    })
  })
})

describe("file links", () => {
  it("finds the @ token that ends at the caret", () => {
    expect(mentionAt("see @src/ma", 11)).toEqual({
      query: "src/ma",
      start: 4,
      end: 11,
    })
    expect(mentionAt("mail me@example.com", 19)).toBeUndefined()
    expect(mentionAt("@", 1)).toEqual({ query: "", start: 0, end: 1 })
  })

  it("replaces the token with a relative Markdown link", () => {
    const token = mentionAt("look at @butt please", 13)!
    expect(
      insertFileLink("look at @butt please", token, {
        path: "src/components/Button.tsx",
        name: "Button.tsx",
      })
    ).toEqual({
      text: "look at [Button.tsx](src/components/Button.tsx)  please",
      caret: 48,
    })
  })

  it("keeps paths with spaces intact", () => {
    expect(fileLink({ path: "docs/my notes.md", name: "my notes.md" })).toBe(
      "[my notes.md](<docs/my notes.md>)"
    )
  })
})
