import type {
  AideError,
  AideEvent,
  InputQuestion,
  InputResolution,
  Request,
  ResolvedExecution,
  SelectOption,
  Turn,
  UserMessage,
} from "@workspace/contracts"

import { pathsOutsideBoundary } from "../../workspace/paths"
import { createEventBus, type EventBus } from "../event-bus"
import type { NativeDispatchInput } from "@workspace/contracts"
import {
  INTERACTION_MODE_TO_PERMISSION_MODE,
  type ClaudeInstanceConfig,
} from "./config"
import { createPartSynthesizer, type PartSynthesizer } from "./parts"
import type {
  ClaudeDialogAsk,
  ClaudeDialogResult,
  ClaudePermissionAsk,
  ClaudePermissionDecision,
  ClaudePermissionMode,
  ClaudeSession,
  ClaudeSessionFactory,
  ClaudeStreamMessage,
} from "./query"

/**
 * One Aide session's live query, and everything that has to be true while it
 * runs a turn.
 *
 * Three things live here that have nowhere else to go:
 *
 * - **Permission inversion.** `canUseTool` is a blocking async callback that
 *   must *return* a decision, so the runtime opens a `Request`, publishes it,
 *   and then parks an unresolved promise across a browser round trip. Every
 *   exit — a response, an interrupt, a closed query — has to resolve it, or the
 *   harness blocks forever.
 * - **The effort reopen.** Effort is a query-creation option with no setter in
 *   the pinned SDK. Changing it means closing the query and opening a new one
 *   against the same native session, and refusing to do that mid-turn.
 * - **Part synthesis ownership.** The synthesizer is per turn, because part ids
 *   are scoped to the assistant message the turn produces.
 */

/**
 * `scope.projectId` is required by the event schema, but the adapter seam
 * carries no project id. The core rewrites the whole scope when it normalizes,
 * so this placeholder never reaches a client.
 */
const ADAPTER_PROJECT_ID = "adapter-local"

const DENY_ON_INTERRUPT = "Denied: the turn was interrupted."
const DENY_ON_CLOSE = "Denied: the Claude query closed before you responded."

export class ClaudeRuntimeFailure extends Error {
  readonly aideError: AideError

  constructor(aideError: AideError) {
    super(aideError.message)
    this.name = "ClaudeRuntimeFailure"
    this.aideError = aideError
  }
}

type PendingPermission = {
  requestId: string
  suggestions?: unknown[]
  resolve: (decision: ClaudePermissionDecision) => void
}

type PendingDialog = {
  requestId: string
  resolve: (result: ClaudeDialogResult) => void
}

type ActiveTurn = {
  turnId: string
  assistantMessageId: string
  turnRow: Turn
  synth: PartSynthesizer
  settled: boolean
  interrupted: boolean
}

type TurnOutcome = "none" | "completed" | "interrupted" | "failed"

type SessionEventShape = {
  type: AideEvent["type"]
  data: unknown
  turnId?: string
  messageId?: string
  partId?: string
  ephemeral?: boolean
}

export type ClaudeRuntimeOptions = {
  instanceId: string
  aideSessionId: string
  /** UUID pinned as the native session id, known before the first turn. */
  nativeSessionId: string
  projectDirectory: string
  config: ClaudeInstanceConfig
  createSession: ClaudeSessionFactory
  startupTimeoutMs: number
  execution: ResolvedExecution
  mcpServers?: Record<string, unknown>
  now: () => string
  nextId: (prefix: string) => string
  /**
   * Called the first time a turn reports the runtime version. The handshake
   * carries none, so this is the only place it becomes knowable. Returns an
   * explanation when the version is incompatible, and nothing when it is fine.
   */
  onVersion?: (version: string) => string | undefined
  /** Resume an existing native session instead of starting a new one. */
  resume?: { resumeSessionAt?: string; fork?: boolean }
}

export type ClaudeRuntime = {
  readonly nativeSessionId: string
  readonly resumeCursor: string | undefined
  readonly bus: EventBus
  activeTurnId(): string | undefined
  send(input: {
    turnId: string
    commandId: string
    userMessage: UserMessage
    execution: ResolvedExecution
    handoff?: NativeDispatchInput
  }): Promise<void>
  interrupt(turnId: string): Promise<void>
  respondToPermission(request: Request): void
  respondToInput(request: Request): void
  setMcpServers(servers: Record<string, unknown>): Promise<void>
  close(): Promise<void>
}

function runtimeError(
  code: string,
  message: string,
  instanceId: string,
  retryable = false,
  detail?: unknown
): ClaudeRuntimeFailure {
  return new ClaudeRuntimeFailure({
    code,
    message,
    instanceId,
    retryable,
    ...(detail === undefined ? {} : { detail }),
  })
}

function permissionModeFor(execution: ResolvedExecution): ClaudePermissionMode {
  const mode = execution.selection.interactionMode
  if (mode && mode in INTERACTION_MODE_TO_PERMISSION_MODE) {
    return INTERACTION_MODE_TO_PERMISSION_MODE[
      mode as keyof typeof INTERACTION_MODE_TO_PERMISSION_MODE
    ]
  }
  return "default"
}

function effortFor(execution: ResolvedExecution): string | undefined {
  return execution.selection.options.effort
}

/**
 * Tool-input keys that name a filesystem path. Which keys those are is
 * Claude-specific, so this lives here rather than in the shared check.
 */
const PATH_INPUT_KEYS = ["file_path", "path", "notebook_path", "cwd"] as const

/**
 * Path-shaped literals in a shell command.
 *
 * Extraction, not shell parsing: it finds absolute and `~`-rooted literals and
 * ignores everything else. It therefore cannot see a path built from a
 * variable, an expansion, or a `cd` earlier in the pipeline — so its silence is
 * not a guarantee.
 *
 * It is still worth doing, because the redirect (`… > ~/notes.txt`) is how a
 * write actually leaves the project in practice, and the failure modes are
 * asymmetric: this only ever annotates a prompt a human is already reviewing,
 * so naming a harmless path costs a glance while missing one costs the file.
 */
const SHELL_PATH_PATTERN = /(?:~|\.{1,2})?\/[^\s'"`|;&<>()$]+/g

export function shellCommandPaths(command: string): string[] {
  const found = command.match(SHELL_PATH_PATTERN) ?? []
  const paths: string[] = []
  for (const raw of found) {
    // Trailing punctuation is sentence noise, not part of the path.
    const trimmed = raw.replace(/[.,;:]+$/, "")
    if (trimmed.length > 1 && !paths.includes(trimmed)) paths.push(trimmed)
  }
  return paths
}

export function toolInputPaths(input: Record<string, unknown>): string[] {
  const paths: string[] = []
  for (const key of PATH_INPUT_KEYS) {
    const value = input[key]
    if (typeof value === "string" && value.length > 0) paths.push(value)
  }
  if (typeof input.command === "string") {
    paths.push(...shellCommandPaths(input.command))
  }
  return paths
}

/**
 * Edit and Write carry their intended change in the tool input, which is the
 * only place a reviewable diff can come from before the tool has run.
 */
export function permissionDiff(
  toolName: string,
  input: Record<string, unknown>
): string | undefined {
  const oldString = input.old_string
  const newString = input.new_string
  if (typeof oldString === "string" && typeof newString === "string") {
    const removed = oldString.split("\n").map((line) => `- ${line}`)
    const added = newString.split("\n").map((line) => `+ ${line}`)
    return [...removed, ...added].join("\n")
  }
  if (toolName === "Write" && typeof input.content === "string") {
    return input.content
      .split("\n")
      .map((line) => `+ ${line}`)
      .join("\n")
  }
  return undefined
}

/**
 * Dialog payloads are per-kind and transported opaquely, so this reads the
 * shapes it recognizes and reports nothing for the rest. An unrecognized kind
 * must be answered `cancelled` rather than guessed at — the SDK says so, and a
 * guess would answer a question the user never saw.
 */
export function normalizeDialogQuestions(
  ask: ClaudeDialogAsk
): InputQuestion[] | undefined {
  const payload = ask.payload
  const raw = payload.questions
  if (Array.isArray(raw) && raw.length > 0) {
    const questions = raw
      .map((entry, position) => toQuestion(entry, position))
      .filter((entry): entry is InputQuestion => entry !== undefined)
    return questions.length > 0 ? questions : undefined
  }
  const single = toQuestion(payload, 0)
  return single ? [single] : undefined
}

function toQuestion(
  value: unknown,
  position: number
): InputQuestion | undefined {
  if (!value || typeof value !== "object") return undefined
  const entry = value as Record<string, unknown>
  const prompt =
    firstString(entry.prompt) ??
    firstString(entry.question) ??
    firstString(entry.message) ??
    firstString(entry.title)
  if (!prompt) return undefined
  const options = toOptions(entry.options ?? entry.choices)
  const allowMultiple =
    entry.allowMultiple === true || entry.multiSelect === true
  const allowFreeText = options.length === 0 || entry.allowFreeText === true
  return {
    id: firstString(entry.id) ?? `question-${position}`,
    prompt,
    ...(firstString(entry.header)
      ? { header: firstString(entry.header)! }
      : {}),
    ...(options.length > 0 ? { options } : {}),
    allowMultiple,
    allowFreeText,
    ...(entry.multiline === true ? { multiline: true } : {}),
  }
}

function toOptions(value: unknown): SelectOption[] {
  if (!Array.isArray(value)) return []
  const options: SelectOption[] = []
  for (const [position, entry] of value.entries()) {
    if (typeof entry === "string") {
      options.push({ id: entry, label: entry })
      continue
    }
    if (!entry || typeof entry !== "object") continue
    const record = entry as Record<string, unknown>
    const id = firstString(record.id) ?? firstString(record.value)
    const label = firstString(record.label) ?? firstString(record.name) ?? id
    if (!id || !label) continue
    options.push({
      id,
      label,
      ...(record.isDefault === true || position === -1
        ? { isDefault: true }
        : {}),
    })
  }
  return options
}

function firstString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export async function createClaudeRuntime(
  options: ClaudeRuntimeOptions
): Promise<ClaudeRuntime> {
  const {
    instanceId,
    aideSessionId,
    nativeSessionId,
    projectDirectory,
    config,
    createSession,
    startupTimeoutMs,
    now,
    nextId,
  } = options

  const bus = createEventBus()
  const openRequests = new Map<string, Request>()
  const pendingPermissions = new Map<string, PendingPermission>()
  const pendingDialogs = new Map<string, PendingDialog>()

  let durableSeq = 0
  let streamOrdinal = 0
  let turnSeq = 0
  let active: ActiveTurn | undefined
  let lastOutcome: TurnOutcome = "none"
  let lastAssistantUuid: string | undefined
  let closed = false

  let model = options.execution.selection.model.modelId
  let permissionMode = permissionModeFor(options.execution)
  let effort = effortFor(options.execution)
  let mcpServers = options.mcpServers

  const emit = (shape: SessionEventShape): void => {
    const event = {
      schemaVersion: 1,
      eventId: `${instanceId}-${nextId("evt")}`,
      timestamp: now(),
      delivery: shape.ephemeral
        ? { durable: false, streamOrdinal: streamOrdinal++ }
        : { durable: true, sequence: durableSeq++ },
      scope: {
        kind: "session",
        projectId: ADAPTER_PROJECT_ID,
        sessionId: aideSessionId,
        ...(shape.turnId ? { turnId: shape.turnId } : {}),
        ...(shape.messageId ? { messageId: shape.messageId } : {}),
        ...(shape.partId ? { partId: shape.partId } : {}),
      },
      instanceId,
      driver: "claudeAgent",
      type: shape.type,
      data: shape.data,
    } as AideEvent
    bus.publish(event)
  }

  const notice = (
    title: string,
    message: string,
    level: "info" | "warning" | "error" = "info"
  ): void => {
    emit({
      type: "notice.created",
      data: { title, message, level },
      ...(active ? { turnId: active.turnId } : {}),
    })
  }

  const publishParts = (parts: { id: string; messageId: string }[]): void => {
    if (!active) return
    for (const part of parts) {
      emit({
        type: "part.upserted",
        data: { part },
        turnId: active.turnId,
        messageId: active.assistantMessageId,
        partId: part.id,
      })
    }
  }

  /**
   * The single exit for an unanswered request. Both the interrupt path and the
   * SDK's own abort signal come through here, so a request is never dropped
   * without a `request.cancelled` and its parked promise is never left unsettled.
   */
  const cancelRequest = (requestId: string, reason: string): void => {
    const request = openRequests.get(requestId)
    const permission = pendingPermissions.get(requestId)
    const dialog = pendingDialogs.get(requestId)
    openRequests.delete(requestId)
    pendingPermissions.delete(requestId)
    pendingDialogs.delete(requestId)
    if (request) {
      emit({
        type: "request.cancelled",
        data: { request: { ...request, status: "cancelled" } },
        turnId: request.turnId,
      })
    }
    permission?.resolve({ behavior: "deny", message: reason })
    dialog?.resolve({ behavior: "cancelled" })
  }

  const cancelOpenRequests = (reason: string): void => {
    for (const requestId of [
      ...openRequests.keys(),
      ...pendingPermissions.keys(),
      ...pendingDialogs.keys(),
    ]) {
      cancelRequest(requestId, reason)
    }
  }

  const settle = (
    type: "turn.completed" | "turn.interrupted" | "turn.failed",
    error?: AideError
  ): void => {
    const turn = active
    if (!turn || turn.settled) return
    turn.settled = true
    const status =
      type === "turn.completed"
        ? "completed"
        : type === "turn.interrupted"
          ? "interrupted"
          : "failed"
    lastOutcome = status
    emit({
      type,
      data: {
        turn: {
          ...turn.turnRow,
          status,
          endedAt: now(),
          ...(error ? { error } : {}),
        },
      },
      turnId: turn.turnId,
    })
    active = undefined
  }

  const canUseTool = async (
    ask: ClaudePermissionAsk
  ): Promise<ClaudePermissionDecision> => {
    const turn = active
    if (!turn || turn.settled) {
      return { behavior: "deny", message: DENY_ON_INTERRUPT }
    }
    const requestId = `${turn.turnId}-${nextId("perm")}`
    const options: SelectOption[] = [
      { id: "allow", label: "Allow", isDefault: true },
      ...(ask.suggestions && ask.suggestions.length > 0
        ? [{ id: "allow_always", label: "Always allow" }]
        : []),
      { id: "deny", label: "Deny" },
    ]
    const diff = permissionDiff(ask.toolName, ask.input)
    // A tool reaching outside the project is the thing a reviewer most needs
    // to notice, and the least likely to spot in a path buried in prose.
    const outsidePaths = await pathsOutsideBoundary(
      projectDirectory,
      toolInputPaths(ask.input)
    ).catch(() => [])
    const request: Request = {
      id: requestId,
      sessionId: aideSessionId,
      turnId: turn.turnId,
      kind: "permission",
      status: "open",
      payload: {
        kind: "permission",
        toolName: ask.toolName,
        title: ask.title ?? `Allow ${ask.displayName ?? ask.toolName}?`,
        ...(ask.description ? { detail: ask.description } : {}),
        ...(diff ? { diff } : {}),
        ...(outsidePaths.length > 0
          ? { boundary: { projectDirectory, outsidePaths } }
          : {}),
        options,
      },
    }
    // Published before the promise is parked, so a client that connects during
    // the round trip still sees an open request rather than a silent stall.
    openRequests.set(requestId, request)
    emit({
      type: "request.opened",
      data: { request },
      turnId: turn.turnId,
    })

    return new Promise<ClaudePermissionDecision>((resolve) => {
      const pending: PendingPermission = {
        requestId,
        ...(ask.suggestions ? { suggestions: ask.suggestions } : {}),
        resolve,
      }
      pendingPermissions.set(requestId, pending)
      if (ask.signal.aborted) {
        cancelRequest(requestId, DENY_ON_INTERRUPT)
        return
      }
      ask.signal.addEventListener(
        "abort",
        () => cancelRequest(requestId, DENY_ON_INTERRUPT),
        { once: true }
      )
    })
  }

  const onUserDialog = async (
    ask: ClaudeDialogAsk
  ): Promise<ClaudeDialogResult> => {
    const turn = active
    const questions = normalizeDialogQuestions(ask)
    if (!turn || turn.settled || !questions) return { behavior: "cancelled" }

    const requestId = `${turn.turnId}-${nextId("input")}`
    const request: Request = {
      id: requestId,
      sessionId: aideSessionId,
      turnId: turn.turnId,
      kind: "input",
      status: "open",
      payload: { kind: "input", questions },
    }
    openRequests.set(requestId, request)
    emit({
      type: "request.opened",
      data: { request },
      turnId: turn.turnId,
    })

    return new Promise<ClaudeDialogResult>((resolve) => {
      pendingDialogs.set(requestId, { requestId, resolve })
      if (ask.signal.aborted) {
        cancelRequest(requestId, DENY_ON_INTERRUPT)
        return
      }
      ask.signal.addEventListener(
        "abort",
        () => cancelRequest(requestId, DENY_ON_INTERRUPT),
        { once: true }
      )
    })
  }

  const open = async (input: {
    resume?: string
    resumeSessionAt?: string
    fork?: boolean
  }): Promise<ClaudeSession> =>
    createSession({
      config,
      cwd: projectDirectory,
      timeoutMs: startupTimeoutMs,
      // Pinning the id is what makes the native session addressable before the
      // first turn; the runtime otherwise reveals it only on `system/init`. A
      // resume names the session instead, and the SDK rejects setting both.
      ...(input.resume ? {} : { sessionId: nativeSessionId }),
      ...(model ? { model } : {}),
      permissionMode,
      ...(effort ? { effort } : {}),
      ...(input.resume ? { resume: input.resume } : {}),
      ...(input.resumeSessionAt
        ? { resumeSessionAt: input.resumeSessionAt }
        : {}),
      ...(input.fork ? { forkSession: true } : {}),
      ...(mcpServers ? { mcpServers } : {}),
      canUseTool,
      onUserDialog,
    })

  let session = await open({
    ...(options.resume ? { resume: nativeSessionId } : {}),
    ...(options.resume?.resumeSessionAt
      ? { resumeSessionAt: options.resume.resumeSessionAt }
      : {}),
    ...(options.resume?.fork ? { fork: true } : {}),
  })

  const handleMessage = (message: ClaudeStreamMessage): void => {
    const turn = active
    switch (message.type) {
      case "stream_event": {
        if (!turn || turn.settled) return
        const applied = turn.synth.applyStreamEvent(message.event)
        publishParts(applied.parts)
        if (applied.delta) {
          emit({
            type: "part.delta",
            data: {
              partId: applied.delta.partId,
              messageId: turn.assistantMessageId,
              field: applied.delta.field,
              text: applied.delta.text,
            },
            turnId: turn.turnId,
            messageId: turn.assistantMessageId,
            partId: applied.delta.partId,
            ephemeral: true,
          })
        }
        return
      }
      case "assistant": {
        if (!turn || turn.settled) return
        lastAssistantUuid = message.uuid
        const apiMessageId = message.message.id ?? message.uuid
        publishParts(
          turn.synth.applyAssistantMessage(
            apiMessageId,
            message.message.content ?? []
          )
        )
        return
      }
      case "user": {
        if (!turn || turn.settled) return
        const content = message.message.content
        if (!Array.isArray(content)) return
        publishParts(turn.synth.applyToolResults(content))
        return
      }
      case "result": {
        if (!turn || turn.settled) return
        if (message.is_error || message.subtype !== "success") {
          settle("turn.failed", {
            code: `claude_${message.subtype}`,
            message:
              message.errors?.join("; ") ??
              message.result ??
              `Claude reported ${message.subtype}`,
            instanceId,
            retryable: message.subtype === "error_during_execution",
          })
          return
        }
        settle("turn.completed")
        return
      }
      case "system": {
        switch (message.subtype) {
          case "init": {
            // The handshake carried no version; this message does, and it is
            // the first moment runtime compatibility can be checked at all.
            const version = message.claude_code_version
            if (!version) return
            const incompatible = options.onVersion?.(version)
            // The supervisor polls `health()` once at start, so a mismatch
            // found here would otherwise never reach anyone. The notice is
            // the one channel that reaches the user on a live turn.
            if (incompatible) notice("Runtime version", incompatible, "warning")
            return
          }
          case "status":
            // `requesting` fires on every API call in a turn — five times in a
            // short one — and tells the user nothing they cannot see from the
            // turn being in flight. Compaction is the status worth surfacing.
            if (message.status === "compacting") {
              notice("Compacting context", "Claude is compacting its context.")
            }
            return
          case "api_retry":
            notice(
              "Claude is retrying",
              `Retrying the API request (attempt ${message.attempt ?? 1} of ${
                message.max_retries ?? 1
              }).`,
              "warning"
            )
            return
          case "permission_denied":
            notice(
              "Tool call denied",
              `Claude was denied permission to run ${
                message.tool_name ?? "a tool"
              }.`,
              "warning"
            )
            return
          case "compact_boundary":
            notice(
              "Context compacted",
              `Claude compacted its context (${
                message.compact_metadata?.trigger ?? "auto"
              }). Compaction is harness-private; the Aide transcript is unchanged.`
            )
            return
          default:
            return
        }
      }
    }
  }

  /**
   * One pump per query. It is replaced wholesale on a reopen, and a query that
   * ends while a turn is running fails that turn rather than leaving the core
   * waiting on a stream that will never produce a terminal event.
   */
  const pump = (current: ClaudeSession): void => {
    void (async () => {
      try {
        for await (const message of current.messages()) {
          if (session !== current) return
          handleMessage(message)
        }
      } catch (error) {
        if (session !== current) return
        cancelOpenRequests(DENY_ON_CLOSE)
        settle("turn.failed", {
          code: "claude_stream_failed",
          message:
            error instanceof Error
              ? error.message
              : "The Claude message stream failed",
          instanceId,
          retryable: true,
        })
        return
      }
      if (session !== current || closed) return
      cancelOpenRequests(DENY_ON_CLOSE)
      settle("turn.failed", {
        code: "claude_stream_closed",
        message: "The Claude query closed before the turn reached a result",
        instanceId,
        retryable: true,
      })
    })()
  }

  pump(session)

  /**
   * Effort is fixed at query creation in the pinned SDK, so changing it means a
   * new query. Only ever called between turns — `send` refuses outright while
   * one is running, which is what keeps a swap from abandoning a live prompt.
   *
   * Resume keeps the conversation. When the previous turn did not end cleanly
   * the resume point cannot be trusted, so the caller's portable handoff packet
   * seeds a fresh query instead; with neither, the send fails rather than
   * running under a context Aide cannot vouch for.
   */
  const reopenForEffort = async (
    next: string | undefined,
    handoff: NativeDispatchInput | undefined
  ): Promise<"resumed" | { seed: string }> => {
    const resumable = lastOutcome === "none" || lastOutcome === "completed"
    if (!resumable && !handoff) {
      throw runtimeError(
        "effort_change_unsafe",
        `Reasoning effort changed after a turn ended as "${lastOutcome}", so the native session cannot be resumed safely and no handoff packet was provided to seed a new one`,
        instanceId
      )
    }

    // `open` reads `effort` from this closure, so the replacement query has to
    // see `next` before it is created. Roll that assignment back if the open
    // fails; otherwise a retry with the same requested effort would skip
    // reopening and run on the old session.
    const previousEffort = effort
    effort = next
    let replacement: ClaudeSession
    try {
      replacement = await open(
        resumable
          ? {
              resume: nativeSessionId,
              ...(lastAssistantUuid
                ? { resumeSessionAt: lastAssistantUuid }
                : {}),
            }
          : {}
      )
    } catch (error) {
      effort = previousEffort
      throw error
    }
    const previous = session
    session = replacement
    await previous.close().catch(() => undefined)
    pump(session)
    if (resumable) return "resumed"
    return { seed: handoff.content }
  }

  const runtime: ClaudeRuntime = {
    nativeSessionId,
    get resumeCursor() {
      return lastAssistantUuid
    },
    bus,

    activeTurnId() {
      return active && !active.settled && !active.interrupted
        ? active.turnId
        : undefined
    },

    async send(input) {
      if (closed) {
        throw runtimeError(
          "native_session_closed",
          `Claude session "${nativeSessionId}" is closed`,
          instanceId
        )
      }
      if (active && !active.settled) {
        throw runtimeError(
          "turn_already_running",
          `Claude session "${nativeSessionId}" is already running turn "${active.turnId}"`,
          instanceId
        )
      }

      let prefix = input.handoff?.content
      const nextEffort = effortFor(input.execution)
      if (nextEffort !== effort) {
        const reopened = await reopenForEffort(nextEffort, input.handoff)
        // A successful native resume already has the conversation; prepending
        // the portable packet would send it twice.
        prefix = reopened === "resumed" ? undefined : reopened.seed
      }

      const nextModel = input.execution.selection.model.modelId
      if (nextModel !== model) {
        await session.query.setModel(nextModel)
        model = nextModel
      }
      const nextMode = permissionModeFor(input.execution)
      if (nextMode !== permissionMode) {
        await session.query.setPermissionMode(nextMode)
        permissionMode = nextMode
      }

      const assistantMessageId = `${input.turnId}-assistant`
      const turnRow: Turn = {
        id: input.turnId,
        sessionId: aideSessionId,
        seq: turnSeq++,
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
        turnRow,
        synth: createPartSynthesizer(assistantMessageId),
        settled: false,
        interrupted: false,
      }

      emit({
        type: "turn.started",
        data: { turn: turnRow },
        turnId: input.turnId,
      })
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
      session.prompt(prefix ? `${prefix}\n\n${text}` : text)
    },

    async interrupt(turnId) {
      const turn = active
      if (!turn || turn.turnId !== turnId || turn.settled) return
      turn.interrupted = true
      try {
        await session.query.interrupt()
      } catch {
        // A runtime that cannot confirm the interrupt still leaves Aide
        // responsible for a terminal state, so the turn is settled regardless.
      }
      cancelOpenRequests(DENY_ON_INTERRUPT)
      settle("turn.interrupted")
    },

    respondToPermission(request) {
      const open = openRequests.get(request.id)
      const pending = pendingPermissions.get(request.id)
      if (!open || open.kind !== "permission" || !pending) {
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
      const option =
        open.payload.kind === "permission"
          ? open.payload.options.find(
              (entry) => entry.id === resolution.optionId
            )
          : undefined
      if (!option) {
        throw runtimeError(
          "invalid_resolution",
          `Option "${resolution.optionId}" was not offered for request "${request.id}"`,
          instanceId
        )
      }

      openRequests.delete(request.id)
      pendingPermissions.delete(request.id)
      const resolved: Request = { ...open, status: "resolved", resolution }
      emit({
        type: "request.resolved",
        data: { request: resolved },
        turnId: open.turnId,
      })

      if (resolution.optionId === "deny") {
        pending.resolve({
          behavior: "deny",
          message: "Denied by the Aide user.",
        })
        return
      }
      pending.resolve({
        behavior: "allow",
        ...(resolution.optionId === "allow_always" && pending.suggestions
          ? { updatedPermissions: pending.suggestions }
          : {}),
      })
    },

    respondToInput(request) {
      const open = openRequests.get(request.id)
      const pending = pendingDialogs.get(request.id)
      if (!open || open.kind !== "input" || !pending) {
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
        open.payload.kind === "input" ? open.payload.questions : []
      assertAnswerable(questions, resolution, instanceId)

      openRequests.delete(request.id)
      pendingDialogs.delete(request.id)
      const resolved: Request = { ...open, status: "resolved", resolution }
      emit({
        type: "request.resolved",
        data: { request: resolved },
        turnId: open.turnId,
      })
      // Dialog results are per-kind and opaque to the protocol, so the answers
      // are returned in the same normalized shape the questions were read from.
      pending.resolve({
        behavior: "completed",
        result: { answers: resolution.answers },
      })
    },

    async setMcpServers(servers) {
      mcpServers = servers
      await session.query.setMcpServers(servers)
    },

    async close() {
      if (closed) return
      closed = true
      cancelOpenRequests(DENY_ON_CLOSE)
      // A query that dies with a turn in flight must not leave the core waiting
      // on a terminal event that can no longer arrive.
      settle("turn.failed", {
        code: "native_session_closed",
        message: "The Claude session closed before the turn completed",
        instanceId,
        retryable: false,
      })
      await session.close().catch(() => undefined)
      bus.close()
    },
  }

  return runtime
}

function assertAnswerable(
  questions: InputQuestion[],
  resolution: InputResolution,
  instanceId: string
): void {
  for (const [questionId, answer] of Object.entries(resolution.answers)) {
    const question = questions.find((entry) => entry.id === questionId)
    if (!question) {
      throw runtimeError(
        "invalid_resolution",
        `Unknown question id "${questionId}"`,
        instanceId
      )
    }
    if (
      answer.optionIds &&
      !answer.optionIds.every((optionId) =>
        (question.options ?? []).some((option) => option.id === optionId)
      )
    ) {
      throw runtimeError(
        "invalid_resolution",
        `Invalid option for question "${questionId}"`,
        instanceId
      )
    }
    if (!answer.optionIds && answer.text === undefined) {
      throw runtimeError(
        "invalid_resolution",
        `Question "${questionId}" needs optionIds or text`,
        instanceId
      )
    }
  }
}
