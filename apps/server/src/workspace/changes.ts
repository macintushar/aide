import {
  sessionFileChangesRepo,
  withTransaction,
  type AideDb,
  type SessionFileChange,
} from "../db"
import { gitStatus, type WorkspaceFileChange } from "./git"

export type SessionChangesOptions = {
  now?: () => string
  /** Overridable so tests can drive attribution without a real repository. */
  status?: (directory: string) => Promise<WorkspaceFileChange[]>
}

export type CaptureInput = {
  sessionId: string
  directory: string
  /**
   * The turn to credit for anything that appears or changes since the last
   * capture. Omit for a baseline capture, which records pre-existing changes
   * without attributing them to any turn.
   */
  turnId?: string
}

function sameChange(
  previous: SessionFileChange,
  current: WorkspaceFileChange
): boolean {
  return (
    previous.staged === current.staged &&
    previous.unstaged === current.unstaged &&
    previous.untracked === current.untracked
  )
}

/**
 * Tracks which files a session has touched by diffing successive git status
 * readings. A capture taken before a turn runs establishes the baseline; the
 * capture taken after it credits everything new or changed to that turn, so
 * pre-existing working tree edits are never misattributed.
 */
export class SessionChangesTracker {
  readonly #db: AideDb
  readonly #now: () => string
  readonly #status: (directory: string) => Promise<WorkspaceFileChange[]>

  constructor(db: AideDb, options: SessionChangesOptions = {}) {
    this.#db = db
    this.#now = options.now ?? (() => new Date().toISOString())
    this.#status = options.status ?? gitStatus
  }

  async capture(input: CaptureInput): Promise<SessionFileChange[]> {
    const current = await this.#status(input.directory)
    const observedAt = this.#now()
    return withTransaction(this.#db, (tx) => {
      const previous = new Map(
        sessionFileChangesRepo
          .listBySession(tx, input.sessionId)
          .map((change) => [change.path, change])
      )
      for (const change of current) {
        const prior = previous.get(change.path)
        previous.delete(change.path)
        const attributed =
          prior === undefined || !sameChange(prior, change)
            ? (input.turnId ?? prior?.turnId)
            : prior.turnId
        sessionFileChangesRepo.put(tx, {
          sessionId: input.sessionId,
          path: change.path,
          ...(attributed ? { turnId: attributed } : {}),
          staged: change.staged,
          unstaged: change.unstaged,
          untracked: change.untracked,
          firstSeenAt: prior?.firstSeenAt ?? observedAt,
          lastSeenAt: observedAt,
        })
      }
      // Anything the working tree no longer reports matches HEAD again.
      for (const path of previous.keys()) {
        sessionFileChangesRepo.remove(tx, input.sessionId, path)
      }
      return sessionFileChangesRepo.listBySession(tx, input.sessionId)
    })
  }

  list(sessionId: string): SessionFileChange[] {
    return sessionFileChangesRepo.listBySession(this.#db, sessionId)
  }

  listByTurn(turnId: string): SessionFileChange[] {
    return sessionFileChangesRepo.listByTurn(this.#db, turnId)
  }
}
