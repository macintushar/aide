import type { DriverId } from "@workspace/contracts"
import claudeMark from "@workspace/ui/assets/harnesses/claude.svg"
import opencodeMark from "@workspace/ui/assets/harnesses/opencode.svg"

/**
 * The only place aide maps a driver to its vendor mark. DESIGN §4.3 wants this
 * to come from the adapter capability descriptor's `icon` field instead — when
 * that contracts change lands, this table collapses into reading the
 * descriptor, and nothing else has to move.
 */
const HARNESS_MARKS: Record<DriverId, string> = {
  opencode: opencodeMark,
  claudeAgent: claudeMark,
}

export function harnessMarkFor(driver: DriverId): string {
  return HARNESS_MARKS[driver]
}
