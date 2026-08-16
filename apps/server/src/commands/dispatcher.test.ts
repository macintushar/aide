import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { commandReceiptSchema } from "@workspace/contracts"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createDb, receiptsRepo } from "../db"
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
      message: "known failure",
      retryable: true,
      detail: { name: "Error" },
    })
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
      message: "connection dropped",
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
      message: "terminal failure",
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
    expect(receipt.error?.message).toBe("ambiguous terminal event")
  })

  it("rejects illegal receipt transitions", () => {
    expect(() => assertReceiptTransition("accepted", "dispatched")).toThrow(
      ReceiptTransitionError
    )
    expect(() => assertReceiptTransition("completed", "failed")).toThrow(
      "completed -> failed"
    )
  })
})
