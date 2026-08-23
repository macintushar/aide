import { basename, isAbsolute, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import type {
  AideError,
  AideEvent,
  InputQuestion,
  NativeDispatchInput,
  Part,
  Request,
  ResolvedExecution,
  SelectOption,
  ToolCategory,
  Turn,
  UserMessage,
} from "@workspace/contracts"

import { createEventBus } from "../event-bus"
import type { NativeSession } from "../types"
import type {
  OpencodeApi,
  OpencodeModelRef,
  OpencodeSessionEvent,
  OpencodeSessionInfo,
} from "./client"

const ADAPTER_PROJECT_ID = "adapter-local"

const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  bash: "shell",
  shell: "shell",
  read: "file_read",
  readfile: "file_read",
  write: "file_write",
  writefile: "file_write",
  edit: "file_write",
  apply_patch: "file_write",
  glob: "search",
  grep: "search",
  search: "search",
  webfetch: "web",
  websearch: "web",
  task: "agent",
}

export class OpencodeRuntimeFailure extends Error {
  readonly aideError: AideError

  constructor(aideError: AideError) {
    super(aideError.message)
    this.name = "OpencodeRuntimeFailure"
    this.aideError = aideError
  }
}

type ActiveTurn = {
  turnId: string
  assistantMessageId: string
  nativeAssistantMessageIds: Set<string>
  turn: Turn
  parts: Map<string, Part>
  indexes: Map<string, number>
  settled: boolean
  interrupting: boolean
}

type OpenRequest = {
  request: Request
  nativeQuestions?: Array<{
    question: string
    header: string
    options: Array<{ label: string; description: string }>
    multiple?: boolean
    custom?: boolean
  }>
}

type SessionEventShape = {
  type: AideEvent["type"]
  data: unknown
  turnId?: string
  messageId?: string
  partId?: string
  ephemeral?: boolean
}

type PartInput<T extends Part = Part> = T extends Part
  ? Omit<T, "id" | "index">
  : never

type OpencodePart = Extract<
  OpencodeSessionEvent,
  { type: "message.part.updated" }
>["data"]["part"]

export type OpencodeSessionRuntime = {
  readonly native: NativeSession
  events(): AsyncIterable<AideEvent>
  activeTurnId(): Promise<string | undefined>
  setMcpServerNames(names: string[]): void
  send(input: {
    turnId: string
    commandId: string
    userMessage: UserMessage
    execution: ResolvedExecution
    handoff?: NativeDispatchInput
  }): Promise<void>
  interrupt(turnId: string): Promise<void>
  respondToPermission(request: Request): Promise<void>
  respondToInput(request: Request): Promise<void>
  close(): Promise<void>
}

export type OpencodeSessionRuntimeOptions = {
  instanceId: string
  aideSessionId: string
  projectDirectory: string
  api: OpencodeApi
  session: OpencodeSessionInfo
  resumeCursor?: string
  activeTurn?: Turn
  mcpServerNames?: string[]
  now: () => string
  nextId: (prefix: string) => string
}

function runtimeError(
  code: string,
  message: string,
  instanceId: string,
  retryable = false,
  detail?: unknown
): OpencodeRuntimeFailure {
  return new OpencodeRuntimeFailure({
    code,
    message,
    instanceId,
    retryable,
    ...(detail === undefined ? {} : { detail }),
  })
}

function resultError(
  result: { error?: unknown },
  code: string,
  message: string,
  instanceId: string,
  retryable = false
): void {
  if (!result.error) return
  throw runtimeError(code, message, instanceId, retryable, result.error)
}

function modelFor(execution: ResolvedExecution): OpencodeModelRef {
  const providerID = execution.selection.model.providerId
  if (!providerID) {
    throw new Error("OpenCode requires a providerId for model selection")
  }
  return {
    id: execution.selection.model.modelId,
    providerID,
    ...(execution.selection.options.variant
      ? { variant: execution.selection.options.variant }
      : {}),
  }
}

function sameModel(
  left: OpencodeModelRef | undefined,
  right: OpencodeModelRef
): boolean {
  return (
    left?.id === right.id &&
    left.providerID === right.providerID &&
    left.variant === right.variant
  )
}

function requestOptions(): SelectOption[] {
  return [
    { id: "allow", label: "Allow once", isDefault: true },
    { id: "allow_always", label: "Always allow" },
    { id: "deny", label: "Deny" },
  ]
}

function questionOptions(
  options: Array<{ label: string; description: string }>
): SelectOption[] {
  return options.map((option, index) => ({
    id: option.label,
    label: option.label,
    ...(index === 0 ? { isDefault: true } : {}),
  }))
}

function toInputQuestions(
  questions: Array<{
    question: string
    header: string
    options: Array<{ label: string; description: string }>
    multiple?: boolean
    custom?: boolean
  }>
): InputQuestion[] {
  return questions.map((question, index) => ({
    id: `question-${index}`,
    prompt: question.question,
    header: question.header,
    ...(question.options.length > 0
      ? { options: questionOptions(question.options) }
      : {}),
    allowMultiple: question.multiple === true,
    allowFreeText: question.custom !== false,
  }))
}

function eventError(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof error.data === "object" &&
    error.data !== null &&
    "message" in error.data &&
    typeof error.data.message === "string"
  ) {
    return error.data.message
  }
  return "OpenCode reported an execution failure"
}

function filePath(url: string): string {
  if (!url.startsWith("file:")) return url
  try {
    return fileURLToPath(url)
  } catch {
    return url
  }
}

export async function createOpencodeSessionRuntime(
  options: OpencodeSessionRuntimeOptions
): Promise<OpencodeSessionRuntime> {
  const {
    instanceId,
    aideSessionId,
    projectDirectory,
    api,
    session,
    now,
    nextId,
  } = options
  const sessionApi = api.v2?.session
  if (!sessionApi) {
    throw runtimeError(
      "opencode_v2_unavailable",
      "The connected OpenCode runtime does not expose the pinned v2 session API",
      instanceId
    )
  }

  const bus = createEventBus()
  const pendingEvents: AideEvent[] = []
  const native: NativeSession = {
    nativeSessionId: session.id,
    ...(options.resumeCursor ? { resumeCursor: options.resumeCursor } : {}),
  }
  const openRequests = new Map<string, OpenRequest>()
  let durableSequence = 0
  let streamOrdinal = 0
  let turnSequence = 0
  let active: ActiveTurn | undefined = options.activeTurn?.assistantMessageId
    ? {
        turnId: options.activeTurn.id,
        assistantMessageId: options.activeTurn.assistantMessageId,
        nativeAssistantMessageIds: new Set(),
        turn: options.activeTurn,
        parts: new Map(),
        indexes: new Map(),
        settled: false,
        interrupting: false,
      }
    : undefined
  let mcpServerNames = [...(options.mcpServerNames ?? [])].sort(
    (left, right) => right.length - left.length
  )
  const suppressDeltas = options.activeTurn !== undefined
  let closed = false
  let sourceEventId: string | undefined
  let sourceEmissionOrdinal = 0
  let observedCursor = native.resumeCursor

  const advanceObservedCursor = (cursor: string): void => {
    const current = observedCursor
    if (current === undefined) {
      observedCursor = cursor
      return
    }
    const currentSequence = Number(current)
    const nextSequence = Number(cursor)
    if (
      Number.isSafeInteger(currentSequence) &&
      Number.isSafeInteger(nextSequence)
    ) {
      if (nextSequence > currentSequence) observedCursor = cursor
      return
    }
    if (cursor !== current) observedCursor = cursor
  }

  const emit = (shape: SessionEventShape): void => {
    const nativeEventId = sourceEventId
      ? `${sourceEventId}-${sourceEmissionOrdinal++}`
      : nextId("evt")
    const event = {
      schemaVersion: 1,
      eventId: `${instanceId}-${nativeEventId}`,
      timestamp: now(),
      delivery: shape.ephemeral
        ? { durable: false, streamOrdinal: streamOrdinal++ }
        : { durable: true, sequence: durableSequence++ },
      scope: {
        kind: "session",
        projectId: ADAPTER_PROJECT_ID,
        sessionId: aideSessionId,
        ...(shape.turnId ? { turnId: shape.turnId } : {}),
        ...(shape.messageId ? { messageId: shape.messageId } : {}),
        ...(shape.partId ? { partId: shape.partId } : {}),
      },
      instanceId,
      driver: "opencode",
      type: shape.type,
      data: shape.data,
    } as AideEvent
    if (bus.subscriberCount() === 0) pendingEvents.push(event)
    else bus.publish(event)
  }

  const partIndex = (turn: ActiveTurn, nativeId: string): number => {
    const existing = turn.indexes.get(nativeId)
    if (existing !== undefined) return existing
    const index = turn.indexes.size
    turn.indexes.set(nativeId, index)
    return index
  }

  const upsertPart = (nativeId: string, part: PartInput) => {
    const turn = active
    if (!turn || turn.settled) return
    const normalized = {
      ...part,
      id: `${turn.turnId}-${nativeId}`,
      index: partIndex(turn, nativeId),
    } as Part
    turn.parts.set(nativeId, normalized)
    emit({
      type: "part.upserted",
      data: { part: normalized },
      turnId: turn.turnId,
      messageId: turn.assistantMessageId,
      partId: normalized.id,
    })
  }

  const acceptsMessage = (turn: ActiveTurn, nativeMessageId: string) => {
    if (nativeMessageId === turn.turn.userMessageId) return false
    turn.nativeAssistantMessageIds.add(nativeMessageId)
    return true
  }

  const upsertSnapshotPart = (part: OpencodePart): void => {
    const turn = active
    if (!turn || turn.settled || !acceptsMessage(turn, part.messageID)) return
    switch (part.type) {
      case "text":
        upsertPart(part.id, {
          messageId: turn.assistantMessageId,
          type: "text",
          text: part.text,
        })
        return
      case "reasoning":
        upsertPart(part.id, {
          messageId: turn.assistantMessageId,
          type: "reasoning",
          text: part.text,
        })
        return
      case "tool": {
        const status =
          part.state.status === "error" ? "failed" : part.state.status
        const mcpServer = mcpServerNames.find((name) =>
          part.tool.startsWith(`${name}_`)
        )
        upsertPart(part.id, {
          messageId: turn.assistantMessageId,
          type: "tool",
          name: part.tool,
          category: mcpServer
            ? "mcp"
            : (TOOL_CATEGORIES[part.tool.toLowerCase()] ?? "other"),
          status,
          ...(mcpServer
            ? { source: { kind: "mcp" as const, server: mcpServer } }
            : {}),
          input: part.state.input,
          ...(part.state.status === "completed"
            ? { output: part.state.output }
            : part.state.status === "error"
              ? { output: part.state.error }
              : {}),
        })
        return
      }
      case "file":
        upsertPart(part.id, {
          messageId: turn.assistantMessageId,
          type: "file",
          path: filePath(part.url),
          mime: part.mime,
        })
        return
      case "agent":
        upsertPart(part.id, {
          messageId: turn.assistantMessageId,
          type: "agent",
          name: part.name,
        })
        return
      default:
        return
    }
  }

  const resolveRequest = (
    requestId: string,
    resolution: Request["resolution"]
  ): void => {
    const open = openRequests.get(requestId)
    if (!open) return
    openRequests.delete(requestId)
    const request = {
      ...open.request,
      status: "resolved",
      ...(resolution ? { resolution } : {}),
    } as Request
    emit({
      type: "request.resolved",
      data: { request },
      turnId: request.turnId,
    })
  }

  const cancelRequests = (): void => {
    for (const [requestId, open] of openRequests) {
      openRequests.delete(requestId)
      emit({
        type: "request.cancelled",
        data: { request: { ...open.request, status: "cancelled" } },
        turnId: open.request.turnId,
      })
    }
  }

  const settle = (
    type: "turn.completed" | "turn.interrupted" | "turn.failed",
    error?: AideError
  ): void => {
    const turn = active
    if (!turn || turn.settled) return
    if (sourceEventId && observedCursor) native.resumeCursor = observedCursor
    turn.settled = true
    cancelRequests()
    const status = type.slice("turn.".length) as
      | "completed"
      | "interrupted"
      | "failed"
    emit({
      type,
      data: {
        turn: {
          ...turn.turn,
          status,
          endedAt: now(),
          ...(error ? { error } : {}),
        },
      },
      turnId: turn.turnId,
    })
    active = undefined
  }

  const handleNativeEvent = (event: OpencodeSessionEvent): void => {
    sourceEventId = event.id
    sourceEmissionOrdinal = 0
    try {
      if (event.durable?.seq !== undefined) {
        advanceObservedCursor(String(event.durable.seq))
      }
      const turn = active
      switch (event.type) {
        case "session.next.step.started":
          if (!turn || event.data.sessionID !== session.id) return
          turn.nativeAssistantMessageIds.add(event.data.assistantMessageID)
          return
        case "message.part.updated":
          if (event.data.sessionID !== session.id) return
          upsertSnapshotPart(event.data.part)
          return
        case "message.part.delta": {
          if (
            suppressDeltas ||
            !turn ||
            event.data.sessionID !== session.id ||
            !acceptsMessage(turn, event.data.messageID)
          ) {
            return
          }
          const current = turn.parts.get(event.data.partID)
          const field =
            current?.type === "reasoning"
              ? "reasoning"
              : current?.type === "tool" && event.data.field === "input"
                ? "input"
                : current?.type === "text"
                  ? "text"
                  : undefined
          if (!field) return
          emit({
            type: "part.delta",
            data: {
              partId: `${turn.turnId}-${event.data.partID}`,
              messageId: turn.assistantMessageId,
              field,
              text: event.data.delta,
            },
            turnId: turn.turnId,
            messageId: turn.assistantMessageId,
            partId: `${turn.turnId}-${event.data.partID}`,
            ephemeral: true,
          })
          return
        }
        case "message.part.removed":
          if (
            !turn ||
            event.data.sessionID !== session.id ||
            !acceptsMessage(turn, event.data.messageID)
          ) {
            return
          }
          turn.parts.delete(event.data.partID)
          emit({
            type: "part.removed",
            data: {
              partId: `${turn.turnId}-${event.data.partID}`,
              messageId: turn.assistantMessageId,
            },
            turnId: turn.turnId,
            messageId: turn.assistantMessageId,
            partId: `${turn.turnId}-${event.data.partID}`,
          })
          return
        case "permission.v2.asked": {
          if (!turn || event.data.sessionID !== session.id) return
          const request: Request = {
            id: event.data.id,
            sessionId: aideSessionId,
            turnId: turn.turnId,
            kind: "permission",
            status: "open",
            payload: {
              kind: "permission",
              toolName: event.data.action,
              title: `Allow ${event.data.action}?`,
              ...(event.data.resources.length > 0
                ? { detail: event.data.resources.join("\n") }
                : {}),
              options: requestOptions(),
            },
          }
          openRequests.set(request.id, { request })
          emit({
            type: "request.opened",
            data: { request },
            turnId: turn.turnId,
          })
          return
        }
        case "permission.v2.replied":
          resolveRequest(event.data.requestID, {
            kind: "permission",
            optionId:
              event.data.reply === "once"
                ? "allow"
                : event.data.reply === "always"
                  ? "allow_always"
                  : "deny",
          })
          return
        case "question.v2.asked": {
          if (!turn || event.data.sessionID !== session.id) return
          const questions = toInputQuestions(event.data.questions)
          if (questions.length === 0) return
          const request: Request = {
            id: event.data.id,
            sessionId: aideSessionId,
            turnId: turn.turnId,
            kind: "input",
            status: "open",
            payload: { kind: "input", questions },
          }
          openRequests.set(request.id, {
            request,
            nativeQuestions: event.data.questions,
          })
          emit({
            type: "request.opened",
            data: { request },
            turnId: turn.turnId,
          })
          return
        }
        case "question.v2.replied": {
          const open = openRequests.get(event.data.requestID)
          if (!open || open.request.kind !== "input") return
          const answers: Record<
            string,
            { optionIds?: string[]; text?: string }
          > = {}
          for (const [index, answer] of event.data.answers.entries()) {
            const question = open.nativeQuestions?.[index]
            const optionLabels = new Set(
              question?.options.map((option) => option.label) ?? []
            )
            const selected = answer.filter((value) => optionLabels.has(value))
            const custom = answer.filter((value) => !optionLabels.has(value))
            answers[`question-${index}`] = {
              ...(selected.length > 0 ? { optionIds: selected } : {}),
              ...(custom.length > 0 ? { text: custom.join("\n") } : {}),
            }
          }
          resolveRequest(event.data.requestID, { kind: "input", answers })
          return
        }
        case "question.v2.rejected": {
          const open = openRequests.get(event.data.requestID)
          if (!open) return
          openRequests.delete(event.data.requestID)
          emit({
            type: "request.cancelled",
            data: { request: { ...open.request, status: "cancelled" } },
            turnId: open.request.turnId,
          })
          return
        }
        case "session.error": {
          if (
            !turn ||
            (event.data.sessionID !== undefined &&
              event.data.sessionID !== session.id)
          ) {
            return
          }
          if (turn.interrupting) {
            settle("turn.interrupted")
            return
          }
          const error: AideError = {
            code: "opencode_session_error",
            message: eventError(event.data.error),
            instanceId,
            retryable: false,
            ...(event.data.error ? { detail: event.data.error } : {}),
          }
          emit({
            type: "error.occurred",
            data: { error },
            turnId: turn.turnId,
          })
          settle("turn.failed", error)
          return
        }
        case "session.idle":
          if (!turn || event.data.sessionID !== session.id) return
          settle(turn.interrupting ? "turn.interrupted" : "turn.completed")
          return
        case "session.status":
          if (!turn || event.data.sessionID !== session.id) return
          if (event.data.status.type === "idle") {
            settle(turn.interrupting ? "turn.interrupted" : "turn.completed")
            return
          }
          if (event.data.status.type !== "retry") return
          emit({
            type: "notice.created",
            data: {
              title: "OpenCode is retrying",
              message: event.data.status.message,
              level: "warning",
            },
            turnId: turn.turnId,
          })
          return
        case "session.next.retried":
          if (!turn || event.data.sessionID !== session.id) return
          emit({
            type: "notice.created",
            data: {
              title: "OpenCode is retrying",
              message: `Retrying the model request (attempt ${event.data.attempt}).`,
              level: "warning",
            },
            turnId: turn.turnId,
          })
          return
        default:
          return
      }
    } finally {
      sourceEventId = undefined
    }
  }

  let eventStream: AsyncGenerator<{
    id: string
    event: string
    data: string
  }>
  const streamAbort = new AbortController()
  try {
    eventStream = (
      await sessionApi.events(
        {
          sessionID: session.id,
          ...(options.resumeCursor ? { after: options.resumeCursor } : {}),
        },
        { signal: streamAbort.signal }
      )
    ).stream
  } catch (error) {
    throw runtimeError(
      "opencode_event_stream_failed",
      `Could not subscribe to OpenCode session "${session.id}"`,
      instanceId,
      true,
      error
    )
  }

  const eventReader = (async () => {
    try {
      for await (const envelope of eventStream) {
        if (closed) return
        advanceObservedCursor(envelope.id)
        let event: OpencodeSessionEvent
        try {
          event = JSON.parse(envelope.data) as OpencodeSessionEvent
        } catch {
          continue
        }
        handleNativeEvent(event)
      }
    } catch (error) {
      if (closed) return
      settle("turn.failed", {
        code: "opencode_event_stream_failed",
        message:
          error instanceof Error
            ? error.message
            : "The OpenCode session event stream failed",
        instanceId,
        retryable: true,
      })
    }
  })()

  const runtime: OpencodeSessionRuntime = {
    native,

    events() {
      const stream = bus.subscribe()
      for (const event of pendingEvents.splice(0)) bus.publish(event)
      return stream
    },

    setMcpServerNames(names) {
      mcpServerNames = [...names].sort(
        (left, right) => right.length - left.length
      )
    },

    async activeTurnId() {
      const turn = active
      if (!turn || turn.settled) return undefined
      const result = await sessionApi.active()
      resultError(
        result,
        "active_session_check_failed",
        `OpenCode could not inspect active session "${session.id}"`,
        instanceId,
        true
      )
      return result.data?.data[session.id] ? turn.turnId : undefined
    },

    async send(input) {
      if (closed) {
        throw runtimeError(
          "native_session_closed",
          `OpenCode session "${session.id}" is closed`,
          instanceId
        )
      }
      if (active && !active.settled) {
        throw runtimeError(
          "turn_already_running",
          `OpenCode session "${session.id}" is already running turn "${active.turnId}"`,
          instanceId
        )
      }

      const model = modelFor(input.execution)
      const agent = input.execution.selection.agent
      const switchedModel = await sessionApi.switchModel({
        sessionID: session.id,
        model,
      })
      resultError(
        switchedModel,
        "model_switch_failed",
        `OpenCode could not switch session "${session.id}" to ${model.providerID}/${model.id}`,
        instanceId
      )
      const switchedAgent = await sessionApi.switchAgent({
        sessionID: session.id,
        agent,
      })
      resultError(
        switchedAgent,
        "agent_switch_failed",
        `OpenCode could not switch session "${session.id}" to agent "${agent ?? "default"}"`,
        instanceId
      )

      const inspected = await sessionApi.get({ sessionID: session.id })
      resultError(
        inspected,
        "session_inspection_failed",
        `OpenCode could not inspect session "${session.id}" after selection changes`,
        instanceId,
        true
      )
      const selected = inspected.data?.data
      if (
        !selected ||
        !sameModel(selected.model, model) ||
        selected.agent !== agent
      ) {
        throw runtimeError(
          "session_selection_mismatch",
          `OpenCode session "${session.id}" did not retain the requested model and agent`,
          instanceId,
          false,
          { expected: { model, agent }, actual: selected }
        )
      }

      const assistantMessageId = `${input.turnId}-assistant`
      const turn: Turn = {
        id: input.turnId,
        sessionId: aideSessionId,
        seq: turnSequence++,
        status: "running",
        execution: input.execution,
        commandId: input.commandId,
        userMessageId: input.userMessage.id,
        assistantMessageId,
        startedAt: now(),
      }
      active = {
        turnId: input.turnId,
        assistantMessageId,
        nativeAssistantMessageIds: new Set(),
        turn,
        parts: new Map(),
        indexes: new Map(),
        settled: false,
        interrupting: false,
      }
      emit({ type: "turn.started", data: { turn }, turnId: input.turnId })
      emit({
        type: "message.upserted",
        data: {
          message: {
            id: assistantMessageId,
            sessionId: aideSessionId,
            seq: input.userMessage.seq + 1,
            role: "assistant",
            parentMessageId: input.userMessage.id,
            createdAt: now(),
          },
        },
        turnId: input.turnId,
        messageId: assistantMessageId,
      })

      const text = input.userMessage.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
      const prefix = input.handoff?.content
      const files = input.userMessage.parts
        .filter((part) => part.type === "file")
        .map((part) => {
          const path = isAbsolute(part.path)
            ? part.path
            : resolve(projectDirectory, part.path)
          return { uri: pathToFileURL(path).href, name: basename(path) }
        })
      const prompted = await sessionApi.prompt({
        sessionID: session.id,
        id: input.userMessage.id,
        prompt: {
          text: prefix ? `${prefix}\n\n${text}` : text,
          ...(files.length > 0 ? { files } : {}),
        },
        delivery: "queue",
      })
      if (prompted.error || !prompted.data?.data) {
        active = undefined
        throw runtimeError(
          "prompt_admission_failed",
          `OpenCode did not admit prompt "${input.userMessage.id}"`,
          instanceId,
          true,
          prompted.error
        )
      }
      native.resumeCursor = String(prompted.data.data.admittedSeq)
      advanceObservedCursor(native.resumeCursor)

      void sessionApi
        .wait({ sessionID: session.id })
        .then((result) => {
          if (result.error) {
            settle("turn.failed", {
              code: "opencode_wait_failed",
              message: `OpenCode could not confirm completion of turn "${input.turnId}"`,
              instanceId,
              retryable: true,
              detail: result.error,
            })
          }
        })
        .catch((error) => {
          settle("turn.failed", {
            code: "opencode_wait_failed",
            message: error instanceof Error ? error.message : String(error),
            instanceId,
            retryable: true,
          })
        })
    },

    async interrupt(turnId) {
      const turn = active
      if (!turn || turn.turnId !== turnId || turn.settled) return
      turn.interrupting = true
      const pending = [...openRequests.values()]
      const result = await sessionApi.interrupt({ sessionID: session.id })
      try {
        resultError(
          result,
          "turn_interrupt_failed",
          `OpenCode did not acknowledge interruption of session "${session.id}"`,
          instanceId,
          true
        )
      } catch (error) {
        turn.interrupting = false
        throw error
      }
      cancelRequests()
      await Promise.all(
        pending.map((open) =>
          open.request.kind === "input"
            ? sessionApi.question
                .reject({ sessionID: session.id, requestID: open.request.id })
                .catch(() => undefined)
            : sessionApi.permission
                .reply({
                  sessionID: session.id,
                  requestID: open.request.id,
                  reply: "reject",
                  message: "The turn was interrupted.",
                })
                .catch(() => undefined)
        )
      )
      settle("turn.interrupted")
    },

    async respondToPermission(request) {
      const open = openRequests.get(request.id)
      if (!open || open.request.kind !== "permission") {
        throw runtimeError(
          "request_not_open",
          `Permission request "${request.id}" is not open`,
          instanceId
        )
      }
      const resolution = request.resolution
      if (!resolution || resolution.kind !== "permission") {
        throw runtimeError(
          "invalid_resolution",
          "A permission response requires a permission resolution",
          instanceId
        )
      }
      const reply =
        resolution.optionId === "allow"
          ? "once"
          : resolution.optionId === "allow_always"
            ? "always"
            : resolution.optionId === "deny"
              ? "reject"
              : undefined
      if (!reply) {
        throw runtimeError(
          "invalid_resolution",
          `Option "${resolution.optionId}" was not offered for request "${request.id}"`,
          instanceId
        )
      }
      const result = await sessionApi.permission.reply({
        sessionID: session.id,
        requestID: request.id,
        reply,
        ...(reply === "reject" ? { message: "Denied by the Aide user." } : {}),
      })
      resultError(
        result,
        "permission_reply_failed",
        `OpenCode did not accept permission response "${request.id}"`,
        instanceId,
        true
      )
      resolveRequest(request.id, resolution)
    },

    async respondToInput(request) {
      const open = openRequests.get(request.id)
      if (!open || open.request.kind !== "input") {
        throw runtimeError(
          "request_not_open",
          `Input request "${request.id}" is not open`,
          instanceId
        )
      }
      const resolution = request.resolution
      if (!resolution || resolution.kind !== "input") {
        throw runtimeError(
          "invalid_resolution",
          "An input response requires an input resolution",
          instanceId
        )
      }
      const questions =
        open.request.payload.kind === "input"
          ? open.request.payload.questions
          : []
      const answers = questions.map((question) => {
        const answer = resolution.answers[question.id]
        if (!answer) {
          throw runtimeError(
            "invalid_resolution",
            `Question "${question.id}" requires an answer`,
            instanceId
          )
        }
        if (
          answer.optionIds?.some(
            (id) => !question.options?.some((option) => option.id === id)
          )
        ) {
          throw runtimeError(
            "invalid_resolution",
            `Question "${question.id}" has an invalid option`,
            instanceId
          )
        }
        return [
          ...(answer.optionIds ?? []),
          ...(answer.text === undefined ? [] : [answer.text]),
        ]
      })
      const result = await sessionApi.question.reply({
        sessionID: session.id,
        requestID: request.id,
        questionV2Reply: { answers },
      })
      resultError(
        result,
        "question_reply_failed",
        `OpenCode did not accept input response "${request.id}"`,
        instanceId,
        true
      )
      resolveRequest(request.id, resolution)
    },

    async close() {
      if (closed) return
      closed = true
      streamAbort.abort()
      cancelRequests()
      settle("turn.failed", {
        code: "native_session_closed",
        message: "The OpenCode session closed before the turn completed",
        instanceId,
        retryable: false,
      })
      void eventStream.return(undefined).catch(() => undefined)
      void eventReader.catch(() => undefined)
      bus.close()
    },
  }

  return runtime
}
