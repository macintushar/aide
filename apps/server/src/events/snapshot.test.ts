import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  inventoryFixture,
  projectFixture,
  sessionFixture,
  type AideConfig,
} from "@workspace/contracts"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  configRepo,
  createDb,
  inventoryCacheRepo,
  projectsRepo,
  sessionsRepo,
} from "../db"
import { Database } from "../db/test/bun-sqlite-shim"
import { SnapshotNotFoundError, SnapshotService } from "./snapshot"

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url)
)
const timestamp = "2026-01-01T00:00:00.000Z"

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

function config(instances: AideConfig["instances"]): AideConfig {
  return { instances, mcpServers: {}, defaults: {} }
}

describe("snapshot service branches", () => {
  let client: Database
  let db: ReturnType<typeof createDb>
  let snapshots: SnapshotService

  beforeEach(() => {
    client = new Database(":memory:")
    client.exec("PRAGMA foreign_keys = ON")
    applyMigrations(client)
    db = createDb(client)
    snapshots = new SnapshotService(db)
  })

  afterEach(() => client.close())

  it("reports a missing session with its resource and id", () => {
    expect(() => snapshots.sessionSnapshot("missing")).toThrowError(
      expect.objectContaining({
        name: "SnapshotNotFoundError",
        resource: "session",
        id: "missing",
        message: "session missing was not found",
      })
    )
  })

  it("reports a session whose project no longer exists", () => {
    projectsRepo.upsertByDirectory(db, projectFixture())
    sessionsRepo.create(db, sessionFixture())
    client.exec("PRAGMA foreign_keys = OFF")
    client.exec("DELETE FROM projects WHERE id = 'proj_1'")

    expect(() => snapshots.sessionSnapshot("ses_1")).toThrowError(
      new SnapshotNotFoundError("project", "proj_1")
    )
  })

  it("returns an empty instances snapshot without config or inventory", () => {
    expect(snapshots.instancesSnapshot()).toEqual({
      schemaVersion: 1,
      scope: { kind: "instances" },
      cursor: { sequence: 0 },
      instances: [],
    })
  })

  it("builds sorted configured instances with config defaults", () => {
    configRepo.put(
      db,
      config({
        zed: {
          instanceId: "zed",
          driver: "opencode",
          enabled: true,
          autoStart: true,
          config: {},
        },
        alpha: {
          instanceId: "alpha",
          driver: "claudeAgent",
          displayName: "Alpha",
          enabled: false,
          autoStart: false,
          config: {},
        },
      }),
      timestamp
    )

    expect(snapshots.instancesSnapshot().instances).toEqual([
      expect.objectContaining({
        instanceId: "alpha",
        driver: "claudeAgent",
        displayName: "Alpha",
        enabled: false,
        autoStart: false,
        status: "configured",
        auth: { status: "unknown" },
      }),
      expect.objectContaining({
        instanceId: "zed",
        driver: "opencode",
        enabled: true,
        autoStart: true,
      }),
    ])
  })

  it("uses the newest inventory per instance and inventory defaults", () => {
    inventoryCacheRepo.put(db, "/older", {
      ...inventoryFixture(),
      revision: "rev_old",
      discoveredAt: "2025-01-01T00:00:00.000Z",
    })
    const newest = {
      ...inventoryFixture(),
      revision: "rev_new",
      discoveredAt: "2026-01-02T00:00:00.000Z",
      stale: true,
    }
    inventoryCacheRepo.put(db, "/newer", newest)

    expect(snapshots.instancesSnapshot().instances).toEqual([
      expect.objectContaining({
        instanceId: "opencode",
        driver: "opencode",
        enabled: false,
        autoStart: false,
        status: "degraded",
        auth: newest.auth,
        inventory: newest,
      }),
    ])
  })
})
