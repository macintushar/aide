import {
  RiGitBranchLine,
  RiPulseLine,
  RiStackLine,
  type RemixiconComponentType,
} from "@remixicon/react"

/**
 * Surfaces the right panel can show. Adding one is an entry here, not a change
 * to the panel — the same "config, not UI branching" rule PLAN.md applies to
 * harnesses.
 */
export const SURFACE_IDS = ["activity", "instances", "changes"] as const

export type SurfaceId = (typeof SURFACE_IDS)[number]

export type SurfaceDefinition = {
  id: SurfaceId
  label: string
  /** Single-key shortcut, active while the panel is open. */
  shortcut: string
  description: string
  icon: RemixiconComponentType
  /** Unavailable surfaces stay visible but inert, so the shape is discoverable. */
  available: boolean
  unavailableReason?: string
}

export const SURFACES: SurfaceDefinition[] = [
  {
    id: "activity",
    label: "Activity",
    shortcut: "a",
    description: "Turns in this session and how each one ended.",
    icon: RiPulseLine,
    available: true,
  },
  {
    id: "instances",
    label: "Instances",
    shortcut: "i",
    description: "Configured harnesses, their health, and auth.",
    icon: RiStackLine,
    available: true,
  },
  {
    id: "changes",
    label: "Changes",
    shortcut: "c",
    description: "Workspace changes and diffs for this project.",
    icon: RiGitBranchLine,
    available: false,
    unavailableReason: "Arrives with the workspace track.",
  },
]

export function findSurface(id: SurfaceId): SurfaceDefinition {
  const surface = SURFACES.find((candidate) => candidate.id === id)
  if (!surface) throw new Error(`Unknown surface: ${id}`)
  return surface
}

export function isSurfaceId(value: unknown): value is SurfaceId {
  return SURFACE_IDS.includes(value as SurfaceId)
}
