import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { inventoryFixture, type HarnessInventory } from "@workspace/contracts"

import type { AideDb } from "../db"
import type { Database } from "../db/test/bun-sqlite-shim"
import { EventService } from "../events"
import { createTestDb } from "../test/db"
import {
  canSend,
  directoryKey,
  InventoryService,
  RUNTIME_DIRECTORY_KEY,
} from "./service"

function inventory(overrides: Partial<HarnessInventory> = {}) {
  return { ...inventoryFixture(), ...overrides }
}

describe("directoryKey", () => {
  it("collapses runtime-scoped instances onto one entry", () => {
    expect(directoryKey("runtime", "/a")).toBe(RUNTIME_DIRECTORY_KEY)
    expect(directoryKey("runtime", undefined)).toBe(RUNTIME_DIRECTORY_KEY)
  })

  it("keys directory-scoped instances by project directory", () => {
    expect(directoryKey("directory", "/a")).toBe("/a")
  })
})

describe("InventoryService", () => {
  let client: Database
  let db: AideDb
  let eventService: EventService
  let service: InventoryService
  let eventId = 0

  beforeEach(() => {
    const created = createTestDb()
    client = created.client
    db = created.db
    eventService = new EventService(db)
    eventId = 0
    service = new InventoryService({
      db,
      eventService,
      now: () => "2026-01-01T00:00:00.000Z",
      id: () => `event_${String(++eventId).padStart(4, "0")}`,
    })
  })

  afterEach(() => client.close())

  it("caches directory-scoped inventory per directory", async () => {
    const base = inventory({ instanceId: "opencode" })
    await service.refresh(
      { instanceId: "opencode", scope: "directory", directory: "/a" },
      async () => ({ ...base, revision: "rev-a" })
    )
    await service.refresh(
      { instanceId: "opencode", scope: "directory", directory: "/b" },
      async () => ({ ...base, revision: "rev-b" })
    )

    expect(
      service.get({
        instanceId: "opencode",
        scope: "directory",
        directory: "/a",
      })?.revision
    ).toBe("rev-a")
    expect(
      service.get({
        instanceId: "opencode",
        scope: "directory",
        directory: "/b",
      })?.revision
    ).toBe("rev-b")
  })

  it("shares one entry across directories for a runtime-scoped instance", async () => {
    const base = inventory({ instanceId: "claude", driver: "claudeAgent" })
    await service.refresh(
      { instanceId: "claude", scope: "runtime", directory: "/a" },
      async () => ({ ...base, revision: "rev-1" })
    )
    expect(
      service.get({ instanceId: "claude", scope: "runtime", directory: "/z" })
        ?.revision
    ).toBe("rev-1")
  })

  it("stores a fresh result unstale and emits harness.inventory_updated", async () => {
    const result = await service.refresh(
      { instanceId: "opencode", scope: "runtime" },
      async () => inventory({ instanceId: "opencode", stale: true })
    )

    expect(result.kind).toBe("fresh")
    expect(result.kind === "fresh" && result.inventory.stale).toBe(false)

    const replay = eventService.replayOrSnapshot({
      scope: { kind: "instances" },
      afterSequence: 0,
      maxReplay: 10,
      snapshot: () => undefined,
    })
    const types = (replay.mode === "events" ? replay.events : []).map(
      (event) => event.type
    )
    expect(types).toEqual(["harness.inventory_updated"])
  })

  it("falls back to the cache and marks it stale when discovery fails", async () => {
    await service.refresh(
      { instanceId: "opencode", scope: "runtime" },
      async () => inventory({ instanceId: "opencode", revision: "good" })
    )

    const result = await service.refresh(
      { instanceId: "opencode", scope: "runtime" },
      async () => {
        throw new Error("harness is down")
      }
    )

    expect(result.kind).toBe("stale")
    expect(result.kind === "stale" && result.inventory.revision).toBe("good")
    expect(result.kind === "stale" && result.inventory.stale).toBe(true)
    expect(canSend(result)).toBe(true)

    // The stale marking is persisted, not just returned.
    expect(
      service.get({ instanceId: "opencode", scope: "runtime" })?.stale
    ).toBe(true)
  })

  it("disables sending when discovery fails with no cache at all", async () => {
    const result = await service.refresh(
      { instanceId: "fresh-instance", scope: "runtime" },
      async () => {
        throw new Error("never discovered")
      }
    )

    expect(result.kind).toBe("unavailable")
    expect(canSend(result)).toBe(false)
    expect(result.kind === "unavailable" && result.error.message).toBe(
      "never discovered"
    )
  })

  it("emits harness.inventory_failed on every failed attempt", async () => {
    await service.refresh(
      { instanceId: "opencode", scope: "runtime" },
      async () => {
        throw new Error("boom")
      }
    )

    const replay = eventService.replayOrSnapshot({
      scope: { kind: "instances" },
      afterSequence: 0,
      maxReplay: 10,
      snapshot: () => undefined,
    })
    const types = (replay.mode === "events" ? replay.events : []).map(
      (event) => event.type
    )
    expect(types).toEqual(["harness.inventory_failed"])
  })

  it("preserves a structured adapter error rather than restating it", async () => {
    const result = await service.refresh(
      { instanceId: "opencode", scope: "runtime" },
      async () => {
        throw Object.assign(new Error("wrapped"), {
          aideError: {
            code: "harness_version_incompatible",
            message: "runtime too old",
            instanceId: "opencode",
            retryable: false,
          },
        })
      }
    )

    expect(result.kind === "unavailable" && result.error).toEqual({
      code: "harness_version_incompatible",
      message: "runtime too old",
      instanceId: "opencode",
      retryable: false,
    })
  })

  it("recovers from stale to fresh on a later successful discovery", async () => {
    const lookup = { instanceId: "opencode", scope: "runtime" as const }
    await service.refresh(lookup, async () =>
      inventory({ instanceId: "opencode", revision: "one" })
    )
    await service.refresh(lookup, async () => {
      throw new Error("blip")
    })
    expect(service.get(lookup)?.stale).toBe(true)

    const recovered = await service.refresh(lookup, async () =>
      inventory({ instanceId: "opencode", revision: "two" })
    )
    expect(recovered.kind).toBe("fresh")
    expect(service.get(lookup)).toMatchObject({ revision: "two", stale: false })
  })
})
