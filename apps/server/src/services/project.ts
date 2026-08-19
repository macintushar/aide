import { basename, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import type { Project, Session } from "@workspace/contracts"

import type { AideDb } from "../db"
import { projectsRepo, sessionsRepo } from "../db"
import { CoreServiceError } from "./errors"

export type ProjectServiceOptions = {
  db: AideDb
  now?: () => string
  id?: (kind: "project" | "session") => string
}

export class ProjectService {
  readonly #db: AideDb
  readonly #now: () => string
  readonly #id: (kind: "project" | "session") => string

  constructor({
    db,
    now = () => new Date().toISOString(),
    id = (kind) => `${kind}_${randomUUID()}`,
  }: ProjectServiceOptions) {
    this.#db = db
    this.#now = now
    this.#id = id
  }

  /**
   * All mutating methods accept an optional transaction-scoped database so the
   * dispatcher's transactional local fast path can commit receipt and domain
   * effects atomically.
   */
  open(directory: string, projectName?: string, db = this.#db): Project {
    const normalized = resolve(directory)
    const now = this.#now()
    return projectsRepo.upsertByDirectory(db, {
      id: this.#id("project"),
      name: projectName ?? basename(normalized),
      directory: normalized,
      createdAt: now,
      lastOpenedAt: now,
    })
  }

  createSession(
    projectId: string,
    title = "New session",
    db = this.#db
  ): Session {
    if (!projectsRepo.get(db, projectId)) {
      throw new CoreServiceError(
        "project_not_found",
        `Project ${projectId} was not found`
      )
    }
    const now = this.#now()
    return sessionsRepo.create(db, {
      id: this.#id("session"),
      projectId,
      title,
      createdAt: now,
      updatedAt: now,
    })
  }

  renameSession(sessionId: string, title: string, db = this.#db): Session {
    const session = sessionsRepo.rename(db, sessionId, title, this.#now())
    if (!session) {
      throw new CoreServiceError(
        "session_not_found",
        `Session ${sessionId} was not found`
      )
    }
    return session
  }

  deleteSession(sessionId: string, db = this.#db): { deleted: true } {
    if (!sessionsRepo.delete(db, sessionId)) {
      throw new CoreServiceError(
        "session_not_found",
        `Session ${sessionId} was not found`
      )
    }
    return { deleted: true }
  }

  listSessions(projectId: string): Session[] {
    return sessionsRepo.listByProject(this.#db, projectId)
  }
}
