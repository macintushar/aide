import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createDb, projectsRepo, sessionsRepo } from "../db"
import { Database } from "../db/test/bun-sqlite-shim"
import { ProjectService } from "./project"

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

describe("ProjectService", () => {
  let client: Database
  let db: ReturnType<typeof createDb>
  let service: ProjectService
  let tick: number
  let sequence: number

  beforeEach(() => {
    client = new Database(":memory:")
    client.exec("PRAGMA foreign_keys = ON")
    applyMigrations(client)
    db = createDb(client)
    tick = 0
    sequence = 0
    service = new ProjectService({
      db,
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
      id: (kind) => `${kind}_${++sequence}`,
    })
  })

  afterEach(() => client.close())

  it("opens normalized directories and reuses their project identity", () => {
    const first = service.open("/tmp/aide/../aide")
    const reopened = service.open("/tmp/aide", "Renamed project")

    expect(first).toMatchObject({
      id: "project_1",
      name: "aide",
      directory: "/tmp/aide",
    })
    expect(reopened).toMatchObject({
      id: first.id,
      name: "Renamed project",
      createdAt: first.createdAt,
    })
    expect(reopened.lastOpenedAt).not.toBe(first.lastOpenedAt)
    expect(projectsRepo.list(db)).toEqual([reopened])
  })

  it("creates, lists, renames, and deletes sessions", () => {
    const project = service.open("/tmp/aide")
    const first = service.createSession(project.id)
    const second = service.createSession(project.id, "Second")

    expect(first.title).toBe("New session")
    expect(service.listSessions(project.id)).toEqual([second, first])
    expect(service.renameSession(first.id, "Renamed")).toMatchObject({
      id: first.id,
      title: "Renamed",
    })
    expect(service.deleteSession(second.id)).toEqual({ deleted: true })
    expect(sessionsRepo.get(db, second.id)).toBeUndefined()
  })

  it("reports missing projects and sessions", () => {
    expect(() => service.createSession("missing")).toThrowError(
      expect.objectContaining({
        aideError: expect.objectContaining({ code: "project_not_found" }),
      })
    )
    expect(() => service.renameSession("missing", "Nope")).toThrowError(
      expect.objectContaining({
        aideError: expect.objectContaining({ code: "session_not_found" }),
      })
    )
    expect(() => service.deleteSession("missing")).toThrowError(
      expect.objectContaining({
        aideError: expect.objectContaining({ code: "session_not_found" }),
      })
    )
    expect(service.listSessions("missing")).toEqual([])
  })
})
