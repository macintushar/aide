import { randomUUID } from "node:crypto"
import type {
  AideError,
  AideEvent,
  ExecutionSelection,
  InputResolution,
  PermissionResolution,
  Request,
  Turn,
  UserMessage,
} from "@workspace/contracts"

import type { ExternalCommandContext } from "../commands"
import type { AideDb } from "../db"
import {
  messagesRepo,
  nativeMappingsRepo,
  partsRepo,
  projectsRepo,
  receiptsRepo,
  requestsRepo,
  sessionsRepo,
  turnsRepo,
  withTransaction,
} from "../db"
import type { NativeSession } from "../harness/types"
import {
  EventService,
  type DurableEvent,
  type DurableEventInput,
  type PartDeltaEventInput,
} from "../events"
import { AdapterRegistry } from "./adapter-registry"
import { CoreServiceError } from "./errors"
import { ExecutionResolver } from "./execution"

type TurnServiceOptions = {
  db: AideDb
  registry: AdapterRegistry
  executionResolver: ExecutionResolver
  eventService: EventService
  now?: () => string
  id?: (kind: "turn" | "message" | "part" | "event") => string
}

type PendingDispatch = {
  context: ExternalCommandContext
}

type ActiveTurn = {
  turnId: string
  instanceId: string
  native: NativeSession
  stop: AbortController
  phase: "starting" | "dispatching" | "cancelling" | "cancellation_failed"
}

function errorOf(error: unknown, instanceId?: string): AideError {
  if (typeof error === "object" && error !== null && "aideError" in error) {
    return (error as { aideError: AideError }).aideError
  }
  return {
    code: "turn_execution_failed",
    message: error instanceof Error ? error.message : String(error),
    instanceId,
    retryable: false,
  }
}

function withoutDelivery(event: AideEvent): DurableEventInput {
  const { delivery: _delivery, ...input } = event
  return input as DurableEventInput
}

export class TurnService {
  readonly #db: AideDb
  readonly #registry: AdapterRegistry
  readonly #resolver: ExecutionResolver
  readonly #events: EventService
  readonly #now: () => string
  readonly #id: NonNullable<TurnServiceOptions["id"]>
  readonly #pending = new Map<string, PendingDispatch>()
  readonly #active = new Map<string, ActiveTurn>()
  readonly #pumping = new Set<string>()

  constructor({
    db,
    registry,
    executionResolver,
    eventService,
    now = () => new Date().toISOString(),
    id = (kind) => `${kind}_${randomUUID()}`,
  }: TurnServiceOptions) {
    this.#db = db
    this.#registry = registry
    this.#resolver = executionResolver
    this.#events = eventService
    this.#now = now
    this.#id = id
  }

  async submit(input: {
    commandId: string
    sessionId: string
    content: string
    execution: ExecutionSelection
    context: ExternalCommandContext
  }): Promise<Turn> {
    const session = sessionsRepo.get(this.#db, input.sessionId)
    if (!session) {
      throw new CoreServiceError(
        "session_not_found",
        `Session ${input.sessionId} was not found`
      )
    }
    const project = projectsRepo.get(this.#db, session.projectId)
    if (!project) {
      throw new CoreServiceError(
        "project_not_found",
        `Project ${session.projectId} was not found`
      )
    }
    const execution = await this.#resolver.resolve(
      input.execution,
      project.directory
    )
    const messageId = this.#id("message")
    const turnId = this.#id("turn")
    const now = this.#now()
    const persistedEvents: DurableEvent[] = []
    const turn = withTransaction(this.#db, (tx) => {
      const message = messagesRepo.createUser(tx, {
        id: messageId,
        sessionId: session.id,
        role: "user",
        parts: [
          {
            id: this.#id("part"),
            messageId,
            index: 0,
            type: "text",
            text: input.content,
          },
        ],
        execution,
        createdAt: now,
      })
      const queued = turnsRepo.create(tx, {
        id: turnId,
        sessionId: session.id,
        execution,
        commandId: input.commandId,
        userMessageId: message.id,
      })
      const { parts, ...metadata } = message
      persistedEvents.push(
        this.#events.persistDurable(tx, {
          schemaVersion: 1,
          eventId: this.#id("event"),
          timestamp: now,
          scope: {
            kind: "session",
            projectId: project.id,
            sessionId: session.id,
            turnId: queued.id,
            messageId: message.id,
          },
          instanceId: execution.selection.instanceId,
          driver: execution.selection.driver,
          type: "message.upserted",
          data: { message: metadata },
        })
      )
      for (const part of parts) {
        persistedEvents.push(
          this.#events.persistDurable(tx, {
            schemaVersion: 1,
            eventId: this.#id("event"),
            timestamp: now,
            scope: {
              kind: "session",
              projectId: project.id,
              sessionId: session.id,
              turnId: queued.id,
              messageId: message.id,
              partId: part.id,
            },
            instanceId: execution.selection.instanceId,
            driver: execution.selection.driver,
            type: "part.upserted",
            data: { part },
          })
        )
      }
      persistedEvents.push(
        this.#events.persistDurable(
          tx,
          this.#localEvent(project.id, queued, "turn.queued")
        )
      )
      return queued
    })
    for (const event of persistedEvents) this.#events.broadcastDurable(event)
    this.#pending.set(turn.id, { context: input.context })
    this.#schedule(session.id)
    return turn
  }

  async interrupt(
    sessionId: string,
    turnId: string,
    context: ExternalCommandContext
  ): Promise<Turn> {
    const turn = turnsRepo.get(this.#db, turnId)
    if (!turn || turn.sessionId !== sessionId) {
      throw new CoreServiceError(
        "turn_not_found",
        `Turn ${turnId} was not found`
      )
    }
    if (["completed", "interrupted", "failed"].includes(turn.status)) {
      context.markDispatching(turn.commandId)
      context.markDispatched({ turnId, alreadyTerminal: true })
      context.complete({ turnId, status: turn.status })
      return turn
    }

    context.markDispatching(turn.commandId)
    let result = turn
    if (turn.status === "running") {
      const active = this.#active.get(sessionId)
      if (active?.turnId === turnId) {
        if (active.phase === "starting") {
          result = await this.#finishLocally(turn, "interrupted")
          this.#clearActive(sessionId, turnId)
        } else {
          const entry = this.#registry.get(active.instanceId)
          try {
            await entry.adapter.interrupt({
              handle: entry.handle,
              nativeSession: active.native,
              turnId,
            })
          } catch (error) {
            active.phase = "cancellation_failed"
            const failure = new CoreServiceError(
              "turn_cancellation_failed",
              `Cancellation of turn ${turn.id} was not acknowledged`,
              true,
              errorOf(error, active.instanceId)
            )
            context.markUncertain(failure)
            throw failure
          }
          const current = turnsRepo.get(this.#db, turnId)
          result =
            current?.status === "running"
              ? await this.#finishLocally(current, "interrupted")
              : current!
          this.#clearActive(sessionId, turnId)
        }
      } else {
        throw new CoreServiceError(
          "turn_not_active",
          `Turn ${turn.id} has no active adapter stream`
        )
      }
    } else {
      result = await this.#finishLocally(turn, "interrupted")
    }
    context.markDispatched({ turnId })
    context.complete({ turnId, status: result.status })
    return result
  }

  async respondToPermission(
    requestId: string,
    resolution: PermissionResolution,
    context: ExternalCommandContext
  ): Promise<Request> {
    return this.#respond(requestId, resolution, "permission", context)
  }

  async respondToInput(
    requestId: string,
    resolution: InputResolution,
    context: ExternalCommandContext
  ): Promise<Request> {
    return this.#respond(requestId, resolution, "input", context)
  }

  reconcileRunningTurns(): Turn[] {
    const reconciled: Turn[] = []
    for (const turn of turnsRepo.listRunning(this.#db)) {
      if (this.#active.get(turn.sessionId)?.turnId === turn.id) continue
      const error: AideError = {
        code: "orphaned_running_turn",
        message: "The adapter stream was not active during boot reconciliation",
        retryable: false,
      }
      reconciled.push(this.#failPersistedTurn(turn, error))
      this.#schedule(turn.sessionId)
    }
    return reconciled
  }

  hasActiveStream(turnId: string): boolean {
    return [...this.#active.values()].some((active) => active.turnId === turnId)
  }

  async #respond(
    requestId: string,
    resolution: PermissionResolution | InputResolution,
    kind: "permission" | "input",
    context: ExternalCommandContext
  ): Promise<Request> {
    const request = requestsRepo.get(this.#db, requestId)
    if (!request || request.status !== "open") {
      throw new CoreServiceError(
        "request_not_open",
        `Request ${requestId} is not open`
      )
    }
    if (request.kind !== kind || resolution.kind !== kind) {
      throw new CoreServiceError(
        "request_kind_mismatch",
        `Request ${requestId} is not ${kind}`
      )
    }
    const turn = turnsRepo.get(this.#db, request.turnId)!
    const active = this.#active.get(request.sessionId)
    if (!active || active.turnId !== turn.id) {
      throw new CoreServiceError(
        "turn_not_active",
        `Turn ${turn.id} has no active adapter stream`
      )
    }
    const resolved = requestsRepo.resolve(this.#db, request.id, resolution)!
    const entry = this.#registry.get(active.instanceId)
    context.markDispatching(request.id)
    if (kind === "permission") {
      await entry.adapter.respondToPermission({
        handle: entry.handle,
        nativeSession: active.native,
        request: resolved as Extract<Request, { kind: "permission" }>,
      })
    } else {
      await entry.adapter.respondToInput({
        handle: entry.handle,
        nativeSession: active.native,
        request: resolved as Extract<Request, { kind: "input" }>,
      })
    }
    context.markDispatched({ requestId })
    context.complete({ requestId, status: "resolved" })
    return resolved
  }

  #schedule(sessionId: string): void {
    if (this.#pumping.has(sessionId) || this.#active.has(sessionId)) return
    this.#pumping.add(sessionId)
    queueMicrotask(() => {
      void this.#pump(sessionId).finally(() => this.#pumping.delete(sessionId))
    })
  }

  async #pump(sessionId: string): Promise<void> {
    while (!this.#active.has(sessionId)) {
      const turn = turnsRepo
        .listOpenBySession(this.#db, sessionId)
        .find((candidate) => candidate.status === "queued")
      if (!turn) return
      await this.#start(turn)
    }
  }

  async #start(turn: Turn): Promise<void> {
    const pending = this.#pending.get(turn.id)
    const session = sessionsRepo.get(this.#db, turn.sessionId)!
    const project = projectsRepo.get(this.#db, session.projectId)!
    const entry = this.#registry.get(
      turn.execution.selection.instanceId,
      turn.execution.selection.driver
    )
    pending?.context.markDispatching(turn.userMessageId)

    try {
      let mapping = nativeMappingsRepo.get(
        this.#db,
        session.id,
        entry.handle.instanceId
      )
      let native: NativeSession
      if (mapping && !mapping.unsafe) {
        try {
          native = await entry.adapter.resumeSession({
            handle: entry.handle,
            sessionId: session.id,
            nativeSessionId: mapping.nativeSessionId,
            resumeCursor: mapping.resumeCursor,
          })
          if (this.#stopTerminalStart(turn)) return
        } catch {
          if (this.#stopTerminalStart(turn)) return
          mapping = undefined
          native = await entry.adapter.openSession({
            handle: entry.handle,
            sessionId: session.id,
            projectDirectory: project.directory,
            execution: turn.execution,
          })
          if (this.#stopTerminalStart(turn)) return
        }
      } else {
        native = await entry.adapter.openSession({
          handle: entry.handle,
          sessionId: session.id,
          projectDirectory: project.directory,
          execution: turn.execution,
        })
        if (this.#stopTerminalStart(turn)) return
      }
      if (this.#stopTerminalStart(turn)) return
      nativeMappingsRepo.upsert(this.#db, {
        sessionId: session.id,
        instanceId: entry.handle.instanceId,
        nativeSessionId: native.nativeSessionId,
        resumeCursor: native.resumeCursor,
        syncCursor: mapping?.syncCursor ?? -1,
        unsafe: false,
      })

      if (this.#stopTerminalStart(turn)) return
      const stop = new AbortController()
      const active: ActiveTurn = {
        turnId: turn.id,
        instanceId: entry.handle.instanceId,
        native,
        stop,
        phase: "starting",
      }
      this.#active.set(session.id, active)

      if (this.#stopTerminalStart(turn)) {
        this.#clearActive(session.id, turn.id)
        return
      }
      const assistantId = `${turn.id}-assistant`
      const now = this.#now()
      let startedEvent: DurableEvent | undefined
      const running = withTransaction(this.#db, (tx) => {
        if (turnsRepo.get(tx, turn.id)?.status !== "queued") return undefined
        if (!messagesRepo.get(tx, assistantId)) {
          messagesRepo.createAssistant(tx, {
            id: assistantId,
            sessionId: session.id,
            role: "assistant",
            parentMessageId: turn.userMessageId,
            parts: [],
            createdAt: now,
          })
        }
        const value = turnsRepo.update(tx, turn.id, {
          status: "running",
          assistantMessageId: assistantId,
          startedAt: now,
        })!
        startedEvent = this.#events.persistDurable(
          tx,
          this.#localEvent(project.id, value, "turn.started")
        )
        return value
      })
      if (!running) {
        this.#clearActive(session.id, turn.id)
        return
      }
      this.#events.broadcastDurable(startedEvent!)

      if (turnsRepo.get(this.#db, turn.id)?.status !== "running") {
        this.#clearActive(session.id, turn.id)
        return
      }

      const stream = entry.adapter.events({
        handle: entry.handle,
        nativeSession: native,
      })
      void this.#consume(running, project.id, stream, stop.signal)
      active.phase = "dispatching"
      await entry.adapter.send({
        handle: entry.handle,
        nativeSession: native,
        commandId: turn.commandId,
        turnId: turn.id,
        userMessage: messagesRepo.get(
          this.#db,
          turn.userMessageId
        ) as UserMessage,
        execution: turn.execution,
      })
      pending?.context.markDispatched({
        turnId: turn.id,
        nativeSessionId: native.nativeSessionId,
      })
    } catch (error) {
      const current = turnsRepo.get(this.#db, turn.id)
      if (
        !current ||
        ["completed", "interrupted", "failed"].includes(current.status)
      ) {
        this.#clearActive(turn.sessionId, turn.id)
        return
      }
      const normalized = errorOf(error, entry.handle.instanceId)
      if (normalized.code === "execution_outcome_unknown") {
        pending?.context.markUncertain(normalized)
        nativeMappingsRepo.markUnsafe(
          this.#db,
          turn.sessionId,
          entry.handle.instanceId
        )
        const active = this.#active.get(turn.sessionId)
        if (active?.turnId !== turn.id) return
        active.phase = "cancelling"
        try {
          await entry.adapter.interrupt({
            handle: entry.handle,
            nativeSession: active.native,
            turnId: turn.id,
          })
        } catch {
          active.phase = "cancellation_failed"
          return
        }
        const current = turnsRepo.get(this.#db, turn.id)
        if (current?.status === "running") {
          this.#failPersistedTurn(current, normalized)
          this.#clearActive(turn.sessionId, turn.id)
        }
        return
      }
      if (pending) pending.context.markUncertain(normalized)
      this.#failPersistedTurn(turnsRepo.get(this.#db, turn.id)!, normalized)
      this.#clearActive(turn.sessionId, turn.id)
    }
  }

  async #consume(
    turn: Turn,
    projectId: string,
    stream: AsyncIterable<AideEvent>,
    signal: AbortSignal
  ): Promise<void> {
    try {
      for await (const event of stream) {
        if (signal.aborted) break
        await this.#consumeEvent(turn, projectId, event)
        if (!this.hasActiveStream(turn.id)) break
      }
    } catch (error) {
      const current = turnsRepo.get(this.#db, turn.id)
      if (current?.status === "running") {
        const active = this.#active.get(turn.sessionId)
        if (
          active?.turnId === turn.id &&
          (active.phase === "cancelling" ||
            active.phase === "cancellation_failed")
        ) {
          return
        }
        this.#failPersistedTurn(
          current,
          errorOf(error, turn.execution.selection.instanceId)
        )
        this.#clearActive(turn.sessionId, turn.id)
      }
    }
  }

  async #consumeEvent(
    turn: Turn,
    projectId: string,
    source: AideEvent
  ): Promise<void> {
    if (source.type === "turn.started") return
    if (source.delivery.durable && this.#eventsEventExists(source.eventId))
      return
    const current = turnsRepo.get(this.#db, turn.id)
    if (!current) return
    if (source.type === "part.delta") {
      if (current.status !== "running") return
      this.#events.publishEphemeral(
        withoutDelivery(
          this.#normalizeEvent(source, projectId, current)
        ) as unknown as PartDeltaEventInput
      )
      return
    }
    if (["completed", "interrupted", "failed"].includes(current.status)) return

    const normalized = this.#normalizeEvent(source, projectId, current)
    const persistedEvents: DurableEvent[] = []
    let terminal = false
    withTransaction(this.#db, (tx) => {
      if (normalized.type === "part.upserted") {
        partsRepo.upsert(tx, normalized.data.part)
      } else if (normalized.type === "part.removed") {
        partsRepo.remove(tx, normalized.data.partId)
      } else if (normalized.type === "message.upserted") {
        const message = messagesRepo.get(tx, normalized.data.message.id)
        if (!message) {
          throw new CoreServiceError(
            "assistant_message_mismatch",
            `Adapter emitted unknown message ${normalized.data.message.id}`
          )
        }
        const { parts: _parts, ...metadata } = message
        normalized.data.message = metadata
      } else if (
        normalized.type === "request.opened" ||
        normalized.type === "request.resolved" ||
        normalized.type === "request.cancelled"
      ) {
        requestsRepo.upsert(tx, normalized.data.request)
      } else if (
        normalized.type === "turn.completed" ||
        normalized.type === "turn.interrupted" ||
        normalized.type === "turn.failed"
      ) {
        const status = normalized.type.slice("turn.".length) as
          | "completed"
          | "interrupted"
          | "failed"
        const endedAt = normalized.data.turn.endedAt ?? source.timestamp
        const updated = turnsRepo.update(tx, turn.id, {
          status,
          endedAt,
          error:
            status === "failed" ? (normalized.data.turn.error ?? null) : null,
        })!
        if (updated.assistantMessageId) {
          const assistant = messagesRepo.updateAssistant(
            tx,
            updated.assistantMessageId,
            {
              completedAt: endedAt,
            }
          )!
          const { parts: _parts, ...metadata } = assistant
          persistedEvents.push(
            this.#events.persistDurable(tx, {
              schemaVersion: 1,
              eventId: this.#id("event"),
              timestamp: endedAt,
              scope: {
                kind: "session",
                projectId,
                sessionId: turn.sessionId,
                turnId: turn.id,
                messageId: assistant.id,
              },
              instanceId: turn.execution.selection.instanceId,
              driver: turn.execution.selection.driver,
              type: "message.upserted",
              data: { message: metadata },
            })
          )
        }
        for (const request of requestsRepo.listOpenBySession(
          tx,
          turn.sessionId
        )) {
          requestsRepo.cancel(tx, request.id)
        }
        receiptsRepo.updateState(
          tx,
          turn.commandId,
          status === "failed" ? "failed" : "completed",
          {
            updatedAt: this.#now(),
            result:
              status === "failed" ? undefined : { turnId: turn.id, status },
            error: status === "failed" ? (updated.error ?? null) : null,
          }
        )
        normalized.data.turn = updated
        terminal = true
      }
      persistedEvents.push(
        this.#events.persistDurable(tx, withoutDelivery(normalized))
      )
    })
    for (const event of persistedEvents) this.#events.broadcastDurable(event)
    if (terminal) this.#clearActive(turn.sessionId, turn.id)
  }

  #normalizeEvent(source: AideEvent, projectId: string, turn: Turn): AideEvent {
    return {
      ...source,
      scope: {
        kind: "session",
        projectId,
        sessionId: turn.sessionId,
        turnId: turn.id,
        ...(source.scope.kind === "session" && source.scope.messageId
          ? { messageId: source.scope.messageId }
          : {}),
        ...(source.scope.kind === "session" && source.scope.partId
          ? { partId: source.scope.partId }
          : {}),
      },
      instanceId: turn.execution.selection.instanceId,
      driver: turn.execution.selection.driver,
    } as AideEvent
  }

  #eventsEventExists(eventId: string): boolean {
    return this.#events.findDurable(eventId) !== undefined
  }

  async #finishLocally(turn: Turn, status: "interrupted"): Promise<Turn> {
    const session = sessionsRepo.get(this.#db, turn.sessionId)!
    const project = projectsRepo.get(this.#db, session.projectId)!
    const endedAt = this.#now()
    let persisted: DurableEvent | undefined
    const updated = withTransaction(this.#db, (tx) => {
      const current = turnsRepo.get(tx, turn.id)!
      if (["completed", "interrupted", "failed"].includes(current.status)) {
        return current
      }
      const value = turnsRepo.update(tx, turn.id, { status, endedAt })!
      receiptsRepo.updateState(tx, turn.commandId, "completed", {
        updatedAt: endedAt,
        result: { turnId: turn.id, status },
        error: null,
      })
      persisted = this.#events.persistDurable(
        tx,
        this.#localEvent(project.id, value, "turn.interrupted")
      )
      return value
    })
    if (persisted) this.#events.broadcastDurable(persisted)
    this.#pending.delete(turn.id)
    return updated
  }

  #stopTerminalStart(turn: Turn): boolean {
    if (turnsRepo.get(this.#db, turn.id)?.status === "queued") return false
    this.#pending.delete(turn.id)
    return true
  }

  #failPersistedTurn(turn: Turn, error: AideError): Turn {
    const session = sessionsRepo.get(this.#db, turn.sessionId)!
    const project = projectsRepo.get(this.#db, session.projectId)!
    const endedAt = this.#now()
    let persisted: DurableEvent | undefined
    const updated = withTransaction(this.#db, (tx) => {
      const value = turnsRepo.update(tx, turn.id, {
        status: "failed",
        endedAt,
        error,
      })!
      if (value.assistantMessageId) {
        messagesRepo.updateAssistant(tx, value.assistantMessageId, {
          completedAt: endedAt,
        })
      }
      receiptsRepo.updateState(tx, turn.commandId, "failed", {
        updatedAt: endedAt,
        error,
      })
      persisted = this.#events.persistDurable(
        tx,
        this.#localEvent(project.id, value, "turn.failed")
      )
      return value
    })
    this.#events.broadcastDurable(persisted!)
    return updated
  }

  #clearActive(sessionId: string, turnId: string): void {
    const active = this.#active.get(sessionId)
    if (active?.turnId === turnId) {
      active.stop.abort()
      this.#active.delete(sessionId)
    }
    this.#pending.delete(turnId)
    this.#schedule(sessionId)
  }

  #localEvent(
    projectId: string,
    turn: Turn,
    type: "turn.queued" | "turn.started" | "turn.interrupted" | "turn.failed"
  ): DurableEventInput {
    return {
      schemaVersion: 1,
      eventId: this.#id("event"),
      timestamp: this.#now(),
      scope: {
        kind: "session",
        projectId,
        sessionId: turn.sessionId,
        turnId: turn.id,
      },
      instanceId: turn.execution.selection.instanceId,
      driver: turn.execution.selection.driver,
      type,
      data: { turn },
    } as DurableEventInput
  }
}
