import { sql } from "drizzle-orm"
import {
  blob,
  check,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  directory: text("directory").notNull(),
  createdAt: text("created_at").notNull(),
  lastOpenedAt: text("last_opened_at").notNull(),
})

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    mimeType: text("mime_type").notNull(),
    data: blob("data", { mode: "buffer" }).notNull(),
    byteLength: integer("byte_length").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check("artifacts_byte_length_check", sql`${table.byteLength} >= 0`),
  ]
)

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    role: text("role").notNull(),
    parentMessageId: text("parent_message_id"),
    executionJson: text("execution_json"),
    usageJson: text("usage_json"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("messages_session_id_seq_unique").on(
      table.sessionId,
      table.seq
    ),
    check("messages_seq_check", sql`${table.seq} >= 0`),
    check("messages_role_check", sql`${table.role} in ('user', 'assistant')`),
    check(
      "messages_role_fields_check",
      sql`(${table.role} = 'user' and ${table.parentMessageId} is null and ${table.executionJson} is not null) or (${table.role} = 'assistant' and ${table.parentMessageId} is not null and ${table.executionJson} is null)`
    ),
  ]
)

export const parts = sqliteTable(
  "parts",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    type: text("type").notNull(),
    dataJson: text("data_json").notNull(),
    artifactId: text("artifact_id").references(() => artifacts.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("parts_message_id_index_unique").on(
      table.messageId,
      table.index
    ),
    check("parts_index_check", sql`${table.index} >= 0`),
    check(
      "parts_type_check",
      sql`${table.type} in ('text', 'reasoning', 'tool', 'file', 'agent')`
    ),
  ]
)

export const commandReceipts = sqliteTable(
  "command_receipts",
  {
    commandId: text("command_id").primaryKey(),
    commandName: text("command_name").notNull(),
    state: text("state").notNull(),
    nativeIdempotencyKey: text("native_idempotency_key"),
    acknowledgementJson: text("acknowledgement_json"),
    resultJson: text("result_json"),
    errorJson: text("error_json"),
    reconciliationErrorJson: text("reconciliation_error_json"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "command_receipts_command_name_check",
      sql`${table.commandName} in ('project.open', 'project.updateDefaults', 'session.create', 'session.rename', 'session.delete', 'turn.send', 'turn.interrupt', 'permission.respond', 'input.respond', 'inventory.refresh', 'instance.start', 'instance.stop', 'instance.restart', 'config.update', 'mcp.reconnect')`
    ),
    check(
      "command_receipts_state_check",
      sql`${table.state} in ('accepted', 'dispatching', 'dispatched', 'uncertain', 'completed', 'failed')`
    ),
  ]
)

export const turns = sqliteTable(
  "turns",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    status: text("status").notNull(),
    executionJson: text("execution_json").notNull(),
    commandId: text("command_id")
      .notNull()
      .references(() => commandReceipts.commandId),
    userMessageId: text("user_message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    assistantMessageId: text("assistant_message_id").references(
      () => messages.id,
      { onDelete: "set null" }
    ),
    startedAt: text("started_at"),
    endedAt: text("ended_at"),
    errorJson: text("error_json"),
  },
  (table) => [
    uniqueIndex("turns_session_id_seq_unique").on(table.sessionId, table.seq),
    uniqueIndex("turns_command_id_unique").on(table.commandId),
    uniqueIndex("turns_user_message_id_unique").on(table.userMessageId),
    uniqueIndex("turns_assistant_message_id_unique").on(
      table.assistantMessageId
    ),
    check("turns_seq_check", sql`${table.seq} >= 0`),
    check(
      "turns_status_check",
      sql`${table.status} in ('queued', 'running', 'completed', 'interrupted', 'failed')`
    ),
  ]
)

export const requests = sqliteTable(
  "requests",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    turnId: text("turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    payloadJson: text("payload_json").notNull(),
    resolutionJson: text("resolution_json"),
  },
  (table) => [
    check("requests_kind_check", sql`${table.kind} in ('permission', 'input')`),
    check(
      "requests_status_check",
      sql`${table.status} in ('open', 'resolved', 'cancelled')`
    ),
    check(
      "requests_resolution_check",
      sql`(${table.status} = 'resolved' and ${table.resolutionJson} is not null) or (${table.status} <> 'resolved' and ${table.resolutionJson} is null)`
    ),
  ]
)

export const nativeSessionMappings = sqliteTable(
  "native_session_mappings",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    instanceId: text("instance_id").notNull(),
    nativeSessionId: text("native_session_id").notNull(),
    resumeCursor: text("resume_cursor"),
    syncCursor: integer("sync_cursor").notNull().default(-1),
    unsafe: integer("unsafe", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.instanceId] }),
    check(
      "native_session_mappings_sync_cursor_check",
      sql`${table.syncCursor} >= -1`
    ),
  ]
)

export const dispatchInputs = sqliteTable(
  "dispatch_inputs",
  {
    id: text("id").primaryKey(),
    turnId: text("turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    instanceId: text("instance_id").notNull(),
    nativeSessionId: text("native_session_id").notNull(),
    role: text("role").notNull(),
    fromMessageSeq: integer("from_message_seq").notNull(),
    throughMessageSeq: integer("through_message_seq").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check("dispatch_inputs_role_check", sql`${table.role} = 'handoff'`),
    check(
      "dispatch_inputs_message_range_check",
      sql`${table.fromMessageSeq} >= 0 and ${table.throughMessageSeq} >= ${table.fromMessageSeq}`
    ),
  ]
)

export const adapterIdMappings = sqliteTable(
  "adapter_id_mappings",
  {
    instanceId: text("instance_id").notNull(),
    mappingKind: text("mapping_kind").notNull(),
    aideId: text("aide_id").notNull(),
    nativeId: text("native_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.instanceId, table.mappingKind, table.aideId],
    }),
    check(
      "adapter_id_mappings_kind_check",
      sql`${table.mappingKind} in ('message', 'part', 'request')`
    ),
  ]
)

export const inventoryCache = sqliteTable(
  "inventory_cache",
  {
    instanceId: text("instance_id").notNull(),
    directory: text("directory").notNull(),
    inventoryJson: text("inventory_json").notNull(),
    revision: text("revision").notNull(),
    discoveredAt: text("discovered_at").notNull(),
    stale: integer("stale", { mode: "boolean" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.instanceId, table.directory] })]
)

export const eventLog = sqliteTable(
  "event_log",
  {
    scopeKind: text("scope_kind").notNull(),
    scopeId: text("scope_id").notNull(),
    sequence: integer("sequence").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    timestamp: text("timestamp").notNull(),
    eventJson: text("event_json").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeKind, table.scopeId, table.sequence] }),
    uniqueIndex("event_log_event_id_unique").on(table.eventId),
    check(
      "event_log_scope_check",
      sql`(${table.scopeKind} = 'session' and ${table.scopeId} <> '') or (${table.scopeKind} = 'instances' and ${table.scopeId} = '')`
    ),
    check("event_log_sequence_check", sql`${table.sequence} >= 0`),
  ]
)

export const configRecords = sqliteTable(
  "config_records",
  {
    kind: text("kind").notNull(),
    projectId: text("project_id").notNull().default(""),
    configJson: text("config_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.kind, table.projectId] }),
    check(
      "config_records_target_check",
      sql`(${table.kind} = 'global' and ${table.projectId} = '') or (${table.kind} = 'project' and ${table.projectId} <> '')`
    ),
  ]
)
