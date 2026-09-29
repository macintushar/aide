import { basename, join, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import type {
  Message,
  Part,
  Project,
  Session,
  WorktreeRequest,
} from "@workspace/contracts"

import type { AideDb } from "../db"
import {
  messagesRepo,
  nativeMappingsRepo,
  projectsRepo,
  sessionsRepo,
  turnsRepo,
  withTransaction,
} from "../db"
import { createWorktree, removeWorktree } from "../workspace/worktrees"
import { CoreServiceError } from "./errors"

export type ProjectServiceOptions = {
  db: AideDb
  now?: () => string
  id?: (kind: "project" | "session" | "message" | "part") => string
  /**
   * Where Aide creates session worktrees. Omit to disable worktrees; a request
   * for one then fails rather than silently running in the project.
   */
  worktreeRoot?: string
}

const TERMINAL = new Set(["completed", "interrupted", "failed"])

/** The directory a session's turns run in: its worktree, else the project. */
export function sessionDirectory(session: Session, project: Project): string {
  return session.worktree?.path ?? project.directory
}

export class ProjectService {
  readonly #db: AideDb
  readonly #now: () => string
  readonly #id: NonNullable<ProjectServiceOptions["id"]>
  readonly #worktreeRoot: string | undefined

  constructor({
    db,
    now = () => new Date().toISOString(),
    id = (kind) => `${kind}_${randomUUID()}`,
    worktreeRoot,
  }: ProjectServiceOptions) {
    this.#db = db
    this.#now = now
    this.#id = id
    this.#worktreeRoot = worktreeRoot ? resolve(worktreeRoot) : undefined
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

  /** Creates a session that runs in a new Aide worktree of the project. */
  async createWorktreeSession(
    projectId: string,
    worktree: WorktreeRequest,
    title = "New session"
  ): Promise<Session> {
    const project = this.#requireProject(projectId)
    const id = this.#id("session")
    const created = await this.#createWorktree(project, id, worktree)
    const now = this.#now()
    return sessionsRepo.create(this.#db, {
      id,
      projectId,
      title,
      createdAt: now,
      updatedAt: now,
      worktree: created,
    })
  }

  /**
   * Copies a session's settled history into a new session. Turns are not
   * copied, only the messages they produced; with no native sessions of its
   * own, the fork's first turn hands the copied history to whichever harness
   * runs it.
   */
  async forkSession(input: {
    sessionId: string
    throughTurnId?: string
    title?: string
    worktree?: WorktreeRequest
  }): Promise<Session> {
    const source = this.#requireSession(input.sessionId)
    const project = this.#requireProject(source.projectId)
    const messages = messagesRepo.listBySession(this.#db, source.id)
    const turns = turnsRepo.listBySession(this.#db, source.id)
    // A turn's messages are not contiguous in sequence (steering lands after
    // later turns are queued), so the fork selects whole turns, not a range.
    let included = turns.filter((turn) => TERMINAL.has(turn.status))
    if (input.throughTurnId) {
      const turn = turns.find(
        (candidate) => candidate.id === input.throughTurnId
      )
      if (!turn) {
        throw new CoreServiceError(
          "turn_not_found",
          `Turn ${input.throughTurnId} is not part of session ${source.id}`
        )
      }
      if (!TERMINAL.has(turn.status)) {
        throw new CoreServiceError(
          "turn_not_settled",
          `Turn ${turn.id} is still ${turn.status}; fork after it finishes`
        )
      }
      included = included.filter((candidate) => candidate.seq <= turn.seq)
    }
    const includedTurnIds = new Set(included.map((turn) => turn.id))
    const turnByUserMessage = new Map(
      turns.map((turn) => [turn.userMessageId, turn.id])
    )
    const copied = messages.filter((message) => {
      if (message.role === "user") {
        // Steering belongs to the turn it was delivered into.
        const turnId = message.steer
          ? message.steer.turnId
          : turnByUserMessage.get(message.id)
        return turnId !== undefined && includedTurnIds.has(turnId)
      }
      const turnId = turnByUserMessage.get(message.parentMessageId)
      return turnId !== undefined && includedTurnIds.has(turnId)
    })

    const id = this.#id("session")
    const created = input.worktree
      ? await this.#createWorktree(project, id, input.worktree)
      : undefined
    const now = this.#now()
    const lastSeq = copied.at(-1)?.seq
    return withTransaction(this.#db, (tx) => {
      const session = sessionsRepo.create(tx, {
        id,
        projectId: project.id,
        title: input.title ?? `${source.title} (fork)`,
        createdAt: now,
        updatedAt: now,
        // Without a worktree of its own, the fork works where its source did.
        ...(created
          ? { worktree: created }
          : source.worktree
            ? { worktree: source.worktree }
            : {}),
        ...(lastSeq !== undefined
          ? {
              forkedFrom: {
                sessionId: source.id,
                throughMessageSeq: lastSeq,
              },
            }
          : {}),
      })
      const ids = new Map<string, string>()
      for (const message of copied) {
        const messageId = this.#id("message")
        ids.set(message.id, messageId)
        const parts = message.parts.map((part): Part => ({
          ...part,
          id: this.#id("part"),
          messageId,
        }))
        copyMessage(tx, message, session.id, messageId, parts, ids)
      }
      return session
    })
  }

  /** Removes a session's worktree. The session keeps its history. */
  async removeWorktree(
    sessionId: string,
    deleteBranch = false
  ): Promise<Session> {
    const session = this.#requireSession(sessionId)
    const project = this.#requireProject(session.projectId)
    const worktree = session.worktree
    if (!worktree) {
      throw new CoreServiceError(
        "worktree_not_found",
        `Session ${sessionId} has no worktree`
      )
    }
    if (turnsRepo.listOpenBySession(this.#db, sessionId).length > 0) {
      throw new CoreServiceError(
        "session_busy",
        `Session ${sessionId} has a queued or running turn`
      )
    }
    const sharing = sessionsRepo
      .listByProject(this.#db, project.id)
      .filter(
        (other) =>
          other.id !== sessionId && other.worktree?.path === worktree.path
      )
    if (sharing.length === 0) {
      await removeWorktree({
        projectDirectory: project.directory,
        path: worktree.path,
        branch: worktree.branch,
        deleteBranch,
      })
    }
    return withTransaction(this.#db, (tx) => {
      // Native sessions were bound to the worktree directory, which is gone.
      nativeMappingsRepo.markSessionUnsafe(tx, sessionId)
      return sessionsRepo.setWorktree(tx, sessionId, undefined, this.#now())!
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

  /**
   * Deletes a session. Its worktree directory goes with it unless another
   * session still works there; the branch is kept so no commits are lost.
   * A worktree that cannot be removed (for example, uncommitted changes)
   * fails the deletion rather than orphaning it.
   */
  async deleteSession(
    sessionId: string,
    db = this.#db
  ): Promise<{ deleted: true }> {
    const session = sessionsRepo.get(db, sessionId)
    if (!session) {
      throw new CoreServiceError(
        "session_not_found",
        `Session ${sessionId} was not found`
      )
    }
    if (turnsRepo.listOpenBySession(db, sessionId).length > 0) {
      throw new CoreServiceError(
        "session_busy",
        `Session ${sessionId} has a queued or running turn`
      )
    }
    const worktree = session.worktree
    if (worktree) {
      const shared = sessionsRepo
        .listByProject(db, session.projectId)
        .some(
          (other) =>
            other.id !== sessionId && other.worktree?.path === worktree.path
        )
      const project = projectsRepo.get(db, session.projectId)
      if (!shared && project) {
        await removeWorktree({
          projectDirectory: project.directory,
          path: worktree.path,
          branch: worktree.branch,
          // Uncommitted work is not preserved by keeping the branch, so a
          // dirty worktree blocks deletion; remove it explicitly instead.
          force: false,
        })
      }
    }
    sessionsRepo.delete(db, sessionId)
    return { deleted: true }
  }

  listSessions(projectId: string): Session[] {
    return sessionsRepo.listByProject(this.#db, projectId)
  }

  async #createWorktree(
    project: Project,
    sessionId: string,
    request: WorktreeRequest
  ): Promise<Session["worktree"]> {
    if (!this.#worktreeRoot) {
      throw new CoreServiceError(
        "worktrees_unavailable",
        "This server has no worktree directory configured"
      )
    }
    const short = sessionId.replace(/[^A-Za-z0-9]/g, "").slice(-8)
    return createWorktree({
      projectDirectory: project.directory,
      path: join(this.#worktreeRoot, project.id, sessionId),
      branch: request.branch ?? `aide/${short}`,
      ...(request.baseRef ? { baseRef: request.baseRef } : {}),
    })
  }

  #requireProject(projectId: string): Project {
    const project = projectsRepo.get(this.#db, projectId)
    if (!project) {
      throw new CoreServiceError(
        "project_not_found",
        `Project ${projectId} was not found`
      )
    }
    return project
  }

  #requireSession(sessionId: string): Session {
    const session = sessionsRepo.get(this.#db, sessionId)
    if (!session) {
      throw new CoreServiceError(
        "session_not_found",
        `Session ${sessionId} was not found`
      )
    }
    return session
  }
}

function copyMessage(
  db: AideDb,
  message: Message,
  sessionId: string,
  messageId: string,
  parts: Part[],
  ids: Map<string, string>
): void {
  if (message.role === "user") {
    const { steer: _steer, seq: _seq, ...rest } = message
    messagesRepo.createUser(db, { ...rest, id: messageId, sessionId, parts })
    return
  }
  const { seq: _seq, ...rest } = message
  messagesRepo.createAssistant(db, {
    ...rest,
    id: messageId,
    sessionId,
    parentMessageId: ids.get(message.parentMessageId)!,
    parts,
  })
}
