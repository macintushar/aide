import { describe, expect, it } from "vitest"

import * as contracts from "./index"

function isZodSchema(
  value: unknown
): value is { parse: (input: unknown) => unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "parse" in value &&
    typeof (value as { parse: unknown }).parse === "function"
  )
}

describe("schema surface", () => {
  it("locks exported schema names", () => {
    const names = Object.entries(contracts)
      .filter(([, value]) => isZodSchema(value))
      .map(([name]) => name)
      .sort()

    expect(names).toMatchSnapshot()
  })
})
