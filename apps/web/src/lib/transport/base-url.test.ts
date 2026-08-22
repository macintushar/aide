import { describe, expect, it } from "vitest"

import { apiBaseUrl } from "./base-url"

describe("apiBaseUrl", () => {
  it("uses the Vite /api proxy during development", () => {
    expect(apiBaseUrl()).toBe("/api")
  })
})
