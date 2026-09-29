import { Hono } from "hono"
import type { FileSearchResult } from "@workspace/contracts"

import type { AideDb } from "../db"
import { projectsRepo, sessionsRepo } from "../db"
import { sessionDirectory } from "../services/project"
import { searchFiles } from "./files"

const MAX_LIMIT = 100

/**
 * File search in a session's working directory (its worktree when it has
 * one), for linking files from the composer. Paths come back relative to that
 * directory.
 */
export function createWorkspaceRouter({ db }: { db: AideDb }): Hono {
  const router = new Hono()

  router.get("/sessions/:id/files", async (c) => {
    const session = sessionsRepo.get(db, c.req.param("id"))
    if (!session) return c.json({ error: "session_not_found" }, 404)
    const project = projectsRepo.get(db, session.projectId)
    if (!project) return c.json({ error: "project_not_found" }, 404)
    const requested = Number(c.req.query("limit") ?? 20)
    const limit = Number.isInteger(requested)
      ? Math.min(Math.max(requested, 1), MAX_LIMIT)
      : 20
    const root = sessionDirectory(session, project)
    const result: FileSearchResult = {
      root,
      files: await searchFiles(root, c.req.query("query") ?? "", limit),
    }
    return c.json(result)
  })

  return router
}
