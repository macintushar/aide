import { describe, expect, it } from "vitest"

import { CONTRACTS_SCHEMA_VERSION } from "./contracts"

describe("contracts wiring", () => {
  it("imports the shared schema version", () => {
    expect(CONTRACTS_SCHEMA_VERSION).toBe(1)
  })
})
