import { z } from "zod"
import {
  inventoryFixture,
  type DriverId,
  type HarnessCapabilities,
  type InstanceConfig,
} from "@workspace/contracts"
import { afterEach, describe, expect, it } from "vitest"

import { configRepo, type AideDb } from "../db"
import type { Database } from "../db/test/bun-sqlite-shim"
import type { HarnessAdapter } from "../harness/types"
import { createTestDb } from "../test/db"
import { startProductionServer } from "./production"

const capabilities: HarnessCapabilities = {
  inventoryScope: "runtime",
  agentSelection: true,
  interactionModes: [{ id: "build", label: "Build", isDefault: true }],
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

function lifecycleAdapter(driver: DriverId, order: string[]) {
  const started = new Set<string>()
  const mcp = new Map<string, string[]>()
  const calls = {
    start: [] as string[],
    stop: [] as string[],
    mcp: [] as Array<{ instanceId: string; names: string[] }>,
  }
  const adapter: HarnessAdapter = {
    driver,
    configSchema: z.strictObject({ valid: z.literal(true) }),
    capabilities: () => capabilities,
    async start({ instance }) {
      order.push(`start:${instance.instanceId}`)
      calls.start.push(instance.instanceId)
      started.add(instance.instanceId)
      return { instanceId: instance.instanceId, driver }
    },
    async stop({ handle }) {
      calls.stop.push(handle.instanceId)
      started.delete(handle.instanceId)
    },
    async health({ handle }) {
      if (!started.has(handle.instanceId)) throw new Error("not started")
      return {
        status: "ready",
        version: `${driver}-1.0.0`,
        installed: true,
        auth: { status: "authenticated", type: "test" },
      }
    },
    async discover({ handle }) {
      return {
        ...inventoryFixture(),
        instanceId: handle.instanceId,
        driver,
        revision: `inventory-${handle.instanceId}`,
        capabilities,
        auth: { status: "authenticated", type: "test" },
      }
    },
    async setMcpServers({ handle, servers }) {
      const names = Object.keys(servers).sort()
      mcp.set(handle.instanceId, names)
      calls.mcp.push({ instanceId: handle.instanceId, names })
    },
    async mcpStatus({ handle }) {
      return (mcp.get(handle.instanceId) ?? []).map((name) => ({
        name,
        connected: true,
      }))
    },
    async dispose() {},
    async openSession() {
      throw new Error("Wave 3")
    },
    async resumeSession() {
      throw new Error("Wave 3")
    },
    async send() {
      throw new Error("Wave 3")
    },
    async interrupt() {
      throw new Error("Wave 3")
    },
    async respondToPermission() {
      throw new Error("Wave 3")
    },
    async respondToInput() {
      throw new Error("Wave 3")
    },
    events() {
      throw new Error("Wave 3")
    },
  }
  return { adapter, calls }
}

function instance(
  instanceId: string,
  driver: DriverId,
  config: unknown = { valid: true }
): InstanceConfig {
  return {
    instanceId,
    driver,
    enabled: true,
    autoStart: true,
    config,
  }
}

describe("Gate G2 production integration", () => {
  let client: Database
  let db: AideDb

  afterEach(() => client?.close())

  it("boots isolated lifecycle instances and hot-reconciles persisted config", async () => {
    ;({ client, db } = createTestDb())
    const order: string[] = []
    const opencode = lifecycleAdapter("opencode", order)
    const claude = lifecycleAdapter("claudeAgent", order)
    configRepo.put(db, {
      instances: {
        opencode: instance("opencode", "opencode"),
        claudeA: instance("claudeA", "claudeAgent"),
        claudeB: instance("claudeB", "claudeAgent"),
        malformed: instance("malformed", "opencode", { valid: false }),
      },
      mcpServers: {
        shared: { type: "http", url: "https://mcp.example.test" },
      },
      defaults: {},
    })
    let stopCount = 0
    const server = await startProductionServer({
      db,
      adapters: [opencode.adapter, claude.adapter],
      serve: () => {
        order.push("bind")
        return {
          stop() {
            stopCount += 1
          },
        }
      },
    })
    await server.supervisor.settled()

    expect(order[0]).toBe("bind")
    expect(opencode.calls.start).toEqual(["opencode"])
    expect(claude.calls.start.sort()).toEqual(["claudeA", "claudeB"])

    const response = await server.app.request("/instances")
    const snapshot = (await response.json()) as {
      instances: Array<Record<string, unknown>>
    }
    expect(snapshot.instances).toHaveLength(3)
    expect(snapshot.instances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instanceId: "opencode",
          status: "ready",
          version: "opencode-1.0.0",
          installed: true,
          auth: { status: "authenticated", type: "test" },
          inventory: expect.objectContaining({
            revision: "inventory-opencode",
          }),
        }),
        expect.objectContaining({ instanceId: "claudeA", status: "ready" }),
        expect.objectContaining({ instanceId: "claudeB", status: "ready" }),
      ])
    )
    expect(
      server.eventService
        .listDurable({
          scope: { kind: "instances" },
          cursor: server.eventService.cursor({ kind: "instances" }, 0),
        })
        .find(
          (event) =>
            event.type === "harness.instance_failed" &&
            event.instanceId === "malformed"
        )
    ).toBeDefined()

    const configResponse = await server.app.request("/config")
    await expect(configResponse.json()).resolves.toMatchObject({
      instances: { claudeA: { driver: "claudeAgent" } },
    })
    const emptyProjectResponse = await server.app.request(
      "/projects/project-empty/config"
    )
    await expect(emptyProjectResponse.json()).resolves.toEqual({
      projectId: "project-empty",
    })

    await server.services.config.update({
      commandId: "command_mcp_hot_update",
      name: "config.update",
      target: { kind: "global" },
      config: {
        mcpServers: {
          replacement: { type: "sse", url: "https://mcp.example.test/sse" },
        },
      },
    })

    expect(opencode.calls.start).toEqual(["opencode"])
    expect(claude.calls.start.sort()).toEqual(["claudeA", "claudeB"])
    expect(opencode.calls.mcp.at(-1)?.names).toEqual(["replacement"])
    expect(
      claude.calls.mcp.filter((call) => call.names[0] === "replacement")
    ).toHaveLength(2)

    await Promise.all([server.shutdown(), server.shutdown()])
    expect(stopCount).toBe(1)
  })
})
