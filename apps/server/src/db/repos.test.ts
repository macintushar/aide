import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  assistantMessageFixture,
  eventFixtures,
  inputRequestFixture,
  inventoryFixture,
  projectFixture,
  resolvedExecutionFixture,
  sessionFixture,
  userMessageFixture,
  type AideConfig,
  type NativeDispatchInput,
} from "@workspace/contracts"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  adapterMappingsRepo,
  artifactsRepo,
  configRepo,
  createDb,
  dispatchInputsRepo,
  eventLogRepo,
  inventoryCacheRepo,
  messagesRepo,
  nativeMappingsRepo,
  partsRepo,
  projectsRepo,
  receiptsRepo,
  RepoError,
  requestsRepo,
  sessionsRepo,
  turnsRepo,
} from "./index"
import { Database } from "./test/bun-sqlite-shim"

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url)
)
const timestamp = "2026-01-01T00:00:00.000Z"

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

describe("database repositories", () => {
  let client: Database
  let db: ReturnType<typeof createDb>

  beforeEach(() => {
    client = new Database(":memory:")
    client.exec("PRAGMA foreign_keys = ON")
    applyMigrations(client)
    db = createDb(client)
  })

  afterEach(() => client.close())

  function createProjectAndSession(): void {
    projectsRepo.upsertByDirectory(db, projectFixture())
    sessionsRepo.create(db, sessionFixture())
  }

  function createReceiptAndMessages(): void {
    receiptsRepo.upsertAccepted(db, {
      commandId: "cmd_0001",
      commandName: "turn.send",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    const { seq: _userSeq, ...user } = userMessageFixture()
    const { seq: _assistantSeq, ...assistant } = assistantMessageFixture()
    messagesRepo.createUser(db, user)
    messagesRepo.createAssistant(db, assistant)
  }

  it("round trips projects, sessions, messages, parts, turns, and requests", () => {
    createProjectAndSession()
    createReceiptAndMessages()

    expect(projectsRepo.get(db, "proj_1")).toEqual(projectFixture())
    expect(projectsRepo.list(db)).toHaveLength(1)
    expect(sessionsRepo.listByProject(db, "proj_1")).toHaveLength(1)
    expect(sessionsRepo.rename(db, "ses_1", "Renamed", timestamp)?.title).toBe(
      "Renamed"
    )
    expect(sessionsRepo.touch(db, "ses_1", timestamp)?.updatedAt).toBe(
      timestamp
    )

    expect(
      messagesRepo.listBySession(db, "ses_1").map((item) => item.seq)
    ).toEqual([0, 1])
    expect(messagesRepo.get(db, "msg_assistant_1")).toEqual(
      assistantMessageFixture()
    )
    const updatedPart = {
      ...assistantMessageFixture().parts[1],
      text: "Updated text",
    }
    partsRepo.upsert(db, updatedPart)
    expect(partsRepo.listByMessage(db, "msg_assistant_1")[1]).toEqual(
      updatedPart
    )

    const turn = turnsRepo.create(db, {
      id: "turn_1",
      sessionId: "ses_1",
      execution: resolvedExecutionFixture(),
      commandId: "cmd_0001",
      userMessageId: "msg_user_1",
    })
    expect(turn.status).toBe("queued")
    expect(turnsRepo.listOpenBySession(db, "ses_1")).toEqual([turn])
    const running = turnsRepo.update(db, "turn_1", {
      status: "running",
      assistantMessageId: "msg_assistant_1",
      startedAt: timestamp,
    })
    expect(turnsRepo.listRunning(db)).toEqual([running])

    const request = {
      ...inputRequestFixture(),
      status: "open" as const,
      resolution: undefined,
    }
    requestsRepo.upsert(db, request)
    expect(requestsRepo.listOpenBySession(db, "ses_1")).toEqual([request])
    expect(
      requestsRepo.resolve(db, request.id, {
        kind: "input",
        answers: { approach: { optionIds: ["safe"] } },
      })?.status
    ).toBe("resolved")
    expect(requestsRepo.cancel(db, request.id)?.status).toBe("cancelled")
  })

  it("allocates unique message sequences in immediate transactions", () => {
    createProjectAndSession()
    const fixture = userMessageFixture()
    for (let index = 0; index < 20; index++) {
      messagesRepo.createUser(db, {
        ...fixture,
        id: `message-${index}`,
        parts: [],
      })
    }

    expect(
      messagesRepo.listBySession(db, "ses_1").map((item) => item.seq)
    ).toEqual(Array.from({ length: 20 }, (_, index) => index))
  })

  it("deduplicates receipts and round trips mappings and dispatch input", () => {
    createProjectAndSession()
    createReceiptAndMessages()
    turnsRepo.create(db, {
      id: "turn_1",
      sessionId: "ses_1",
      execution: resolvedExecutionFixture(),
      commandId: "cmd_0001",
      userMessageId: "msg_user_1",
    })

    const duplicate = receiptsRepo.upsertAccepted(db, {
      commandId: "cmd_0001",
      commandName: "session.delete",
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    })
    expect(duplicate.commandName).toBe("turn.send")
    expect(
      receiptsRepo.updateState(db, "cmd_0001", "dispatching", {
        updatedAt: timestamp,
        acknowledgement: { accepted: true },
      })?.state
    ).toBe("dispatching")
    expect(receiptsRepo.listByStates(db, ["dispatching"])).toHaveLength(1)

    nativeMappingsRepo.upsert(db, {
      sessionId: "ses_1",
      instanceId: "opencode",
      nativeSessionId: "native-1",
      resumeCursor: "cursor-1",
      syncCursor: -1,
      unsafe: false,
    })
    expect(
      nativeMappingsRepo.setSyncCursor(db, "ses_1", "opencode", 1)?.syncCursor
    ).toBe(1)
    expect(nativeMappingsRepo.markUnsafe(db, "ses_1", "opencode")?.unsafe).toBe(
      true
    )

    const mapping = {
      instanceId: "opencode",
      mappingKind: "message" as const,
      aideId: "msg_user_1",
      nativeId: "native-message-1",
    }
    adapterMappingsRepo.put(db, mapping)
    expect(
      adapterMappingsRepo.get(db, "opencode", "message", "msg_user_1")
    ).toEqual(mapping)

    const dispatchInput: NativeDispatchInput = {
      id: "dispatch-1",
      turnId: "turn_1",
      instanceId: "opencode",
      nativeSessionId: "native-1",
      role: "handoff",
      fromMessageSeq: 0,
      throughMessageSeq: 1,
      content: "context",
      createdAt: timestamp,
    }
    dispatchInputsRepo.create(db, dispatchInput)
    expect(dispatchInputsRepo.listByTurn(db, "turn_1")).toEqual([dispatchInput])
  })

  it("round trips inventory, config, artifacts, and monotonic event scopes", () => {
    const inventory = inventoryFixture()
    inventoryCacheRepo.put(db, "/tmp/aide", inventory)
    expect(inventoryCacheRepo.get(db, "opencode", "/tmp/aide")).toEqual(
      inventory
    )

    const config: AideConfig = {
      instances: {},
      mcpServers: {},
      defaults: {},
    }
    configRepo.put(db, config, timestamp)
    configRepo.put(
      db,
      { projectId: "proj_1", defaults: { instanceId: "opencode" } },
      timestamp
    )
    expect(configRepo.get(db, { kind: "global" })).toEqual(config)
    expect(
      configRepo.get(db, { kind: "project", projectId: "proj_1" })
    ).toEqual({
      projectId: "proj_1",
      defaults: { instanceId: "opencode" },
    })

    const artifact = {
      id: "artifact-1",
      mimeType: "text/plain",
      data: Buffer.from("hello"),
      byteLength: 5,
      createdAt: timestamp,
    }
    artifactsRepo.create(db, artifact)
    expect(artifactsRepo.get(db, artifact.id)).toEqual(artifact)

    const events = eventFixtures()
    const first = eventLogRepo.append(db, events[0])
    const second = eventLogRepo.append(db, events[1])
    const instances = eventLogRepo.append(
      db,
      events.find((event) => event.type === "harness.connected")!
    )
    expect(first.delivery).toEqual({ durable: true, sequence: 1 })
    expect(second.delivery).toEqual({ durable: true, sequence: 2 })
    expect(instances.delivery).toEqual({ durable: true, sequence: 1 })
    expect(
      eventLogRepo.latestSequence(db, { kind: "session", sessionId: "ses_1" })
    ).toBe(2)
    expect(
      eventLogRepo.listAfter(db, { kind: "session", sessionId: "ses_1" }, 0, 10)
    ).toEqual([first, second])
    expect(() =>
      eventLogRepo.append(
        db,
        events.find((event) => event.type === "part.delta")!
      )
    ).toThrow(RepoError)
  })

  it("throws RepoError for corrupted persisted JSON", () => {
    createProjectAndSession()
    const { seq: _seq, ...user } = userMessageFixture()
    messagesRepo.createUser(db, user)
    client
      .prepare("UPDATE messages SET execution_json = ? WHERE id = ?")
      .run("{broken", "msg_user_1")

    expect(() => messagesRepo.get(db, "msg_user_1")).toThrowError(
      expect.objectContaining({ code: "corrupt_json", retryable: false })
    )
  })

  it("deletes sessions and their owned records", () => {
    createProjectAndSession()
    expect(sessionsRepo.delete(db, "ses_1")).toBe(true)
    expect(sessionsRepo.get(db, "ses_1")).toBeUndefined()
    expect(sessionsRepo.delete(db, "ses_1")).toBe(false)
  })
})
