import { randomUUID } from "node:crypto"

import type {
  AideError,
  DriverId,
  InstanceAuth,
  InstanceConfig,
  InstanceRuntimeStatus,
  InstanceSnapshotEntry,
} from "@workspace/contracts"

import type { EffectiveConfig } from "../config"
import type { EventService } from "../events"
import type { HarnessAdapter, InstanceHandle } from "../harness/types"
import type { InventoryService } from "../inventory"
import type { AdapterRegistry } from "../services/adapter-registry"
import {
  backoffDelay,
  DEFAULT_BACKOFF,
  shouldRetry,
  type BackoffPolicy,
} from "./backoff"

/**
 * Instance supervisor.
 *
 *   configured -> starting -> ready
 *                    |          |-> degraded   (inventory stale or auth expired)
 *                    |          |-> stopped    (user or config change)
 *                    |-> failed (start error; retried with backoff)
 *
 * The supervisor owns instance lifecycle. Adapters expose `start`/`stop`/
 * `health` and never self-supervise.
 *
 * Boot is concurrent and non-blocking: `boot()` returns as soon as the work is
 * scheduled, so the HTTP server binds and serves while instances are still
 * `starting`. A failing instance never takes down the server or another
 * instance.
 */

const UNKNOWN_AUTH: InstanceAuth = { status: "unknown" }

type SupervisedInstance = {
  config: InstanceConfig
  status: InstanceRuntimeStatus
  handle?: InstanceHandle
  version?: string
  installed?: boolean
  auth: InstanceAuth
  error?: AideError
  attempt: number
  /** Bumped on every stop/restart so a late async step can detect it is stale. */
  generation: number
  timer?: ReturnType<typeof setTimeout>
  pending?: Promise<void>
}

export type AdapterResolver = (driver: DriverId) => HarnessAdapter | undefined

export type SupervisorOptions = {
  registry: AdapterRegistry
  adapters: AdapterResolver
  inventory: InventoryService
  eventService?: EventService
  backoff?: BackoffPolicy
  /** Project directory passed to adapters that scope inventory by directory. */
  projectDirectory?: string
  now?: () => string
  id?: () => string
  /** Injectable for tests; defaults to `setTimeout`. */
  schedule?: (fn: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  cancel?: (timer: ReturnType<typeof setTimeout>) => void
}

export class InstanceSupervisor {
  readonly #registry: AdapterRegistry
  readonly #adapters: AdapterResolver
  readonly #inventory: InventoryService
  readonly #eventService: EventService | undefined
  readonly #backoff: BackoffPolicy
  readonly #projectDirectory: string | undefined
  readonly #now: () => string
  readonly #id: () => string
  readonly #schedule: NonNullable<SupervisorOptions["schedule"]>
  readonly #cancel: NonNullable<SupervisorOptions["cancel"]>
  readonly #instances = new Map<string, SupervisedInstance>()
  #shuttingDown = false

  constructor({
    registry,
    adapters,
    inventory,
    eventService,
    backoff = DEFAULT_BACKOFF,
    projectDirectory,
    now = () => new Date().toISOString(),
    id = () => `event_${randomUUID()}`,
    schedule = (fn, delayMs) => setTimeout(fn, delayMs),
    cancel = (timer) => clearTimeout(timer),
  }: SupervisorOptions) {
    this.#registry = registry
    this.#adapters = adapters
    this.#inventory = inventory
    this.#eventService = eventService
    this.#backoff = backoff
    this.#projectDirectory = projectDirectory
    this.#now = now
    this.#id = id
    this.#schedule = schedule
    this.#cancel = cancel
  }

  // ---------------------------------------------------------------- lifecycle

  /**
   * Registers every configured instance and starts the `enabled && autoStart`
   * ones concurrently. Returns immediately — awaiting it is only for tests and
   * for a caller that genuinely wants the boot barrier.
   */
  boot(config: EffectiveConfig): void {
    this.#shuttingDown = false
    this.reap(config)

    for (const instance of Object.values(config.instances)) {
      this.#upsert(instance)
    }

    for (const instance of Object.values(config.instances)) {
      if (instance.enabled && instance.autoStart) {
        void this.#beginStart(instance.instanceId)
      }
    }
  }

  /**
   * Clears anything a previous server process may have left behind. Adapters
   * own their child processes, so reaping is delegated: each configured
   * driver's adapter is asked to dispose a handle for the instance id before it
   * is started again. Failures here are non-fatal by construction — there may
   * be nothing to reap.
   */
  reap(config: EffectiveConfig): void {
    for (const instance of Object.values(config.instances)) {
      const adapter = this.#adapters(instance.driver)
      if (!adapter) continue
      void Promise.resolve(
        adapter.dispose({
          handle: {
            instanceId: instance.instanceId,
            driver: instance.driver,
          },
        })
      ).catch(() => undefined)
    }
  }

  /**
   * Reconciles against a new effective configuration: added instances start,
   * removed ones stop, changed ones restart, untouched ones are left alone.
   * Never a wholesale restart.
   */
  async reconcile(config: EffectiveConfig): Promise<void> {
    const next = config.instances
    const removed = [...this.#instances.keys()].filter((id) => !(id in next))

    await Promise.all(removed.map((id) => this.#stop(id, "removed")))
    for (const id of removed) this.#instances.delete(id)

    const work: Array<Promise<void>> = []
    for (const instance of Object.values(next)) {
      const current = this.#instances.get(instance.instanceId)

      if (!current) {
        this.#upsert(instance)
        if (instance.enabled && instance.autoStart) {
          work.push(this.#beginStart(instance.instanceId))
        }
        continue
      }

      if (sameInstanceConfig(current.config, instance)) continue

      current.config = instance
      if (!instance.enabled) {
        work.push(this.#stop(instance.instanceId, "disabled"))
        continue
      }

      // A changed enabled instance restarts; an already-stopped one only starts
      // if it is meant to be running.
      const wasRunning =
        current.status === "ready" ||
        current.status === "degraded" ||
        current.status === "starting"
      if (wasRunning || instance.autoStart) {
        work.push(this.restart(instance.instanceId))
      }
    }

    await Promise.all(work)
  }

  /** Stops every instance and disposes its adapter handle. */
  async shutdown(): Promise<void> {
    this.#shuttingDown = true
    const ids = [...this.#instances.keys()]
    await Promise.all(ids.map((id) => this.#stop(id, "shutdown")))
    await Promise.all(
      ids.map(async (id) => {
        const entry = this.#instances.get(id)
        const adapter = entry && this.#adapters(entry.config.driver)
        if (!entry || !adapter) return
        await Promise.resolve(
          adapter.dispose({
            handle: {
              instanceId: entry.config.instanceId,
              driver: entry.config.driver,
            },
          })
        ).catch(() => undefined)
      })
    )
  }

  // ------------------------------------------------------------------ control

  async start(instanceId: string): Promise<void> {
    await this.#beginStart(instanceId)
  }

  async stop(instanceId: string): Promise<void> {
    await this.#stop(instanceId, "requested")
  }

  async restart(instanceId: string): Promise<void> {
    await this.#stop(instanceId, "restarting")
    await this.#beginStart(instanceId)
  }

  /**
   * Lazy start for `autoStart: false`. Such an instance stays selectable and
   * starts on first send, which is the escape hatch for expensive or rarely
   * used instances.
   */
  async ensureStarted(instanceId: string): Promise<InstanceHandle> {
    const entry = this.#require(instanceId)
    if (!entry.config.enabled) {
      throw new SupervisorError({
        code: "instance_disabled",
        message: `Instance ${instanceId} is disabled`,
        instanceId,
        retryable: false,
      })
    }
    if (
      entry.handle &&
      (entry.status === "ready" || entry.status === "degraded")
    ) {
      return entry.handle
    }
    await this.#beginStart(instanceId)
    const started = this.#require(instanceId)
    if (!started.handle) {
      throw new SupervisorError(
        started.error ?? {
          code: "instance_not_ready",
          message: `Instance ${instanceId} did not reach ready`,
          instanceId,
          retryable: true,
        }
      )
    }
    return started.handle
  }

  /** Resolves once no start or stop is in flight. Test and shutdown helper. */
  async settled(): Promise<void> {
    for (;;) {
      const pending = [...this.#instances.values()]
        .map((entry) => entry.pending)
        .filter((value): value is Promise<void> => Boolean(value))
      if (pending.length === 0) return
      await Promise.all(pending)
    }
  }

  // -------------------------------------------------------------------- state

  status(instanceId: string): InstanceRuntimeStatus | undefined {
    return this.#instances.get(instanceId)?.status
  }

  /** The `GET /instances` projection. */
  snapshot(): InstanceSnapshotEntry[] {
    return [...this.#instances.values()]
      .sort((left, right) =>
        left.config.instanceId.localeCompare(right.config.instanceId)
      )
      .map((entry) => ({
        instanceId: entry.config.instanceId,
        driver: entry.config.driver,
        ...(entry.config.displayName
          ? { displayName: entry.config.displayName }
          : {}),
        enabled: entry.config.enabled,
        autoStart: entry.config.autoStart,
        status: entry.status,
        ...(entry.version === undefined ? {} : { version: entry.version }),
        ...(entry.installed === undefined
          ? {}
          : { installed: entry.installed }),
        auth: entry.auth,
        ...this.#cachedInventory(entry),
        ...(entry.error ? { error: entry.error } : {}),
      }))
  }

  // ------------------------------------------------------------------ private

  #cachedInventory(entry: SupervisedInstance) {
    const adapter = this.#adapters(entry.config.driver)
    if (!adapter) return undefined
    const scope = adapter.capabilities({
      instanceId: entry.config.instanceId,
      driver: entry.config.driver,
    }).inventoryScope
    const inventory = this.#inventory.get({
      instanceId: entry.config.instanceId,
      scope,
      directory: this.#projectDirectory,
    })
    return inventory ? { inventory } : undefined
  }

  #require(instanceId: string): SupervisedInstance {
    const entry = this.#instances.get(instanceId)
    if (!entry) {
      throw new SupervisorError({
        code: "instance_not_configured",
        message: `Instance ${instanceId} is not configured`,
        instanceId,
        retryable: false,
      })
    }
    return entry
  }

  #upsert(config: InstanceConfig): SupervisedInstance {
    const existing = this.#instances.get(config.instanceId)
    if (existing) {
      existing.config = config
      return existing
    }
    const entry: SupervisedInstance = {
      config,
      status: "configured",
      auth: UNKNOWN_AUTH,
      attempt: 0,
      generation: 0,
    }
    this.#instances.set(config.instanceId, entry)
    return entry
  }

  #transition(entry: SupervisedInstance, status: InstanceRuntimeStatus): void {
    entry.status = status
  }

  #emit(
    instanceId: string,
    driver: DriverId,
    type:
      | "harness.instance_starting"
      | "harness.connected"
      | "harness.disconnected"
      | "harness.reconnecting"
      | "harness.instance_failed"
      | "harness.auth_changed",
    data: Record<string, unknown>
  ): void {
    this.#eventService?.appendDurable({
      schemaVersion: 1,
      eventId: this.#id(),
      timestamp: this.#now(),
      scope: { kind: "instances" },
      instanceId,
      driver,
      type,
      data,
    } as Parameters<EventService["appendDurable"]>[0])
  }

  #beginStart(instanceId: string): Promise<void> {
    const entry = this.#require(instanceId)
    if (entry.pending) return entry.pending
    if (entry.status === "ready" || entry.status === "degraded") {
      return Promise.resolve()
    }
    const pending = this.#runStart(entry).finally(() => {
      if (entry.pending === pending) entry.pending = undefined
    })
    entry.pending = pending
    return pending
  }

  async #runStart(entry: SupervisedInstance): Promise<void> {
    const { instanceId, driver } = entry.config
    if (this.#shuttingDown || !entry.config.enabled) return

    const adapter = this.#adapters(driver)
    if (!adapter) {
      this.#fail(entry, {
        code: "driver_unavailable",
        message: `No adapter is registered for driver "${driver}"`,
        instanceId,
        retryable: false,
      })
      return
    }

    const generation = entry.generation
    this.#transition(entry, "starting")
    entry.error = undefined
    this.#emit(instanceId, driver, "harness.instance_starting", {})

    try {
      const handle = await adapter.start({
        instance: entry.config,
        ...(this.#projectDirectory
          ? { projectDirectory: this.#projectDirectory }
          : {}),
      })
      if (generation !== entry.generation || this.#shuttingDown) {
        await Promise.resolve(adapter.stop({ handle })).catch(() => undefined)
        return
      }

      entry.handle = handle
      entry.attempt = 0
      this.#registry.unregister(instanceId)
      this.#registry.register({ adapter, handle, instance: entry.config })

      const health = await adapter.health({ handle })
      if (generation !== entry.generation) return

      entry.version = health.version
      entry.installed = health.installed
      this.#setAuth(entry, health.auth)
      this.#transition(entry, "ready")
      this.#emit(
        instanceId,
        driver,
        "harness.connected",
        health.version ? { version: health.version } : {}
      )

      await this.#discover(entry, adapter, generation)
    } catch (error) {
      if (generation !== entry.generation) return
      this.#handleStartFailure(entry, toAideError(error, instanceId))
    }
  }

  /**
   * Boot discovery is what gives the composer real inventory before the first
   * send. A discovery failure is not a start failure: the instance stays up and
   * goes `degraded` when a stale cache is available, and only loses the ability
   * to send when there is no cache at all.
   */
  async #discover(
    entry: SupervisedInstance,
    adapter: HarnessAdapter,
    generation: number
  ): Promise<void> {
    const handle = entry.handle
    if (!handle) return
    const scope = adapter.capabilities(handle).inventoryScope

    const result = await this.#inventory.refresh(
      {
        instanceId: entry.config.instanceId,
        scope,
        directory: this.#projectDirectory,
      },
      () =>
        adapter.discover({
          handle,
          ...(scope === "directory" && this.#projectDirectory
            ? { directory: this.#projectDirectory }
            : {}),
        })
    )
    if (generation !== entry.generation) return

    if (result.kind === "fresh") {
      this.#setAuth(entry, result.inventory.auth)
    }

    const authDegraded =
      entry.auth.status === "expired" || entry.auth.status === "unauthenticated"

    // No cache and a failed discovery: the instance stays up but cannot be
    // sent to. A stale cache is usable, and both are `degraded`.
    if (result.kind === "unavailable" || result.kind === "stale") {
      entry.error = result.error
      this.#transition(entry, "degraded")
      return
    }
    this.#transition(entry, authDegraded ? "degraded" : "ready")
  }

  #setAuth(entry: SupervisedInstance, auth: InstanceAuth): void {
    if (JSON.stringify(entry.auth) === JSON.stringify(auth)) return
    entry.auth = auth
    this.#emit(
      entry.config.instanceId,
      entry.config.driver,
      "harness.auth_changed",
      { auth }
    )
  }

  #handleStartFailure(entry: SupervisedInstance, error: AideError): void {
    entry.error = error
    entry.handle = undefined
    this.#registry.unregister(entry.config.instanceId)

    const attempt = entry.attempt + 1
    if (!error.retryable || !shouldRetry(attempt, this.#backoff)) {
      this.#fail(entry, error)
      return
    }

    entry.attempt = attempt
    this.#transition(entry, "starting")
    this.#emit(
      entry.config.instanceId,
      entry.config.driver,
      "harness.reconnecting",
      { attempt }
    )

    const generation = entry.generation
    const delay = backoffDelay(attempt, this.#backoff)
    entry.timer = this.#schedule(() => {
      entry.timer = undefined
      if (generation !== entry.generation || this.#shuttingDown) return
      void this.#beginStart(entry.config.instanceId)
    }, delay)
  }

  #fail(entry: SupervisedInstance, error: AideError): void {
    entry.error = error
    entry.handle = undefined
    this.#transition(entry, "failed")
    this.#registry.unregister(entry.config.instanceId)
    this.#emit(
      entry.config.instanceId,
      entry.config.driver,
      "harness.instance_failed",
      { error }
    )
  }

  async #stop(instanceId: string, reason: string): Promise<void> {
    const entry = this.#instances.get(instanceId)
    if (!entry) return

    entry.generation += 1
    if (entry.timer) {
      this.#cancel(entry.timer)
      entry.timer = undefined
    }
    await entry.pending?.catch(() => undefined)

    const handle = entry.handle
    entry.handle = undefined
    entry.attempt = 0
    this.#registry.unregister(instanceId)

    if (handle) {
      const adapter = this.#adapters(entry.config.driver)
      await Promise.resolve(adapter?.stop({ handle })).catch(() => undefined)
      this.#emit(
        instanceId,
        entry.config.driver,
        "harness.disconnected",
        reason ? { reason } : {}
      )
    }

    this.#transition(entry, "stopped")
  }
}

export class SupervisorError extends Error {
  readonly aideError: AideError

  constructor(aideError: AideError) {
    super(aideError.message)
    this.name = "SupervisorError"
    this.aideError = aideError
  }
}

/** Two configs are the same when nothing an adapter would observe changed. */
function sameInstanceConfig(
  left: InstanceConfig,
  right: InstanceConfig
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
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
    code: "instance_start_failed",
    message: error instanceof Error ? error.message : String(error),
    instanceId,
    retryable: true,
  }
}
