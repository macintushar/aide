import { eventFixtures, sessionSnapshotFixture } from "@workspace/contracts"
import { describe, expect, it } from "vitest"

import { eventSseFrame, heartbeatSseFrame, snapshotSseFrame } from "./sse"

describe("SSE frames", () => {
  it("includes durable sequence ids and omits ids for deltas", () => {
    const durable = eventFixtures().find((event) => event.delivery.durable)!
    const delta = eventFixtures().find((event) => event.type === "part.delta")!
    if (!durable.delivery.durable) throw new Error("Expected durable fixture")

    expect(eventSseFrame(durable)).toBe(
      `id: ${durable.delivery.sequence}\nevent: ${durable.type}\ndata: ${JSON.stringify(durable)}\n\n`
    )
    expect(eventSseFrame(delta)).toBe(
      `event: part.delta\ndata: ${JSON.stringify(delta)}\n\n`
    )
  })

  it("formats default and custom heartbeat comments", () => {
    expect(heartbeatSseFrame()).toBe(": heartbeat\n\n")
    expect(heartbeatSseFrame("keep-alive")).toBe(": keep-alive\n\n")
  })

  it("formats snapshots without an SSE id", () => {
    const snapshot = sessionSnapshotFixture()
    expect(snapshotSseFrame(snapshot)).toBe(
      `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`
    )
  })
})
