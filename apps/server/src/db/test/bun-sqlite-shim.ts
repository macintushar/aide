import { DatabaseSync } from "node:sqlite"

export type RunResult = {
  changes: number | bigint
  lastInsertRowid: number | bigint
}

type StmtParams = unknown[]

type ShimStatement = {
  all: (...params: StmtParams) => Record<string, unknown>[]
  get: (...params: StmtParams) => Record<string, unknown> | undefined
  run: (...params: StmtParams) => RunResult
  values: (...params: StmtParams) => unknown[][]
}

type TransactionFn<T> = () => T

type WrappedTransaction<T> = (() => T) & {
  deferred: () => T
  immediate: () => T
  exclusive: () => T
}

export class Database {
  readonly filename: string
  #db: DatabaseSync

  constructor(filename = ":memory:") {
    this.filename = filename
    this.#db = new DatabaseSync(filename)
  }

  prepare(sql: string): ShimStatement {
    const stmt = this.#db.prepare(sql)
    return {
      all: (...params: StmtParams) =>
        stmt.all(...(params as Parameters<typeof stmt.all>)) as Record<
          string,
          unknown
        >[],
      get: (...params: StmtParams) =>
        stmt.get(...(params as Parameters<typeof stmt.get>)) as
          | Record<string, unknown>
          | undefined,
      run: (...params: StmtParams) =>
        stmt.run(...(params as Parameters<typeof stmt.run>)) as RunResult,
      values: (...params: StmtParams) =>
        (
          stmt.all(...(params as Parameters<typeof stmt.all>)) as Record<
            string,
            unknown
          >[]
        ).map((row) => Object.values(row)),
    }
  }

  exec(sql: string): void {
    this.#db.exec(sql)
  }

  transaction<T>(fn: TransactionFn<T>): WrappedTransaction<T> {
    const run = (mode: "DEFERRED" | "IMMEDIATE" | "EXCLUSIVE"): T => {
      this.#db.exec(`BEGIN ${mode}`)
      try {
        const result = fn()
        this.#db.exec("COMMIT")
        return result
      } catch (err) {
        try {
          this.#db.exec("ROLLBACK")
        } catch {
          // best-effort rollback; surface the original error
        }
        throw err
      }
    }
    const wrapped = () => run("DEFERRED")
    wrapped.deferred = () => run("DEFERRED")
    wrapped.immediate = () => run("IMMEDIATE")
    wrapped.exclusive = () => run("EXCLUSIVE")
    return wrapped
  }

  loadExtension(): void {}

  close(): void {
    this.#db.close()
  }
}
