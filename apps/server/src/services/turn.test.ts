import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type {
  AideEvent,
  ExecutionSelection,
  Request,
  Turn,
} from "@workspace/contracts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ExternalCommandContext } from "../commands"
import {
  artifactsRepo,
  createDb,
  messagesRepo,
  nativeMappingsRepo,
  partsRepo,
  projectsRepo,
  receiptsRepo,
  requestsRepo,
  turnsRepo,
} from "../db"
import { Database } from "../db/test/bun-sqlite-shim"
import { createFakeHarnessAdapter } from "../harness/fake"
import { createAideTestApp } from "../integration/app"
import { AdapterRegistry } from "./adapter-registry"

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url)
)
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

async function waitFor<T>(read: () => T | undefined): Promise<T> {
  const deadline = Date.now() + 1000
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for turn state")
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}

function commandContext() {
  const context = {
    defer: vi.fn(),
    markDispatching: vi.fn(),
    markDispatched: vi.fn(),
    markUncertain: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
  }
  return context as typeof context & ExternalCommandContext
}

function eventStream() {
  type StreamItem = { event: AideEvent } | { error: unknown }
  const queued: StreamItem[] = []
  const waiting: Array<(item: StreamItem) => void> = []
  return {
    emit(event: AideEvent) {
      const resolve = waiting.shift()
      const item = { event }
      if (resolve) resolve(item)
      else queued.push(item)
    },
    fail(error: unknown) {
      const resolve = waiting.shift()
      const item = { error }
      if (resolve) resolve(item)
      else queued.push(item)
    },
    iterable: {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          const item =
            queued.shift() ??
            (await new Promise<StreamItem>((resolve) => waiting.push(resolve)))
          if ("error" in item) throw item.error
          yield item.event
        }
      },
    },
  }
}

describe("TurnService", () => {
  let client: Database
  let cleanup: (() => Promise<void>)[]

  beforeEach(() => {
    client = new Database(":memory:")
    client.exec("PRAGMA foreign_keys = ON")
    applyMigrations(client)
    cleanup = []
  })

  afterEach(async () => {
    await Promise.all(cleanup.map((stop) => stop()))
    client.close()
  })

  async function boot(options: { controlled?: boolean } = {}) {
    const db = createDb(client)
    const registry = new AdapterRegistry()
    const fake = createFakeHarnessAdapter({ projectId: "project_1" })
    const instance = {
      instanceId: "fake-primary",
      driver: "opencode" as const,
      displayName: "Fake Primary",
      enabled: true,
      autoStart: true,
      config: {},
    }
    const handle = await fake.adapter.start({ instance })
    const stream = eventStream()
    if (options.controlled) {
      fake.adapter.events = () => stream.iterable
      fake.adapter.send = vi.fn().mockResolvedValue(undefined)
    }
    registry.register({ adapter: fake.adapter, handle, instance })
    cleanup.push(() => fake.adapter.stop({ handle }))
    let tick = 0
    const counters = new Map<string, number>()
    const integration = createAideTestApp({
      db,
      registry,
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
      id: (kind) => {
        const value = (counters.get(kind) ?? 0) + 1
        counters.set(kind, value)
        return `${kind}_${value}`
      },
    })
    const project = integration.services.projects.open(
      "/tmp/turn-tests",
      "Turns"
    )
    const session = integration.services.projects.createSession(project.id)
    return { ...integration, ...fake, handle, project, session, stream }
  }

  async function submit(
    subject: Awaited<ReturnType<typeof boot>>,
    commandId = "command_turn",
    context = commandContext(),
    execution = selection
  ) {
    receiptsRepo.upsertAccepted(subject.db, {
      commandId,
      commandName: "turn.send",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })
    const turn = await subject.services.turns.submit({
      commandId,
      sessionId: subject.session.id,
      content: "test turn",
      execution,
      context,
    })
    return { turn, context }
  }

  function adapterEvent(
    turn: Turn,
    type: AideEvent["type"],
    data: unknown,
    eventId = `adapter-${type}`,
    messageId?: string,
    partId?: string
  ): AideEvent {
    return {
      schemaVersion: 1,
      eventId,
      timestamp: "2026-01-01T01:00:00.000Z",
      delivery: { durable: true, sequence: 1 },
      scope: {
        kind: "session",
        projectId: "adapter-project",
        sessionId: "adapter-session",
        turnId: "adapter-turn",
        ...(messageId ? { messageId } : {}),
        ...(partId ? { partId } : {}),
      },
      instanceId: "adapter-instance",
      driver: "opencode",
      type,
      data,
    } as AideEvent
  }

  it("rejects missing sessions, missing projects, and invalid selections", async () => {
    const subject = await boot()
    const context = commandContext()
    await expect(
      subject.services.turns.submit({
        commandId: "missing-session",
        sessionId: "missing",
        content: "no session",
        execution: selection,
        context,
      })
    ).rejects.toMatchObject({
      aideError: expect.objectContaining({ code: "session_not_found" }),
    })

    client.exec("PRAGMA foreign_keys = OFF")
    client.prepare("DELETE FROM projects WHERE id = ?").run(subject.project.id)
    await expect(
      subject.services.turns.submit({
        commandId: "missing-project",
        sessionId: subject.session.id,
        content: "no project",
        execution: selection,
        context,
      })
    ).rejects.toMatchObject({
      aideError: expect.objectContaining({ code: "project_not_found" }),
    })

    projectsRepo.upsertByDirectory(subject.db, subject.project)
    await expect(
      submit(subject, "bad-selection", context, {
        ...selection,
        model: { ...selection.model, modelId: "missing" },
      })
    ).rejects.toMatchObject({
      aideError: expect.objectContaining({ code: "model_unavailable" }),
    })
    expect(turnsRepo.listBySession(subject.db, subject.session.id)).toEqual([])
  })

  it("fails a persisted turn when the adapter rejects send", async () => {
    const subject = await boot()
    subject.control.setNextDispatchOutcome("known-not-dispatched")
    const { turn, context } = await submit(subject)

    const failed = await waitFor(() => {
      const current = turnsRepo.get(subject.db, turn.id)
      return current?.status === "failed" ? current : undefined
    })
    expect(failed.error).toMatchObject({
      code: "dispatch_rejected",
      instanceId: "fake-primary",
      retryable: true,
    })
    expect(context.markUncertain).toHaveBeenCalledWith(
      expect.objectContaining({ code: "dispatch_rejected" })
    )
    expect(subject.services.turns.hasActiveStream(turn.id)).toBe(false)
  })

  it("cancels an ambiguous dispatch before releasing its queued successor", async () => {
    const subject = await boot()
    subject.control.setNextDispatchOutcome("ambiguous-after-effect")
    const { turn, context } = await submit(subject)

    await waitFor(() =>
      context.markUncertain.mock.calls.length > 0 ? true : undefined
    )
    expect(context.markUncertain).toHaveBeenCalledWith(
      expect.objectContaining({ code: "execution_outcome_unknown" })
    )
    await waitFor(() => {
      const status = turnsRepo.get(subject.db, turn.id)?.status
      return status && status !== "running" ? status : undefined
    })
    expect(subject.services.turns.hasActiveStream(turn.id)).toBe(false)
    expect(subject.control.effectCount(turn.userMessageId)).toBe(1)
    expect(
      nativeMappingsRepo.get(subject.db, subject.session.id, "fake-primary")
        ?.unsafe
    ).toBe(true)
  })

  it("does not release an ambiguous dispatch until adapter cancellation succeeds", async () => {
    const subject = await boot({ controlled: true })
    let confirmCancellation!: () => void
    const cancellation = new Promise<void>((resolve) => {
      confirmCancellation = resolve
    })
    const send = vi
      .fn()
      .mockRejectedValueOnce({
        aideError: {
          code: "execution_outcome_unknown",
          message: "send may have taken effect",
          retryable: false,
        },
      })
      .mockResolvedValue(undefined)
    subject.adapter.send = send
    subject.adapter.interrupt = vi.fn(() => cancellation)

    const first = await submit(subject, "first")
    await waitFor(() =>
      vi.mocked(subject.adapter.interrupt).mock.calls.length > 0
        ? true
        : undefined
    )
    const second = await submit(subject, "second")

    expect(send).toHaveBeenCalledTimes(1)
    expect(turnsRepo.get(subject.db, first.turn.id)?.status).toBe("running")
    expect(turnsRepo.get(subject.db, second.turn.id)?.status).toBe("queued")

    confirmCancellation()
    await waitFor(() => (send.mock.calls.length === 2 ? true : undefined))
    expect(turnsRepo.get(subject.db, first.turn.id)).toMatchObject({
      status: "failed",
      error: { code: "execution_outcome_unknown" },
    })
    expect(turnsRepo.get(subject.db, second.turn.id)?.status).toBe("running")
  })

  it("keeps an ambiguously running turn locked until an explicit cancellation retry succeeds", async () => {
    const subject = await boot({ controlled: true })
    const send = vi
      .fn()
      .mockRejectedValueOnce({
        aideError: {
          code: "execution_outcome_unknown",
          message: "send may have taken effect",
          retryable: false,
        },
      })
      .mockResolvedValue(undefined)
    subject.adapter.send = send
    subject.adapter.interrupt = vi
      .fn()
      .mockRejectedValueOnce(new Error("internal cancellation failed"))
      .mockRejectedValueOnce(new Error("explicit cancellation failed"))
      .mockResolvedValue(undefined)

    const first = await submit(subject, "ambiguous-first")
    await waitFor(() =>
      vi.mocked(subject.adapter.interrupt).mock.calls.length === 1
        ? true
        : undefined
    )
    const second = await submit(subject, "queued-second")

    const failedRetry = await subject.dispatcher.dispatch({
      commandId: "interrupt-failed",
      name: "turn.interrupt",
      sessionId: subject.session.id,
      turnId: first.turn.id,
    })
    expect(failedRetry).toMatchObject({
      state: "uncertain",
      error: {
        code: "turn_cancellation_failed",
        retryable: true,
      },
    })
    expect(subject.services.turns.hasActiveStream(first.turn.id)).toBe(true)
    expect(turnsRepo.get(subject.db, second.turn.id)?.status).toBe("queued")
    expect(send).toHaveBeenCalledTimes(1)

    const successfulRetry = await subject.dispatcher.dispatch({
      commandId: "interrupt-succeeded",
      name: "turn.interrupt",
      sessionId: subject.session.id,
      turnId: first.turn.id,
    })
    expect(successfulRetry).toMatchObject({
      state: "completed",
      result: { turnId: first.turn.id, status: "interrupted" },
    })
    await waitFor(() => (send.mock.calls.length === 2 ? true : undefined))
    expect(turnsRepo.get(subject.db, first.turn.id)?.status).toBe("interrupted")
    expect(subject.services.turns.hasActiveStream(first.turn.id)).toBe(false)
    expect(turnsRepo.get(subject.db, second.turn.id)?.status).toBe("running")
  })

  it("releases an ambiguous turn on a late terminal event after cancellation fails", async () => {
    const subject = await boot({ controlled: true })
    const send = vi
      .fn()
      .mockRejectedValueOnce({
        aideError: {
          code: "execution_outcome_unknown",
          message: "send may have taken effect",
          retryable: false,
        },
      })
      .mockResolvedValue(undefined)
    subject.adapter.send = send
    subject.adapter.interrupt = vi
      .fn()
      .mockRejectedValue(new Error("cancellation failed"))

    const first = await submit(subject, "late-terminal-first")
    await waitFor(() =>
      vi.mocked(subject.adapter.interrupt).mock.calls.length === 1
        ? true
        : undefined
    )
    const second = await submit(subject, "late-terminal-second")
    const running = turnsRepo.get(subject.db, first.turn.id)!

    subject.stream.emit(
      adapterEvent(
        running,
        "turn.interrupted",
        {
          turn: {
            ...running,
            status: "interrupted",
            endedAt: "2026-01-01T01:00:00.000Z",
          },
        },
        "late-interrupted-event"
      )
    )

    await waitFor(() => (send.mock.calls.length === 2 ? true : undefined))
    expect(turnsRepo.get(subject.db, first.turn.id)?.status).toBe("interrupted")
    expect(subject.services.turns.hasActiveStream(first.turn.id)).toBe(false)
    expect(turnsRepo.get(subject.db, second.turn.id)?.status).toBe("running")
  })

  it("keeps an ambiguous turn locked when its event stream fails", async () => {
    const subject = await boot({ controlled: true })
    const send = vi
      .fn()
      .mockRejectedValueOnce({
        aideError: {
          code: "execution_outcome_unknown",
          message: "send may have taken effect",
          retryable: false,
        },
      })
      .mockResolvedValue(undefined)
    subject.adapter.send = send
    subject.adapter.interrupt = vi
      .fn()
      .mockRejectedValueOnce(new Error("automatic cancellation failed"))
      .mockResolvedValue(undefined)

    const first = await submit(subject, "stream-failure-first")
    await waitFor(() =>
      vi.mocked(subject.adapter.interrupt).mock.calls.length === 1
        ? true
        : undefined
    )
    const second = await submit(subject, "stream-failure-second")

    subject.stream.fail(new Error("adapter event stream disconnected"))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(turnsRepo.get(subject.db, first.turn.id)?.status).toBe("running")
    expect(subject.services.turns.hasActiveStream(first.turn.id)).toBe(true)
    expect(turnsRepo.get(subject.db, second.turn.id)?.status).toBe("queued")
    expect(send).toHaveBeenCalledTimes(1)

    await subject.dispatcher.dispatch({
      commandId: "stream-failure-interrupt",
      name: "turn.interrupt",
      sessionId: subject.session.id,
      turnId: first.turn.id,
    })

    await waitFor(() => (send.mock.calls.length === 2 ? true : undefined))
    expect(turnsRepo.get(subject.db, first.turn.id)?.status).toBe("interrupted")
    expect(turnsRepo.get(subject.db, second.turn.id)?.status).toBe("running")
  })

  it("revalidates a queued selection immediately before execution", async () => {
    const subject = await boot({ controlled: true })
    const first = await submit(subject, "revalidation-first")
    await waitFor(() =>
      turnsRepo.get(subject.db, first.turn.id)?.status === "running"
        ? true
        : undefined
    )
    const second = await submit(subject, "revalidation-second")
    expect(turnsRepo.get(subject.db, second.turn.id)?.status).toBe("queued")

    const discover = subject.adapter.discover.bind(subject.adapter)
    subject.adapter.discover = vi.fn(async (input) => ({
      ...(await discover(input)),
      models: [],
    }))
    await subject.services.turns.interrupt(
      subject.session.id,
      first.turn.id,
      commandContext()
    )

    const failed = await waitFor(() => {
      const turn = turnsRepo.get(subject.db, second.turn.id)
      return turn?.status === "failed" ? turn : undefined
    })
    expect(failed.error).toMatchObject({ code: "model_unavailable" })
    expect(subject.adapter.send).toHaveBeenCalledTimes(1)
  })

  it("fails a running turn when its instance event stream closes", async () => {
    const subject = await boot()
    const { turn } = await submit(subject, "stream-closed")
    await waitFor(() =>
      turnsRepo.get(subject.db, turn.id)?.status === "running"
        ? true
        : undefined
    )

    await subject.adapter.stop({ handle: subject.handle })

    const failed = await waitFor(() => {
      const current = turnsRepo.get(subject.db, turn.id)
      return current?.status === "failed" ? current : undefined
    })
    expect(failed.error).toEqual({
      code: "instance_event_stream_closed",
      message:
        "Instance fake-primary closed its event stream before the turn completed",
      instanceId: "fake-primary",
      retryable: false,
    })
    expect(subject.services.turns.hasActiveStream(turn.id)).toBe(false)
    expect(
      nativeMappingsRepo.get(subject.db, subject.session.id, "fake-primary")
        ?.unsafe
    ).toBe(true)
  })

  it("does not regress a terminal receipt when completion beats send acknowledgement", async () => {
    const subject = await boot({ controlled: true })
    let acknowledge!: () => void
    const acknowledgement = new Promise<void>((resolve) => {
      acknowledge = resolve
    })
    subject.adapter.send = vi.fn(() => acknowledgement)
    const { turn } = await submit(subject, "terminal-before-ack")
    const running = await waitFor(() => {
      const current = turnsRepo.get(subject.db, turn.id)
      return current?.status === "running" ? current : undefined
    })
    await waitFor(() =>
      vi.mocked(subject.adapter.send).mock.calls.length === 1 ? true : undefined
    )

    subject.stream.emit(
      adapterEvent(running, "turn.completed", {
        turn: {
          ...running,
          status: "completed",
          endedAt: "2026-01-01T01:00:00.000Z",
        },
      })
    )
    await waitFor(() =>
      turnsRepo.get(subject.db, turn.id)?.status === "completed"
        ? true
        : undefined
    )
    expect(receiptsRepo.get(subject.db, turn.commandId)?.state).toBe(
      "completed"
    )
    expect(
      nativeMappingsRepo.get(subject.db, subject.session.id, "fake-primary")
    ).toMatchObject({ syncCursor: 1, unsafe: false })

    acknowledge()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(receiptsRepo.get(subject.db, turn.commandId)?.state).toBe(
      "completed"
    )
    expect(turnsRepo.get(subject.db, turn.id)?.status).toBe("completed")
  })

  it("does not restart a queued turn interrupted during native session acquisition", async () => {
    const subject = await boot({ controlled: true })
    const originalOpen = subject.adapter.openSession.bind(subject.adapter)
    let releaseOpen!: () => void
    const openGate = new Promise<void>((resolve) => {
      releaseOpen = resolve
    })
    let firstOpenReturned!: () => void
    const firstOpenDone = new Promise<void>((resolve) => {
      firstOpenReturned = resolve
    })
    subject.adapter.openSession = vi
      .fn()
      .mockImplementationOnce(async (input) => {
        await openGate
        const native = await originalOpen(input)
        firstOpenReturned()
        return native
      })
      .mockImplementation(originalOpen)
    const started: string[] = []
    const broadcast = subject.eventService.broadcastDurable.bind(
      subject.eventService
    )
    vi.spyOn(subject.eventService, "broadcastDurable").mockImplementation(
      (event) => {
        broadcast(event)
        if (event.type === "turn.started") started.push(event.data.turn.id)
      }
    )

    const first = await submit(subject, "startup-first")
    await waitFor(() =>
      vi.mocked(subject.adapter.openSession).mock.calls.length === 1
        ? true
        : undefined
    )
    await subject.services.turns.interrupt(
      subject.session.id,
      first.turn.id,
      commandContext()
    )
    expect(receiptsRepo.get(subject.db, first.turn.commandId)).toMatchObject({
      state: "completed",
      result: { turnId: first.turn.id, status: "interrupted" },
    })

    releaseOpen()
    await firstOpenDone
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(turnsRepo.get(subject.db, first.turn.id)?.status).toBe("interrupted")
    expect(
      messagesRepo.get(subject.db, `${first.turn.id}-assistant`)
    ).toBeUndefined()
    expect(
      nativeMappingsRepo.get(subject.db, subject.session.id, "fake-primary")
    ).toBeUndefined()
    expect(started).not.toContain(first.turn.id)
    expect(subject.adapter.send).not.toHaveBeenCalled()
    expect(subject.services.turns.hasActiveStream(first.turn.id)).toBe(false)

    const second = await submit(subject, "startup-second")
    await waitFor(() =>
      vi.mocked(subject.adapter.send).mock.calls.length === 1 ? true : undefined
    )
    expect(turnsRepo.get(subject.db, second.turn.id)?.status).toBe("running")
    expect(vi.mocked(subject.adapter.send).mock.calls[0]?.[0].turnId).toBe(
      second.turn.id
    )
  })

  it("does not fail an interrupted turn when native session acquisition later rejects", async () => {
    const subject = await boot({ controlled: true })
    let rejectOpen!: (error: Error) => void
    const open = new Promise<never>((_resolve, reject) => {
      rejectOpen = reject
    })
    subject.adapter.openSession = vi.fn(() => open)

    const { turn } = await submit(subject, "startup-rejection")
    await waitFor(() =>
      vi.mocked(subject.adapter.openSession).mock.calls.length === 1
        ? true
        : undefined
    )
    await subject.services.turns.interrupt(
      subject.session.id,
      turn.id,
      commandContext()
    )
    rejectOpen(new Error("session setup failed late"))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(turnsRepo.get(subject.db, turn.id)?.status).toBe("interrupted")
    expect(receiptsRepo.get(subject.db, turn.commandId)).toMatchObject({
      state: "completed",
      result: { turnId: turn.id, status: "interrupted" },
    })
    expect(subject.adapter.send).not.toHaveBeenCalled()
    expect(subject.services.turns.hasActiveStream(turn.id)).toBe(false)
  })

  it("interrupts a turn persisted as running before adapter send", async () => {
    const subject = await boot({ controlled: true })
    const send = vi.mocked(subject.adapter.send)
    const interrupt = vi.spyOn(subject.adapter, "interrupt")
    const interruptContext = commandContext()
    let interruption: Promise<Turn> | undefined
    const broadcast = subject.eventService.broadcastDurable.bind(
      subject.eventService
    )
    vi.spyOn(subject.eventService, "broadcastDurable").mockImplementation(
      (event) => {
        broadcast(event)
        if (event.type === "turn.started") {
          interruption = subject.services.turns.interrupt(
            subject.session.id,
            event.data.turn.id,
            interruptContext
          )
        }
      }
    )

    const { turn } = await submit(subject)
    await waitFor(() => interruption)
    await interruption

    expect(turnsRepo.get(subject.db, turn.id)?.status).toBe("interrupted")
    expect(send).not.toHaveBeenCalled()
    expect(interrupt).not.toHaveBeenCalled()
    expect(subject.services.turns.hasActiveStream(turn.id)).toBe(false)
    expect(interruptContext.complete).toHaveBeenCalledWith({
      turnId: turn.id,
      status: "interrupted",
    })
  })

  it("interrupts queued turns locally and reports unknown and terminal turns", async () => {
    const subject = await boot({ controlled: true })
    const first = await submit(subject, "first")
    await waitFor(() =>
      turnsRepo.get(subject.db, first.turn.id)?.status === "running"
        ? true
        : undefined
    )
    const second = await submit(subject, "second")
    expect(turnsRepo.get(subject.db, second.turn.id)?.status).toBe("queued")

    const queuedContext = commandContext()
    const interrupted = await subject.services.turns.interrupt(
      subject.session.id,
      second.turn.id,
      queuedContext
    )
    expect(interrupted.status).toBe("interrupted")
    expect(queuedContext.markDispatched).toHaveBeenCalledWith({
      turnId: second.turn.id,
    })
    expect(subject.services.turns.hasActiveStream(first.turn.id)).toBe(true)

    const terminalContext = commandContext()
    await subject.services.turns.interrupt(
      subject.session.id,
      second.turn.id,
      terminalContext
    )
    expect(terminalContext.markDispatched).toHaveBeenCalledWith({
      turnId: second.turn.id,
      alreadyTerminal: true,
    })
    await expect(
      subject.services.turns.interrupt(
        subject.session.id,
        "missing",
        commandContext()
      )
    ).rejects.toMatchObject({
      aideError: expect.objectContaining({ code: "turn_not_found" }),
    })
  })

  it("deduplicates adapter events and persists message, part removal, and failure", async () => {
    const subject = await boot({ controlled: true })
    const { turn } = await submit(subject)
    const running = await waitFor(() => {
      const current = turnsRepo.get(subject.db, turn.id)
      return current?.status === "running" ? current : undefined
    })
    const assistantId = running.assistantMessageId!
    const part = {
      id: "adapter-part",
      messageId: assistantId,
      index: 0,
      type: "text" as const,
      text: "temporary",
    }
    const upsert = adapterEvent(
      running,
      "part.upserted",
      { part },
      "adapter-part-event",
      assistantId,
      part.id
    )
    subject.stream.emit(upsert)
    await waitFor(() =>
      partsRepo.listByMessage(subject.db, assistantId).length === 1
        ? true
        : undefined
    )
    subject.stream.emit(upsert)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(
      subject.eventService.findDurable("adapter-part-event")?.delivery
    ).toMatchObject({ durable: true })

    const assistant = messagesRepo.get(subject.db, assistantId)!
    const { parts: _parts, ...metadata } = assistant
    subject.stream.emit(
      adapterEvent(
        running,
        "message.upserted",
        { message: metadata },
        "adapter-message-event",
        assistantId
      )
    )
    subject.stream.emit(
      adapterEvent(
        running,
        "part.removed",
        { partId: part.id, messageId: assistantId },
        "adapter-remove-event",
        assistantId,
        part.id
      )
    )
    await waitFor(() =>
      partsRepo.listByMessage(subject.db, assistantId).length === 0
        ? true
        : undefined
    )

    const error = {
      code: "adapter_failed",
      message: "Adapter failed",
      retryable: false,
    }
    subject.stream.emit(
      adapterEvent(
        running,
        "turn.failed",
        {
          turn: {
            ...running,
            status: "failed",
            endedAt: "2026-01-01T01:00:00.000Z",
            error,
          },
        },
        "adapter-failed-event"
      )
    )
    const failed = await waitFor(() => {
      const current = turnsRepo.get(subject.db, turn.id)
      return current?.status === "failed" ? current : undefined
    })
    expect(failed.error).toEqual(error)
    expect(messagesRepo.get(subject.db, assistantId)).toMatchObject({
      completedAt: "2026-01-01T01:00:00.000Z",
    })
    expect(subject.services.turns.hasActiveStream(turn.id)).toBe(false)
  })

  it("announces the assistant placeholder when a turn starts", async () => {
    const subject = await boot()
    const { turn } = await submit(subject)
    const running = await waitFor(() => {
      const current = turnsRepo.get(subject.db, turn.id)
      return current?.status === "running" ? current : undefined
    })
    const assistantId = running.assistantMessageId!

    const announced = subject.eventService
      .listDurable({
        scope: { kind: "session", sessionId: subject.session.id },
        cursor: subject.eventService.cursor(
          { kind: "session", sessionId: subject.session.id },
          0
        ),
      })
      .find(
        (event) =>
          event.type === "message.upserted" &&
          event.data.message.id === assistantId
      )
    expect(announced).toBeDefined()
    expect(messagesRepo.get(subject.db, assistantId)?.role).toBe("assistant")
  })

  it("routes oversized tool output to an artifact with a bounded preview", async () => {
    const subject = await boot({ controlled: true })
    const { turn } = await submit(subject)
    const running = await waitFor(() => {
      const current = turnsRepo.get(subject.db, turn.id)
      return current?.status === "running" ? current : undefined
    })
    const assistantId = running.assistantMessageId!
    const largeOutput = "x".repeat(12_000)
    subject.stream.emit(
      adapterEvent(
        running,
        "part.upserted",
        {
          part: {
            id: "tool-large",
            messageId: assistantId,
            index: 0,
            type: "tool" as const,
            name: "big-tool",
            category: "shell" as const,
            status: "completed" as const,
            output: largeOutput,
          },
        },
        "tool-large-event",
        assistantId,
        "tool-large"
      )
    )
    await waitFor(() =>
      partsRepo.listByMessage(subject.db, assistantId).length === 1
        ? true
        : undefined
    )

    const part = partsRepo
      .listByMessage(subject.db, assistantId)
      .find((candidate) => candidate.id === "tool-large")!
    expect(part.type).toBe("tool")
    if (part.type === "tool") {
      expect(part.output!.length).toBeLessThan(largeOutput.length)
      expect(part.output).toContain("tool output truncated")
      expect(part.artifactId).toBeDefined()
      const artifact = artifactsRepo.get(subject.db, part.artifactId!)
      expect(artifact).toBeDefined()
      expect(artifact!.data.byteLength).toBe(largeOutput.length)
    }
  })

  it("fails a running turn when an adapter references an unknown message", async () => {
    const subject = await boot({ controlled: true })
    const { turn } = await submit(subject)
    const running = await waitFor(() => {
      const current = turnsRepo.get(subject.db, turn.id)
      return current?.status === "running" ? current : undefined
    })
    subject.stream.emit(
      adapterEvent(
        running,
        "message.upserted",
        {
          message: {
            id: "unknown-message",
            sessionId: subject.session.id,
            seq: 99,
            role: "assistant",
            parentMessageId: turn.userMessageId,
            createdAt: "2026-01-01T01:00:00.000Z",
          },
        },
        "unknown-message-event",
        "unknown-message"
      )
    )

    const failed = await waitFor(() => {
      const current = turnsRepo.get(subject.db, turn.id)
      return current?.status === "failed" ? current : undefined
    })
    expect(failed.error).toMatchObject({ code: "assistant_message_mismatch" })
  })

  it("rejects unknown, closed, mismatched, and inactive requests", async () => {
    const subject = await boot({ controlled: true })
    await expect(
      subject.services.turns.respondToPermission(
        "missing",
        { kind: "permission", optionId: "allow" },
        commandContext()
      )
    ).rejects.toMatchObject({
      aideError: expect.objectContaining({ code: "request_not_open" }),
    })

    const { turn } = await submit(subject)
    await waitFor(() =>
      turnsRepo.get(subject.db, turn.id)?.status === "running"
        ? true
        : undefined
    )
    const permission: Request = {
      id: "permission",
      sessionId: subject.session.id,
      turnId: turn.id,
      kind: "permission",
      status: "open",
      payload: {
        kind: "permission",
        toolName: "shell",
        title: "Run?",
        options: [{ id: "allow", label: "Allow" }],
      },
    }
    requestsRepo.upsert(subject.db, permission)
    await expect(
      subject.services.turns.respondToInput(
        permission.id,
        { kind: "input", answers: {} },
        commandContext()
      )
    ).rejects.toMatchObject({
      aideError: expect.objectContaining({ code: "request_kind_mismatch" }),
    })

    requestsRepo.upsert(subject.db, { ...permission, status: "cancelled" })
    await expect(
      subject.services.turns.respondToPermission(
        permission.id,
        { kind: "permission", optionId: "allow" },
        commandContext()
      )
    ).rejects.toMatchObject({
      aideError: expect.objectContaining({ code: "request_not_open" }),
    })

    const inactive: Request = { ...permission, id: "inactive", status: "open" }
    requestsRepo.upsert(subject.db, inactive)
    const restarted = createAideTestApp({
      db: subject.db,
      registry: subject.registry,
    })
    await expect(
      restarted.services.turns.respondToPermission(
        inactive.id,
        { kind: "permission", optionId: "allow" },
        commandContext()
      )
    ).rejects.toMatchObject({
      aideError: expect.objectContaining({ code: "turn_not_active" }),
    })
  })

  it("leaves active reconciliation untouched and emits interrupted terminal state", async () => {
    const subject = await boot({ controlled: true })
    const { turn } = await submit(subject)
    const running = await waitFor(() => {
      const current = turnsRepo.get(subject.db, turn.id)
      return current?.status === "running" ? current : undefined
    })
    expect(await subject.services.turns.reconcileRunningTurns()).toEqual([])

    subject.stream.emit(
      adapterEvent(
        running,
        "turn.interrupted",
        {
          turn: {
            ...running,
            status: "interrupted",
            endedAt: "2026-01-01T01:00:00.000Z",
          },
        },
        "adapter-interrupted-event"
      )
    )
    await waitFor(() =>
      turnsRepo.get(subject.db, turn.id)?.status === "interrupted"
        ? true
        : undefined
    )
    expect(subject.services.turns.hasActiveStream(turn.id)).toBe(false)
  })
})
