import type { SessionSummary } from "@workspace/contracts"
import { sessionFixture } from "@workspace/contracts"
import { describe, expect, it } from "vitest"

import {
  elapsed,
  formatCost,
  groupByLane,
  laneOf,
  relativeTime,
} from "../activity"

function summary(activity: SessionSummary["activity"]): SessionSummary {
  return {
    session: { ...sessionFixture(), id: `session_${activity}` },
    project: { id: "proj_1", name: "aide", directory: "/code/aide" },
    activity,
    openRequests: activity === "needs_input" ? 1 : 0,
    turnCount: 1,
  }
}

describe("board lanes", () => {
  it("puts sessions that want a person in the attention lane", () => {
    expect(laneOf("needs_input")).toBe("attention")
    expect(laneOf("failed")).toBe("attention")
    expect(laneOf("running")).toBe("active")
    expect(laneOf("queued")).toBe("active")
    expect(laneOf("completed")).toBe("recent")
    expect(laneOf("interrupted")).toBe("recent")
    expect(laneOf("idle")).toBe("recent")
  })

  it("keeps the server's order inside each lane", () => {
    const lanes = groupByLane([
      summary("completed"),
      summary("running"),
      summary("needs_input"),
      summary("idle"),
    ])
    expect(lanes.attention.map((s) => s.activity)).toEqual(["needs_input"])
    expect(lanes.active.map((s) => s.activity)).toEqual(["running"])
    expect(lanes.recent.map((s) => s.activity)).toEqual(["completed", "idle"])
  })
})

describe("time and cost formatting", () => {
  const now = Date.parse("2026-10-01T12:00:00.000Z")

  it("says how long ago, compactly", () => {
    expect(relativeTime("2026-10-01T11:59:50.000Z", now)).toBe("just now")
    expect(relativeTime("2026-10-01T11:55:00.000Z", now)).toBe("5m ago")
    expect(relativeTime("2026-10-01T09:00:00.000Z", now)).toBe("3h ago")
    expect(relativeTime("2026-09-29T12:00:00.000Z", now)).toBe("2d ago")
    expect(relativeTime("not a date", now)).toBe("")
  })

  it("ticks a running clock", () => {
    expect(elapsed("2026-10-01T11:59:18.000Z", now)).toBe("42s")
    expect(elapsed("2026-10-01T11:56:55.000Z", now)).toBe("3m 05s")
    expect(elapsed("2026-10-01T10:48:00.000Z", now)).toBe("1h 12m")
  })

  it("rounds cost to cents and never shows a misleading zero", () => {
    expect(formatCost(undefined)).toBeUndefined()
    expect(formatCost(0.004)).toBe("<$0.01")
    expect(formatCost(1.234)).toBe("$1.23")
  })
})
