export type RepoErrorCode =
  | "corrupt_json"
  | "corrupt_record"
  | "ephemeral_event"

export class RepoError extends Error {
  readonly code: RepoErrorCode
  readonly retryable: boolean
  readonly detail?: unknown

  constructor(
    code: RepoErrorCode,
    message: string,
    retryable = false,
    detail?: unknown
  ) {
    super(message)
    this.name = "RepoError"
    this.code = code
    this.retryable = retryable
    this.detail = detail
  }
}
