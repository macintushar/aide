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

  open(directory: string, projectName?: string): Project {
    const normalized = resolve(directory)
    const now = this.#now()
    return projectsRepo.upsertByDirectory(this.#db, {
      id: this.#id("project"),
      name: projectName ?? basename(normalized),
      directory: normalized,
      createdAt: now,
      lastOpenedAt: now,
    })
  }

  createSession(projectId: string, title = "New session"): Session {
    if (!projectsRepo.get(this.#db, projectId)) {
      throw new CoreServiceError(
        "project_not_found",
        `Project ${projectId} was not found`
      )
    }
    const now = this.#now()
    return sessionsRepo.create(this.#db, {
      id: this.#id("session"),
      projectId,
      title,
      createdAt: now,
      updatedAt: now,
    })
  }

  renameSession(sessionId: string, title: string): Session {
    const session = sessionsRepo.rename(this.#db, sessionId, title, this.#now())
    if (!session) {
      throw new CoreServiceError(
        "session_not_found",
        `Session ${sessionId} was not found`
      )
    }
    return session
  }

  deleteSession(sessionId: string): { deleted: true } {
    if (!sessionsRepo.delete(this.#db, sessionId)) {
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
