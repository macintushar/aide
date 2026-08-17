import {
  instancesSnapshotFixture,
  inventoryFixture,
  type AideEvent,
  type InstancesSnapshot,
} from "@workspace/contracts"
import { describe, expect, it } from "vitest"

import { createInstancesStore, sendBlockedReason } from "./instances-store"

let sequence = 0

function snapshot(): InstancesSnapshot {
  const base = instancesSnapshotFixture()
  return {
    ...base,
    instances: base.instances.map((entry) => ({
      ...entry,
      status: "configured",
      inventory: undefined,
      error: undefined,
    })),
  }
}

function event(
  type: AideEvent["type"],
  instanceId: string | undefined,
  data: unknown
): AideEvent {
  return {
    schemaVersion: 1,
    eventId: `event_${++sequence}`,
    timestamp: "2026-01-01T00:00:00.000Z",
    delivery: { durable: true, sequence },
    scope: { kind: "instances" },
    ...(instanceId ? { instanceId } : {}),
    type,
    data,
  } as AideEvent
}

function firstId(): string {
  return snapshot().instances[0]!.instanceId
}

describe("instances store", () => {
  it("starts empty and applies a snapshot", () => {
    const store = createInstancesStore()
    expect(store.getState().snapshotApplied).toBe(false)

    store.applySnapshot(snapshot())
    const state = store.getState()
    expect(state.snapshotApplied).toBe(true)
    expect(state.instances.length).toBeGreaterThan(0)
  })

  it("advances the cursor only on durable events", () => {
    const store = createInstancesStore()
    store.applySnapshot({ ...snapshot(), cursor: { sequence: 0 } })

    store.applyEvent({
      ...event("harness.instance_starting", firstId(), {}),
      delivery: { durable: true, sequence: 7 },
    })
    expect(store.getState().cursor.sequence).toBe(7)

    store.applyEvent({
      ...event("harness.instance_starting", firstId(), {}),
      delivery: { durable: true, sequence: 3 },
    })
    // The cursor never moves backwards.
    expect(store.getState().cursor.sequence).toBe(7)
  })

  it("ignores a duplicate event id", () => {
    const store = createInstancesStore()
    store.applySnapshot(snapshot())
    const id = firstId()

    const failed = event("harness.instance_failed", id, {
      error: { code: "start_failed", message: "boom", retryable: true },
    })
    store.applyEvent(failed)
    store.applyEvent({ ...failed })

    expect(entry(store, id).status).toBe("failed")
  })

  it("walks the lifecycle from starting to connected", () => {
    const store = createInstancesStore()
    store.applySnapshot(snapshot())
    const id = firstId()

    store.applyEvent(event("harness.instance_starting", id, {}))
    expect(entry(store, id).status).toBe("starting")

    store.applyEvent(event("harness.connected", id, { version: "1.18.16" }))
    expect(entry(store, id)).toMatchObject({
      status: "ready",
      version: "1.18.16",
      installed: true,
    })
  })

  it("records a failure with its error and clears it on the next start", () => {
    const store = createInstancesStore()
    store.applySnapshot(snapshot())
    const id = firstId()

    store.applyEvent(
      event("harness.instance_failed", id, {
        error: { code: "start_failed", message: "no runtime", retryable: true },
      })
    )
    expect(entry(store, id)).toMatchObject({
      status: "failed",
      error: { message: "no runtime" },
    })

    store.applyEvent(event("harness.instance_starting", id, {}))
    expect(entry(store, id).error).toBeUndefined()
  })

  it("shows a reconnect attempt as starting", () => {
    const store = createInstancesStore()
    store.applySnapshot(snapshot())
    const id = firstId()

    store.applyEvent(event("harness.reconnecting", id, { attempt: 2 }))
    expect(entry(store, id).status).toBe("starting")
  })

  it("applies auth changes without touching status", () => {
    const store = createInstancesStore()
    store.applySnapshot(snapshot())
    const id = firstId()
    store.applyEvent(event("harness.connected", id, {}))

    store.applyEvent(
      event("harness.auth_changed", id, {
        auth: { status: "expired", type: "oauth" },
      })
    )
    expect(entry(store, id)).toMatchObject({
      status: "ready",
      auth: { status: "expired" },
    })
  })

  it("stores fresh inventory and recovers from degraded", () => {
    const store = createInstancesStore()
    store.applySnapshot(snapshot())
    const id = firstId()

    store.applyEvent(
      event("harness.inventory_failed", id, {
        error: {
          code: "inventory_discovery_failed",
          message: "down",
          retryable: true,
        },
      })
    )
    expect(entry(store, id).status).toBe("degraded")

    store.applyEvent(
      event("harness.inventory_updated", id, {
        inventory: { ...inventoryFixture(), instanceId: id },
      })
    )
    expect(entry(store, id)).toMatchObject({ status: "ready" })
    expect(entry(store, id).error).toBeUndefined()
    expect(entry(store, id).inventory?.stale).toBe(false)
  })

  it("marks existing inventory stale when discovery fails", () => {
    const store = createInstancesStore()
    store.applySnapshot(snapshot())
    const id = firstId()

    store.applyEvent(
      event("harness.inventory_updated", id, {
        inventory: { ...inventoryFixture(), instanceId: id },
      })
    )
    store.applyEvent(
      event("harness.inventory_failed", id, {
        error: {
          code: "inventory_discovery_failed",
          message: "down",
          retryable: true,
        },
      })
    )

    expect(entry(store, id)).toMatchObject({ status: "degraded" })
    expect(entry(store, id).inventory?.stale).toBe(true)
  })

  it("ignores an event for an unknown instance", () => {
    const store = createInstancesStore()
    store.applySnapshot(snapshot())
    const before = store.getState().instances

    store.applyEvent(event("harness.connected", "not-configured", {}))
    expect(store.getState().instances).toEqual(before)
  })

  it("bumps a revision on config.updated so the UI can refetch", () => {
    const store = createInstancesStore()
    store.applySnapshot(snapshot())
    expect(store.getState().configRevision).toBe(0)

    store.applyEvent(
      event("config.updated", undefined, { target: { kind: "global" } })
    )
    expect(store.getState().configRevision).toBe(1)
  })

  it("notifies subscribers and stops after unsubscribe", () => {
    const store = createInstancesStore()
    const seen: number[] = []
    const unsubscribe = store.subscribe((state) =>
      seen.push(state.instances.length)
    )

    store.applySnapshot(snapshot())
    unsubscribe()
    store.applyEvent(event("harness.connected", firstId(), {}))

    expect(seen).toHaveLength(1)
  })
})

describe("sendBlockedReason", () => {
  const base = instancesSnapshotFixture().instances[0]!

  it("allows a ready, authenticated instance", () => {
    expect(
      sendBlockedReason({
        ...base,
        enabled: true,
        status: "ready",
        auth: { status: "authenticated" },
      })
    ).toBeUndefined()
  })

  it("blocks a disabled instance", () => {
    expect(sendBlockedReason({ ...base, enabled: false })).toContain("disabled")
  })

  it("blocks an unauthenticated instance with an actionable message", () => {
    expect(
      sendBlockedReason({
        ...base,
        enabled: true,
        status: "ready",
        auth: { status: "unauthenticated" },
      })
    ).toContain("Sign in")
  })

  it("blocks an expired instance", () => {
    expect(
      sendBlockedReason({
        ...base,
        enabled: true,
        status: "ready",
        auth: { status: "expired" },
      })
    ).toContain("expired")
  })

  it("blocks a degraded instance that has no inventory at all", () => {
    expect(
      sendBlockedReason({
        ...base,
        enabled: true,
        status: "degraded",
        auth: { status: "authenticated" },
        inventory: undefined,
        error: { code: "x", message: "discovery failed", retryable: true },
      })
    ).toBe("discovery failed")
  })

  it("allows a degraded instance that still has stale inventory", () => {
    expect(
      sendBlockedReason({
        ...base,
        enabled: true,
        status: "degraded",
        auth: { status: "authenticated" },
        inventory: { ...inventoryFixture(), stale: true },
      })
    ).toBeUndefined()
  })
})

function entry(
  store: ReturnType<typeof createInstancesStore>,
  instanceId: string
) {
  const found = store
    .getState()
    .instances.find((candidate) => candidate.instanceId === instanceId)
  if (!found) throw new Error(`instance ${instanceId} missing from store`)
  return found
}
