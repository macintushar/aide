import {
  aideConfigSchema,
  aideEventSchema,
  assistantMessageSchema,
  commandReceiptSchema,
  harnessInventorySchema,
  messageSchema,
  nativeDispatchInputSchema,
  partSchema,
  projectConfigRecordSchema,
  projectSchema,
  requestSchema,
  sessionSchema,
  turnSchema,
  userMessageSchema,
  type AideConfig,
  type AideError,
  type AideEvent,
  type AssistantMessage,
  type CommandReceipt,
  type HarnessInventory,
  type Message,
  type NativeDispatchInput,
  type Part,
  type Project,
  type ProjectConfigRecord,
  type ReceiptState,
  type Request,
  type Session,
  type Turn,
  type TurnStatus,
  type UserMessage,
} from "@workspace/contracts"
import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm"
import { z } from "zod"

import type { AideDb } from "./index"
import { RepoError } from "./repo-error"
import * as tables from "./schema"

type TransactionDb = Parameters<Parameters<AideDb["transaction"]>[0]>[0]

export function withTransaction<T>(db: AideDb, fn: (tx: AideDb) => T): T {
  return db.transaction((tx) => fn(tx as unknown as AideDb), {
    behavior: "immediate",
  })
}

function parseJson(value: string, field: string): unknown {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new RepoError(
      "corrupt_json",
      `Persisted ${field} is not valid JSON`,
      false,
      { field, error }
    )
  }
}

function parseRecord<T>(
  schema: z.ZodType<T>,
  value: unknown,
  record: string
): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  throw new RepoError(
    "corrupt_record",
    `Persisted ${record} failed contract validation`,
    false,
    { record, issues: result.error.issues }
  )
}

function optionalJson(
  value: string | null,
  field: string
): unknown | undefined {
  return value === null ? undefined : parseJson(value, field)
}

function getProject(
  db: AideDb | TransactionDb,
  id: string
): Project | undefined {
  const row = db
    .select()
    .from(tables.projects)
    .where(eq(tables.projects.id, id))
    .get()
  return row ? parseRecord(projectSchema, row, "project") : undefined
}

export const projectsRepo = {
  upsertByDirectory(db: AideDb, project: Project): Project {
    const input = parseRecord(projectSchema, project, "project input")
    return withTransaction(db, (tx) => {
      const existing = tx
        .select({ id: tables.projects.id })
        .from(tables.projects)
        .where(eq(tables.projects.directory, input.directory))
        .get()
      if (existing) {
        tx.update(tables.projects)
          .set({
            name: input.name,
            directory: input.directory,
            lastOpenedAt: input.lastOpenedAt,
          })
          .where(eq(tables.projects.id, existing.id))
          .run()
        return getProject(tx, existing.id)!
      }
      tx.insert(tables.projects).values(input).run()
      return getProject(tx, input.id)!
    })
  },

  get(db: AideDb, id: string): Project | undefined {
    return getProject(db, id)
  },

  list(db: AideDb): Project[] {
    return db
      .select()
      .from(tables.projects)
      .orderBy(desc(tables.projects.lastOpenedAt), asc(tables.projects.id))
      .all()
      .map((row) => parseRecord(projectSchema, row, "project"))
  },
}

function getSession(
  db: AideDb | TransactionDb,
  id: string
): Session | undefined {
  const row = db
    .select()
    .from(tables.sessions)
    .where(eq(tables.sessions.id, id))
    .get()
  return row ? parseRecord(sessionSchema, row, "session") : undefined
}

export const sessionsRepo = {
  create(db: AideDb, session: Session): Session {
    const input = parseRecord(sessionSchema, session, "session input")
    db.insert(tables.sessions).values(input).run()
    return getSession(db, input.id)!
  },

  get(db: AideDb, id: string): Session | undefined {
    return getSession(db, id)
  },

  rename(
    db: AideDb,
    id: string,
    title: string,
    updatedAt: string
  ): Session | undefined {
    db.update(tables.sessions)
      .set({ title, updatedAt })
      .where(eq(tables.sessions.id, id))
      .run()
    return getSession(db, id)
  },

  touch(db: AideDb, id: string, updatedAt: string): Session | undefined {
    db.update(tables.sessions)
      .set({ updatedAt })
      .where(eq(tables.sessions.id, id))
      .run()
    return getSession(db, id)
  },

  delete(db: AideDb, id: string): boolean {
    return Boolean(
      db
        .delete(tables.sessions)
        .where(eq(tables.sessions.id, id))
        .returning({ id: tables.sessions.id })
        .get()
    )
  },

  listByProject(db: AideDb, projectId: string): Session[] {
    return db
      .select()
      .from(tables.sessions)
      .where(eq(tables.sessions.projectId, projectId))
      .orderBy(desc(tables.sessions.updatedAt), asc(tables.sessions.id))
      .all()
      .map((row) => parseRecord(sessionSchema, row, "session"))
  },
}

function parsePartRow(row: typeof tables.parts.$inferSelect): Part {
  return parseRecord(
    partSchema,
    parseJson(row.dataJson, `parts.${row.id}.data_json`),
    "part"
  )
}

function putPart(db: AideDb | TransactionDb, part: Part): Part {
  const input = parseRecord(partSchema, part, "part input")
  db.insert(tables.parts)
    .values({
      id: input.id,
      messageId: input.messageId,
      index: input.index,
      type: input.type,
      dataJson: JSON.stringify(input),
      artifactId: input.type === "tool" ? input.artifactId : undefined,
    })
    .onConflictDoUpdate({
      target: tables.parts.id,
      set: {
        messageId: input.messageId,
        index: input.index,
        type: input.type,
        dataJson: JSON.stringify(input),
        artifactId: input.type === "tool" ? input.artifactId : null,
      },
    })
    .run()
  const row = db
    .select()
    .from(tables.parts)
    .where(eq(tables.parts.id, input.id))
    .get()!
  return parsePartRow(row)
}

export const partsRepo = {
  upsert(db: AideDb, part: Part): Part {
    return putPart(db, part)
  },

  listByMessage(db: AideDb, messageId: string): Part[] {
    return db
      .select()
      .from(tables.parts)
      .where(eq(tables.parts.messageId, messageId))
      .orderBy(asc(tables.parts.index), asc(tables.parts.id))
      .all()
      .map(parsePartRow)
  },

  remove(db: AideDb, id: string): boolean {
    return Boolean(
      db
        .delete(tables.parts)
        .where(eq(tables.parts.id, id))
        .returning({ id: tables.parts.id })
        .get()
    )
  },
}

function parseMessageRow(
  db: AideDb | TransactionDb,
  row: typeof tables.messages.$inferSelect
): Message {
  const partRows = db
    .select()
    .from(tables.parts)
    .where(eq(tables.parts.messageId, row.id))
    .orderBy(asc(tables.parts.index), asc(tables.parts.id))
    .all()
  const parts = partRows.map(parsePartRow)
  const value =
    row.role === "user"
      ? {
          id: row.id,
          sessionId: row.sessionId,
          seq: row.seq,
          role: "user" as const,
          parts,
          execution: parseJson(
            row.executionJson!,
            `messages.${row.id}.execution_json`
          ),
          createdAt: row.createdAt,
        }
      : {
          id: row.id,
          sessionId: row.sessionId,
          seq: row.seq,
          role: "assistant" as const,
          parentMessageId: row.parentMessageId!,
          parts,
          usage: optionalJson(row.usageJson, `messages.${row.id}.usage_json`),
          createdAt: row.createdAt,
          completedAt: row.completedAt ?? undefined,
        }
  return parseRecord(messageSchema, value, "message")
}

function createMessage(
  db: AideDb,
  input: Omit<UserMessage, "seq"> | Omit<AssistantMessage, "seq">
): Message {
  return withTransaction(db, (tx) => {
    const current = tx
      .select({ value: max(tables.messages.seq) })
      .from(tables.messages)
      .where(eq(tables.messages.sessionId, input.sessionId))
      .get()
    const seq = (current?.value ?? -1) + 1
    const message: Message =
      input.role === "user"
        ? parseRecord(userMessageSchema, { ...input, seq }, "message input")
        : parseRecord(
            assistantMessageSchema,
            { ...input, seq },
            "message input"
          )
    tx.insert(tables.messages)
      .values({
        id: message.id,
        sessionId: message.sessionId,
        seq: message.seq,
        role: message.role,
        parentMessageId:
          message.role === "assistant" ? message.parentMessageId : undefined,
        executionJson:
          message.role === "user"
            ? JSON.stringify(message.execution)
            : undefined,
        usageJson:
          message.role === "assistant" && message.usage
            ? JSON.stringify(message.usage)
            : undefined,
        createdAt: message.createdAt,
        completedAt:
          message.role === "assistant" ? message.completedAt : undefined,
      })
      .run()
    for (const part of message.parts) putPart(tx, part)
    const row = tx
      .select()
      .from(tables.messages)
      .where(eq(tables.messages.id, message.id))
      .get()!
    return parseMessageRow(tx, row)
  })
}

export const messagesRepo = {
  createUser(db: AideDb, message: Omit<UserMessage, "seq">): UserMessage {
    return createMessage(db, message) as UserMessage
  },

  createAssistant(
    db: AideDb,
    message: Omit<AssistantMessage, "seq">
  ): AssistantMessage {
    return createMessage(db, message) as AssistantMessage
  },

  get(db: AideDb, id: string): Message | undefined {
    const row = db
      .select()
      .from(tables.messages)
      .where(eq(tables.messages.id, id))
      .get()
    return row ? parseMessageRow(db, row) : undefined
  },

  updateAssistant(
    db: AideDb,
    id: string,
    patch: { usage?: AssistantMessage["usage"]; completedAt?: string }
  ): AssistantMessage | undefined {
    db.update(tables.messages)
      .set({
        usageJson:
          patch.usage === undefined ? undefined : JSON.stringify(patch.usage),
        completedAt: patch.completedAt,
      })
      .where(
        and(eq(tables.messages.id, id), eq(tables.messages.role, "assistant"))
      )
      .run()
    const message = this.get(db, id)
    return message?.role === "assistant" ? message : undefined
  },

  listBySession(db: AideDb, sessionId: string): Message[] {
    return db
      .select()
      .from(tables.messages)
      .where(eq(tables.messages.sessionId, sessionId))
      .orderBy(asc(tables.messages.seq), asc(tables.messages.id))
      .all()
      .map((row) => parseMessageRow(db, row))
  },
}

function parseTurnRow(row: typeof tables.turns.$inferSelect): Turn {
  return parseRecord(
    turnSchema,
    {
      id: row.id,
      sessionId: row.sessionId,
      seq: row.seq,
      status: row.status,
      execution: parseJson(row.executionJson, `turns.${row.id}.execution_json`),
      commandId: row.commandId,
      userMessageId: row.userMessageId,
      assistantMessageId: row.assistantMessageId ?? undefined,
      startedAt: row.startedAt ?? undefined,
      endedAt: row.endedAt ?? undefined,
      error: optionalJson(row.errorJson, `turns.${row.id}.error_json`),
    },
    "turn"
  )
}

function getTurn(db: AideDb | TransactionDb, id: string): Turn | undefined {
  const row = db
    .select()
    .from(tables.turns)
    .where(eq(tables.turns.id, id))
    .get()
  return row ? parseTurnRow(row) : undefined
}

type QueuedTurnInput = Omit<Turn, "status" | "seq"> & { seq?: number }

export const turnsRepo = {
  create(db: AideDb, turn: QueuedTurnInput): Turn {
    return withTransaction(db, (tx) => {
      const current = tx
        .select({ value: max(tables.turns.seq) })
        .from(tables.turns)
        .where(eq(tables.turns.sessionId, turn.sessionId))
        .get()
      const value = parseRecord(
        turnSchema,
        {
          ...turn,
          seq: turn.seq ?? (current?.value ?? -1) + 1,
          status: "queued",
        },
        "turn input"
      )
      tx.insert(tables.turns)
        .values({
          id: value.id,
          sessionId: value.sessionId,
          seq: value.seq,
          status: value.status,
          executionJson: JSON.stringify(value.execution),
          commandId: value.commandId,
          userMessageId: value.userMessageId,
          assistantMessageId: value.assistantMessageId,
          startedAt: value.startedAt,
          endedAt: value.endedAt,
          errorJson: value.error ? JSON.stringify(value.error) : undefined,
        })
        .run()
      return getTurn(tx, value.id)!
    })
  },

  get(db: AideDb, id: string): Turn | undefined {
    return getTurn(db, id)
  },

  update(
    db: AideDb,
    id: string,
    patch: {
      status?: TurnStatus
      assistantMessageId?: string | null
      startedAt?: string | null
      endedAt?: string | null
      error?: AideError | null
    }
  ): Turn | undefined {
    db.update(tables.turns)
      .set({
        status: patch.status,
        assistantMessageId: patch.assistantMessageId,
        startedAt: patch.startedAt,
        endedAt: patch.endedAt,
        errorJson:
          patch.error === undefined
            ? undefined
            : patch.error === null
              ? null
              : JSON.stringify(patch.error),
      })
      .where(eq(tables.turns.id, id))
      .run()
    return getTurn(db, id)
  },

  listOpenBySession(db: AideDb, sessionId: string): Turn[] {
    return db
      .select()
      .from(tables.turns)
      .where(
        and(
          eq(tables.turns.sessionId, sessionId),
          inArray(tables.turns.status, ["queued", "running"])
        )
      )
      .orderBy(asc(tables.turns.seq), asc(tables.turns.id))
      .all()
      .map(parseTurnRow)
  },

  listBySession(db: AideDb, sessionId: string): Turn[] {
    return db
      .select()
      .from(tables.turns)
      .where(eq(tables.turns.sessionId, sessionId))
      .orderBy(asc(tables.turns.seq), asc(tables.turns.id))
      .all()
      .map(parseTurnRow)
  },

  listRunning(db: AideDb): Turn[] {
    return db
      .select()
      .from(tables.turns)
      .where(eq(tables.turns.status, "running"))
      .orderBy(asc(tables.turns.sessionId), asc(tables.turns.seq))
      .all()
      .map(parseTurnRow)
  },
}

function parseRequestRow(row: typeof tables.requests.$inferSelect): Request {
  return parseRecord(
    requestSchema,
    {
      id: row.id,
      sessionId: row.sessionId,
      turnId: row.turnId,
      kind: row.kind,
      status: row.status,
      payload: parseJson(row.payloadJson, `requests.${row.id}.payload_json`),
      resolution: optionalJson(
        row.resolutionJson,
        `requests.${row.id}.resolution_json`
      ),
    },
    "request"
  )
}

function getRequest(
  db: AideDb | TransactionDb,
  id: string
): Request | undefined {
  const row = db
    .select()
    .from(tables.requests)
    .where(eq(tables.requests.id, id))
    .get()
  return row ? parseRequestRow(row) : undefined
}

export const requestsRepo = {
  upsert(db: AideDb, request: Request): Request {
    const input = parseRecord(requestSchema, request, "request input")
    const values = {
      id: input.id,
      sessionId: input.sessionId,
      turnId: input.turnId,
      kind: input.kind,
      status: input.status,
      payloadJson: JSON.stringify(input.payload),
      resolutionJson: input.resolution
        ? JSON.stringify(input.resolution)
        : null,
    }
    db.insert(tables.requests)
      .values(values)
      .onConflictDoUpdate({ target: tables.requests.id, set: values })
      .run()
    return getRequest(db, input.id)!
  },

  get(db: AideDb, id: string): Request | undefined {
    return getRequest(db, id)
  },

  listOpenBySession(db: AideDb, sessionId: string): Request[] {
    return db
      .select()
      .from(tables.requests)
      .where(
        and(
          eq(tables.requests.sessionId, sessionId),
          eq(tables.requests.status, "open")
        )
      )
      .orderBy(asc(tables.requests.id))
      .all()
      .map(parseRequestRow)
  },

  listBySession(db: AideDb, sessionId: string): Request[] {
    return db
      .select()
      .from(tables.requests)
      .where(eq(tables.requests.sessionId, sessionId))
      .orderBy(asc(tables.requests.turnId), asc(tables.requests.id))
      .all()
      .map(parseRequestRow)
  },

  resolve(
    db: AideDb,
    id: string,
    resolution: Request["resolution"]
  ): Request | undefined {
    db.update(tables.requests)
      .set({ status: "resolved", resolutionJson: JSON.stringify(resolution) })
      .where(eq(tables.requests.id, id))
      .run()
    return getRequest(db, id)
  },

  cancel(db: AideDb, id: string): Request | undefined {
    db.update(tables.requests)
      .set({ status: "cancelled", resolutionJson: null })
      .where(eq(tables.requests.id, id))
      .run()
    return getRequest(db, id)
  },
}

type ReceiptUpdate = {
  nativeIdempotencyKey?: string | null
  acknowledgement?: unknown
  result?: unknown
  error?: AideError | null
  reconciliationError?: AideError | null
  updatedAt: string
}

function parseReceiptRow(
  row: typeof tables.commandReceipts.$inferSelect
): CommandReceipt {
  optionalJson(
    row.acknowledgementJson,
    `command_receipts.${row.commandId}.acknowledgement_json`
  )
  optionalJson(
    row.reconciliationErrorJson,
    `command_receipts.${row.commandId}.reconciliation_error_json`
  )
  return parseRecord(
    commandReceiptSchema,
    {
      commandId: row.commandId,
      commandName: row.commandName,
      state: row.state,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      result: optionalJson(
        row.resultJson,
        `command_receipts.${row.commandId}.result_json`
      ),
      error: optionalJson(
        row.errorJson,
        `command_receipts.${row.commandId}.error_json`
      ),
    },
    "command receipt"
  )
}

function getReceipt(
  db: AideDb | TransactionDb,
  commandId: string
): CommandReceipt | undefined {
  const row = db
    .select()
    .from(tables.commandReceipts)
    .where(eq(tables.commandReceipts.commandId, commandId))
    .get()
  return row ? parseReceiptRow(row) : undefined
}

export const receiptsRepo = {
  upsertAccepted(
    db: AideDb,
    receipt: Omit<CommandReceipt, "state">
  ): CommandReceipt {
    return withTransaction(db, (tx) => {
      const existing = getReceipt(tx, receipt.commandId)
      if (existing) return existing
      const input = parseRecord(
        commandReceiptSchema,
        { ...receipt, state: "accepted" },
        "command receipt input"
      )
      tx.insert(tables.commandReceipts)
        .values({
          commandId: input.commandId,
          commandName: input.commandName,
          state: input.state,
          resultJson:
            input.result === undefined
              ? undefined
              : JSON.stringify(input.result),
          errorJson: input.error ? JSON.stringify(input.error) : undefined,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
        })
        .run()
      return getReceipt(tx, input.commandId)!
    })
  },

  get(db: AideDb, commandId: string): CommandReceipt | undefined {
    return getReceipt(db, commandId)
  },

  updateState(
    db: AideDb,
    commandId: string,
    state: ReceiptState,
    update: ReceiptUpdate
  ): CommandReceipt | undefined {
    db.update(tables.commandReceipts)
      .set({
        state,
        nativeIdempotencyKey: update.nativeIdempotencyKey,
        acknowledgementJson:
          update.acknowledgement === undefined
            ? undefined
            : JSON.stringify(update.acknowledgement),
        resultJson:
          update.result === undefined
            ? undefined
            : JSON.stringify(update.result),
        errorJson:
          update.error === undefined
            ? undefined
            : update.error === null
              ? null
              : JSON.stringify(update.error),
        reconciliationErrorJson:
          update.reconciliationError === undefined
            ? undefined
            : update.reconciliationError === null
              ? null
              : JSON.stringify(update.reconciliationError),
        updatedAt: update.updatedAt,
      })
      .where(eq(tables.commandReceipts.commandId, commandId))
      .run()
    return getReceipt(db, commandId)
  },

  listByStates(db: AideDb, states: ReceiptState[]): CommandReceipt[] {
    if (states.length === 0) return []
    return db
      .select()
      .from(tables.commandReceipts)
      .where(inArray(tables.commandReceipts.state, states))
      .orderBy(
        asc(tables.commandReceipts.createdAt),
        asc(tables.commandReceipts.commandId)
      )
      .all()
      .map(parseReceiptRow)
  },
}

export type NativeSessionMapping = {
  sessionId: string
  instanceId: string
  nativeSessionId: string
  resumeCursor?: string
  syncCursor: number
  unsafe: boolean
}

function parseNativeMapping(
  row: typeof tables.nativeSessionMappings.$inferSelect
): NativeSessionMapping {
  return { ...row, resumeCursor: row.resumeCursor ?? undefined }
}

export const nativeMappingsRepo = {
  get(
    db: AideDb,
    sessionId: string,
    instanceId: string
  ): NativeSessionMapping | undefined {
    const row = db
      .select()
      .from(tables.nativeSessionMappings)
      .where(
        and(
          eq(tables.nativeSessionMappings.sessionId, sessionId),
          eq(tables.nativeSessionMappings.instanceId, instanceId)
        )
      )
      .get()
    return row ? parseNativeMapping(row) : undefined
  },

  upsert(db: AideDb, mapping: NativeSessionMapping): NativeSessionMapping {
    db.insert(tables.nativeSessionMappings)
      .values(mapping)
      .onConflictDoUpdate({
        target: [
          tables.nativeSessionMappings.sessionId,
          tables.nativeSessionMappings.instanceId,
        ],
        set: {
          nativeSessionId: mapping.nativeSessionId,
          resumeCursor: mapping.resumeCursor,
          syncCursor: mapping.syncCursor,
          unsafe: mapping.unsafe,
        },
      })
      .run()
    return this.get(db, mapping.sessionId, mapping.instanceId)!
  },

  setSyncCursor(
    db: AideDb,
    sessionId: string,
    instanceId: string,
    syncCursor: number,
    resumeCursor?: string
  ): NativeSessionMapping | undefined {
    db.update(tables.nativeSessionMappings)
      .set({ syncCursor, resumeCursor })
      .where(
        and(
          eq(tables.nativeSessionMappings.sessionId, sessionId),
          eq(tables.nativeSessionMappings.instanceId, instanceId)
        )
      )
      .run()
    return this.get(db, sessionId, instanceId)
  },

  markUnsafe(
    db: AideDb,
    sessionId: string,
    instanceId: string
  ): NativeSessionMapping | undefined {
    db.update(tables.nativeSessionMappings)
      .set({ unsafe: true })
      .where(
        and(
          eq(tables.nativeSessionMappings.sessionId, sessionId),
          eq(tables.nativeSessionMappings.instanceId, instanceId)
        )
      )
      .run()
    return this.get(db, sessionId, instanceId)
  },
}

export const dispatchInputsRepo = {
  create(db: AideDb, input: NativeDispatchInput): NativeDispatchInput {
    const value = parseRecord(
      nativeDispatchInputSchema,
      input,
      "dispatch input input"
    )
    db.insert(tables.dispatchInputs).values(value).run()
    return value
  },

  listByTurn(db: AideDb, turnId: string): NativeDispatchInput[] {
    return db
      .select()
      .from(tables.dispatchInputs)
      .where(eq(tables.dispatchInputs.turnId, turnId))
      .orderBy(
        asc(tables.dispatchInputs.createdAt),
        asc(tables.dispatchInputs.id)
      )
      .all()
      .map((row) =>
        parseRecord(nativeDispatchInputSchema, row, "dispatch input")
      )
  },
}

export type AdapterMappingKind = "message" | "part" | "request"

export type AdapterIdMapping = {
  instanceId: string
  mappingKind: AdapterMappingKind
  aideId: string
  nativeId: string
}

export const adapterMappingsRepo = {
  put(db: AideDb, mapping: AdapterIdMapping): AdapterIdMapping {
    db.insert(tables.adapterIdMappings)
      .values(mapping)
      .onConflictDoUpdate({
        target: [
          tables.adapterIdMappings.instanceId,
          tables.adapterIdMappings.mappingKind,
          tables.adapterIdMappings.aideId,
        ],
        set: { nativeId: mapping.nativeId },
      })
      .run()
    return mapping
  },

  get(
    db: AideDb,
    instanceId: string,
    mappingKind: AdapterMappingKind,
    aideId: string
  ): AdapterIdMapping | undefined {
    return db
      .select()
      .from(tables.adapterIdMappings)
      .where(
        and(
          eq(tables.adapterIdMappings.instanceId, instanceId),
          eq(tables.adapterIdMappings.mappingKind, mappingKind),
          eq(tables.adapterIdMappings.aideId, aideId)
        )
      )
      .get() as AdapterIdMapping | undefined
  },
}

export const inventoryCacheRepo = {
  put(
    db: AideDb,
    directory: string,
    inventory: HarnessInventory
  ): HarnessInventory {
    const value = parseRecord(
      harnessInventorySchema,
      inventory,
      "inventory input"
    )
    db.insert(tables.inventoryCache)
      .values({
        instanceId: value.instanceId,
        directory,
        inventoryJson: JSON.stringify(value),
        revision: value.revision,
        discoveredAt: value.discoveredAt,
        stale: value.stale,
      })
      .onConflictDoUpdate({
        target: [
          tables.inventoryCache.instanceId,
          tables.inventoryCache.directory,
        ],
        set: {
          inventoryJson: JSON.stringify(value),
          revision: value.revision,
          discoveredAt: value.discoveredAt,
          stale: value.stale,
        },
      })
      .run()
    return value
  },

  get(
    db: AideDb,
    instanceId: string,
    directory: string
  ): HarnessInventory | undefined {
    const row = db
      .select()
      .from(tables.inventoryCache)
      .where(
        and(
          eq(tables.inventoryCache.instanceId, instanceId),
          eq(tables.inventoryCache.directory, directory)
        )
      )
      .get()
    return row
      ? parseRecord(
          harnessInventorySchema,
          parseJson(row.inventoryJson, "inventory_cache.inventory_json"),
          "inventory"
        )
      : undefined
  },

  list(db: AideDb): HarnessInventory[] {
    return db
      .select()
      .from(tables.inventoryCache)
      .orderBy(
        asc(tables.inventoryCache.instanceId),
        desc(tables.inventoryCache.discoveredAt),
        asc(tables.inventoryCache.directory)
      )
      .all()
      .map((row) =>
        parseRecord(
          harnessInventorySchema,
          parseJson(row.inventoryJson, "inventory_cache.inventory_json"),
          "inventory"
        )
      )
  },
}

export type EventScopeTarget =
  | { kind: "instances" }
  | { kind: "session"; sessionId: string }

function eventScopeKey(
  scope: EventScopeTarget
): ["instances" | "session", string] {
  return scope.kind === "instances"
    ? ["instances", ""]
    : ["session", scope.sessionId]
}

function parseEventRow(row: typeof tables.eventLog.$inferSelect): AideEvent {
  return parseRecord(
    aideEventSchema,
    parseJson(row.eventJson, `event_log.${row.eventId}.event_json`),
    "event"
  )
}

export const eventLogRepo = {
  append(db: AideDb, event: AideEvent): AideEvent {
    const input = parseRecord(aideEventSchema, event, "event input")
    if (input.type === "part.delta") {
      throw new RepoError(
        "ephemeral_event",
        "Ephemeral events cannot be persisted",
        false,
        { eventId: input.eventId, type: input.type }
      )
    }
    return withTransaction(db, (tx) => {
      const [scopeKind, scopeId] = eventScopeKey(input.scope)
      const current = tx
        .select({ value: max(tables.eventLog.sequence) })
        .from(tables.eventLog)
        .where(
          and(
            eq(tables.eventLog.scopeKind, scopeKind),
            eq(tables.eventLog.scopeId, scopeId)
          )
        )
        .get()
      const sequence = (current?.value ?? 0) + 1
      const persisted = parseRecord(
        aideEventSchema,
        {
          ...input,
          delivery: {
            durable: true,
            sequence,
          },
        },
        "event"
      )
      tx.insert(tables.eventLog)
        .values({
          scopeKind,
          scopeId,
          sequence,
          eventId: persisted.eventId,
          type: persisted.type,
          timestamp: persisted.timestamp,
          eventJson: JSON.stringify(persisted),
        })
        .run()
      return persisted
    })
  },

  listAfter(
    db: AideDb,
    scope: EventScopeTarget,
    after: number,
    limit: number
  ): AideEvent[] {
    const [scopeKind, scopeId] = eventScopeKey(scope)
    return db
      .select()
      .from(tables.eventLog)
      .where(
        and(
          eq(tables.eventLog.scopeKind, scopeKind),
          eq(tables.eventLog.scopeId, scopeId),
          sql`${tables.eventLog.sequence} > ${after}`
        )
      )
      .orderBy(asc(tables.eventLog.sequence))
      .limit(limit)
      .all()
      .map(parseEventRow)
  },

  getByEventId(db: AideDb, eventId: string): AideEvent | undefined {
    const row = db
      .select()
      .from(tables.eventLog)
      .where(eq(tables.eventLog.eventId, eventId))
      .get()
    return row ? parseEventRow(row) : undefined
  },

  latestSequence(db: AideDb, scope: EventScopeTarget): number {
    const [scopeKind, scopeId] = eventScopeKey(scope)
    const row = db
      .select({ value: max(tables.eventLog.sequence) })
      .from(tables.eventLog)
      .where(
        and(
          eq(tables.eventLog.scopeKind, scopeKind),
          eq(tables.eventLog.scopeId, scopeId)
        )
      )
      .get()
    return row?.value ?? 0
  },
}

export type ConfigTarget =
  | { kind: "global" }
  | { kind: "project"; projectId: string }

function getConfig(
  db: AideDb,
  target: { kind: "global" }
): AideConfig | undefined
function getConfig(
  db: AideDb,
  target: { kind: "project"; projectId: string }
): ProjectConfigRecord | undefined
function getConfig(
  db: AideDb,
  target: ConfigTarget
): AideConfig | ProjectConfigRecord | undefined {
  const projectId = target.kind === "global" ? "" : target.projectId
  const row = db
    .select()
    .from(tables.configRecords)
    .where(
      and(
        eq(tables.configRecords.kind, target.kind),
        eq(tables.configRecords.projectId, projectId)
      )
    )
    .get()
  if (!row) return undefined
  const value = parseJson(row.configJson, "config_records.config_json")
  return target.kind === "global"
    ? parseRecord(aideConfigSchema, value, "config")
    : parseRecord(projectConfigRecordSchema, value, "config")
}

export const configRepo = {
  get: getConfig,

  put(
    db: AideDb,
    config: AideConfig | ProjectConfigRecord,
    updatedAt = new Date().toISOString()
  ): AideConfig | ProjectConfigRecord {
    const isProject = "projectId" in config
    const value = isProject
      ? parseRecord(projectConfigRecordSchema, config, "config input")
      : parseRecord(aideConfigSchema, config, "config input")
    const kind = isProject ? "project" : "global"
    const projectId = isProject ? config.projectId : ""
    db.insert(tables.configRecords)
      .values({
        kind,
        projectId,
        configJson: JSON.stringify(value),
        createdAt: updatedAt,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [tables.configRecords.kind, tables.configRecords.projectId],
        set: { configJson: JSON.stringify(value), updatedAt },
      })
      .run()
    return value
  },
}

const artifactSchema = z.object({
  id: z.string().min(1),
  mimeType: z.string().min(1),
  data: z.instanceof(Buffer),
  byteLength: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
})

export type Artifact = z.infer<typeof artifactSchema>

export const artifactsRepo = {
  create(db: AideDb, artifact: Artifact): Artifact {
    const value = parseRecord(artifactSchema, artifact, "artifact input")
    db.insert(tables.artifacts).values(value).run()
    return this.get(db, value.id)!
  },

  get(db: AideDb, id: string): Artifact | undefined {
    const row = db
      .select()
      .from(tables.artifacts)
      .where(eq(tables.artifacts.id, id))
      .get()
    if (!row) return undefined
    return parseRecord(
      artifactSchema,
      { ...row, data: Buffer.from(row.data) },
      "artifact"
    )
  },
}
