import { z } from "zod"

/**
 * Driver-specific configuration for an OpenCode instance.
 *
 * `config` is opaque to everything except this adapter; this schema is what the
 * adapter exports so the config service can validate an instance at load and
 * disable only that instance when it is malformed.
 */
export const opencodeConfigSchema = z
  .strictObject({
    /**
     * Connect to an already-running OpenCode server instead of managing one.
     * A self-hosted deployment is the reason two OpenCode instances differ.
     */
    baseUrl: z.string().min(1).optional(),
    /**
     * Session database for the in-process host. Defaults to a file next to
     * Aide's own database; OpenCode would otherwise keep sessions in memory.
     */
    databasePath: z.string().min(1).optional(),
    /** Fallback working directory when a send is not project-scoped. */
    directory: z.string().min(1).optional(),
    /** Skip the pinned-version compatibility check. */
    allowVersionMismatch: z.boolean().optional(),
  })
  .refine((value) => !(value.baseUrl && value.databasePath), {
    message:
      "baseUrl cannot be combined with databasePath: either Aide hosts OpenCode or it connects to yours",
  })

export type OpencodeInstanceConfig = z.infer<typeof opencodeConfigSchema>

/**
 * The SDK version this adapter is written against. Pinned exactly until an
 * explicit adapter compatibility update, together with the fixtures that encode
 * the generated event discriminants.
 */
export const PINNED_OPENCODE_SDK_VERSION = "2.0.18"

/**
 * The adapter targets one OpenCode minor line. A runtime outside it is an
 * actionable error rather than a best-effort attempt against unknown wire
 * shapes.
 */
export const SUPPORTED_OPENCODE_RUNTIME_RANGE = { major: 2, minor: 0 } as const

export function isCompatibleRuntimeVersion(version: string): boolean {
  const match = /^(\d+)\.(\d+)\./.exec(version.trim())
  if (!match) return false
  return (
    Number(match[1]) === SUPPORTED_OPENCODE_RUNTIME_RANGE.major &&
    Number(match[2]) >= SUPPORTED_OPENCODE_RUNTIME_RANGE.minor
  )
}
