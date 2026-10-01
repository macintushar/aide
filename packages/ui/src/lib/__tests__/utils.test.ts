import { describe, expect, it } from "vitest"

import { cn } from "../utils"

describe("cn", () => {
  it("keeps a type role beside a text colour", () => {
    expect(cn("text-ui", "text-foreground")).toBe("text-ui text-foreground")
    expect(cn("text-small text-[var(--n6)]")).toBe(
      "text-small text-[var(--n6)]"
    )
  })

  it("still lets a later type role win over an earlier one", () => {
    expect(cn("text-ui", "text-small")).toBe("text-small")
  })
})
