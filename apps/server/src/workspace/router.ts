import { open, stat } from "node:fs/promises"
import { Hono } from "hono"
import type {
  FilePreview,
  FileSearchResult,
  ProjectList,
  SessionList,
  SessionSummaryList,
} from "@workspace/contracts"

import type { AideDb } from "../db"
import { artifactsRepo, projectsRepo, sessionsRepo } from "../db"
import type { AdapterRegistry } from "../services/adapter-registry"
import type { ExecutionResolver } from "../services/execution"
import { sessionDirectory } from "../services/project"
import { WorkspaceError } from "./errors"
import { searchFiles } from "./files"
import { summarizeSession } from "./summaries"
import { resolveRealWithinBoundary } from "./paths"

const MAX_LIMIT = 100
const PREVIEW_BYTES = 256 * 1024

/**
 * Read routes the browser needs beyond snapshots: the project and session
 * browser, file search and preview in a session's working directory (its
 * worktree when it has one), full tool output, and inventory for the
 * session's own directory. All of them are session-guarded when auth is on.
 */
export function createWorkspaceRouter({
  db,
  registry,
  resolver,
}: {
  db: AideDb
  registry?: AdapterRegistry
  resolver?: ExecutionResolver
}): Hono {
  const router = new Hono()

  const locate = (sessionId: string) => {
    const session = sessionsRepo.get(db, sessionId)
    if (!session) return undefined
    const project = projectsRepo.get(db, session.projectId)
    return project ? { session, project } : undefined
  }

  router.get("/projects", (c) => {
    const result: ProjectList = {
      projects: projectsRepo.list(db).map((project) => ({
        ...project,
        sessionCount: sessionsRepo.listByProject(db, project.id).length,
      })),
    }
    return c.json(result)
  })

  router.get("/projects/:projectId/sessions", (c) => {
    const projectId = c.req.param("projectId")
    if (!projectsRepo.get(db, projectId)) {
      return c.json({ error: "project_not_found" }, 404)
    }
    const result: SessionList = {
      sessions: sessionsRepo.listByProject(db, projectId),
    }
    return c.json(result)
  })

  router.get("/sessions", (c) => {
    const sessions = projectsRepo
      .list(db)
      .flatMap((project) =>
        sessionsRepo
          .listByProject(db, project.id)
          .map((session) => summarizeSession(db, session, project))
      )
      .sort((a, b) => b.session.updatedAt.localeCompare(a.session.updatedAt))
    const result: SessionSummaryList = { sessions }
    return c.json(result)
  })

  router.get("/sessions/:id/files", async (c) => {
    const found = locate(c.req.param("id"))
    if (!found) return c.json({ error: "session_not_found" }, 404)
    const requested = Number(c.req.query("limit") ?? 20)
    const limit = Number.isInteger(requested)
      ? Math.min(Math.max(requested, 1), MAX_LIMIT)
      : 20
    const root = sessionDirectory(found.session, found.project)
    const result: FileSearchResult = {
      root,
      files: await searchFiles(root, c.req.query("query") ?? "", limit),
    }
    return c.json(result)
  })

  router.get("/sessions/:id/file", async (c) => {
    const found = locate(c.req.param("id"))
    if (!found) return c.json({ error: "session_not_found" }, 404)
    const path = c.req.query("path")
    if (!path) return c.json({ error: "path_required" }, 400)
    const root = sessionDirectory(found.session, found.project)
    let resolved: string
    try {
      resolved = await resolveRealWithinBoundary(root, path)
    } catch (error) {
      if (error instanceof WorkspaceError) {
        return c.json({ error: error.code }, 403)
      }
      throw error
    }
    const info = await stat(resolved).catch(() => undefined)
    if (!info?.isFile()) return c.json({ error: "file_not_found" }, 404)
    const handle = await open(resolved, "r")
    try {
      const length = Math.min(info.size, PREVIEW_BYTES)
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, 0)
      const binary = buffer.includes(0)
      const result: FilePreview = {
        path,
        binary,
        truncated: info.size > PREVIEW_BYTES,
        size: info.size,
        ...(binary ? {} : { content: buffer.toString("utf8") }),
      }
      return c.json(result)
    } finally {
      await handle.close()
    }
  })

  router.get("/artifacts/:id", (c) => {
    const artifact = artifactsRepo.get(db, c.req.param("id"))
    if (!artifact) return c.json({ error: "artifact_not_found" }, 404)
    return new Response(new Uint8Array(artifact.data), {
      headers: { "content-type": artifact.mimeType },
    })
  })

  /**
   * Inventory for the session's project directory, where commands and skills
   * defined by the project itself live. Runtime-scoped instances have one
   * inventory regardless of directory.
   */
  router.get("/sessions/:id/inventory", async (c) => {
    const found = locate(c.req.param("id"))
    if (!found) return c.json({ error: "session_not_found" }, 404)
    const instanceId = c.req.query("instanceId")
    if (!instanceId) return c.json({ error: "instance_required" }, 400)
    if (!registry || !resolver) {
      return c.json({ error: "inventory_unavailable" }, 404)
    }
    let entry: ReturnType<AdapterRegistry["get"]>
    try {
      entry = registry.get(instanceId)
    } catch {
      return c.json({ error: "instance_not_running" }, 409)
    }
    const directory = found.project.directory
    const cached = resolver.inventory(instanceId, directory)
    const fresh =
      c.req.query("refresh") === "1" ||
      !cached ||
      entry.adapter.capabilities(entry.handle).inventoryScope !== "directory"
    try {
      return c.json(
        fresh ? await resolver.discover(instanceId, directory) : cached
      )
    } catch {
      return cached
        ? c.json(cached)
        : c.json({ error: "inventory_discovery_failed" }, 502)
    }
  })

  return router
}
