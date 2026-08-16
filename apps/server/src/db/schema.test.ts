import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { Database } from "./test/bun-sqlite-shim"

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url)
)
const statementBreakpoint = "--> statement-breakpoint"

function applyMigrations(client: Database): void {
  for (const file of readdirSync(migrationsFolder)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const migration = readFileSync(`${migrationsFolder}/${file}`, "utf8")
    for (const statement of migration.split(statementBreakpoint)) {
      if (statement.trim()) client.exec(statement)
    }
  }
}

describe("database schema", () => {
  let client: Database

  beforeEach(() => {
    client = new Database(":memory:")
    client.exec("PRAGMA foreign_keys = ON")
    applyMigrations(client)
  })

  afterEach(() => client.close())

  function insertProjectAndSession(): void {
    client.exec(`
      INSERT INTO projects (id, name, directory, created_at, last_opened_at)
      VALUES ('project-1', 'Aide', '/tmp/aide', '2026-01-01', '2026-01-01');
      INSERT INTO sessions (id, project_id, title, created_at, updated_at)
      VALUES ('session-1', 'project-1', 'Schema', '2026-01-01', '2026-01-01');
    `)
  }

  function insertUserMessage(id = "message-1", seq = 0): void {
    client.exec(`
      INSERT INTO messages
        (id, session_id, seq, role, execution_json, created_at)
      VALUES ('${id}', 'session-1', ${seq}, 'user', '{}', '2026-01-01');
    `)
  }

  it("keeps message sequences unique within a session", () => {
    insertProjectAndSession()
    insertUserMessage()

    expect(() => insertUserMessage("message-2", 0)).toThrow()
  })

  it("keeps part indexes unique within a message", () => {
    insertProjectAndSession()
    insertUserMessage()
    client.exec(`
      INSERT INTO parts (id, message_id, "index", type, data_json)
      VALUES ('part-1', 'message-1', 0, 'text', '{"text":"one"}');
    `)

    expect(() =>
      client.exec(`
        INSERT INTO parts (id, message_id, "index", type, data_json)
        VALUES ('part-2', 'message-1', 0, 'text', '{"text":"two"}');
      `)
    ).toThrow()
  })

  it("uses commandId as the command receipt primary key", () => {
    client.exec(`
      INSERT INTO command_receipts
        (command_id, command_name, state, created_at, updated_at)
      VALUES ('command-1', 'turn.send', 'accepted', '2026-01-01', '2026-01-01');
    `)

    expect(() =>
      client.exec(`
        INSERT INTO command_receipts
          (command_id, command_name, state, created_at, updated_at)
        VALUES ('command-1', 'session.rename', 'completed', '2026-01-01', '2026-01-01');
      `)
    ).toThrow()
  })

  it("scopes native and adapter mappings by their composite keys", () => {
    insertProjectAndSession()
    client.exec(`
      INSERT INTO native_session_mappings
        (session_id, instance_id, native_session_id)
      VALUES ('session-1', 'instance-1', 'native-session-1');
      INSERT INTO adapter_id_mappings
        (instance_id, mapping_kind, aide_id, native_id)
      VALUES ('instance-1', 'message', 'message-1', 'native-message-1');
    `)

    expect(() =>
      client.exec(`
        INSERT INTO native_session_mappings
          (session_id, instance_id, native_session_id)
        VALUES ('session-1', 'instance-1', 'native-session-2');
      `)
    ).toThrow()
    expect(() =>
      client.exec(`
        INSERT INTO adapter_id_mappings
          (instance_id, mapping_kind, aide_id, native_id)
        VALUES ('instance-1', 'message', 'message-1', 'native-message-2');
      `)
    ).toThrow()

    expect(() =>
      client.exec(`
        INSERT INTO native_session_mappings
          (session_id, instance_id, native_session_id)
        VALUES ('session-1', 'instance-2', 'native-session-2');
        INSERT INTO adapter_id_mappings
          (instance_id, mapping_kind, aide_id, native_id)
        VALUES ('instance-1', 'part', 'message-1', 'native-part-1');
      `)
    ).not.toThrow()
  })

  it("keeps event sequences per scope and event ids globally unique", () => {
    client.exec(`
      INSERT INTO event_log
        (scope_kind, scope_id, sequence, event_id, type, timestamp, event_json)
      VALUES ('session', 'session-1', 0, 'event-1', 'turn.queued', '2026-01-01', '{}');
    `)

    expect(() =>
      client.exec(`
        INSERT INTO event_log
          (scope_kind, scope_id, sequence, event_id, type, timestamp, event_json)
        VALUES ('session', 'session-1', 0, 'event-2', 'turn.started', '2026-01-01', '{}');
      `)
    ).toThrow()
    expect(() =>
      client.exec(`
        INSERT INTO event_log
          (scope_kind, scope_id, sequence, event_id, type, timestamp, event_json)
        VALUES ('instances', '', 0, 'event-1', 'harness.connected', '2026-01-01', '{}');
      `)
    ).toThrow()

    expect(() =>
      client.exec(`
        INSERT INTO event_log
          (scope_kind, scope_id, sequence, event_id, type, timestamp, event_json)
        VALUES ('instances', '', 0, 'event-2', 'harness.connected', '2026-01-01', '{}');
      `)
    ).not.toThrow()
  })

  it("cascades project deletion through stable ownership foreign keys", () => {
    insertProjectAndSession()
    insertUserMessage()
    client.exec(`
      INSERT INTO command_receipts
        (command_id, command_name, state, created_at, updated_at)
      VALUES ('command-1', 'turn.send', 'accepted', '2026-01-01', '2026-01-01');
      INSERT INTO turns
        (id, session_id, seq, status, execution_json, command_id, user_message_id)
      VALUES ('turn-1', 'session-1', 0, 'queued', '{}', 'command-1', 'message-1');
      INSERT INTO parts (id, message_id, "index", type, data_json)
      VALUES ('part-1', 'message-1', 0, 'text', '{}');
      INSERT INTO requests
        (id, session_id, turn_id, kind, status, payload_json)
      VALUES ('request-1', 'session-1', 'turn-1', 'permission', 'open', '{}');
      INSERT INTO native_session_mappings
        (session_id, instance_id, native_session_id)
      VALUES ('session-1', 'instance-1', 'native-session-1');
      INSERT INTO dispatch_inputs
        (id, turn_id, instance_id, native_session_id, role,
         from_message_seq, through_message_seq, content, created_at)
      VALUES ('dispatch-1', 'turn-1', 'instance-1', 'native-session-1',
              'handoff', 0, 0, 'context', '2026-01-01');
      DELETE FROM projects WHERE id = 'project-1';
    `)

    for (const table of [
      "sessions",
      "messages",
      "parts",
      "turns",
      "requests",
      "native_session_mappings",
      "dispatch_inputs",
    ]) {
      const row = client
        .prepare(`SELECT count(*) AS count FROM ${table}`)
        .get() as { count: number }
      expect(row.count).toBe(0)
    }
  })
})
