import { z } from "zod"

/**
 * Driver-specific configuration for a Claude Agent SDK instance.
 *
 * Two instances of this driver typically differ by account or by executable, so
 * those are the fields worth exposing; everything else the SDK resolves itself.
 */
export const claudeConfigSchema = z
  .strictObject({
    /** Working directory when a send is not project-scoped. */
    cwd: z.string().min(1).optional(),
    /** Model applied at query open. A send may override it per turn. */
    model: z.string().min(1).optional(),
    /** Path to the Claude Code executable, for a pinned or side-by-side install. */
    executable: z.string().min(1).optional(),
    /** Extra environment for the spawned runtime — how a second account is selected. */
    env: z.record(z.string(), z.string()).optional(),
    /** Skip the pinned-version compatibility check. */
    allowVersionMismatch: z.boolean().optional(),
    /** How long to wait for the runtime to report `system/init`. */
    startupTimeoutMs: z.number().int().min(1_000).max(600_000).optional(),
  })
  .strict()

export type ClaudeInstanceConfig = z.infer<typeof claudeConfigSchema>

/** Pinned exactly until an explicit adapter compatibility update. */
export const PINNED_CLAUDE_SDK_VERSION = "0.3.228"

/** The Claude Code runtime line this SDK version ships against. */
export const SUPPORTED_CLAUDE_RUNTIME_MAJOR = 2

export function isCompatibleRuntimeVersion(version: string): boolean {
  const match = /^(\d+)\./.exec(version.trim())
  if (!match) return false
  return Number(match[1]) === SUPPORTED_CLAUDE_RUNTIME_MAJOR
}

export const DEFAULT_STARTUP_TIMEOUT_MS = 30_000

/**
 * `interactionMode` maps to the SDK's `PermissionMode`. Agent selection is a
 * different axis — `options.agents` defines subagents the main loop delegates
 * to — so this adapter reports `agentSelection: false` and offers modes instead.
 */
export const INTERACTION_MODE_TO_PERMISSION_MODE = {
  build: "default",
  plan: "plan",
} as const

export type AideInteractionMode =
  keyof typeof INTERACTION_MODE_TO_PERMISSION_MODE
