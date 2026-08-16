import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  inventoryFixture,
  type AideEvent,
  type HarnessInventory,
  type InstanceConfig,
} from "@workspace/contracts"

import type { EffectiveConfig } from "../config"
import type { AideDb } from "../db"
import type { Database } from "../db/test/bun-sqlite-shim"
import { EventService } from "../events"
import type { HarnessAdapter, InstanceHandle } from "../harness/types"
import { InventoryService } from "../inventory"
import { AdapterRegistry } from "../services/adapter-registry"
import { createTestDb } from "../test/db"
import { InstanceSupervisor } from "./supervisor"

/**
 * A controllable stand-in for a driver. The supervisor is what is under test,
 * so the adapter only has to be observable and steerable, not realistic.
 */
function createStubAdapter(
  overrides: {
    driver?: "opencode" | "claudeAgent"
    inventoryScope?: "directory" | "runtime"
  } = {}
) {
  const driver = overrides.driver ?? "opencode"
  const calls = {
    start: [] as string[],
    stop: [] as string[],
    dispose: [] as string[],
    discover: [] as string[],
  }
  let failStartTimes = 0
  let startError: { aideError: unknown } | Error | undefined
  let discoverError: Error | undefined
  let inventory: HarnessInventory | undefined

  const adapter: HarnessAdapter = {
    driver,
    configSchema: {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (value: unknown) => ({ value }),
      },
    } as never,
    capabilities() {
      return {
        inventoryScope: overrides.inventoryScope ?? "runtime",
        agentSelection: true,
        interactionModes: [],
        sessionModelSwitch: "in-session",
        steer: true,
        interrupt: true,
        permissions: true,
        userInput: true,
        reasoningParts: true,
        mcp: {
          stdio: true,
          http: true,
          sse: true,
          inProcess: false,
          runtimeReconfigure: true,
        },
      }
    },
    async start(input) {
      calls.start.push(input.instance.instanceId)
      if (failStartTimes > 0) {
        failStartTimes -= 1
        throw (
          startError ??
          Object.assign(new Error("stub start failed"), {
            aideError: {
              code: "start_failed",
              message: "stub start failed",
              instanceId: input.instance.instanceId,
              retryable: true,
            },
          })
        )
      }
      return { instanceId: input.instance.instanceId, driver }
    },
    async stop(input) {
      calls.stop.push(input.handle.instanceId)
    },
    async health(input) {
      return {
        status: "ready",
        version: "1.2.3",
        installed: true,
        auth: { status: "authenticated", type: "stub" },
        ...(input ? {} : {}),
      }
    },
    async discover(input) {
      calls.discover.push(input.handle.instanceId)
      if (discoverError) throw discoverError
      return (
        inventory ?? {
          ...inventoryFixture(),
          instanceId: input.handle.instanceId,
          driver,
        }
      )
    },
    async openSession() {
      throw new Error("not used")
    },
    async resumeSession() {
      throw new Error("not used")
    },
    async send() {
      throw new Error("not used")
    },
    async interrupt() {
      throw new Error("not used")
    },
    async respondToPermission() {
      throw new Error("not used")
    },
    async respondToInput() {
      throw new Error("not used")
    },
    async setMcpServers() {},
    async mcpStatus() {
      return []
    },
    events() {
      throw new Error("not used")
    },
    async dispose(input: { handle: InstanceHandle }) {
      calls.dispose.push(input.handle.instanceId)
    },
  }

  return {
    adapter,
    calls,
    failStartsFor(times: number, error?: Error) {
      failStartTimes = times
      startError = error
    },
    failDiscoverWith(error: Error | undefined) {
      discoverError = error
    },
    setInventory(next: HarnessInventory | undefined) {
      inventory = next
    },
  }
}

function instance(overrides: Partial<InstanceConfig> = {}): InstanceConfig {
  return {
    instanceId: "opencode",
    driver: "opencode",
    enabled: true,
    autoStart: true,
    config: {},
    ...overrides,
  }
}

function effective(...instances: InstanceConfig[]): EffectiveConfig {
  return {
    instances: Object.fromEntries(
      instances.map((entry) => [entry.instanceId, entry])
    ),
    mcpServers: {},
    defaults: {},
    failures: [],
  }
}

describe("InstanceSupervisor", () => {
  let client: Database
  let db: AideDb
  let eventService: EventService
  let registry: AdapterRegistry
  let inventoryService: InventoryService
  let timers: Array<{ fn: () => void; delayMs: number; cancelled: boolean }>
  let eventId = 0

  function build(
    stubs: Array<ReturnType<typeof createStubAdapter>>,
    options: { projectDirectory?: string } = {}
  ): InstanceSupervisor {
    const byDriver = new Map(
      stubs.map((stub) => [stub.adapter.driver, stub.adapter])
    )
    return new InstanceSupervisor({
      registry,
      adapters: (driver) => byDriver.get(driver),
      inventory: inventoryService,
      eventService,
      backoff: { baseMs: 10, maxMs: 40, maxAttempts: 2 },
      ...(options.projectDirectory
        ? { projectDirectory: options.projectDirectory }
        : {}),
      now: () => "2026-01-01T00:00:00.000Z",
      id: () => `event_${String(++eventId).padStart(4, "0")}`,
      schedule: (fn, delayMs) => {
        const timer = { fn, delayMs, cancelled: false }
        timers.push(timer)
        return timer as never
      },
      cancel: (timer) => {
        ;(timer as never as { cancelled: boolean }).cancelled = true
      },
    })
  }

  /** Runs every timer the supervisor scheduled, then settles the work it started. */
  async function runTimers(supervisor: InstanceSupervisor): Promise<void> {
    for (let pass = 0; pass < 10; pass += 1) {
      const pending = timers.filter((timer) => !timer.cancelled)
      timers = []
      if (pending.length === 0) break
      for (const timer of pending) timer.fn()
      await supervisor.settled()
    }
  }

  function instanceEvents(): AideEvent[] {
    const replay = eventService.replayOrSnapshot({
      scope: { kind: "instances" },
      afterSequence: 0,
      maxReplay: 500,
      snapshot: () => undefined,
    })
    return replay.mode === "events" ? replay.events : []
  }

  beforeEach(() => {
    const created = createTestDb()
    client = created.client
    db = created.db
    eventService = new EventService(db)
    registry = new AdapterRegistry()
    inventoryService = new InventoryService({
      db,
      eventService,
      now: () => "2026-01-01T00:00:00.000Z",
      id: () => `event_${String(++eventId).padStart(4, "0")}`,
    })
    timers = []
    eventId = 0
  })

  afterEach(() => client.close())

  describe("state machine and concurrent boot", () => {
    it("returns from boot before any instance is ready", () => {
      const stub = createStubAdapter()
      const supervisor = build([stub])

      supervisor.boot(effective(instance()))

      // boot() is synchronous by contract: the HTTP server binds and serves
      // while instances are still starting.
      expect(supervisor.status("opencode")).toBe("starting")
    })

    it("reaches ready and reports version and auth once started", async () => {
      const stub = createStubAdapter()
      const supervisor = build([stub])

      supervisor.boot(effective(instance()))
      await supervisor.settled()

      expect(supervisor.status("opencode")).toBe("ready")
      expect(supervisor.snapshot()[0]).toMatchObject({
        instanceId: "opencode",
        status: "ready",
        version: "1.2.3",
        installed: true,
        auth: { status: "authenticated" },
      })
    })

    it("starts every enabled autoStart instance concurrently", async () => {
      const opencode = createStubAdapter()
      const claude = createStubAdapter({ driver: "claudeAgent" })
      const supervisor = build([opencode, claude])

      supervisor.boot(
        effective(
          instance({ instanceId: "a" }),
          instance({ instanceId: "b", driver: "claudeAgent" })
        )
      )
      expect(supervisor.status("a")).toBe("starting")
      expect(supervisor.status("b")).toBe("starting")

      await supervisor.settled()
      expect(supervisor.status("a")).toBe("ready")
      expect(supervisor.status("b")).toBe("ready")
    })

    it("leaves a disabled instance configured and never starts it", async () => {
      const stub = createStubAdapter()
      const supervisor = build([stub])

      supervisor.boot(effective(instance({ enabled: false })))
      await supervisor.settled()

      expect(supervisor.status("opencode")).toBe("configured")
      expect(stub.calls.start).toEqual([])
    })

    it("registers the started instance for execution and unregisters on stop", async () => {
      const stub = createStubAdapter()
      const supervisor = build([stub])

      supervisor.boot(effective(instance()))
      await supervisor.settled()
      expect(registry.list()).toHaveLength(1)

      await supervisor.stop("opencode")
      expect(registry.list()).toHaveLength(0)
    })

    it("emits instance_starting then connected", async () => {
      const stub = createStubAdapter()
      const supervisor = build([stub])

      supervisor.boot(effective(instance()))
      await supervisor.settled()

      const types = instanceEvents().map((event) => event.type)
      expect(types.slice(0, 2)).toEqual([
        "harness.instance_starting",
        "harness.auth_changed",
      ])
      expect(types).toContain("harness.connected")
    })
  })

  describe("health, degraded state, and backoff", () => {
    it("retries a retryable start failure with backoff and then reaches ready", async () => {
      const stub = createStubAdapter()
      stub.failStartsFor(1)
      const supervisor = build([stub])

      supervisor.boot(effective(instance()))
      await supervisor.settled()
      expect(supervisor.status("opencode")).toBe("starting")
      expect(instanceEvents().map((event) => event.type)).toContain(
        "harness.reconnecting"
      )

      await runTimers(supervisor)
      expect(supervisor.status("opencode")).toBe("ready")
      expect(stub.calls.start).toEqual(["opencode", "opencode"])
    })

    it("uses a capped exponential delay", async () => {
      const stub = createStubAdapter()
      stub.failStartsFor(5)
      const supervisor = build([stub])

      supervisor.boot(effective(instance()))
      await supervisor.settled()
      expect(timers.at(-1)?.delayMs).toBe(10)

      const first = timers.filter((timer) => !timer.cancelled)
      timers = []
      for (const timer of first) timer.fn()
      await supervisor.settled()
      expect(timers.at(-1)?.delayMs).toBe(20)
    })

    it("moves to failed with the last error after repeated failure", async () => {
      const stub = createStubAdapter()
      stub.failStartsFor(10)
      const supervisor = build([stub])

      supervisor.boot(effective(instance()))
      await supervisor.settled()
      await runTimers(supervisor)

      expect(supervisor.status("opencode")).toBe("failed")
      expect(supervisor.snapshot()[0]?.error).toMatchObject({
        code: "start_failed",
      })
      expect(instanceEvents().map((event) => event.type)).toContain(
        "harness.instance_failed"
      )
    })

    it("does not retry a non-retryable failure", async () => {
      const stub = createStubAdapter()
      stub.failStartsFor(
        10,
        Object.assign(new Error("bad config"), {
          aideError: {
            code: "invalid_instance_config",
            message: "bad config",
            instanceId: "opencode",
            retryable: false,
          },
        })
      )
      const supervisor = build([stub])

      supervisor.boot(effective(instance()))
      await supervisor.settled()

      expect(supervisor.status("opencode")).toBe("failed")
      expect(stub.calls.start).toEqual(["opencode"])
      expect(timers.filter((timer) => !timer.cancelled)).toEqual([])
    })

    it("keeps one instance's failure from touching another", async () => {
      const opencode = createStubAdapter()
      const claude = createStubAdapter({ driver: "claudeAgent" })
      opencode.failStartsFor(
        10,
        Object.assign(new Error("nope"), {
          aideError: {
            code: "start_failed",
            message: "nope",
            instanceId: "a",
            retryable: false,
          },
        })
      )
      const supervisor = build([opencode, claude])

      supervisor.boot(
        effective(
          instance({ instanceId: "a" }),
          instance({ instanceId: "b", driver: "claudeAgent" })
        )
      )
      await supervisor.settled()

      expect(supervisor.status("a")).toBe("failed")
      expect(supervisor.status("b")).toBe("ready")
    })

    it("fails an instance whose driver has no adapter", async () => {
      const supervisor = build([])
      supervisor.boot(effective(instance()))
      await supervisor.settled()

      expect(supervisor.status("opencode")).toBe("failed")
      expect(supervisor.snapshot()[0]?.error?.code).toBe("driver_unavailable")
    })

    it("goes degraded when discovery fails but a cache exists", async () => {
      const stub = createStubAdapter()
      const supervisor = build([stub])

      supervisor.boot(effective(instance()))
      await supervisor.settled()
      expect(supervisor.status("opencode")).toBe("ready")

      stub.failDiscoverWith(new Error("discovery down"))
      await supervisor.restart("opencode")

      expect(supervisor.status("opencode")).toBe("degraded")
      expect(supervisor.snapshot()[0]?.inventory).toMatchObject({ stale: true })
    })

    it("goes degraded when discovery fails with no cache at all", async () => {
      const stub = createStubAdapter()
      stub.failDiscoverWith(new Error("never discovered"))
      const supervisor = build([stub])

      supervisor.boot(effective(instance()))
      await supervisor.settled()

      expect(supervisor.status("opencode")).toBe("degraded")
      expect(supervisor.snapshot()[0]?.inventory).toBeUndefined()
    })

    it("goes degraded when discovery reports expired auth", async () => {
      const stub = createStubAdapter()
      stub.setInventory({
        ...inventoryFixture(),
        instanceId: "opencode",
        driver: "opencode",
        auth: { status: "expired" },
      })
      const supervisor = build([stub])

      supervisor.boot(effective(instance()))
      await supervisor.settled()

      expect(supervisor.status("opencode")).toBe("degraded")
      expect(supervisor.snapshot()[0]?.auth.status).toBe("expired")
    })
  })

  describe("reconcile on config change", () => {
    it("starts an added instance", async () => {
      const opencode = createStubAdapter()
      const claude = createStubAdapter({ driver: "claudeAgent" })
      const supervisor = build([opencode, claude])

      supervisor.boot(effective(instance({ instanceId: "a" })))
      await supervisor.settled()

      await supervisor.reconcile(
        effective(
          instance({ instanceId: "a" }),
          instance({ instanceId: "b", driver: "claudeAgent" })
        )
      )
      expect(supervisor.status("b")).toBe("ready")
    })

    it("stops a removed instance and forgets it", async () => {
      const stub = createStubAdapter()
      const supervisor = build([stub])

      supervisor.boot(
        effective(instance({ instanceId: "a" }), instance({ instanceId: "b" }))
      )
      await supervisor.settled()

      await supervisor.reconcile(effective(instance({ instanceId: "a" })))
      expect(supervisor.status("b")).toBeUndefined()
      expect(stub.calls.stop).toEqual(["b"])
    })

    it("restarts a changed instance", async () => {
      const stub = createStubAdapter()
      const supervisor = build([stub])

      supervisor.boot(effective(instance()))
      await supervisor.settled()

      await supervisor.reconcile(
        effective(instance({ config: { port: 4096 } }))
      )
      expect(stub.calls.stop).toEqual(["opencode"])
      expect(stub.calls.start).toEqual(["opencode", "opencode"])
      expect(supervisor.status("opencode")).toBe("ready")
    })

    it("leaves an untouched instance alone — never a wholesale restart", async () => {
      const stub = createStubAdapter()
      const supervisor = build([stub])

      supervisor.boot(
        effective(instance({ instanceId: "a" }), instance({ instanceId: "b" }))
      )
      await supervisor.settled()
      expect(stub.calls.start).toEqual(["a", "b"])

      await supervisor.reconcile(
        effective(
          instance({ instanceId: "a" }),
          instance({ instanceId: "b", displayName: "renamed" })
        )
      )

      expect(stub.calls.stop).toEqual(["b"])
      expect(stub.calls.start).toEqual(["a", "b", "b"])
    })

    it("stops an instance that becomes disabled", async () => {
      const stub = createStubAdapter()
      const supervisor = build([stub])

      supervisor.boot(effective(instance()))
      await supervisor.settled()

      await supervisor.reconcile(effective(instance({ enabled: false })))
      expect(supervisor.status("opencode")).toBe("stopped")
      expect(stub.calls.stop).toEqual(["opencode"])
    })
  })

  describe("shutdown, orphan kill, and stale reap", () => {
    it("stops and disposes every instance on shutdown", async () => {
      const stub = createStubAdapter()
      const supervisor = build([stub])

      supervisor.boot(
        effective(instance({ instanceId: "a" }), instance({ instanceId: "b" }))
      )
      await supervisor.settled()

      await supervisor.shutdown()
      expect(stub.calls.stop.sort()).toEqual(["a", "b"])
      // dispose runs for the reap pass at boot and again at shutdown.
      expect(stub.calls.dispose.filter((id) => id === "a").length).toBe(2)
    })

    it("reaps configured instances before starting them on boot", async () => {
      const stub = createStubAdapter()
      const supervisor = build([stub])

      supervisor.boot(effective(instance()))
      await supervisor.settled()

      expect(stub.calls.dispose).toContain("opencode")
    })
  })

  describe("lazy start for autoStart:false", () => {
    it("leaves the instance selectable without starting it at boot", async () => {
      const stub = createStubAdapter()
      const supervisor = build([stub])

      supervisor.boot(effective(instance({ autoStart: false })))
      await supervisor.settled()

      expect(supervisor.status("opencode")).toBe("configured")
      expect(supervisor.snapshot()[0]).toMatchObject({
        enabled: true,
        autoStart: false,
      })
      expect(stub.calls.start).toEqual([])
    })

    it("starts it on the first send and reuses the handle afterwards", async () => {
      const stub = createStubAdapter()
      const supervisor = build([stub])

      supervisor.boot(effective(instance({ autoStart: false })))
      await supervisor.settled()

      const handle = await supervisor.ensureStarted("opencode")
      expect(handle).toEqual({ instanceId: "opencode", driver: "opencode" })
      expect(supervisor.status("opencode")).toBe("ready")

      await supervisor.ensureStarted("opencode")
      expect(stub.calls.start).toEqual(["opencode"])
    })

    it("refuses to lazily start a disabled instance", async () => {
      const stub = createStubAdapter()
      const supervisor = build([stub])

      supervisor.boot(effective(instance({ enabled: false, autoStart: false })))
      await supervisor.settled()

      await expect(supervisor.ensureStarted("opencode")).rejects.toMatchObject({
        aideError: { code: "instance_disabled" },
      })
    })

    it("surfaces the start error when a lazy start cannot reach ready", async () => {
      const stub = createStubAdapter()
      stub.failStartsFor(
        1,
        Object.assign(new Error("nope"), {
          aideError: {
            code: "start_failed",
            message: "nope",
            instanceId: "opencode",
            retryable: false,
          },
        })
      )
      const supervisor = build([stub])

      supervisor.boot(effective(instance({ autoStart: false })))
      await supervisor.settled()

      await expect(supervisor.ensureStarted("opencode")).rejects.toMatchObject({
        aideError: { code: "start_failed" },
      })
    })
  })

  describe("inventory scoping", () => {
    it("passes the project directory to a directory-scoped adapter", async () => {
      const stub = createStubAdapter({ inventoryScope: "directory" })
      const supervisor = build([stub], { projectDirectory: "/work/repo" })

      supervisor.boot(effective(instance()))
      await supervisor.settled()

      expect(
        inventoryService.get({
          instanceId: "opencode",
          scope: "directory",
          directory: "/work/repo",
        })
      ).toBeDefined()
    })

    it("keys a runtime-scoped adapter without the directory", async () => {
      const stub = createStubAdapter({ inventoryScope: "runtime" })
      const supervisor = build([stub], { projectDirectory: "/work/repo" })

      supervisor.boot(effective(instance()))
      await supervisor.settled()

      expect(
        inventoryService.get({ instanceId: "opencode", scope: "runtime" })
      ).toBeDefined()
    })
  })
})
