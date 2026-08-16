import type { AideError } from "@workspace/contracts"

export class CoreServiceError extends Error {
  readonly aideError: AideError

  constructor(
    code: string,
    message: string,
    retryable = false,
    detail?: unknown
  ) {
    super(message)
    this.name = "CoreServiceError"
    this.aideError = {
      code,
      message,
      retryable,
      ...(detail === undefined ? {} : { detail }),
    }
  }
}
