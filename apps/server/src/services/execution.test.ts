import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  inventoryFixture,
  resolvedExecutionFixture,
  type HarnessInventory,
} from "@workspace/contracts"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createDb, inventoryCacheRepo } from "../db"
import { Database } from "../db/test/bun-sqlite-shim"
import { createFakeHarnessAdapter } from "../harness/fake"
import { AdapterRegistry } from "./adapter-registry"
import { ExecutionResolver } from "./execution"

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url)
)

function applyMigrations(client: Database): void {
  for (const file of readdirSync(migrationsFolder)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const migration = readFileSync(`${migrationsFolder}/${file}`, "utf8")
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) client.exec(statement)
    }
  }
}

describe("ExecutionResolver", () => {
  let client: Database
  let db: ReturnType<typeof createDb>

  beforeEach(() => {
    client = new Database(":memory:")
    applyMigrations(client)
    db = createDb(client)
  })

  afterEach(() => client.close())

  async function resolverFor(
    change: (inventory: HarnessInventory) => HarnessInventory = (value) => value
  ) {
    const registry = new AdapterRegistry()
    const { adapter } = createFakeHarnessAdapter()
    const instance = {
      instanceId: "opencode",
      driver: "opencode" as const,
      displayName: "Primary OpenCode",
      enabled: true,
      autoStart: true,
      config: {},
    }
    const handle = await adapter.start({ instance })
    adapter.discover = async () => change(inventoryFixture())
    registry.register({ adapter, handle, instance })
    return new ExecutionResolver(db, registry)
  }

  it("rejects unavailable instances and mismatched inventory identity", async () => {
    const empty = new ExecutionResolver(db, new AdapterRegistry())
    await expect(
      empty.resolve(resolvedExecutionFixture().selection, "/tmp/project")
    ).rejects.toMatchObject({
      aideError: { code: "adapter_instance_unavailable", retryable: true },
    })

    const resolver = await resolverFor((inventory) => ({
      ...inventory,
      instanceId: "another-instance",
    }))
    await expect(
      resolver.discover("opencode", "/tmp/project")
    ).rejects.toMatchObject({
      aideError: { code: "invalid_inventory_identity", retryable: false },
    })
    expect(inventoryCacheRepo.list(db)).toEqual([])
  })

  it("rejects stale inventory before resolving selections", async () => {
    const resolver = await resolverFor((inventory) => ({
      ...inventory,
      stale: true,
    }))

    await expect(
      resolver.resolve(resolvedExecutionFixture().selection, "/tmp/project")
    ).rejects.toMatchObject({
      aideError: { code: "inventory_stale", retryable: true },
    })
    expect(inventoryCacheRepo.get(db, "opencode", "/tmp/project")?.stale).toBe(
      true
    )
  })

  it.each([
    [
      "model_unavailable",
      { model: { providerId: "openai", modelId: "missing" } },
      undefined,
    ],
    ["agent_unavailable", { agent: "missing" }, undefined],
    [
      "agent_unsupported",
      { agent: "plan" },
      (inventory: HarnessInventory) => ({
        ...inventory,
        models: inventory.models.map((model) => ({
          ...model,
          supportedAgents: ["build"],
        })),
      }),
    ],
    ["interaction_mode_unavailable", { interactionMode: "missing" }, undefined],
    [
      "execution_option_unavailable",
      { options: { variant: "missing" } },
      undefined,
    ],
    [
      "execution_option_unavailable",
      { options: { unknown: "value" } },
      undefined,
    ],
  ])("rejects %s selections", async (code, patch, alter) => {
    const resolver = await resolverFor(alter)
    const selection = {
      ...resolvedExecutionFixture().selection,
      ...patch,
    }

    await expect(
      resolver.resolve(selection, "/tmp/project")
    ).rejects.toMatchObject({ aideError: expect.objectContaining({ code }) })
  })

  it("applies option defaults and maps selected labels without mutating input", async () => {
    const resolver = await resolverFor((inventory) => ({
      ...inventory,
      interactionModes: [{ id: "build", label: "Build mode" }],
    }))
    const selection = {
      ...resolvedExecutionFixture().selection,
      interactionMode: "build",
      options: {},
    }

    const resolved = await resolver.resolve(selection, "/tmp/project")

    expect(selection.options).toEqual({})
    expect(resolved).toMatchObject({
      selection: { options: { variant: "stable" } },
      display: {
        instanceName: "Primary OpenCode",
        modelName: "GPT-5",
        agentName: "Build",
        interactionModeName: "Build mode",
        options: {
          variant: { label: "Variant", valueLabel: "Stable" },
        },
      },
      inventoryRevision: "rev_1",
    })
  })
})
