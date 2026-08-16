/**
 * Capped exponential backoff for instance restarts. Repeated failure moves the
 * instance to `failed` with the last error retained rather than retrying
 * forever.
 */

export type BackoffPolicy = {
  /** Delay before the first retry. */
  readonly baseMs: number
  /** Ceiling on the computed delay. */
  readonly maxMs: number
  /** Retries after the initial attempt before the instance is `failed`. */
  readonly maxAttempts: number
}

export const DEFAULT_BACKOFF: BackoffPolicy = {
  baseMs: 500,
  maxMs: 30_000,
  maxAttempts: 5,
}

/** `attempt` is 1-based: the delay before retry number `attempt`. */
export function backoffDelay(attempt: number, policy: BackoffPolicy): number {
  const exponent = Math.max(0, attempt - 1)
  return Math.min(policy.baseMs * 2 ** exponent, policy.maxMs)
}

export function shouldRetry(attempt: number, policy: BackoffPolicy): boolean {
  return attempt <= policy.maxAttempts
}
