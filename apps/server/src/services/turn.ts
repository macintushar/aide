import { randomUUID } from "node:crypto"
import type {
  AideError,
  AideEvent,
  ExecutionSelection,
  InputResolution,
  NativeDispatchInput,
  Part,
  PermissionResolution,
  Request,
  Turn,
  UserMessage,
} from "@workspace/contracts"

import type { ExternalCommandContext } from "../commands"
import type { AideDb } from "../db"
import {
  artifactsRepo,
  dispatchInputsRepo,
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
import {
  applyPortableHandoffBudget,
  buildPortableHandoffPacket,
  renderPortableHandoffPacket,
} from "./context-builder"
import { CoreServiceError } from "./errors"
import { ExecutionResolver } from "./execution"
import { SessionChangesTracker } from "../workspace/changes"
import { WorkspaceError } from "../workspace/errors"

const DEFAULT_TOOL_OUTPUT_MAX_CHARACTERS = 8_000
const DEFAULT_REATTACH_SETTLE_MS = 250

type TurnServiceOptions = {
  db: AideDb
  registry: AdapterRegistry
  executionResolver: ExecutionResolver
  eventService: EventService
  now?: () => string
  id?: (
    kind: "turn" | "message" | "part" | "event" | "dispatchInput" | "artifact"
  ) => string
  handoffMaxCharacters?: number
  toolOutputMaxCharacters?: number
  /**
   * How long boot reconciliation waits for an in-flight terminal event when
   * the harness reports the turn already finished.
   */
  reattachSettleMs?: number
  /** Omit to run without workspace change tracking. */
  changes?: SessionChangesTracker
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

/**
 * Rewraps an iterator whose first pull has already been issued, so the result
 * of that pull is not dropped when consumption starts for real.
 */
function startedStream(
  iterator: AsyncIterator<AideEvent>,
  first: Promise<IteratorResult<AideEvent>>
): AsyncIterable<AideEvent> {
  let pending: Promise<IteratorResult<AideEvent>> | undefined = first
  return {
    [Symbol.asyncIterator]: () => ({
      next() {
        if (!pending) return iterator.next()
        const result = pending
        pending = undefined
        return result
      },
      return() {
        return (
          iterator.return?.() ??
          Promise.resolve({ value: undefined, done: true as const })
        )
      },
    }),
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
  readonly #handoffMaxCharacters: number
  readonly #toolOutputMaxCharacters: number
  readonly #reattachSettleMs: number
  readonly #changes: SessionChangesTracker | undefined
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
    handoffMaxCharacters = 32_000,
    toolOutputMaxCharacters = DEFAULT_TOOL_OUTPUT_MAX_CHARACTERS,
    reattachSettleMs = DEFAULT_REATTACH_SETTLE_MS,
    changes,
  }: TurnServiceOptions) {
    this.#db = db
    this.#registry = registry
    this.#resolver = executionResolver
    this.#events = eventService
    this.#now = now
    this.#id = id
    this.#handoffMaxCharacters = handoffMaxCharacters
    this.#toolOutputMaxCharacters = toolOutputMaxCharacters
    this.#reattachSettleMs = reattachSettleMs
    this.#changes = changes
  }

  /**
   * Records what the working tree looks like right now. A capture without a
   * turn establishes the baseline; one with a turn credits everything that
   * moved since the previous capture to that turn. Workspaces that git cannot
   * inspect (no repository, no such directory) are simply not tracked.
   */
  async #captureChanges(
    sessionId: string,
    directory: string,
    turnId?: string
  ): Promise<void> {
    if (!this.#changes) return
    try {
      await this.#changes.capture({
        sessionId,
        directory,
        ...(turnId ? { turnId } : {}),
      })
    } catch (error) {
      if (error instanceof WorkspaceError) return
      throw error
    }
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

  /**
   * Boot reconciliation for persisted `running` turns without an active
   * stream. A turn whose native session still resumes is put back under a
   * live event consumer so it finishes against canonical history; anything
   * else fails with a structured error rather than silently rerouting.
   */
  async reconcileRunningTurns(): Promise<Turn[]> {
    const reconciled: Turn[] = []
    for (const turn of turnsRepo.listRunning(this.#db)) {
      if (this.#active.get(turn.sessionId)?.turnId === turn.id) continue
      if (await this.#reattach(turn)) continue
      const error: AideError = {
        code: "orphaned_running_turn",
        message:
          "The native session could not be resumed during boot reconciliation",
        instanceId: turn.execution.selection.instanceId,
        retryable: false,
      }
      reconciled.push(this.#failPersistedTurn(turn, error))
      this.#schedule(turn.sessionId)
    }
    return reconciled
  }

  /**
   * Puts a persisted running turn back under a live event consumer. The
   * dispatch itself already happened before the restart, so only the stream
   * is rebuilt; the mapping's `unsafe` flag is not a barrier here because it
   * marks an in-flight turn, which is exactly what is being recovered.
   * Returns false when the turn cannot be recovered and must be failed.
   */
  async #reattach(turn: Turn): Promise<boolean> {
    try {
      const entry = this.#registry.get(
        turn.execution.selection.instanceId,
        turn.execution.selection.driver
      )
      const session = sessionsRepo.get(this.#db, turn.sessionId)
      if (!session) return false
      const project = projectsRepo.get(this.#db, session.projectId)
      if (!project) return false
      const mapping = nativeMappingsRepo.get(
        this.#db,
        turn.sessionId,
        entry.handle.instanceId
      )
      if (!mapping) return false
      const native = await entry.adapter.resumeSession({
        handle: entry.handle,
        sessionId: turn.sessionId,
        nativeSessionId: mapping.nativeSessionId,
        resumeCursor: mapping.resumeCursor,
      })
      if (native.nativeSessionId !== mapping.nativeSessionId) return false
      if (turnsRepo.get(this.#db, turn.id)?.status !== "running") return false
      // Without a way to ask what the native session is doing, a turn that
      // already finished while the server was down would be waited on
      // forever, holding the session's active slot against every later turn.
      if (!entry.adapter.activeTurn) return false
      // Pull before the check rather than merely calling `events()`: an
      // adapter that only subscribes once iteration begins would otherwise
      // miss a terminal event emitted while the check is in flight, which is
      // the stall this guard exists to prevent.
      const iterator = entry.adapter
        .events({ handle: entry.handle, nativeSession: native })
        [Symbol.asyncIterator]()
      const first = iterator.next()
      void first.catch(() => undefined)
      const live = await entry.adapter.activeTurn({
        handle: entry.handle,
        nativeSession: native,
      })
      const stop = new AbortController()
      this.#active.set(turn.sessionId, {
        turnId: turn.id,
        instanceId: entry.handle.instanceId,
        native,
        stop,
        phase: "dispatching",
      })
      void this.#consume(
        turn,
        project.id,
        startedStream(iterator, first),
        stop.signal
      )
      if (live?.turnId === turn.id) return true
      // The harness says this turn is over, but events emitted just before
      // the check may still be in flight — including the one carrying how it
      // ended. Wait briefly for the stream to settle it rather than
      // overwriting a finished turn with a failure, then give up so a turn
      // whose outcome never arrives cannot hold the session open.
      if (await this.#settles(turn.id)) return true
      stop.abort()
      await iterator.return?.()
      this.#clearActive(turn.sessionId, turn.id)
      return false
    } catch {
      return false
    }
  }

  /** Waits out the reattachment grace for a turn the harness calls finished. */
  async #settles(turnId: string): Promise<boolean> {
    const deadline = Date.now() + this.#reattachSettleMs
    for (;;) {
      if (turnsRepo.get(this.#db, turnId)?.status !== "running") return true
      if (Date.now() >= deadline) return false
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
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
    const instanceId = turn.execution.selection.instanceId
    let entry: ReturnType<AdapterRegistry["get"]> | undefined
    pending?.context.markDispatching(turn.userMessageId)

    try {
      // Baseline the working tree before the harness can touch it, so edits
      // that were already there are not credited to this turn.
      await this.#captureChanges(session.id, project.directory)
      // A queued turn keeps its captured selection, but admission must prove the
      // same values are still available in current inventory.
      await this.#resolver.resolve(turn.execution.selection, project.directory)
      const adapterEntry = this.#registry.get(
        instanceId,
        turn.execution.selection.driver
      )
      entry = adapterEntry
      let mapping = nativeMappingsRepo.get(
        this.#db,
        session.id,
        adapterEntry.handle.instanceId
      )
      let native: NativeSession
      let syncCursor = -1
      if (mapping && !mapping.unsafe) {
        try {
          native = await adapterEntry.adapter.resumeSession({
            handle: adapterEntry.handle,
            sessionId: session.id,
            nativeSessionId: mapping.nativeSessionId,
            resumeCursor: mapping.resumeCursor,
          })
          syncCursor = mapping.syncCursor
          if (this.#stopTerminalStart(turn)) return
        } catch {
          if (this.#stopTerminalStart(turn)) return
          mapping = undefined
          native = await adapterEntry.adapter.openSession({
            handle: adapterEntry.handle,
            sessionId: session.id,
            projectDirectory: project.directory,
            execution: turn.execution,
          })
          if (this.#stopTerminalStart(turn)) return
        }
      } else {
        native = await adapterEntry.adapter.openSession({
          handle: adapterEntry.handle,
          sessionId: session.id,
          projectDirectory: project.directory,
          execution: turn.execution,
        })
        if (this.#stopTerminalStart(turn)) return
      }
      if (this.#stopTerminalStart(turn)) return
      const userMessage = messagesRepo.get(
        this.#db,
        turn.userMessageId
      ) as UserMessage
      const currentUserText = userMessage.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
      let handoff: NativeDispatchInput | undefined
      withTransaction(this.#db, (tx) => {
        nativeMappingsRepo.upsert(tx, {
          sessionId: session.id,
          instanceId: adapterEntry.handle.instanceId,
          nativeSessionId: native.nativeSessionId,
          resumeCursor: native.resumeCursor,
          syncCursor,
          // A mapping is safe only after the native turn completes cleanly.
          unsafe: true,
        })
        const fromMessageSeq = syncCursor + 1
        const throughMessageSeq = userMessage.seq - 1
        if (fromMessageSeq > throughMessageSeq) return
        const packet = applyPortableHandoffBudget(
          buildPortableHandoffPacket({
            sessionId: session.id,
            messages: messagesRepo.listBySession(tx, session.id),
            workingDirectory: project.directory,
            fromMessageSeq,
            throughMessageSeq,
          }),
          {
            maxCharacters: this.#handoffMaxCharacters,
            currentMessageCharacters: currentUserText.length,
          }
        )
        handoff = dispatchInputsRepo.create(tx, {
          id: this.#id("dispatchInput"),
          turnId: turn.id,
          instanceId: adapterEntry.handle.instanceId,
          nativeSessionId: native.nativeSessionId,
          role: "handoff",
          fromMessageSeq,
          throughMessageSeq,
          content: renderPortableHandoffPacket(packet),
          createdAt: this.#now(),
        })
      })

      if (this.#stopTerminalStart(turn)) return
      const stop = new AbortController()
      const active: ActiveTurn = {
        turnId: turn.id,
        instanceId: adapterEntry.handle.instanceId,
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
      let assistantEvent: DurableEvent | undefined
      const running = withTransaction(this.#db, (tx) => {
        if (turnsRepo.get(tx, turn.id)?.status !== "queued") return undefined
        if (!messagesRepo.get(tx, assistantId)) {
          const assistant = messagesRepo.createAssistant(tx, {
            id: assistantId,
            sessionId: session.id,
            role: "assistant",
            parentMessageId: turn.userMessageId,
            parts: [],
            createdAt: now,
          })
          // Announce the placeholder immediately so live clients see the
          // assistant message before its first part arrives.
          const { parts: _parts, ...metadata } = assistant
          assistantEvent = this.#events.persistDurable(tx, {
            schemaVersion: 1,
            eventId: this.#id("event"),
            timestamp: now,
            scope: {
              kind: "session",
              projectId: project.id,
              sessionId: session.id,
              turnId: turn.id,
              messageId: assistant.id,
            },
            instanceId: turn.execution.selection.instanceId,
            driver: turn.execution.selection.driver,
            type: "message.upserted",
            data: { message: metadata },
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
      if (assistantEvent) this.#events.broadcastDurable(assistantEvent)
      this.#events.broadcastDurable(startedEvent!)

      if (turnsRepo.get(this.#db, turn.id)?.status !== "running") {
        this.#clearActive(session.id, turn.id)
        return
      }

      const stream = adapterEntry.adapter.events({
        handle: adapterEntry.handle,
        nativeSession: native,
      })
      void this.#consume(running, project.id, stream, stop.signal)
      active.phase = "dispatching"
      await adapterEntry.adapter.send({
        handle: adapterEntry.handle,
        nativeSession: native,
        commandId: turn.commandId,
        turnId: turn.id,
        userMessage,
        execution: turn.execution,
        handoff,
      })
      pending?.context.markDispatched(
        {
          turnId: turn.id,
          nativeSessionId: native.nativeSessionId,
        },
        (tx) => {
          const acknowledged = nativeMappingsRepo.acknowledgeDispatch(tx, {
            sessionId: session.id,
            instanceId: adapterEntry.handle.instanceId,
            nativeSessionId: native.nativeSessionId,
            resumeCursor: native.resumeCursor,
          })
          if (!acknowledged) {
            throw new CoreServiceError(
              "native_mapping_changed",
              `Native mapping changed before turn ${turn.id} was acknowledged`
            )
          }
        }
      )
    } catch (error) {
      const current = turnsRepo.get(this.#db, turn.id)
      if (
        !current ||
        ["completed", "interrupted", "failed"].includes(current.status)
      ) {
        this.#clearActive(turn.sessionId, turn.id)
        return
      }
      const normalized = errorOf(error, instanceId)
      if (normalized.code === "execution_outcome_unknown") {
        pending?.context.markUncertain(normalized)
        nativeMappingsRepo.markUnsafe(this.#db, turn.sessionId, instanceId)
        const active = this.#active.get(turn.sessionId)
        if (active?.turnId !== turn.id || !entry) return
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
      const current = turnsRepo.get(this.#db, turn.id)
      if (!signal.aborted && current?.status === "running") {
        this.#failPersistedTurn(current, {
          code: "instance_event_stream_closed",
          message: `Instance ${turn.execution.selection.instanceId} closed its event stream before the turn completed`,
          instanceId: turn.execution.selection.instanceId,
          retryable: false,
        })
        this.#clearActive(turn.sessionId, turn.id)
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
        partsRepo.upsert(tx, this.#boundToolOutput(tx, normalized.data.part))
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
          if (status === "completed") {
            const active = this.#active.get(turn.sessionId)
            const mapping =
              active?.turnId === turn.id
                ? nativeMappingsRepo.completeSync(tx, {
                    sessionId: turn.sessionId,
                    instanceId: active.instanceId,
                    nativeSessionId: active.native.nativeSessionId,
                    syncCursor: assistant.seq,
                    resumeCursor: active.native.resumeCursor,
                  })
                : undefined
            if (!mapping) {
              throw new CoreServiceError(
                "native_mapping_changed",
                `Native mapping changed before turn ${turn.id} completed`
              )
            }
          }
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
    if (terminal) {
      this.#clearActive(turn.sessionId, turn.id)
      const project = projectsRepo.get(this.#db, projectId)
      if (project) {
        await this.#captureChanges(turn.sessionId, project.directory, turn.id)
      }
    }
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

  /**
   * Oversized assembled tool output is stored as an artifact; the persisted
   * part keeps a bounded, explicitly-marked preview plus the artifact
   * reference. Small output stays inline.
   */
  #boundToolOutput(db: AideDb, part: Part): Part {
    if (part.type !== "tool" || part.output === undefined) return part
    if (part.output.length <= this.#toolOutputMaxCharacters) return part
    const artifactId = this.#id("artifact")
    artifactsRepo.create(db, {
      id: artifactId,
      mimeType: "text/plain; charset=utf-8",
      data: Buffer.from(part.output, "utf8"),
      byteLength: Buffer.byteLength(part.output, "utf8"),
      createdAt: this.#now(),
    })
    const omitted = part.output.length - this.#toolOutputMaxCharacters
    return {
      ...part,
      output: `${part.output.slice(0, this.#toolOutputMaxCharacters)}\n[tool output truncated: ${omitted} characters stored as artifact ${artifactId}]`,
      artifactId,
    }
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
