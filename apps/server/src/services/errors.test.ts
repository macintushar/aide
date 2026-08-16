import { describe, expect, it } from "vitest"

import { CoreServiceError } from "./errors"

describe("CoreServiceError", () => {
  it("exposes Error and AideError fields with defaults", () => {
    const error = new CoreServiceError("missing", "Not found")

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe("CoreServiceError")
    expect(error.message).toBe("Not found")
    expect(error.aideError).toEqual({
      code: "missing",
      message: "Not found",
      retryable: false,
    })
  })

  it("preserves retryability and defined detail", () => {
    const detail = { instanceId: "primary" }
    const error = new CoreServiceError("offline", "Offline", true, detail)

    expect(error.aideError).toEqual({
      code: "offline",
      message: "Offline",
      retryable: true,
      detail,
    })
  })
})
