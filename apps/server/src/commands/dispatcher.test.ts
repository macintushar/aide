import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { commandReceiptSchema } from "@workspace/contracts"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createDb, projectsRepo, receiptsRepo } from "../db"
import { Database } from "../db/test/bun-sqlite-shim"
import {
  ReceiptTransitionError,
  assertReceiptTransition,
  createCommandDispatcher,
  type CommandHandlerRegistry,
} from "./dispatcher"

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

describe("command dispatcher", () => {
  let client: Database
  let db: ReturnType<typeof createDb>
  let tick: number

  beforeEach(() => {
    client = new Database(":memory:")
    applyMigrations(client)
    db = createDb(client)
    tick = 0
  })

  afterEach(() => client.close())

  function dispatcher(handlers: CommandHandlerRegistry) {
    return createCommandDispatcher({
      db,
      handlers,
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
    })
  }

  const command = {
    commandId: "cmd-1",
    name: "session.delete" as const,
    sessionId: "session-1",
  }

  it("runs a local command and completes it once", async () => {
    let calls = 0
    const subject = dispatcher({
      "session.delete": {
        kind: "local",
        handle: () => ({ deleted: ++calls }),
      },
    })

    const receipt = await subject.dispatch(command)

    expect(receipt.state).toBe("completed")
    expect(receipt.result).toEqual({ deleted: 1 })
    expect(receipt.updatedAt).not.toBe(receipt.createdAt)
    expect(commandReceiptSchema.parse(receipt)).toEqual(receipt)
  })

  it("returns the persisted receipt for a duplicate without invoking twice", async () => {
    let calls = 0
    const subject = dispatcher({
      "session.delete": {
        kind: "local",
        handle: () => ({ calls: ++calls }),
      },
    })

    const first = await subject.dispatch(command)
    const duplicate = await subject.dispatch(command)

    expect(duplicate).toEqual(first)
    expect(calls).toBe(1)
  })

  it("persists the full external dispatch lifecycle", async () => {
    const states: string[] = []
    const subject = dispatcher({
      "session.delete": {
        kind: "external",
        handle: (_command, context) => {
          states.push(context.markDispatching("native-key").state)
          states.push(context.markDispatched({ nativeId: "one" }).state)
          states.push(context.complete({ deleted: true }).state)
        },
      },
    })

    const receipt = await subject.dispatch(command)

    expect(states).toEqual(["dispatching", "dispatched", "completed"])
    expect(receipt).toEqual(receiptsRepo.get(db, command.commandId))
    expect(receipt.result).toEqual({ deleted: true })
  })

  it("commits acknowledgement persistence with the receipt transition", async () => {
    const subject = dispatcher({
      "session.delete": {
        kind: "external",
        handle: (_command, context) => {
          context.markDispatching("native-key")
          context.markDispatched({ nativeId: "one" }, (tx) => {
            expect(receiptsRepo.get(tx, command.commandId)?.state).toBe(
              "dispatched"
            )
            projectsRepo.upsertByDirectory(tx, {
              id: "project-ack",
              name: "Acknowledged",
              directory: "/tmp/acknowledged",
              createdAt: "2026-01-01T00:00:00.000Z",
              lastOpenedAt: "2026-01-01T00:00:00.000Z",
            })
          })
          context.complete()
        },
      },
    })

    const receipt = await subject.dispatch(command)

    expect(receipt.state).toBe("completed")
    expect(projectsRepo.get(db, "project-ack")).toBeDefined()
  })

  it("rolls back acknowledgement when its persistence callback fails", async () => {
    const subject = dispatcher({
      "session.delete": {
        kind: "external",
        handle: (_command, context) => {
          context.markDispatching("native-key")
          context.markDispatched(undefined, (tx) => {
            projectsRepo.upsertByDirectory(tx, {
              id: "project-rolled-back",
              name: "Rolled back",
              directory: "/tmp/rolled-back",
              createdAt: "2026-01-01T00:00:00.000Z",
              lastOpenedAt: "2026-01-01T00:00:00.000Z",
            })
            throw new Error("mapping acknowledgement failed")
          })
        },
      },
    })

    const receipt = await subject.dispatch(command)

    expect(receipt.state).toBe("uncertain")
    expect(projectsRepo.get(db, "project-rolled-back")).toBeUndefined()
  })

  it("records a pre-dispatch throw as a retryable failure", async () => {
    const subject = dispatcher({
      "session.delete": {
        kind: "external",
        handle: () => {
          throw new Error("known failure")
        },
      },
    })

    const receipt = await subject.dispatch(command)

    expect(receipt.state).toBe("failed")
    expect(receipt.error).toMatchObject({
      code: "command_handler_failed",
      message: "Command handler failed",
      retryable: true,
      detail: { name: "Error" },
    })
  })

  it("redacts generic errors from returned and persisted receipts", async () => {
    const secret = "/Users/operator/aide/src/private-handler.ts"
    const subject = dispatcher({
      "session.delete": {
        kind: "local",
        handle: () => {
          const error = new TypeError(`Failed while reading ${secret}`)
          error.stack = `TypeError: Failed while reading ${secret}\n    at ${secret}:1:1`
          throw error
        },
      },
    })

    const receipt = await subject.dispatch(command)
    const persisted = receiptsRepo.get(db, command.commandId)

    expect(receipt.error).toEqual({
      code: "command_handler_failed",
      message: "Command handler failed",
      retryable: true,
      detail: { name: "TypeError" },
    })
    expect(persisted).toEqual(receipt)
    expect(JSON.stringify(receipt)).not.toContain(secret)
    expect(JSON.stringify(persisted)).not.toContain(secret)
  })

  it("does not persist arbitrary non-Error thrown values", async () => {
    const secret = "/private/config/credentials.json"
    const subject = dispatcher({
      "session.delete": {
        kind: "local",
        handle: () => {
          throw { secret, credentials: { token: "do-not-persist" } }
        },
      },
    })

    const receipt = await subject.dispatch(command)

    expect(receipt.error).toEqual({
      code: "command_handler_failed",
      message: "Command handler failed",
      retryable: true,
      detail: { type: "object" },
    })
    expect(receiptsRepo.get(db, command.commandId)).toEqual(receipt)
    expect(JSON.stringify(receipt)).not.toContain(secret)
    expect(JSON.stringify(receipt)).not.toContain("do-not-persist")
  })

  it("does not trust arbitrary Error names as safe identity", async () => {
    const secret = "/private/error/name"
    const subject = dispatcher({
      "session.delete": {
        kind: "local",
        handle: () => {
          const error = new Error("failure")
          error.name = secret
          throw error
        },
      },
    })

    const receipt = await subject.dispatch(command)

    expect(receipt.error?.detail).toEqual({ name: "Error" })
    expect(JSON.stringify(receipt)).not.toContain(secret)
    expect(
      JSON.stringify(receiptsRepo.get(db, command.commandId))
    ).not.toContain(secret)
  })

  it("preserves structured domain error details", async () => {
    const domainError = {
      code: "session_not_found",
      message: "Session session-1 was not found",
      instanceId: "session-1",
      retryable: false,
      detail: { resource: "session", requestedId: "session-1" },
    }
    const subject = dispatcher({
      "session.delete": {
        kind: "local",
        handle: () => {
          throw Object.assign(new Error("internal wrapper"), {
            aideError: domainError,
          })
        },
      },
    })

    const receipt = await subject.dispatch(command)

    expect(receipt.error).toEqual(domainError)
    expect(receiptsRepo.get(db, command.commandId)?.error).toEqual(domainError)
  })

  it("records a throw after dispatch starts as uncertain", async () => {
    const subject = dispatcher({
      "session.delete": {
        kind: "external",
        handle: (_command, context) => {
          context.markDispatching()
          throw new Error("connection dropped")
        },
      },
    })

    const receipt = await subject.dispatch(command)

    expect(receipt.state).toBe("uncertain")
    expect(receipt.error).toMatchObject({
      code: "execution_outcome_unknown",
      message: "Command execution outcome is unknown",
      retryable: false,
    })
  })

  it("records a throw after acknowledgement as failed", async () => {
    const subject = dispatcher({
      "session.delete": {
        kind: "external",
        handle: (_command, context) => {
          context.markDispatching()
          context.markDispatched()
          throw new Error("terminal failure")
        },
      },
    })

    const receipt = await subject.dispatch(command)

    expect(receipt.state).toBe("failed")
    expect(receipt.error).toMatchObject({
      message: "Command handler failed",
      retryable: false,
    })
  })

  it("preserves an explicitly uncertain outcome", async () => {
    const subject = dispatcher({
      "session.delete": {
        kind: "external",
        handle: (_command, context) => {
          context.markDispatching()
          context.markDispatched()
          context.markUncertain(new Error("ambiguous terminal event"))
          throw new Error("ignored after explicit uncertainty")
        },
      },
    })

    const receipt = await subject.dispatch(command)

    expect(receipt.state).toBe("uncertain")
    expect(receipt.error?.message).toBe("Command execution outcome is unknown")
  })

  it("rejects illegal receipt transitions", () => {
    expect(() => assertReceiptTransition("accepted", "dispatched")).toThrow(
      ReceiptTransitionError
    )
    expect(() => assertReceiptTransition("completed", "failed")).toThrow(
      "completed -> failed"
    )
  })

  it("commits a transactional local command's receipt and effects atomically", async () => {
    const subject = dispatcher({
      "session.delete": {
        kind: "local",
        transactional: true,
        handle(_command, tx) {
          projectsRepo.upsertByDirectory(tx, {
            id: "project-atomic",
            name: "Atomic",
            directory: "/tmp/atomic",
            createdAt: "2026-01-01T00:00:00.000Z",
            lastOpenedAt: "2026-01-01T00:00:00.000Z",
          })
          return { deleted: true }
        },
      },
    })

    const receipt = await subject.dispatch(command)

    expect(receipt.state).toBe("completed")
    expect(receipt.result).toEqual({ deleted: true })
    expect(projectsRepo.get(db, "project-atomic")).toBeDefined()
    expect(receiptsRepo.get(db, command.commandId)?.state).toBe("completed")
  })

  it("rolls back a failed transactional local command and records only a failed receipt", async () => {
    const subject = dispatcher({
      "session.delete": {
        kind: "local",
        transactional: true,
        handle(_command, tx) {
          projectsRepo.upsertByDirectory(tx, {
            id: "project-rolled-back",
            name: "Rolled back",
            directory: "/tmp/rolled-back",
            createdAt: "2026-01-01T00:00:00.000Z",
            lastOpenedAt: "2026-01-01T00:00:00.000Z",
          })
          throw new Error("effect failed")
        },
      },
    })

    const receipt = await subject.dispatch(command)

    expect(receipt.state).toBe("failed")
    expect(receipt.error).toMatchObject({ retryable: true })
    expect(projectsRepo.get(db, "project-rolled-back")).toBeUndefined()
    expect(receiptsRepo.getRecord(db, command.commandId)?.state).toBe("failed")
  })

  it("exposes private receipt metadata through the record readback", async () => {
    const subject = dispatcher({
      "session.delete": {
        kind: "external",
        handle(_command, context) {
          context.markDispatching("native-key-1")
          context.markDispatched({ nativeId: "one" })
          context.complete({ deleted: true })
        },
      },
    })
    await subject.dispatch(command)

    const record = receiptsRepo.getRecord(db, command.commandId)
    expect(record).toMatchObject({
      state: "completed",
      nativeIdempotencyKey: "native-key-1",
      acknowledgement: { nativeId: "one" },
    })
    expect(receiptsRepo.listRecordsByStates(db, ["completed"])).toHaveLength(1)
  })
})
