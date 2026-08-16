export type WorkspaceErrorInput = {
  code: string
  message: string
  retryable: boolean
  detail?: unknown
}

export class WorkspaceError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly detail?: unknown

  constructor(input: WorkspaceErrorInput) {
    super(input.message)
    this.name = "WorkspaceError"
    this.code = input.code
    this.retryable = input.retryable
    if (input.detail !== undefined) {
      this.detail = input.detail
    }
  }
}
