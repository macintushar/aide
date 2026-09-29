import { basename, isAbsolute, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import type {
  AideError,
  AideEvent,
  InputQuestion,
  InputResolution,
  NativeDispatchInput,
  Part,
  Request,
  ResolvedExecution,
  SelectOption,
  ToolCategory,
  Turn,
  Usage,
  UserMessage,
} from "@workspace/contracts"

import { createEventBus } from "../event-bus"
import { messageText, type NativeSession } from "../types"
import type {
  OpencodeApi,
  OpencodeForm,
  OpencodeFormField,
  OpencodeLiveEvent,
  OpencodeLogEvent,
  OpencodeModelRef,
  OpencodePermissionRequest,
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
  /** Native assistant messages this turn produced; other messages are ignored. */
  nativeAssistantMessageIds: Set<string>
  turn: Turn
  parts: Map<string, Part>
  indexes: Map<string, number>
  toolNames: Map<string, string>
  /** Subagent (`task` tool) calls, which render as agent parts. */
  subagentCalls: Set<string>
  /** Token usage and cost summed over the turn's steps. */
  usage: Usage | undefined
  /**
   * Set once this turn's `session.execution.started` is seen. A terminal
   * execution event before that belongs to an earlier, already-settled turn
   * (an interrupt settles locally before OpenCode confirms it).
   */
  executing: boolean
  settled: boolean
  interrupting: boolean
}

type OpenRequest = {
  request: Request
  /** Native form fields, keyed by question id, to translate answers back. */
  fields?: Map<string, AnswerableField>
}

type AnswerableField = Exclude<OpencodeFormField, { type: "external" }>

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

type LogEvent = Exclude<OpencodeLogEvent, { type: "log.synced" }>

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
  steer(turnId: string, message: UserMessage): Promise<void>
  compact(): Promise<void>
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

/** Runs one SDK call, translating a thrown `ClientError` into an Aide error. */
async function call<T>(
  operation: () => Promise<T>,
  code: string,
  message: string,
  instanceId: string,
  retryable = false
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw runtimeError(code, message, instanceId, retryable, errorDetail(error))
  }
}

function errorDetail(error: unknown): unknown {
  if (error instanceof Error)
    return { name: error.name, message: error.message }
  return error
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

/**
 * OpenCode message ids must carry its `msg_` prefix. The Aide id rides behind
 * it so the prompt stays idempotent: resubmitting the same id is a no-op.
 */
function nativeMessageId(aideMessageId: string): string {
  return aideMessageId.startsWith("msg_")
    ? aideMessageId
    : `msg_${aideMessageId}`
}

/** OpenCode records a model selected without a variant as variant "default". */
const DEFAULT_VARIANT = "default"

function sameModel(
  left: OpencodeModelRef | undefined,
  right: OpencodeModelRef
): boolean {
  return (
    left?.id === right.id &&
    left.providerID === right.providerID &&
    (left.variant ?? DEFAULT_VARIANT) === (right.variant ?? DEFAULT_VARIANT)
  )
}

function permissionOptions(): SelectOption[] {
  return [
    { id: "allow", label: "Allow once", isDefault: true },
    { id: "allow_always", label: "Always allow" },
    { id: "deny", label: "Deny" },
  ]
}

const BOOLEAN_OPTIONS: SelectOption[] = [
  { id: "true", label: "Yes", isDefault: true },
  { id: "false", label: "No" },
]

/**
 * OpenCode forms are typed fields; Aide input requests are questions. Each
 * visible, answerable field becomes one question keyed by the field's key. An
 * external field is a link the user must open elsewhere, so it has no answer
 * Aide could send and is left out.
 */
function toInputQuestions(form: OpencodeForm): {
  questions: InputQuestion[]
  fields: Map<string, AnswerableField>
} {
  const questions: InputQuestion[] = []
  const fields = new Map<string, AnswerableField>()
  for (const field of form.fields) {
    if (field.type === "external") continue
    if (field.hidden) continue
    fields.set(field.key, field)
    const prompt = field.description ?? field.title ?? form.title
    const base = {
      id: field.key,
      prompt,
      ...(field.title && field.title !== prompt ? { header: field.title } : {}),
    }
    switch (field.type) {
      case "string": {
        const options = field.options?.map((option, index): SelectOption => ({
          id: option.value,
          label: option.label,
          ...(index === 0 ? { isDefault: true } : {}),
        }))
        questions.push({
          ...base,
          ...(options && options.length > 0 ? { options } : {}),
          allowMultiple: false,
          allowFreeText:
            !options || options.length === 0 || field.custom !== false,
        })
        break
      }
      case "multiselect":
        questions.push({
          ...base,
          options: field.options.map((option, index) => ({
            id: option.value,
            label: option.label,
            ...(index === 0 ? { isDefault: true } : {}),
          })),
          allowMultiple: true,
          allowFreeText: field.custom === true,
        })
        break
      case "boolean":
        questions.push({
          ...base,
          options: BOOLEAN_OPTIONS,
          allowMultiple: false,
          allowFreeText: false,
        })
        break
      case "number":
      case "integer":
        questions.push({ ...base, allowMultiple: false, allowFreeText: true })
        break
    }
  }
  return { questions, fields }
}

function optionValues(field: AnswerableField): Set<string> {
  if (field.type === "boolean") return new Set(["true", "false"])
  if (field.type === "string" || field.type === "multiselect") {
    return new Set(field.options?.map((option) => option.value) ?? [])
  }
  return new Set()
}

/** A native form answer, translated back into Aide's option/text shape. */
function toInputResolution(
  fields: Map<string, AnswerableField>,
  answer: Record<string, unknown>
): InputResolution {
  const answers: InputResolution["answers"] = {}
  for (const [key, field] of fields) {
    const value = answer[key]
    if (value === undefined) continue
    const values = Array.isArray(value) ? value.map(String) : [String(value)]
    const known = optionValues(field)
    const selected = values.filter((entry) => known.has(entry))
    const custom = values.filter((entry) => !known.has(entry))
    answers[key] = {
      ...(selected.length > 0 ? { optionIds: selected } : {}),
      ...(custom.length > 0 ? { text: custom.join("\n") } : {}),
    }
  }
  return { kind: "input", answers }
}

function filePath(url: string): string {
  if (!url.startsWith("file:")) return url
  try {
    return fileURLToPath(url)
  } catch {
    return url
  }
}

function isLogEvent(event: OpencodeLogEvent): event is LogEvent {
  return event.type !== "log.synced"
}

/** A live event that is also a session's durable history. */
function isDurable(
  event: OpencodeLiveEvent
): event is OpencodeLiveEvent & LogEvent {
  return (
    "durable" in event &&
    event.durable !== undefined &&
    "data" in event &&
    typeof event.data === "object" &&
    event.data !== null &&
    "sessionID" in event.data
  )
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
        toolNames: new Map(),
        subagentCalls: new Set(),
        usage: undefined,
        executing: false,
        settled: false,
        interrupting: false,
      }
    : undefined
  let mcpServerNames = [...(options.mcpServerNames ?? [])].sort(
    (left, right) => right.length - left.length
  )
  // A reattached turn rebuilds from durable history; replaying live deltas on
  // top of that would double the text the UI already has.
  const suppressDeltas = options.activeTurn !== undefined
  let closed = false
  let sourceEventId: string | undefined
  let sourceEmissionOrdinal = 0
  let observedCursor =
    options.resumeCursor === undefined
      ? undefined
      : Number(options.resumeCursor)

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

  /** Emits under a stable source id so a replay dedupes against the original. */
  const withSource = (id: string, body: () => void): void => {
    const previous = sourceEventId
    const previousOrdinal = sourceEmissionOrdinal
    sourceEventId = id
    sourceEmissionOrdinal = 0
    try {
      body()
    } finally {
      sourceEventId = previous
      sourceEmissionOrdinal = previousOrdinal
    }
  }

  const partIndex = (turn: ActiveTurn, nativeId: string): number => {
    const existing = turn.indexes.get(nativeId)
    if (existing !== undefined) return existing
    const index = turn.indexes.size
    turn.indexes.set(nativeId, index)
    return index
  }

  const upsertPart = (turn: ActiveTurn, nativeId: string, part: PartInput) => {
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

  /** The live turn, when this native assistant message belongs to it. */
  const turnFor = (assistantMessageId: string): ActiveTurn | undefined => {
    const turn = active
    if (!turn || turn.settled) return undefined
    return turn.nativeAssistantMessageIds.has(assistantMessageId)
      ? turn
      : undefined
  }

  /** OpenCode delegates to a subagent through its `task` tool. */
  const SUBAGENT_TOOL = "task"

  const agentPart = (
    turn: ActiveTurn,
    callId: string,
    update: {
      status: "running" | "completed" | "failed"
      input?: unknown
      summary?: string
    }
  ): void => {
    const previous = turn.parts.get(`agent-${callId}`)
    const input =
      typeof update.input === "object" && update.input !== null
        ? (update.input as Record<string, unknown>)
        : {}
    const name =
      typeof input.subagent_type === "string" && input.subagent_type
        ? input.subagent_type
        : previous?.type === "agent"
          ? previous.name
          : "subagent"
    const description =
      typeof input.description === "string"
        ? input.description
        : previous?.type === "agent"
          ? previous.description
          : undefined
    upsertPart(turn, `agent-${callId}`, {
      messageId: turn.assistantMessageId,
      type: "agent",
      name,
      status: update.status,
      ...(description ? { description } : {}),
      ...(update.summary ? { summary: update.summary.slice(0, 2_000) } : {}),
    })
  }

  /** Adds one step's accounting to the turn. */
  const addUsage = (
    turn: ActiveTurn,
    step: {
      cost?: number
      tokens?: {
        input: number
        output: number
        reasoning: number
        cache?: { read: number; write: number }
      }
    }
  ): void => {
    if (step.cost === undefined && step.tokens === undefined) return
    const current = turn.usage ?? {}
    turn.usage = {
      inputTokens: (current.inputTokens ?? 0) + (step.tokens?.input ?? 0),
      outputTokens: (current.outputTokens ?? 0) + (step.tokens?.output ?? 0),
      reasoningTokens:
        (current.reasoningTokens ?? 0) + (step.tokens?.reasoning ?? 0),
      cacheReadTokens:
        (current.cacheReadTokens ?? 0) + (step.tokens?.cache?.read ?? 0),
      cacheWriteTokens:
        (current.cacheWriteTokens ?? 0) + (step.tokens?.cache?.write ?? 0),
      costUsd: (current.costUsd ?? 0) + (step.cost ?? 0),
    }
  }

  /** Reports the turn's usage on its assistant message before it settles. */
  const reportUsage = (turn: ActiveTurn): void => {
    if (!turn.usage) return
    emit({
      type: "message.upserted",
      data: {
        message: {
          id: turn.assistantMessageId,
          sessionId: aideSessionId,
          // The core keeps its own metadata; only usage is taken from here.
          seq: 0,
          role: "assistant",
          parentMessageId: turn.turn.userMessageId,
          createdAt: turn.turn.startedAt ?? now(),
          usage: turn.usage,
        },
      },
      turnId: turn.turnId,
      messageId: turn.assistantMessageId,
    })
  }

  const toolPart = (
    turn: ActiveTurn,
    callId: string,
    update: {
      status: "pending" | "running" | "completed" | "failed"
      input?: unknown
      output?: string
    }
  ): void => {
    const name = turn.toolNames.get(callId) ?? "tool"
    const previous = turn.parts.get(`tool-${callId}`)
    const mcpServer = mcpServerNames.find((server) =>
      name.startsWith(`${server}_`)
    )
    upsertPart(turn, `tool-${callId}`, {
      messageId: turn.assistantMessageId,
      type: "tool",
      name,
      category: mcpServer
        ? "mcp"
        : (TOOL_CATEGORIES[name.toLowerCase()] ?? "other"),
      status: update.status,
      ...(mcpServer
        ? { source: { kind: "mcp" as const, server: mcpServer } }
        : {}),
      ...(update.input !== undefined
        ? { input: update.input }
        : previous?.type === "tool" && previous.input !== undefined
          ? { input: previous.input }
          : {}),
      ...(update.output !== undefined ? { output: update.output } : {}),
    })
  }

  const openPermission = (request: OpencodePermissionRequest): void => {
    const turn = active
    if (!turn || turn.settled || openRequests.has(request.id)) return
    const opened: Request = {
      id: request.id,
      sessionId: aideSessionId,
      turnId: turn.turnId,
      kind: "permission",
      status: "open",
      payload: {
        kind: "permission",
        toolName: request.action,
        title: request.message ?? `Allow ${request.action}?`,
        ...(request.resources.length > 0
          ? { detail: request.resources.join("\n") }
          : {}),
        options: permissionOptions(),
      },
    }
    openRequests.set(opened.id, { request: opened })
    withSource(`request-${opened.id}`, () =>
      emit({
        type: "request.opened",
        data: { request: opened },
        turnId: turn.turnId,
      })
    )
  }

  const openForm = (form: OpencodeForm): void => {
    const turn = active
    if (!turn || turn.settled || openRequests.has(form.id)) return
    const { questions, fields } = toInputQuestions(form)
    if (questions.length === 0) {
      // Nothing here Aide can show or answer (only external or hidden
      // fields). Left pending it would block the turn for good, so decline it.
      void api.session.form
        .cancel({ sessionID: session.id, formID: form.id })
        .catch(() => undefined)
      return
    }
    const opened: Request = {
      id: form.id,
      sessionId: aideSessionId,
      turnId: turn.turnId,
      kind: "input",
      status: "open",
      payload: { kind: "input", questions },
    }
    openRequests.set(opened.id, { request: opened, fields })
    withSource(`request-${opened.id}`, () =>
      emit({
        type: "request.opened",
        data: { request: opened },
        turnId: turn.turnId,
      })
    )
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

  const cancelRequest = (requestId: string): void => {
    const open = openRequests.get(requestId)
    if (!open) return
    openRequests.delete(requestId)
    emit({
      type: "request.cancelled",
      data: { request: { ...open.request, status: "cancelled" } },
      turnId: open.request.turnId,
    })
  }

  const cancelRequests = (): void => {
    for (const requestId of openRequests.keys()) cancelRequest(requestId)
  }

  const settle = (
    type: "turn.completed" | "turn.interrupted" | "turn.failed",
    error?: AideError
  ): void => {
    const turn = active
    if (!turn || turn.settled) return
    if (observedCursor !== undefined) {
      native.resumeCursor = String(observedCursor)
    }
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

  const notice = (
    turn: ActiveTurn,
    title: string,
    message: string,
    level: "info" | "warning" | "error" = "warning"
  ): void => {
    emit({
      type: "notice.created",
      data: { title, message, level },
      turnId: turn.turnId,
    })
  }

  /** Durable history: parts, tool lifecycle, and the turn's terminal state. */
  const handleLogEvent = (event: LogEvent): void => {
    const turn = active
    switch (event.type) {
      case "session.execution.started":
        if (turn && !turn.settled) turn.executing = true
        return
      case "session.step.started":
        if (!turn || turn.settled || !turn.executing) return
        turn.nativeAssistantMessageIds.add(event.data.assistantMessageID)
        return
      case "session.text.started":
      case "session.text.ended": {
        const owner = turnFor(event.data.assistantMessageID)
        if (!owner) return
        upsertPart(
          owner,
          `text-${event.data.assistantMessageID}-${event.data.ordinal}`,
          {
            messageId: owner.assistantMessageId,
            type: "text",
            text: event.type === "session.text.ended" ? event.data.text : "",
          }
        )
        return
      }
      case "session.reasoning.started":
      case "session.reasoning.ended": {
        const owner = turnFor(event.data.assistantMessageID)
        if (!owner) return
        upsertPart(
          owner,
          `reasoning-${event.data.assistantMessageID}-${event.data.ordinal}`,
          {
            messageId: owner.assistantMessageId,
            type: "reasoning",
            text:
              event.type === "session.reasoning.ended" ? event.data.text : "",
          }
        )
        return
      }
      case "session.tool.input.started": {
        const owner = turnFor(event.data.assistantMessageID)
        if (!owner) return
        owner.toolNames.set(event.data.id, event.data.name)
        if (event.data.name.toLowerCase() === SUBAGENT_TOOL) {
          owner.subagentCalls.add(event.data.id)
          agentPart(owner, event.data.id, { status: "running" })
          return
        }
        toolPart(owner, event.data.id, { status: "pending" })
        return
      }
      case "session.tool.called": {
        const owner = turnFor(event.data.assistantMessageID)
        if (!owner) return
        if (owner.subagentCalls.has(event.data.id)) {
          agentPart(owner, event.data.id, {
            status: "running",
            input: event.data.input,
          })
          return
        }
        toolPart(owner, event.data.id, {
          status: "running",
          input: event.data.input,
        })
        return
      }
      case "session.tool.success":
      case "session.tool.failed": {
        const owner = turnFor(event.data.assistantMessageID)
        if (!owner) return
        const content = event.data.content ?? []
        const text = content
          .flatMap((entry) => (entry.type === "text" ? [entry.text] : []))
          .join("\n")
        if (owner.subagentCalls.has(event.data.id)) {
          agentPart(owner, event.data.id, {
            status:
              event.type === "session.tool.success" ? "completed" : "failed",
            summary:
              event.type === "session.tool.failed"
                ? event.data.error.message
                : text,
          })
          return
        }
        toolPart(owner, event.data.id, {
          status:
            event.type === "session.tool.success" ? "completed" : "failed",
          output:
            event.type === "session.tool.failed"
              ? event.data.error.message
              : text,
        })
        for (const [index, entry] of content.entries()) {
          if (entry.type !== "file") continue
          upsertPart(owner, `file-${event.data.id}-${index}`, {
            messageId: owner.assistantMessageId,
            type: "file",
            path: filePath(entry.uri),
            mime: entry.mime,
          })
        }
        return
      }
      case "session.retry.scheduled": {
        const owner = turnFor(event.data.assistantMessageID)
        if (!owner) return
        notice(
          owner,
          "OpenCode is retrying",
          `Retrying the model request (attempt ${event.data.attempt}).`
        )
        return
      }
      case "session.step.ended":
      case "session.step.failed": {
        const owner = turnFor(event.data.assistantMessageID)
        if (!owner) return
        addUsage(owner, event.data)
        return
      }
      case "session.compaction.started":
        if (!turn || turn.settled) return
        notice(
          turn,
          "Compacting context",
          "OpenCode is compacting its context."
        )
        return
      case "session.compaction.ended":
        if (!turn || turn.settled) return
        notice(
          turn,
          "Context compacted",
          "OpenCode compacted its context. Compaction is harness-private; the Aide transcript is unchanged.",
          "info"
        )
        return
      case "session.compaction.failed":
        if (!turn || turn.settled) return
        notice(
          turn,
          "Compaction failed",
          "OpenCode could not compact its context."
        )
        return
      case "session.execution.succeeded":
        if (!turn || !turn.executing) return
        reportUsage(turn)
        settle(turn.interrupting ? "turn.interrupted" : "turn.completed")
        return
      case "session.execution.interrupted":
        if (!turn || !turn.executing) return
        reportUsage(turn)
        settle("turn.interrupted")
        return
      case "session.execution.failed": {
        if (!turn || !turn.executing) return
        reportUsage(turn)
        if (turn.interrupting) {
          settle("turn.interrupted")
          return
        }
        const error: AideError = {
          code: "opencode_session_error",
          message: event.data.error.message,
          instanceId,
          retryable: false,
          detail: event.data.error,
        }
        emit({ type: "error.occurred", data: { error }, turnId: turn.turnId })
        settle("turn.failed", error)
        return
      }
      default:
        return
    }
  }

  /** Live-only events: deltas, requests, and status the log does not keep. */
  const handleLiveEvent = (event: OpencodeLiveEvent): void => {
    switch (event.type) {
      case "session.text.delta":
      case "session.reasoning.delta":
      case "session.tool.input.delta": {
        if (suppressDeltas || event.data.sessionID !== session.id) return
        const turn = active
        if (!turn || turn.settled) return
        // Deltas race the log stream; the first one may precede step.started.
        turn.nativeAssistantMessageIds.add(event.data.assistantMessageID)
        const nativeId =
          event.type === "session.tool.input.delta"
            ? `tool-${event.data.id}`
            : event.type === "session.text.delta"
              ? `text-${event.data.assistantMessageID}-${event.data.ordinal}`
              : `reasoning-${event.data.assistantMessageID}-${event.data.ordinal}`
        const field =
          event.type === "session.tool.input.delta"
            ? "input"
            : event.type === "session.text.delta"
              ? "text"
              : "reasoning"
        if (!turn.parts.has(nativeId)) {
          if (field === "input") return
          upsertPart(turn, nativeId, {
            messageId: turn.assistantMessageId,
            type: field,
            text: "",
          })
        }
        const partId = `${turn.turnId}-${nativeId}`
        emit({
          type: "part.delta",
          data: {
            partId,
            messageId: turn.assistantMessageId,
            field,
            text: event.data.delta,
          },
          turnId: turn.turnId,
          messageId: turn.assistantMessageId,
          partId,
          ephemeral: true,
        })
        return
      }
      case "permission.asked":
        if (event.data.sessionID !== session.id) return
        openPermission(event.data)
        return
      case "permission.replied":
        if (event.data.sessionID !== session.id) return
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
      case "form.created":
        if (event.data.form.sessionID !== session.id) return
        openForm(event.data.form as OpencodeForm)
        return
      case "form.replied": {
        if (event.data.sessionID !== session.id) return
        const open = openRequests.get(event.data.id)
        if (!open?.fields) return
        resolveRequest(
          event.data.id,
          toInputResolution(open.fields, event.data.answer)
        )
        return
      }
      case "form.cancelled":
        if (event.data.sessionID !== session.id) return
        cancelRequest(event.data.id)
        return
      case "session.status": {
        const turn = active
        if (!turn || turn.settled || event.data.sessionID !== session.id) return
        if (event.data.status.type !== "retry") return
        notice(turn, "OpenCode is retrying", event.data.status.message)
        return
      }
      default:
        return
    }
  }

  const streamAbort = new AbortController()
  const fail = (error: unknown): void => {
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

  let logStream: AsyncIterable<OpencodeLogEvent>
  let liveStream: AsyncIterable<OpencodeLiveEvent>
  try {
    liveStream = api.event.subscribe({ signal: streamAbort.signal })
    logStream = api.session.log(
      {
        sessionID: session.id,
        ...(observedCursor === undefined ? {} : { after: observedCursor }),
        follow: true,
      },
      { signal: streamAbort.signal }
    )
  } catch (error) {
    throw runtimeError(
      "opencode_event_stream_failed",
      `Could not subscribe to OpenCode session "${session.id}"`,
      instanceId,
      true,
      errorDetail(error)
    )
  }

  /**
   * Durable events arrive on both streams: the log replays history and, when
   * the host persists events, follows new ones; the live stream carries every
   * new one whether or not the host persists. Each stream is complete and in
   * order from where it starts, so a sequence number at or below the last one
   * handled is a duplicate from the other stream.
   */
  const handleDurable = (event: LogEvent): void => {
    if (event.data.sessionID !== session.id) return
    if (observedCursor !== undefined && event.durable.seq <= observedCursor) {
      return
    }
    observedCursor = event.durable.seq
    withSource(event.id, () => handleLogEvent(event))
  }

  // Live durable events wait for the log's replay, so a reattached turn sees
  // history before anything newer.
  let replayed = false
  const heldBack: LogEvent[] = []
  const finishReplay = (): void => {
    if (replayed) return
    replayed = true
    heldBack.sort((left, right) => left.durable.seq - right.durable.seq)
    for (const event of heldBack.splice(0)) handleDurable(event)
  }

  const logReader = (async () => {
    try {
      for await (const event of logStream) {
        if (closed) return
        if (isLogEvent(event)) handleDurable(event)
        else finishReplay()
      }
    } catch {
      // Without a log, the live stream still carries new durable events.
      finishReplay()
    }
  })()
  const liveReader = (async () => {
    try {
      for await (const event of liveStream) {
        if (closed) return
        if (isDurable(event)) {
          if (replayed) handleDurable(event)
          else heldBack.push(event)
          continue
        }
        withSource(event.id, () => handleLiveEvent(event))
      }
    } catch (error) {
      fail(error)
    }
  })()

  // Permissions and forms are live-only. A reattached turn re-reads whatever
  // is still waiting on the user rather than stranding it.
  if (active) {
    const [permissions, forms] = await Promise.all([
      api.permission.list({ sessionID: session.id }).catch(() => []),
      api.session.form.list({ sessionID: session.id }).catch(() => []),
    ])
    for (const request of permissions) openPermission(request)
    for (const form of forms) openForm(form)
  }

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
      const running = await call(
        () => api.session.active(),
        "active_session_check_failed",
        `OpenCode could not inspect active session "${session.id}"`,
        instanceId,
        true
      )
      return running[session.id] ? turn.turnId : undefined
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
      await call(
        () => api.session.switchModel({ sessionID: session.id, model }),
        "model_switch_failed",
        `OpenCode could not switch session "${session.id}" to ${model.providerID}/${model.id}`,
        instanceId
      )
      // OpenCode 2 has no "no agent" state; without a selection the session
      // keeps the agent it already has.
      if (agent) {
        await call(
          () => api.session.switchAgent({ sessionID: session.id, agent }),
          "agent_switch_failed",
          `OpenCode could not switch session "${session.id}" to agent "${agent}"`,
          instanceId
        )
      }

      const selected = await call(
        () => api.session.get({ sessionID: session.id }),
        "session_inspection_failed",
        `OpenCode could not inspect session "${session.id}" after selection changes`,
        instanceId,
        true
      )
      if (
        !sameModel(selected.model, model) ||
        (agent !== undefined && selected.agent !== agent)
      ) {
        throw runtimeError(
          "session_selection_mismatch",
          `OpenCode session "${session.id}" did not retain the requested model and agent`,
          instanceId,
          false,
          {
            expected: { model, agent },
            actual: { model: selected.model, agent: selected.agent },
          }
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
        toolNames: new Map(),
        subagentCalls: new Set(),
        usage: undefined,
        executing: false,
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

      const { text, arguments: args } = messageText(input.userMessage)
      const invocation = input.userMessage.invocation
      const prefix = input.handoff?.content
      const files = input.userMessage.parts
        .filter((part) => part.type === "file")
        .map((part) => {
          const path = isAbsolute(part.path)
            ? part.path
            : resolve(projectDirectory, part.path)
          return { uri: pathToFileURL(path).href, name: basename(path) }
        })
      // A restart replays from here: everything after this cursor is this turn.
      if (observedCursor !== undefined) {
        native.resumeCursor = String(observedCursor)
      }
      try {
        if (invocation?.kind === "command") {
          // A command takes only its arguments, so earlier history goes in
          // first as context that starts no execution of its own.
          if (prefix) {
            await api.session.synthetic({
              sessionID: session.id,
              text: prefix,
              description: "Conversation so far, handed over by Aide",
              resume: false,
            })
          }
          await api.session.command({
            sessionID: session.id,
            name: invocation.name,
            text: args,
            ...(files.length > 0 ? { files } : {}),
            delivery: "queue",
          })
        } else {
          const body = invocation ? args : text
          await api.session.prompt({
            sessionID: session.id,
            id: nativeMessageId(input.userMessage.id),
            text: prefix ? `${prefix}\n\n${body}` : body,
            ...(files.length > 0 ? { files } : {}),
            ...(invocation?.kind === "skill"
              ? { skills: [{ id: invocation.name }] }
              : {}),
            delivery: "queue",
          })
        }
      } catch (error) {
        active = undefined
        throw runtimeError(
          "prompt_admission_failed",
          `OpenCode did not admit prompt "${input.userMessage.id}"`,
          instanceId,
          true,
          errorDetail(error)
        )
      }

      void api.session.wait({ sessionID: session.id }).catch((error) => {
        settle("turn.failed", {
          code: "opencode_wait_failed",
          message: error instanceof Error ? error.message : String(error),
          instanceId,
          retryable: true,
        })
      })
    },

    async compact() {
      if (closed) {
        throw runtimeError(
          "native_session_closed",
          `OpenCode session "${session.id}" is closed`,
          instanceId
        )
      }
      if (active && !active.settled) {
        throw runtimeError(
          "session_busy",
          `OpenCode session "${session.id}" is running a turn; compact between turns`,
          instanceId
        )
      }
      await call(
        () => api.session.compact({ sessionID: session.id }),
        "compaction_failed",
        `OpenCode could not compact session "${session.id}"`,
        instanceId,
        true
      )
      await call(
        () => api.session.wait({ sessionID: session.id }),
        "compaction_failed",
        `OpenCode did not finish compacting session "${session.id}"`,
        instanceId,
        true
      )
    },

    async steer(turnId, message) {
      const turn = active
      if (!turn || turn.turnId !== turnId || turn.settled) {
        throw runtimeError(
          "turn_not_active",
          `OpenCode turn "${turnId}" is not running, so it cannot be steered`,
          instanceId
        )
      }
      await call(
        () =>
          api.session.prompt({
            sessionID: session.id,
            id: nativeMessageId(message.id),
            text: messageText(message).text,
            delivery: "steer",
          }),
        "steer_failed",
        `OpenCode did not accept the steering message for turn "${turnId}"`,
        instanceId,
        true
      )
    },

    async interrupt(turnId) {
      const turn = active
      if (!turn || turn.turnId !== turnId || turn.settled) return
      turn.interrupting = true
      const pending = [...openRequests.values()]
      try {
        await call(
          () => api.session.interrupt({ sessionID: session.id }),
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
            ? api.session.form
                .cancel({ sessionID: session.id, formID: open.request.id })
                .catch(() => undefined)
            : api.permission
                .reply({
                  sessionID: session.id,
                  requestID: open.request.id,
                  decision: "reject",
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
      const decision =
        resolution.optionId === "allow"
          ? "once"
          : resolution.optionId === "allow_always"
            ? "always"
            : resolution.optionId === "deny"
              ? "reject"
              : undefined
      if (!decision) {
        throw runtimeError(
          "invalid_resolution",
          `Option "${resolution.optionId}" was not offered for request "${request.id}"`,
          instanceId
        )
      }
      await call(
        () =>
          api.permission.reply({
            sessionID: session.id,
            requestID: request.id,
            decision,
            ...(decision === "reject"
              ? { message: "Denied by the Aide user." }
              : {}),
          }),
        "permission_reply_failed",
        `OpenCode did not accept permission response "${request.id}"`,
        instanceId,
        true
      )
      resolveRequest(request.id, resolution)
    },

    async respondToInput(request) {
      const open = openRequests.get(request.id)
      if (!open || open.request.kind !== "input" || !open.fields) {
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
      const answer: Record<string, string | number | boolean | string[]> = {}
      for (const question of questions) {
        const field = open.fields.get(question.id)
        const given = resolution.answers[question.id]
        if (!field) continue
        if (!given) {
          if (!field.required) continue
          throw runtimeError(
            "invalid_resolution",
            `Question "${question.id}" requires an answer`,
            instanceId
          )
        }
        if (
          given.optionIds?.some(
            (id) => !question.options?.some((option) => option.id === id)
          )
        ) {
          throw runtimeError(
            "invalid_resolution",
            `Question "${question.id}" has an invalid option`,
            instanceId
          )
        }
        const values = [
          ...(given.optionIds ?? []),
          ...(given.text === undefined ? [] : [given.text]),
        ]
        switch (field.type) {
          case "multiselect":
            answer[question.id] = values
            break
          case "boolean":
            answer[question.id] = values[0] === "true"
            break
          case "number":
          case "integer": {
            const value = Number(values[0])
            if (!Number.isFinite(value)) {
              throw runtimeError(
                "invalid_resolution",
                `Question "${question.id}" requires a number`,
                instanceId
              )
            }
            answer[question.id] = value
            break
          }
          case "string":
            answer[question.id] = values.join("\n")
            break
        }
      }
      await call(
        () =>
          api.session.form.reply({
            sessionID: session.id,
            formID: request.id,
            answer,
          }),
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
      void logReader.catch(() => undefined)
      void liveReader.catch(() => undefined)
      bus.close()
    },
  }

  return runtime
}
