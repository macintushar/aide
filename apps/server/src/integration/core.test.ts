import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  aideEventSchema,
  sessionSnapshotSchema,
  type CommandReceipt,
  type ExecutionSelection,
  type SessionSnapshot,
} from "@workspace/contracts"
import { afterEach, describe, expect, it } from "vitest"

import { createDb, nativeMappingsRepo, turnsRepo } from "../db"
import { Database } from "../db/test/bun-sqlite-shim"
import { eventSseFrame } from "../events"
import { createFakeHarnessAdapter } from "../harness/fake"
import { REDACTED } from "../mcp"
import { AdapterRegistry } from "../services"
import { createTestDb } from "../test/db"
import { createAideTestApp } from "./app"

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url)
)
const token = "gate-g1-token"
const origin = "http://127.0.0.1:3000"
const selection: ExecutionSelection = {
  instanceId: "fake-primary",
  driver: "opencode",
  model: { providerId: "fake-provider", modelId: "fake-standard" },
  agent: "build",
  interactionMode: "build",
  options: { variant: "stable" },
}

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

async function waitFor<T>(
  read: () => T | undefined,
  timeout = 2000
): Promise<T> {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for lifecycle state")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe("Gate G1 core integration", () => {
  const clients: Database[] = []
  afterEach(() => {
    for (const client of clients.splice(0)) client.close()
  })

  function boot() {
    const client = new Database(":memory:")
    clients.push(client)
    client.exec("PRAGMA foreign_keys = ON")
    applyMigrations(client)
    const db = createDb(client)
    const registry = new AdapterRegistry()
    const { adapter, control } = createFakeHarnessAdapter({
      projectId: "project_1",
    })
    const instance = {
      instanceId: "fake-primary",
      driver: adapter.driver,
      displayName: "Fake Primary",
      enabled: true,
      autoStart: true,
      config: {},
    } as const
    let tick = 0
    const now = () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString()
    const counters = new Map<string, number>()
    const id = (kind: string) => {
      const next = (counters.get(kind) ?? 0) + 1
      counters.set(kind, next)
      return `${kind}_${next}`
    }
    const started = adapter.start({
      instance,
      projectDirectory: "/tmp/gate-g1",
    })
    return started.then((handle) => {
      registry.register({ adapter, handle, instance })
      const integration = createAideTestApp({
        db,
        registry,
        bearerToken: token,
        allowedOrigins: [origin],
        now,
        id,
      })
      return {
        adapter,
        handle,
        control,
        ...integration,
      }
    })
  }

  async function command(
    app: Awaited<ReturnType<typeof boot>>["app"],
    name: string,
    body: Record<string, unknown>
  ): Promise<CommandReceipt> {
    const response = await app.request(`/commands/${name}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name, ...body }),
    })
    expect([200, 202]).toContain(response.status)
    return (await response.json()) as CommandReceipt
  }

  async function createProjectSession(
    subject: Awaited<ReturnType<typeof boot>>
  ) {
    const projectReceipt = await command(subject.app, "project.open", {
      commandId: "command_project",
      directory: "/tmp/gate-g1",
      projectName: "Gate G1",
    })
    const project = projectReceipt.result as { id: string }
    const sessionReceipt = await command(subject.app, "session.create", {
      commandId: "command_session",
      projectId: project.id,
      title: "Wave 1",
    })
    return (sessionReceipt.result as { id: string }).id
  }

  it("guards config reads and redacts configuration secrets", async () => {
    const created = createTestDb()
    try {
      const integration = createAideTestApp({
        db: created.db,
        bearerToken: token,
        allowedOrigins: [origin],
      })
      await integration.services.config.update({
        commandId: "command_global_config",
        name: "config.update",
        target: { kind: "global" },
        config: {
          mcpServers: {
            global: {
              type: "http",
              url: "https://global.example.test",
              headers: { Authorization: "global-secret" },
            },
          },
          instances: {
            opencode: {
              instanceId: "opencode",
              driver: "opencode",
              enabled: true,
              autoStart: false,
              config: { env: { ANTHROPIC_API_KEY: "driver-secret" } },
              mcpServers: {
                instance: {
                  type: "stdio",
                  command: "instance-mcp",
                  env: { TOKEN: "instance-secret" },
                },
              },
            },
          },
        },
      })
      await integration.services.config.update({
        commandId: "command_project_config",
        name: "config.update",
        target: { kind: "project", projectId: "project_1" },
        config: {
          mcpServers: {
            project: {
              type: "sse",
              url: "https://project.example.test/sse",
              headers: { "X-Token": "project-secret" },
            },
          },
        },
      })

      expect((await integration.app.request("/config")).status).toBe(401)
      expect(
        (await integration.app.request("/projects/project_1/config")).status
      ).toBe(401)

      const headers = { authorization: `Bearer ${token}`, origin }
      await expect(
        (await integration.app.request("/config", { headers })).json()
      ).resolves.toMatchObject({
        mcpServers: {
          global: { headers: { Authorization: REDACTED } },
        },
        instances: {
          opencode: {
            config: { env: { ANTHROPIC_API_KEY: REDACTED } },
            mcpServers: { instance: { env: { TOKEN: REDACTED } } },
          },
        },
      })
      await expect(
        (
          await integration.app.request("/projects/project_1/config", {
            headers,
          })
        ).json()
      ).resolves.toMatchObject({
        mcpServers: {
          project: { headers: { "X-Token": REDACTED } },
        },
      })
    } finally {
      created.client.close()
    }
  })

  it("drives commands, scheduling, requests, snapshots, replay, and ephemeral deltas", async () => {
    const subject = await boot()
    const sessionId = await createProjectSession(subject)
    const live = subject.eventService.subscribe({ kind: "session", sessionId })
    const liveEvents: unknown[] = []
    const collect = (async () => {
      for await (const event of live) liveEvents.push(event)
    })()

    const firstReceipt = await command(subject.app, "turn.send", {
      commandId: "command_turn_1",
      sessionId,
      content: "first wave turn",
      execution: selection,
    })
    expect(["accepted", "dispatching", "dispatched"]).toContain(
      firstReceipt.state
    )

    const mid = await waitFor(() => {
      const snapshot = subject.snapshotService.sessionSnapshot(sessionId)
      return snapshot.turns[0]?.status === "running" &&
        snapshot.requests.some(
          (request) =>
            request.kind === "permission" && request.status === "open"
        )
        ? snapshot
        : undefined
    })
    sessionSnapshotSchema.parse(mid)
    expect(mid.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ])
    const reloadCursor = mid.cursor.sequence

    const duplicate = await command(subject.app, "turn.send", {
      commandId: "command_turn_1",
      sessionId,
      content: "first wave turn",
      execution: selection,
    })
    expect(duplicate.commandId).toBe("command_turn_1")
    const firstUser = mid.messages.find((message) => message.role === "user")!
    expect(subject.control.invocationCount(firstUser.id)).toBe(1)

    await command(subject.app, "turn.send", {
      commandId: "command_turn_2",
      sessionId,
      content: "second queued turn",
      execution: selection,
    })
    const queued = await waitFor(() => {
      const snapshot = subject.snapshotService.sessionSnapshot(sessionId)
      return snapshot.turns.length === 2 ? snapshot : undefined
    })
    expect(queued.turns.map((turn) => turn.status)).toEqual([
      "running",
      "queued",
    ])
    const secondUser = queued.messages.filter(
      (message) => message.role === "user"
    )[1]!
    expect(subject.control.invocationCount(secondUser.id)).toBe(0)

    const permission = mid.requests.find(
      (request) => request.kind === "permission"
    )!
    await command(subject.app, "permission.respond", {
      commandId: "command_permission_1",
      requestId: permission.id,
      resolution: { kind: "permission", optionId: "allow" },
    })
    const input = await waitFor(() => {
      const request = subject.snapshotService
        .sessionSnapshot(sessionId)
        .requests.find(
          (candidate) =>
            candidate.kind === "input" && candidate.status === "open"
        )
      return request?.kind === "input" ? request : undefined
    })
    await command(subject.app, "input.respond", {
      commandId: "command_input_1",
      requestId: input.id,
      resolution: {
        kind: "input",
        answers: {
          approach: { optionIds: ["fast"] },
          notes: { text: "reload-safe" },
        },
      },
    })

    await waitFor(() =>
      subject.snapshotService.sessionSnapshot(sessionId).turns[0]?.status ===
      "completed"
        ? true
        : undefined
    )
    await waitFor(() =>
      subject.control.invocationCount(secondUser.id) === 1 ? true : undefined
    )

    const secondPermission = await waitFor(() => {
      const requests =
        subject.snapshotService.sessionSnapshot(sessionId).requests
      return requests.find(
        (request) =>
          request.turnId === queued.turns[1]!.id &&
          request.kind === "permission" &&
          request.status === "open"
      )
    })
    await command(subject.app, "permission.respond", {
      commandId: "command_permission_2",
      requestId: secondPermission.id,
      resolution: { kind: "permission", optionId: "allow" },
    })
    const secondInput = await waitFor(() =>
      subject.snapshotService
        .sessionSnapshot(sessionId)
        .requests.find(
          (request) =>
            request.turnId === queued.turns[1]!.id &&
            request.kind === "input" &&
            request.status === "open"
        )
    )
    await command(subject.app, "input.respond", {
      commandId: "command_input_2",
      requestId: secondInput.id,
      resolution: {
        kind: "input",
        answers: {
          approach: { optionIds: ["safe"] },
          notes: { text: "second" },
        },
      },
    })

    const final = await waitFor<SessionSnapshot>(() => {
      const snapshot = subject.snapshotService.sessionSnapshot(sessionId)
      return snapshot.turns.every((turn) => turn.status === "completed")
        ? snapshot
        : undefined
    })
    sessionSnapshotSchema.parse(final)
    expect(final.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ])
    for (const assistant of final.messages.filter(
      (message) => message.role === "assistant"
    )) {
      expect(assistant.parts.map((part) => part.index)).toEqual([0, 1, 2, 3])
    }

    const replay = subject.eventService.listDurable({
      scope: { kind: "session", sessionId },
      cursor: subject.eventService.cursor(
        { kind: "session", sessionId },
        reloadCursor
      ),
    })
    expect(replay.some((event) => event.type === "turn.completed")).toBe(true)
    expect(replay.map((event) => String(event.type))).not.toContain(
      "part.delta"
    )
    replay.forEach((event) => aideEventSchema.parse(event))

    const reconstructed = structuredClone(mid)
    for (const event of replay) {
      if (event.type === "message.upserted") {
        const existing = reconstructed.messages.findIndex(
          (message) => message.id === event.data.message.id
        )
        const message = {
          ...event.data.message,
          parts: existing === -1 ? [] : reconstructed.messages[existing]!.parts,
        }
        if (existing === -1) reconstructed.messages.push(message)
        else reconstructed.messages[existing] = message
      } else if (event.type === "part.upserted") {
        const message = reconstructed.messages.find(
          (candidate) => candidate.id === event.data.part.messageId
        )!
        message.parts = message.parts.filter(
          (part) => part.id !== event.data.part.id
        )
        message.parts.push(event.data.part)
        message.parts.sort((left, right) => left.index - right.index)
      } else if (event.type.startsWith("turn.")) {
        const turn = "turn" in event.data ? event.data.turn : undefined
        if (turn) {
          const existing = reconstructed.turns.findIndex(
            (item) => item.id === turn.id
          )
          if (existing === -1) reconstructed.turns.push(turn)
          else reconstructed.turns[existing] = turn
        }
      } else if (event.type.startsWith("request.")) {
        const request = "request" in event.data ? event.data.request : undefined
        if (request) {
          const existing = reconstructed.requests.findIndex(
            (item) => item.id === request.id
          )
          if (existing === -1) reconstructed.requests.push(request)
          else reconstructed.requests[existing] = request
        }
      }
    }
    reconstructed.cursor.sequence = final.cursor.sequence
    reconstructed.messages.sort((left, right) => left.seq - right.seq)
    reconstructed.turns.sort((left, right) => left.seq - right.seq)
    reconstructed.requests.sort((left, right) =>
      left.turnId === right.turnId
        ? left.id.localeCompare(right.id)
        : left.turnId.localeCompare(right.turnId)
    )
    expect(reconstructed.messages).toEqual(final.messages)
    expect(reconstructed.turns).toEqual(final.turns)
    expect(reconstructed.requests).toEqual(final.requests)
    expect(
      liveEvents.some(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          "type" in event &&
          event.type === "part.delta" &&
          !eventSseFrame(event as Parameters<typeof eventSseFrame>[0]).includes(
            "id:"
          )
      )
    ).toBe(true)

    const reloaded = createAideTestApp({
      db: subject.db,
      registry: subject.registry,
    })
    expect(reloaded.snapshotService.sessionSnapshot(sessionId)).toEqual(final)
    await live.return()
    await collect
  })

  it("fails a persisted running turn when a new core has no active stream", async () => {
    const subject = await boot()
    const sessionId = await createProjectSession(subject)
    await command(subject.app, "turn.send", {
      commandId: "command_orphan",
      sessionId,
      content: "orphan me",
      execution: selection,
    })
    await waitFor(() =>
      subject.snapshotService.sessionSnapshot(sessionId).turns[0]?.status ===
      "running"
        ? true
        : undefined
    )
    // The instance did not survive the restart, so its native session can no
    // longer be resumed and the turn must be failed rather than rerouted.
    subject.adapter.resumeSession = async () => {
      throw new Error("fake instance is gone")
    }

    const restarted = createAideTestApp({
      db: subject.db,
      registry: subject.registry,
    })
    const reconciled = await restarted.services.turns.reconcileRunningTurns()
    expect(reconciled).toHaveLength(1)
    expect(reconciled[0]).toMatchObject({
      status: "failed",
      error: {
        code: "orphaned_running_turn",
        instanceId: "fake-primary",
        retryable: false,
      },
    })
    expect(
      restarted.snapshotService.sessionSnapshot(sessionId).turns[0]?.status
    ).toBe("failed")
    await subject.adapter.stop({ handle: subject.handle })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it("reattaches a persisted running turn whose native session survives", async () => {
    const subject = await boot()
    const sessionId = await createProjectSession(subject)
    await command(subject.app, "turn.send", {
      commandId: "command_reattach_running",
      sessionId,
      content: "finish me after the restart",
      execution: selection,
    })
    const permission = await waitFor(() => {
      const snapshot = subject.snapshotService.sessionSnapshot(sessionId)
      return snapshot.turns[0]?.status === "running"
        ? snapshot.requests.find(
            (request) =>
              request.kind === "permission" && request.status === "open"
          )
        : undefined
    })

    // The instance outlived the core, so the turn keeps running under a
    // rebuilt event consumer instead of being failed.
    const restarted = createAideTestApp({
      db: subject.db,
      registry: subject.registry,
    })
    expect(await restarted.services.turns.reconcileRunningTurns()).toEqual([])
    const turnId =
      subject.snapshotService.sessionSnapshot(sessionId).turns[0]!.id
    expect(restarted.services.turns.hasActiveStream(turnId)).toBe(true)
    expect(
      restarted.snapshotService.sessionSnapshot(sessionId).turns[0]?.status
    ).toBe("running")

    // The reattached stream still answers requests, so the turn completes on
    // the new core rather than stranding its session.
    await command(restarted.app, "permission.respond", {
      commandId: "command_reattach_permission",
      requestId: permission.id,
      resolution: { kind: "permission", optionId: "allow" },
    })
    const input = await waitFor(() =>
      restarted.snapshotService
        .sessionSnapshot(sessionId)
        .requests.find(
          (request) => request.kind === "input" && request.status === "open"
        )
    )
    await command(restarted.app, "input.respond", {
      commandId: "command_reattach_input",
      requestId: input.id,
      resolution: {
        kind: "input",
        answers: {
          approach: { optionIds: ["safe"] },
          notes: { text: "reattached" },
        },
      },
    })
    await waitFor(() =>
      restarted.snapshotService.sessionSnapshot(sessionId).turns[0]?.status ===
      "completed"
        ? true
        : undefined
    )
    expect(
      nativeMappingsRepo.get(subject.db, sessionId, "fake-primary")
    ).toMatchObject({ unsafe: false })
    await subject.adapter.stop({ handle: subject.handle })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it("resumes a cleanly completed mapping's session after a restart", async () => {
    const subject = await boot()
    const sessionId = await createProjectSession(subject)

    async function resolveOpenRequests() {
      for (const request of subject.snapshotService
        .sessionSnapshot(sessionId)
        .requests.filter((candidate) => candidate.status === "open")) {
        await command(subject.app, "permission.respond", {
          commandId: `command_resolve_${request.id}_perm`,
          requestId: request.id,
          resolution: { kind: "permission", optionId: "allow" },
        }).catch(async () => {
          await command(subject.app, "input.respond", {
            commandId: `command_resolve_${request.id}_input`,
            requestId: request.id,
            resolution: {
              kind: "input",
              answers: {
                approach: { optionIds: ["safe"] },
                notes: { text: "restart" },
              },
            },
          })
        })
      }
    }

    await command(subject.app, "turn.send", {
      commandId: "command_reattach_first",
      sessionId,
      content: "complete me",
      execution: selection,
    })
    for (;;) {
      await resolveOpenRequests()
      if (
        subject.snapshotService.sessionSnapshot(sessionId).turns[0]?.status ===
        "completed"
      ) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(
      nativeMappingsRepo.get(subject.db, sessionId, "fake-primary")
    ).toMatchObject({ unsafe: false })

    // A second turn is submitted while its native session acquisition is
    // gated, so it is still persisted as running when the core "restarts".
    let releaseResume!: () => void
    const resumeGate = new Promise<void>((resolve) => {
      releaseResume = resolve
    })
    const originalResume = subject.adapter.resumeSession.bind(subject.adapter)
    subject.adapter.resumeSession = async (input: never) => {
      await resumeGate
      return originalResume(input)
    }
    await command(subject.app, "turn.send", {
      commandId: "command_reattach_second",
      sessionId,
      content: "queued across restart",
      execution: selection,
    })
    await waitFor(() =>
      turnsRepo.get(subject.db, "turn_2")?.status === "running" ||
      turnsRepo.get(subject.db, "turn_2")?.status === "queued"
        ? true
        : undefined
    )
    releaseResume()
    const resumed = createAideTestApp({
      db: subject.db,
      registry: subject.registry,
    })
    const reconciled = await resumed.services.turns.reconcileRunningTurns()
    expect(reconciled).toEqual([])

    const secondTurn = await waitFor(() => {
      const turn = resumed.snapshotService
        .sessionSnapshot(sessionId)
        .turns.find(
          (candidate) => candidate.commandId === "command_reattach_second"
        )
      return turn ? turn : undefined
    })
    expect(
      resumed.snapshotService
        .sessionSnapshot(sessionId)
        .turns.find((turn) => turn.commandId === "command_reattach_first")
        ?.status
    ).toBe("completed")
    expect(secondTurn.status).toBe("queued")
    // The safe mapping from the first turn is preserved for the resumed core.
    expect(
      nativeMappingsRepo.get(subject.db, sessionId, "fake-primary")
    ).toMatchObject({ unsafe: false })

    // Drain the queued turn so no core touches the closed database later.
    for (;;) {
      await resolveOpenRequests()
      if (
        resumed.snapshotService
          .sessionSnapshot(sessionId)
          .turns.find((turn) => turn.commandId === "command_reattach_second")
          ?.status === "completed"
      ) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    await subject.adapter.stop({ handle: subject.handle })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})
