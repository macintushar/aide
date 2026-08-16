export type ArtifactErrorCode = "invalid_artifact" | "artifact_too_large"

export class ArtifactError extends Error {
  readonly code: ArtifactErrorCode
  readonly retryable = false
  readonly detail?: unknown

  constructor(code: ArtifactErrorCode, message: string, detail?: unknown) {
    super(message)
    this.name = "ArtifactError"
    this.code = code
    if (detail !== undefined) this.detail = detail
  }
}
