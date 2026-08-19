import {
  aideErrorSchema,
  commandSchema,
  type AideError,
  type Command,
  type CommandName,
  type CommandReceipt,
  type ReceiptState,
} from "@workspace/contracts"

import type { AideDb } from "../db"
import { receiptsRepo, withTransaction } from "../db"

type MaybePromise<T> = T | Promise<T>
type CommandFor<Name extends CommandName> = Extract<Command, { name: Name }>

const safeErrorNames = new Set([
  "AggregateError",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
])

export type LocalCommandHandler<Name extends CommandName = CommandName> = {
  kind: "local"
  /**
   * When true, the handler must be synchronous and runs inside the receipt
   * transaction: accepted receipt, domain effects, and the completed receipt
   * commit (or roll back) together.
   */
  transactional?: boolean
  handle(command: CommandFor<Name>, db: AideDb): MaybePromise<unknown>
}

export type ExternalCommandContext = {
  defer(): void
  markDispatching(nativeIdempotencyKey?: string): CommandReceipt
  markDispatched(
    acknowledgement?: unknown,
    persist?: (db: AideDb) => void
  ): CommandReceipt
  markUncertain(error: unknown): CommandReceipt
  complete(result?: unknown): CommandReceipt
  fail(error: unknown): CommandReceipt
}

export type ExternalCommandHandler<Name extends CommandName = CommandName> = {
  kind: "external"
  handle(
    command: CommandFor<Name>,
    context: ExternalCommandContext
  ): MaybePromise<void>
}

export type CommandHandler<Name extends CommandName = CommandName> =
  | LocalCommandHandler<Name>
  | ExternalCommandHandler<Name>

export type CommandHandlerRegistry = {
  [Name in CommandName]?: CommandHandler<Name>
}

export interface CommandDispatcher {
  dispatch(command: unknown): Promise<CommandReceipt>
}

const legalTransitions: Record<ReceiptState, ReadonlySet<ReceiptState>> = {
  accepted: new Set(["dispatching", "completed", "failed"]),
  dispatching: new Set(["dispatched", "uncertain"]),
  dispatched: new Set(["uncertain", "completed", "failed"]),
  uncertain: new Set(["completed", "failed"]),
  completed: new Set(),
  failed: new Set(),
}

export class ReceiptTransitionError extends Error {
  readonly from: ReceiptState
  readonly to: ReceiptState

  constructor(from: ReceiptState, to: ReceiptState) {
    super(`Illegal command receipt transition: ${from} -> ${to}`)
    this.name = "ReceiptTransitionError"
    this.from = from
    this.to = to
  }
}

export function assertReceiptTransition(
  from: ReceiptState,
  to: ReceiptState
): void {
  if (!legalTransitions[from].has(to)) {
    throw new ReceiptTransitionError(from, to)
  }
}

export function normalizeCommandError(
  error: unknown,
  options: { retryable: boolean; code?: string } = { retryable: false }
): AideError {
  if (typeof error === "object" && error !== null && "aideError" in error) {
    const nested = aideErrorSchema.safeParse(
      (error as { aideError: unknown }).aideError
    )
    if (nested.success) return nested.data
  }
  const parsed = aideErrorSchema.safeParse(error)
  if (parsed.success) return parsed.data

  const code = options.code ?? "command_handler_failed"
  const message =
    code === "execution_outcome_unknown"
      ? "Command execution outcome is unknown"
      : "Command handler failed"
  const detail =
    error instanceof Error
      ? { name: safeErrorNames.has(error.name) ? error.name : "Error" }
      : {
          type:
            error === null
              ? "null"
              : Array.isArray(error)
                ? "array"
                : typeof error,
        }

  return {
    code,
    message,
    retryable: options.retryable,
    detail,
  }
}

type DispatcherOptions = {
  db: AideDb
  handlers: CommandHandlerRegistry
  now?: () => string
}

export function createCommandDispatcher({
  db,
  handlers,
  now = () => new Date().toISOString(),
}: DispatcherOptions): CommandDispatcher {
  return {
    async dispatch(input: unknown): Promise<CommandReceipt> {
      const command = commandSchema.parse(input)
      const existing = receiptsRepo.get(db, command.commandId)
      if (existing) return existing

      let receipt = receiptsRepo.upsertAccepted(db, {
        commandId: command.commandId,
        commandName: command.name,
        createdAt: now(),
        updatedAt: now(),
      })

      // Another dispatcher may have inserted this id between get and insert.
      if (
        receipt.commandName !== command.name ||
        receipt.state !== "accepted"
      ) {
        return receipt
      }

      const transition = (
        state: ReceiptState,
        update: {
          nativeIdempotencyKey?: string
          acknowledgement?: unknown
          result?: unknown
          error?: AideError
        } = {},
        persist?: (db: AideDb) => void
      ): CommandReceipt => {
        const current = receiptsRepo.get(db, command.commandId)
        if (!current) {
          throw new Error(`Command receipt disappeared: ${command.commandId}`)
        }
        receipt = current
        // Adapter terminal events can win the race with a send acknowledgement.
        // A late acknowledgement must never regress an authoritative terminal receipt.
        if (
          state === "dispatched" &&
          (receipt.state === "completed" || receipt.state === "failed")
        ) {
          return receipt
        }
        assertReceiptTransition(receipt.state, state)
        const previousState = receipt.state
        const updated = withTransaction(db, (tx) => {
          const transitioned = receiptsRepo.transitionState(
            tx,
            command.commandId,
            previousState,
            state,
            {
              ...update,
              updatedAt: now(),
            }
          )
          if (!transitioned) {
            throw new Error(
              `Command receipt changed concurrently: ${command.commandId}`
            )
          }
          persist?.(tx)
          return transitioned
        })
        receipt = updated
        return receipt
      }

      const handler = handlers[command.name] as CommandHandler | undefined
      if (!handler) {
        return transition("failed", {
          error: {
            code: "command_handler_not_found",
            message: `No handler is registered for ${command.name}`,
            retryable: false,
          },
        })
      }

      if (handler.kind === "local") {
        if (handler.transactional) {
          return dispatchTransactionalLocal(handler, command)
        }
        try {
          const result = await handler.handle(command, db)
          return transition("completed", { result })
        } catch (error) {
          return transition("failed", {
            error: normalizeCommandError(error, { retryable: true }),
          })
        }
      }

      const context: ExternalCommandContext = {
        defer() {
          deferred = true
        },
        markDispatching(nativeIdempotencyKey = command.commandId) {
          return transition("dispatching", { nativeIdempotencyKey })
        },
        markDispatched(acknowledgement, persist) {
          return transition("dispatched", { acknowledgement }, persist)
        },
        markUncertain(error) {
          return transition("uncertain", {
            error: normalizeCommandError(error, {
              code: "execution_outcome_unknown",
              retryable: false,
            }),
          })
        },
        complete(result) {
          return transition("completed", { result })
        },
        fail(error) {
          return transition("failed", {
            error: normalizeCommandError(error),
          })
        },
      }

      let deferred = false
      try {
        await handler.handle(command, context)
        if (deferred) return receipt
        if (receipt.state === "accepted") {
          return transition("failed", {
            error: {
              code: "dispatch_not_started",
              message: "External command handler returned before dispatching",
              retryable: true,
            },
          })
        }
        if (receipt.state === "dispatching") {
          return context.markUncertain(
            new Error(
              "External command handler returned before acknowledgement"
            )
          )
        }
        return receipt
      } catch (error) {
        if (receipt.state === "accepted") {
          return transition("failed", {
            error: normalizeCommandError(error, { retryable: true }),
          })
        }
        if (receipt.state === "dispatching") {
          return context.markUncertain(error)
        }
        if (receipt.state === "dispatched") {
          return transition("failed", {
            error: normalizeCommandError(error),
          })
        }
        return receipt
      }
    },
  }

  function dispatchTransactionalLocal(
    handler: LocalCommandHandler<CommandName>,
    command: Command
  ): CommandReceipt {
    const acceptedInput = {
      commandId: command.commandId,
      commandName: command.name,
      createdAt: now(),
      updatedAt: now(),
    }

    try {
      return withTransaction(db, (tx) => {
        const accepted = receiptsRepo.upsertAccepted(tx, acceptedInput)
        if (
          accepted.commandName !== command.name ||
          accepted.state !== "accepted"
        ) {
          return accepted
        }
        const result = handler.handle(command, tx)
        if (result instanceof Promise) {
          throw new Error(
            `Transactional local handler ${command.name} must be synchronous`
          )
        }
        const completed = receiptsRepo.transitionState(
          tx,
          command.commandId,
          "accepted",
          "completed",
          { result, updatedAt: now() }
        )
        if (!completed) {
          throw new Error(`Command receipt disappeared: ${command.commandId}`)
        }
        return completed
      })
    } catch (error) {
      // The transaction rolled back: the accepted receipt, handler effects,
      // and completed receipt are all gone. Record the failure in a fresh
      // transaction so the commandId stays deduplicated.
      return withTransaction(db, (tx) => {
        const accepted = receiptsRepo.upsertAccepted(tx, acceptedInput)
        if (accepted.state !== "accepted") return accepted
        return (
          receiptsRepo.transitionState(
            tx,
            command.commandId,
            "accepted",
            "failed",
            {
              error: normalizeCommandError(error, { retryable: true }),
              updatedAt: now(),
            }
          ) ?? accepted
        )
      })
    }
  }
}
