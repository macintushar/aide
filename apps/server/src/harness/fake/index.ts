import type { StandardSchemaV1 } from "@standard-schema/spec"
import { z } from "zod"
import type {
  AideError,
  AideEvent,
  DriverId,
  InstanceConfig,
  InstanceRuntimeStatus,
  Request,
  Turn,
} from "@workspace/contracts"
import type {
  DisposeInput,
  DiscoverInput,
  HealthInput,
  HarnessAdapter,
  HarnessEventsInput,
  InstanceHandle,
  InterruptTurnInput,
  InputResponseInput,
  McpStatusInput,
  OpenSessionInput,
  PermissionResponseInput,
  ResumeSessionInput,
  SendTurnInput,
  SetMcpServersInput,
  StartInstanceInput,
  StopInstanceInput,
} from "../types"

/**
 * Test-only fake harness adapter.
 *
 * It implements the frozen `HarnessAdapter` seam without any SDK and drives a
 * deterministic turn script so the core, the conformance suite, and the UI can
 * be exercised end to end before real adapters exist.
 *
 * Known seam gaps this fake works around without touching frozen contracts:
 * - `DriverId` has no "fake" value, so the adapter masquerades as a real
 *   driver (configurable, defaults to "opencode").
 * - `SendTurnInput` carries no canonical `projectId` or assistant message id,
 *   so they are injected here as fake-only options and deterministic ids.
 * - The interface has no dispatch-outcome result, so outcomes are exposed via
 *   the test-only `FakeHarnessControl` and typed errors.
 */

export type FakeDispatchMode =
  | "acknowledged"
  | "known-not-dispatched"
  | "ambiguous-after-effect"

export class FakeAdapterError extends Error {
  readonly aideError: AideError

  constructor(aideError: AideError) {
    super(aideError.message)
    this.name = "FakeAdapterError"
    this.aideError = aideError
  }
}

function fakeError(
  code: string,
  message: string,
  retryable: boolean,
  instanceId?: string
): FakeAdapterError {
  return new FakeAdapterError({
    code,
    message,
    instanceId,
    retryable,
  })
}

export type FakeHarnessAdapterOptions = {
  driver?: DriverId
  projectId?: string
  now?: () => string
}

const fakeConfigSchema = z.strictObject({
  failStart: z.boolean().optional(),
})

type FakeGate = {
  resolve: (outcome: "resolved" | "cancelled") => void
}

type FakeTurn = {
  turnId: string
  turnRow: Turn
  status: "running" | "completed" | "interrupted" | "failed"
  cancelled: boolean
  gates: Map<string, FakeGate>
}

type FakeNativeSession = {
  nativeSessionId: string
  aideSessionId: string
  bus: EventBus
  resumeCursor: string | undefined
  durableSeq: number
  streamOrdinal: number
  turnSeq: number
  openRequests: Map<string, Request>
  activeTurn: FakeTurn | undefined
}

type FakeInstance = {
  config: InstanceConfig
  status: InstanceRuntimeStatus
  bus: EventBus
  sessions: Map<string, FakeNativeSession>
  mcpServers: Record<string, unknown>
}

type Subscription = {
  buffered: AideEvent[]
  closed: boolean
  waiters: Array<(result: IteratorResult<AideEvent>) => void>
}

type EventBus = {
  publish(event: AideEvent): void
  close(): void
  subscribe(): AsyncIterable<AideEvent>
  subscriberCount(): number
}

function createEventBus(): EventBus {
  const subscriptions = new Set<Subscription>()
  let closed = false

  const dispatch = (subscription: Subscription, event: AideEvent) => {
    if (subscription.closed) return
    const waiter = subscription.waiters.shift()
    if (waiter) {
      waiter({ value: event, done: false })
    } else {
      subscription.buffered.push(event)
    }
  }

  const finish = (subscription: Subscription) => {
    subscription.closed = true
    for (const waiter of subscription.waiters.splice(0)) {
      waiter({ value: undefined, done: true })
    }
  }

  return {
    publish(event) {
      if (closed) return
      for (const subscription of subscriptions) {
        dispatch(subscription, event)
      }
    },
    close() {
      closed = true
      for (const subscription of subscriptions) {
        finish(subscription)
      }
      subscriptions.clear()
    },
    subscribe() {
      const subscription: Subscription = {
        buffered: [],
        closed: false,
        waiters: [],
      }
      if (closed) {
        subscription.closed = true
      } else {
        subscriptions.add(subscription)
      }
      const iterator: AsyncIterator<AideEvent> = {
        next() {
          const event = subscription.buffered.shift()
          if (event) {
            return Promise.resolve({ value: event, done: false })
          }
          if (subscription.closed) {
            return Promise.resolve({ value: undefined, done: true })
          }
          return new Promise<IteratorResult<AideEvent>>((resolve) => {
            subscription.waiters.push(resolve)
          })
        },
        return() {
          subscriptions.delete(subscription)
          finish(subscription)
          return Promise.resolve({ value: undefined, done: true })
        },
      }
      const iterable: AsyncIterable<AideEvent> = {
        [Symbol.asyncIterator]: () => iterator,
      }
      return iterable
    },
    subscriberCount() {
      return subscriptions.size
    },
  }
}

export type FakeHarnessControl = {
  setNextDispatchOutcome(mode: FakeDispatchMode): void
  invocationCount(userMessageId: string): number
  effectCount(userMessageId: string): number
  instanceStatus(instanceId: string): InstanceRuntimeStatus | undefined
}

export function createFakeHarnessAdapter(
  options: FakeHarnessAdapterOptions = {}
): { adapter: HarnessAdapter; control: FakeHarnessControl } {
  const driver: DriverId = options.driver ?? "opencode"
  const projectId = options.projectId ?? "fake-project"

  let idCounter = 0
  const nextId = (prefix: string) =>
    `${prefix}-${String(++idCounter).padStart(4, "0")}`

  let tick = 0
  const baseTime = Date.parse("2026-01-01T00:00:00.000Z")
  const now =
    options.now ?? (() => new Date(baseTime + tick++ * 1000).toISOString())

  const instances = new Map<string, FakeInstance>()
  const dispatchOutcomes: FakeDispatchMode[] = []
  const invocations = new Map<string, number>()
  const effects = new Map<string, number>()
  const dispatchModes = new Map<string, FakeDispatchMode>()

  const requireInstance = (handle: InstanceHandle): FakeInstance => {
    const instance = instances.get(handle.instanceId)
    if (!instance) {
      throw fakeError(
        "instance_not_started",
        `fake instance "${handle.instanceId}" is not started`,
        false,
        handle.instanceId
      )
    }
    return instance
  }

  const requireSession = (
    handle: InstanceHandle,
    nativeSessionId: string
  ): { instance: FakeInstance; session: FakeNativeSession } => {
    const instance = requireInstance(handle)
    const session = instance.sessions.get(nativeSessionId)
    if (!session) {
      throw fakeError(
        "native_session_not_found",
        `fake native session "${nativeSessionId}" not found`,
        false,
        handle.instanceId
      )
    }
    return { instance, session }
  }

  type SessionEventShape = {
    type: AideEvent["type"]
    data: unknown
    turnId: string
    messageId?: string
    partId?: string
    ephemeral?: boolean
  }

  const buildSessionEvent = (
    session: FakeNativeSession,
    instanceId: string,
    shape: SessionEventShape
  ): AideEvent => {
    const event = {
      schemaVersion: 1,
      eventId: `${instanceId}-${nextId("evt")}`,
      timestamp: now(),
      delivery: shape.ephemeral
        ? { durable: false, streamOrdinal: session.streamOrdinal++ }
        : { durable: true, sequence: session.durableSeq++ },
      scope: {
        kind: "session",
        projectId,
        sessionId: session.aideSessionId,
        turnId: shape.turnId,
        messageId: shape.messageId,
        partId: shape.partId,
      },
      instanceId,
      driver,
      type: shape.type,
      data: shape.data,
    } as AideEvent
    return event
  }

  const runScript = async (
    input: SendTurnInput,
    session: FakeNativeSession
  ) => {
    const { userMessage, execution } = input
    const turnId = input.turnId
    const assistantMessageId = `${turnId}-assistant`
    const turnSeq = session.turnSeq++

    const turnRow: Turn = {
      id: turnId,
      sessionId: session.aideSessionId,
      seq: turnSeq,
      status: "running",
      execution,
      commandId: input.commandId,
      userMessageId: userMessage.id,
      assistantMessageId,
      startedAt: now(),
    }

    const turn: FakeTurn = {
      turnId,
      turnRow,
      status: "running",
      cancelled: false,
      gates: new Map(),
    }
    session.activeTurn = turn

    const emit = (shape: SessionEventShape) => {
      if (turn.cancelled) return
      session.bus.publish(
        buildSessionEvent(session, input.handle.instanceId, shape)
      )
    }

    try {
      emit({ type: "turn.started", data: { turn: turnRow }, turnId })

      emit({
        type: "message.upserted",
        data: {
          message: {
            id: assistantMessageId,
            sessionId: session.aideSessionId,
            seq: userMessage.seq + 1,
            role: "assistant",
            parentMessageId: userMessage.id,
            createdAt: now(),
          },
        },
        turnId,
        messageId: assistantMessageId,
      })

      const reasoningPartId = `${turnId}-p0`
      emit({
        type: "part.delta",
        data: {
          partId: reasoningPartId,
          messageId: assistantMessageId,
          field: "reasoning",
          text: "thinking about the request",
        },
        turnId,
        messageId: assistantMessageId,
        partId: reasoningPartId,
        ephemeral: true,
      })
      emit({
        type: "part.upserted",
        data: {
          part: {
            id: reasoningPartId,
            messageId: assistantMessageId,
            index: 0,
            type: "reasoning",
            text: "thinking about the request",
          },
        },
        turnId,
        messageId: assistantMessageId,
        partId: reasoningPartId,
      })

      const toolPartId = `${turnId}-p1`
      emit({
        type: "part.upserted",
        data: {
          part: {
            id: toolPartId,
            messageId: assistantMessageId,
            index: 1,
            type: "tool",
            name: "fake-check",
            category: "shell",
            status: "pending",
          },
        },
        turnId,
        messageId: assistantMessageId,
        partId: toolPartId,
      })
      emit({
        type: "part.delta",
        data: {
          partId: toolPartId,
          messageId: assistantMessageId,
          field: "input",
          text: "checking",
        },
        turnId,
        messageId: assistantMessageId,
        partId: toolPartId,
        ephemeral: true,
      })
      emit({
        type: "part.upserted",
        data: {
          part: {
            id: toolPartId,
            messageId: assistantMessageId,
            index: 1,
            type: "tool",
            name: "fake-check",
            category: "shell",
            status: "running",
          },
        },
        turnId,
        messageId: assistantMessageId,
        partId: toolPartId,
      })
      emit({
        type: "part.upserted",
        data: {
          part: {
            id: toolPartId,
            messageId: assistantMessageId,
            index: 1,
            type: "tool",
            name: "fake-check",
            category: "shell",
            status: "completed",
            output: "check passed",
          },
        },
        turnId,
        messageId: assistantMessageId,
        partId: toolPartId,
      })

      const failingToolPartId = `${turnId}-p2`
      emit({
        type: "part.upserted",
        data: {
          part: {
            id: failingToolPartId,
            messageId: assistantMessageId,
            index: 2,
            type: "tool",
            name: "fake-fail",
            category: "shell",
            status: "pending",
          },
        },
        turnId,
        messageId: assistantMessageId,
        partId: failingToolPartId,
      })
      emit({
        type: "part.upserted",
        data: {
          part: {
            id: failingToolPartId,
            messageId: assistantMessageId,
            index: 2,
            type: "tool",
            name: "fake-fail",
            category: "shell",
            status: "running",
          },
        },
        turnId,
        messageId: assistantMessageId,
        partId: failingToolPartId,
      })
      emit({
        type: "part.upserted",
        data: {
          part: {
            id: failingToolPartId,
            messageId: assistantMessageId,
            index: 2,
            type: "tool",
            name: "fake-fail",
            category: "shell",
            status: "failed",
            output: "exit 1",
          },
        },
        turnId,
        messageId: assistantMessageId,
        partId: failingToolPartId,
      })

      const permissionRequestId = `${turnId}-req-perm`
      const permissionRequest: Request = {
        id: permissionRequestId,
        sessionId: session.aideSessionId,
        turnId,
        kind: "permission",
        status: "open",
        payload: {
          kind: "permission",
          toolName: "fake-check",
          title: "Run fake-check?",
          detail: "The fake adapter asks before running fake-check.",
          options: [
            { id: "allow", label: "Allow", isDefault: true },
            { id: "deny", label: "Deny" },
          ],
        },
      }
      session.openRequests.set(permissionRequestId, permissionRequest)
      emit({
        type: "request.opened",
        data: { request: permissionRequest },
        turnId,
      })
      const permissionOutcome = await new Promise<"resolved" | "cancelled">(
        (resolve) => {
          turn.gates.set(permissionRequestId, { resolve })
        }
      )
      turn.gates.delete(permissionRequestId)
      if (permissionOutcome === "cancelled" || turn.cancelled) return

      const inputRequestId = `${turnId}-req-input`
      const inputRequest: Request = {
        id: inputRequestId,
        sessionId: session.aideSessionId,
        turnId,
        kind: "input",
        status: "open",
        payload: {
          kind: "input",
          questions: [
            {
              id: "approach",
              prompt: "Which approach should the fake take?",
              header: "Approach",
              options: [
                { id: "fast", label: "Fast" },
                { id: "safe", label: "Safe" },
              ],
              allowMultiple: true,
              allowFreeText: false,
            },
            {
              id: "notes",
              prompt: "Any additional notes?",
              allowMultiple: false,
              allowFreeText: true,
              multiline: true,
            },
          ],
        },
      }
      session.openRequests.set(inputRequestId, inputRequest)
      emit({
        type: "request.opened",
        data: { request: inputRequest },
        turnId,
      })
      const inputOutcome = await new Promise<"resolved" | "cancelled">(
        (resolve) => {
          turn.gates.set(inputRequestId, { resolve })
        }
      )
      turn.gates.delete(inputRequestId)
      if (inputOutcome === "cancelled" || turn.cancelled) return

      const canonicalText = userMessage.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")

      const echoPartId = `${turnId}-p3`
      emit({
        type: "part.delta",
        data: {
          partId: echoPartId,
          messageId: assistantMessageId,
          field: "text",
          text: canonicalText,
        },
        turnId,
        messageId: assistantMessageId,
        partId: echoPartId,
        ephemeral: true,
      })
      emit({
        type: "part.upserted",
        data: {
          part: {
            id: echoPartId,
            messageId: assistantMessageId,
            index: 3,
            type: "text",
            text: canonicalText,
          },
        },
        turnId,
        messageId: assistantMessageId,
        partId: echoPartId,
      })

      session.resumeCursor = turnId
      turn.status = "completed"
      emit({
        type: "turn.completed",
        data: {
          turn: { ...turnRow, status: "completed", endedAt: now() },
        },
        turnId,
      })
    } catch {
      turn.cancelled = true
      turn.status = "failed"
    } finally {
      if (session.activeTurn === turn) {
        session.activeTurn = undefined
      }
    }
  }

  const adapter: HarnessAdapter = {
    driver,
    configSchema: fakeConfigSchema as unknown as StandardSchemaV1,

    capabilities() {
      return {
        inventoryScope: "runtime",
        agentSelection: true,
        interactionModes: [
          { id: "build", label: "Build" },
          { id: "plan", label: "Plan" },
        ],
        sessionModelSwitch: "in-session",
        steer: true,
        interrupt: true,
        permissions: true,
        userInput: true,
        reasoningParts: true,
        mcp: {
          stdio: true,
          http: true,
          sse: true,
          inProcess: true,
          runtimeReconfigure: true,
        },
      }
    },

    async start(input: StartInstanceInput) {
      const parsed = fakeConfigSchema.safeParse(input.instance.config)
      if (!parsed.success) {
        throw fakeError(
          "invalid_instance_config",
          "fake adapter config is invalid",
          false,
          input.instance.instanceId
        )
      }
      if (parsed.data.failStart) {
        throw fakeError(
          "start_failed",
          "fake adapter configured to fail start",
          true,
          input.instance.instanceId
        )
      }
      instances.set(input.instance.instanceId, {
        config: input.instance,
        status: "ready",
        bus: createEventBus(),
        sessions: new Map(),
        mcpServers: {},
      })
      return { instanceId: input.instance.instanceId, driver }
    },

    async stop(input: StopInstanceInput) {
      const instance = instances.get(input.handle.instanceId)
      if (!instance) return
      instance.status = "stopped"
      instance.bus.close()
      for (const session of instance.sessions.values()) {
        session.bus.close()
      }
    },

    async health(input: HealthInput) {
      const instance = instances.get(input.handle.instanceId)
      return {
        status: instance?.status ?? "configured",
        version: "0.0.0-fake",
        installed: true,
        auth: {
          status: "authenticated",
          type: "fake",
          label: "Fake Auth",
        },
      }
    },

    async discover(input: DiscoverInput) {
      requireInstance(input.handle)
      return {
        instanceId: input.handle.instanceId,
        driver,
        revision: `fake-rev-${String(++idCounter).padStart(3, "0")}`,
        discoveredAt: now(),
        stale: false,
        capabilities: adapter.capabilities(input.handle),
        auth: { status: "authenticated", type: "fake", label: "Fake Auth" },
        models: [
          {
            providerId: "fake-provider",
            modelId: "fake-standard",
            displayName: "Fake Standard",
            description: "Deterministic default fake model",
            isDefault: true,
            optionDescriptors: [
              {
                id: "variant",
                label: "Variant",
                type: "select",
                options: [
                  { id: "stable", label: "Stable", isDefault: true },
                  { id: "preview", label: "Preview" },
                ],
                defaultValue: "stable",
              },
            ],
          },
          {
            providerId: "fake-provider",
            modelId: "fake-pro",
            displayName: "Fake Pro",
            optionDescriptors: [],
          },
        ],
        agents: [
          { id: "build", label: "Build", isDefault: true },
          { id: "plan", label: "Plan" },
        ],
        interactionModes: [
          { id: "build", label: "Build" },
          { id: "plan", label: "Plan" },
        ],
      }
    },

    async openSession(input: OpenSessionInput) {
      const instance = requireInstance(input.handle)
      const nativeSessionId = nextId("fake-native")
      const session: FakeNativeSession = {
        nativeSessionId,
        aideSessionId: input.sessionId,
        bus: createEventBus(),
        resumeCursor: undefined,
        durableSeq: 0,
        streamOrdinal: 0,
        turnSeq: 0,
        openRequests: new Map(),
        activeTurn: undefined,
      }
      instance.sessions.set(nativeSessionId, session)
      return { nativeSessionId }
    },

    async resumeSession(input: ResumeSessionInput) {
      const { session } = requireSession(input.handle, input.nativeSessionId)
      return {
        nativeSessionId: session.nativeSessionId,
        resumeCursor: input.resumeCursor ?? session.resumeCursor,
      }
    },

    async send(input: SendTurnInput) {
      const { session } = requireSession(
        input.handle,
        input.nativeSession.nativeSessionId
      )
      const key = input.userMessage.id
      invocations.set(key, (invocations.get(key) ?? 0) + 1)

      const prior = dispatchModes.get(key)
      if (prior) {
        if (prior === "ambiguous-after-effect") {
          throw fakeError(
            "execution_outcome_unknown",
            "fake dispatch outcome stays ambiguous on retry",
            false,
            input.handle.instanceId
          )
        }
        return
      }

      const mode = dispatchOutcomes.shift() ?? "acknowledged"
      if (mode === "known-not-dispatched") {
        throw fakeError(
          "dispatch_rejected",
          "fake adapter rejected the dispatch before any effect",
          true,
          input.handle.instanceId
        )
      }

      dispatchModes.set(key, mode)
      effects.set(key, (effects.get(key) ?? 0) + 1)
      void runScript(input, session).catch(() => {})

      if (mode === "ambiguous-after-effect") {
        throw fakeError(
          "execution_outcome_unknown",
          "fake adapter may have dispatched before failing",
          false,
          input.handle.instanceId
        )
      }
    },

    async interrupt(input: InterruptTurnInput) {
      const { session } = requireSession(
        input.handle,
        input.nativeSession.nativeSessionId
      )
      const turn = session.activeTurn
      if (!turn || turn.turnId !== input.turnId || turn.cancelled) return

      turn.cancelled = true
      turn.status = "interrupted"

      for (const request of session.openRequests.values()) {
        request.status = "cancelled"
        session.bus.publish(
          buildSessionEvent(session, input.handle.instanceId, {
            type: "request.cancelled",
            data: { request: { ...request } },
            turnId: input.turnId,
          })
        )
      }
      session.openRequests.clear()

      for (const gate of turn.gates.values()) {
        gate.resolve("cancelled")
      }
      turn.gates.clear()

      session.bus.publish(
        buildSessionEvent(session, input.handle.instanceId, {
          type: "turn.interrupted",
          data: {
            turn: { ...turn.turnRow, status: "interrupted", endedAt: now() },
          },
          turnId: input.turnId,
        })
      )
      session.activeTurn = undefined
    },

    async respondToPermission(input: PermissionResponseInput) {
      const { session } = requireSession(
        input.handle,
        input.nativeSession.nativeSessionId
      )
      if (input.request.kind !== "permission") {
        throw fakeError(
          "request_kind_mismatch",
          "respondToPermission requires a permission request",
          false,
          input.handle.instanceId
        )
      }
      const open = session.openRequests.get(input.request.id)
      if (!open || open.kind !== "permission") {
        throw fakeError(
          "request_not_open",
          `permission request "${input.request.id}" is not open`,
          false,
          input.handle.instanceId
        )
      }
      if (
        !input.request.resolution ||
        input.request.resolution.kind !== "permission"
      ) {
        throw fakeError(
          "invalid_resolution",
          "permission response requires a permission resolution",
          false,
          input.handle.instanceId
        )
      }

      open.status = "resolved"
      open.resolution = input.request.resolution
      session.openRequests.delete(open.id)
      session.bus.publish(
        buildSessionEvent(session, input.handle.instanceId, {
          type: "request.resolved",
          data: { request: { ...open } },
          turnId: open.turnId,
        })
      )
      session.activeTurn?.gates.get(open.id)?.resolve("resolved")
    },

    async respondToInput(input: InputResponseInput) {
      const { session } = requireSession(
        input.handle,
        input.nativeSession.nativeSessionId
      )
      if (input.request.kind !== "input") {
        throw fakeError(
          "request_kind_mismatch",
          "respondToInput requires an input request",
          false,
          input.handle.instanceId
        )
      }
      const open = session.openRequests.get(input.request.id)
      if (!open || open.kind !== "input") {
        throw fakeError(
          "request_not_open",
          `input request "${input.request.id}" is not open`,
          false,
          input.handle.instanceId
        )
      }
      if (
        !input.request.resolution ||
        input.request.resolution.kind !== "input"
      ) {
        throw fakeError(
          "invalid_resolution",
          "input response requires an input resolution",
          false,
          input.handle.instanceId
        )
      }

      const questions =
        open.payload.kind === "input" ? open.payload.questions : []
      for (const [questionId, answer] of Object.entries(
        input.request.resolution.answers
      )) {
        const question = questions.find((entry) => entry.id === questionId)
        if (!question) {
          throw fakeError(
            "invalid_resolution",
            `unknown question id "${questionId}"`,
            false,
            input.handle.instanceId
          )
        }
        if (
          answer.optionIds &&
          !answer.optionIds.every((optionId) =>
            (question.options ?? []).some((option) => option.id === optionId)
          )
        ) {
          throw fakeError(
            "invalid_resolution",
            `invalid option for question "${questionId}"`,
            false,
            input.handle.instanceId
          )
        }
        if (!answer.optionIds && !answer.text) {
          throw fakeError(
            "invalid_resolution",
            `question "${questionId}" needs optionIds or text`,
            false,
            input.handle.instanceId
          )
        }
      }

      open.status = "resolved"
      open.resolution = input.request.resolution
      session.openRequests.delete(open.id)
      session.bus.publish(
        buildSessionEvent(session, input.handle.instanceId, {
          type: "request.resolved",
          data: { request: { ...open } },
          turnId: open.turnId,
        })
      )
      session.activeTurn?.gates.get(open.id)?.resolve("resolved")
    },

    async setMcpServers(input: SetMcpServersInput) {
      const instance = requireInstance(input.handle)
      instance.mcpServers = { ...input.servers }
    },

    async mcpStatus(input: McpStatusInput) {
      const instance = requireInstance(input.handle)
      return Object.keys(instance.mcpServers).map((name) => ({
        name,
        connected: true,
      }))
    },

    events(input: HarnessEventsInput) {
      const instance = requireInstance(input.handle)
      if (input.nativeSession) {
        const session = instance.sessions.get(
          input.nativeSession.nativeSessionId
        )
        if (!session) {
          throw fakeError(
            "native_session_not_found",
            `fake native session "${input.nativeSession.nativeSessionId}" not found`,
            false,
            input.handle.instanceId
          )
        }
        return session.bus.subscribe()
      }
      return instance.bus.subscribe()
    },

    async dispose(input: DisposeInput) {
      await adapter.stop({ handle: input.handle })
    },
  }

  const control: FakeHarnessControl = {
    setNextDispatchOutcome(mode) {
      dispatchOutcomes.push(mode)
    },
    invocationCount(userMessageId) {
      return invocations.get(userMessageId) ?? 0
    },
    effectCount(userMessageId) {
      return effects.get(userMessageId) ?? 0
    },
    instanceStatus(instanceId) {
      return instances.get(instanceId)?.status
    },
  }

  return { adapter, control }
}
