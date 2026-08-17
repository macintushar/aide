import { randomUUID } from "node:crypto"

import type {
  AideError,
  HarnessCapabilities,
  HarnessInventory,
} from "@workspace/contracts"

import type { AideDb } from "../db"
import { inventoryCacheRepo } from "../db"
import type { EventService } from "../events"

/**
 * Inventory cache and staleness.
 *
 * Inventory is cached per instance and, for `inventoryScope: "directory"`, per
 * project directory. Runtime-scoped instances share one entry across
 * directories, keyed by the sentinel below, because their inventory comes from a
 * live harness handle rather than from the working directory.
 *
 * Discovery failure policy, per instance:
 *   1. Use a previously cached inventory and mark it stale.
 *   2. If no cache exists, disable sending for that instance and show the error.
 *   3. Never fall back to CLI parsing.
 */

/** Directory key for `inventoryScope: "runtime"` instances. */
export const RUNTIME_DIRECTORY_KEY = ""

export type InventoryScope = HarnessCapabilities["inventoryScope"]

export function directoryKey(
  scope: InventoryScope,
  directory: string | undefined
): string {
  return scope === "runtime" ? RUNTIME_DIRECTORY_KEY : (directory ?? "")
}

export type InventoryLookup = {
  readonly instanceId: string
  readonly scope: InventoryScope
  readonly directory?: string
}

/**
 * The outcome of a discovery attempt, and the only thing callers should branch
 * on to decide whether an instance may be sent to.
 */
export type InventoryResult =
  | { readonly kind: "fresh"; readonly inventory: HarnessInventory }
  | {
      readonly kind: "stale"
      readonly inventory: HarnessInventory
      readonly error: AideError
    }
  | { readonly kind: "unavailable"; readonly error: AideError }

/** Sending is blocked only when there is no inventory at all. */
export function canSend(result: InventoryResult): boolean {
  return result.kind !== "unavailable"
}

export type InventoryServiceOptions = {
  db: AideDb
  eventService?: EventService
  now?: () => string
  id?: () => string
}

export class InventoryService {
  readonly #db: AideDb
  readonly #eventService: EventService | undefined
  readonly #now: () => string
  readonly #id: () => string

  constructor({
    db,
    eventService,
    now = () => new Date().toISOString(),
    id = () => `event_${randomUUID()}`,
  }: InventoryServiceOptions) {
    this.#db = db
    this.#eventService = eventService
    this.#now = now
    this.#id = id
  }

  get(lookup: InventoryLookup): HarnessInventory | undefined {
    return inventoryCacheRepo.get(
      this.#db,
      lookup.instanceId,
      directoryKey(lookup.scope, lookup.directory)
    )
  }

  list(): HarnessInventory[] {
    return inventoryCacheRepo.list(this.#db)
  }

  /** Writes a successful discovery result and emits `harness.inventory_updated`. */
  put(lookup: InventoryLookup, inventory: HarnessInventory): HarnessInventory {
    const stored = inventoryCacheRepo.put(
      this.#db,
      directoryKey(lookup.scope, lookup.directory),
      { ...inventory, stale: false }
    )
    this.#eventService?.appendDurable({
      schemaVersion: 1,
      eventId: this.#id(),
      timestamp: this.#now(),
      scope: { kind: "instances" },
      instanceId: stored.instanceId,
      driver: stored.driver,
      type: "harness.inventory_updated",
      data: { inventory: stored },
    })
    return stored
  }

  /** Marks a cached entry stale in place, without discarding it. */
  markStale(lookup: InventoryLookup): HarnessInventory | undefined {
    const cached = this.get(lookup)
    if (!cached || cached.stale) return cached
    return inventoryCacheRepo.put(
      this.#db,
      directoryKey(lookup.scope, lookup.directory),
      { ...cached, stale: true }
    )
  }

  /**
   * Runs a discovery attempt and applies the failure policy. `discover` is the
   * adapter call; this method owns everything around it, so no adapter has to
   * know the caching or staleness rules.
   */
  async refresh(
    lookup: InventoryLookup,
    discover: () => Promise<HarnessInventory>
  ): Promise<InventoryResult> {
    try {
      const discovered = await discover()
      return { kind: "fresh", inventory: this.put(lookup, discovered) }
    } catch (error) {
      const aideError = toAideError(error, lookup.instanceId)
      this.#eventService?.appendDurable({
        schemaVersion: 1,
        eventId: this.#id(),
        timestamp: this.#now(),
        scope: { kind: "instances" },
        instanceId: lookup.instanceId,
        type: "harness.inventory_failed",
        data: { error: aideError },
      })

      const cached = this.markStale(lookup)
      if (cached) {
        return { kind: "stale", inventory: cached, error: aideError }
      }
      return { kind: "unavailable", error: aideError }
    }
  }
}

function toAideError(error: unknown, instanceId: string): AideError {
  if (
    error &&
    typeof error === "object" &&
    "aideError" in error &&
    error.aideError
  ) {
    return error.aideError as AideError
  }
  return {
    code: "inventory_discovery_failed",
    message: error instanceof Error ? error.message : String(error),
    instanceId,
    retryable: true,
  }
}
