import { query } from "@anthropic-ai/claude-agent-sdk"

import type { ClaudeInstanceConfig } from "./config"

/**
 * The SDK boundary, plus the streaming-input query lifecycle.
 *
 * Every instance runs in streaming input mode — `query({ prompt:
 * AsyncIterable<SDKUserMessage>, options })` — because the control methods
 * (`interrupt`, `setModel`, `setPermissionMode`, and the inventory methods) only
 * exist there. That also makes inventory runtime-scoped: `supportedModels()` and
 * `supportedAgents()` are methods on a live `Query`, not free functions, so the
 * adapter must hold a live query open just to answer `discover`.
 *
 * The types below are deliberately narrower than the SDK's: they name exactly
 * the fields the adapter reads, which keeps the test doubles honest and makes
 * an SDK upgrade a compile error here rather than a behavior change three files
 * away. Content blocks and stream frames are open sets upstream, so they are
 * modeled as bags of optional fields rather than a closed union.
 *
 * This file and its siblings are the only place the Claude Agent SDK may be
 * imported; the S0.10 lint rule makes a leak a build failure.
 */

export type ClaudeModelInfo = {
  value: string
  displayName: string
  description?: string
  supportsEffort?: boolean
  supportedEffortLevels?: string[]
}

export type ClaudeAgentInfo = {
  name: string
  description?: string
}

export type ClaudeMcpServerStatus = {
  name: string
  status: string
}

export type ClaudeAccountInfo = {
  email?: string
  organization?: string
  subscriptionType?: string
  tokenSource?: string
  apiKeySource?: string
  apiProvider?: string
}

/**
 * What the runtime reports before any turn has run.
 *
 * Deliberately missing a version: `initializationResult()` does not carry one,
 * and the `system/init` *message* that does is only emitted once a turn starts.
 * The adapter learns it on the first turn instead of blocking start on a fact
 * the runtime will not give it.
 */
export type ClaudeInitInfo = {
  /** The id this session was pinned to, so it is known before the first turn. */
  sessionId: string
  /** The model alias the account resolves to, used to mark the default. */
  defaultModel: string | undefined
  account: ClaudeAccountInfo
  models: ClaudeModelInfo[]
  agents: ClaudeAgentInfo[]
}

/** The two `PermissionMode` values Aide's interaction modes map onto. */
export type ClaudePermissionMode = "default" | "plan"

export type ClaudeContentBlock = {
  type: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: unknown
  server_name?: string
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

export type ClaudeRawStreamEvent = {
  type: string
  index?: number
  message?: { id?: string }
  content_block?: ClaudeContentBlock
  delta?: {
    type?: string
    text?: string
    thinking?: string
    partial_json?: string
  }
}

export type ClaudeStreamMessage =
  | {
      type: "assistant"
      uuid: string
      message: { id?: string; content?: ClaudeContentBlock[] }
    }
  | {
      type: "user"
      uuid?: string
      message: { content?: ClaudeContentBlock[] | string }
    }
  | { type: "stream_event"; uuid?: string; event: ClaudeRawStreamEvent }
  | {
      type: "result"
      uuid?: string
      subtype: string
      is_error?: boolean
      result?: string
      errors?: string[]
    }
  | {
      type: "system"
      uuid?: string
      subtype: string
      status?: string | null
      claude_code_version?: string
      attempt?: number
      max_retries?: number
      tool_name?: string
      compact_metadata?: { trigger?: string }
    }

export type ClaudePermissionDecision =
  | { behavior: "allow"; updatedPermissions?: unknown[] }
  | { behavior: "deny"; message: string; interrupt?: boolean }

export type ClaudePermissionAsk = {
  toolName: string
  input: Record<string, unknown>
  signal: AbortSignal
  /** Prompt sentence rendered by the runtime; preferred over reconstructing one. */
  title?: string
  displayName?: string
  description?: string
  /** Permission updates that answer "always allow" for this tool. */
  suggestions?: unknown[]
}

export type ClaudeDialogAsk = {
  dialogKind: string
  payload: Record<string, unknown>
  toolUseID?: string
  signal: AbortSignal
}

export type ClaudeDialogResult =
  | { behavior: "completed"; result: unknown }
  | { behavior: "cancelled" }

/** The subset of `Query` this adapter uses. */
export type ClaudeQuery = {
  supportedModels(): Promise<ClaudeModelInfo[]>
  supportedAgents(): Promise<ClaudeAgentInfo[]>
  mcpServerStatus(): Promise<ClaudeMcpServerStatus[]>
  interrupt(): Promise<unknown>
  setModel(model?: string): Promise<void>
  setPermissionMode(mode: ClaudePermissionMode): Promise<void>
  setMcpServers(servers: Record<string, unknown>): Promise<unknown>
}

/** A live query plus the init facts it reported and the means to drive it. */
export type ClaudeSession = {
  readonly query: ClaudeQuery
  readonly init: ClaudeInitInfo
  /**
   * Messages after `system/init`. Single-consumer: the adapter runs one pump
   * per session, because the underlying `Query` is one generator.
   */
  messages(): AsyncIterable<ClaudeStreamMessage>
  /** Queues a prompt on the open streaming-input iterable. */
  prompt(text: string): void
  close(): Promise<void>
}

export type ClaudeSessionOpenInput = {
  config: ClaudeInstanceConfig
  cwd?: string
  timeoutMs: number
  /**
   * Pins `options.sessionId` so the caller knows the native session id before
   * the first turn. Must be a UUID; the runtime otherwise generates one and
   * only reveals it on the first `system/init` message.
   */
  sessionId?: string
  /** Applied as `options.model`; `setModel` handles later changes. */
  model?: string
  permissionMode?: ClaudePermissionMode
  /**
   * Query-creation only — the pinned SDK has no dynamic effort setter, which is
   * why changing it costs a query reopen.
   */
  effort?: string
  resume?: string
  resumeSessionAt?: string
  forkSession?: boolean
  mcpServers?: Record<string, unknown>
  canUseTool?: (ask: ClaudePermissionAsk) => Promise<ClaudePermissionDecision>
  onUserDialog?: (ask: ClaudeDialogAsk) => Promise<ClaudeDialogResult>
}

export type ClaudeSessionFactory = (
  input: ClaudeSessionOpenInput
) => Promise<ClaudeSession>

type PromptStream<T> = {
  stream: AsyncIterable<T>
  push(value: T): void
  close(): void
}

/**
 * A prompt stream that stays open. The query ends when this iterator returns,
 * so holding it open is what keeps the control channel — and therefore
 * inventory — available between turns.
 */
function createPromptStream<T>(): PromptStream<T> {
  const queued: T[] = []
  let pending: ((result: IteratorResult<T>) => void) | undefined
  let closed = false

  return {
    stream: {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<T>> {
            const value = queued.shift()
            if (value !== undefined) {
              return Promise.resolve({ value, done: false })
            }
            if (closed) {
              return Promise.resolve({ value: undefined, done: true })
            }
            return new Promise((resolve) => {
              pending = resolve
            })
          },
          return(): Promise<IteratorResult<T>> {
            closed = true
            return Promise.resolve({ value: undefined, done: true })
          },
        }
      },
    },
    push(value) {
      if (closed) return
      const resolve = pending
      pending = undefined
      if (resolve) {
        resolve({ value, done: false })
      } else {
        queued.push(value)
      }
    },
    close() {
      if (closed) return
      closed = true
      const resolve = pending
      pending = undefined
      resolve?.({ value: undefined, done: true })
    },
  }
}

type RawQuery = AsyncIterator<unknown> & {
  return?: (value?: unknown) => Promise<unknown>
  close?: () => void
}

/**
 * Opens a live query and completes the initialize handshake.
 *
 * The handshake is a *control request*, not a message. In streaming input mode
 * the runtime emits no `system/init` message until a turn actually starts, so
 * waiting for one to arrive on the message stream deadlocks: the query is
 * healthy and idle, and start times out anyway. `initializationResult()`
 * answers immediately and carries the models, agents, and account.
 *
 * It does not carry a version. That only reaches us on the first turn's
 * `system/init`, which is why the compatibility check is deferred rather than
 * gating start on a fact the runtime will not supply yet.
 */
export const createClaudeSession: ClaudeSessionFactory = async (input) => {
  const { config, cwd, timeoutMs } = input
  const prompt = createPromptStream<unknown>()
  const live = query({
    prompt: prompt.stream as never,
    options: {
      includePartialMessages: true,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...((cwd ?? config.cwd) ? { cwd: cwd ?? config.cwd } : {}),
      ...((input.model ?? config.model)
        ? { model: input.model ?? config.model }
        : {}),
      ...(input.permissionMode ? { permissionMode: input.permissionMode } : {}),
      ...(input.effort ? { effort: input.effort as never } : {}),
      ...(input.resume ? { resume: input.resume } : {}),
      ...(input.resumeSessionAt
        ? { resumeSessionAt: input.resumeSessionAt }
        : {}),
      ...(input.forkSession ? { forkSession: true } : {}),
      ...(input.mcpServers ? { mcpServers: input.mcpServers as never } : {}),
      ...(config.executable
        ? { pathToClaudeCodeExecutable: config.executable }
        : {}),
      ...(config.env ? { env: { ...process.env, ...config.env } } : {}),
      ...(input.canUseTool
        ? {
            canUseTool: ((
              toolName: string,
              toolInput: Record<string, unknown>,
              options: {
                signal: AbortSignal
                suggestions?: unknown[]
                title?: string
                displayName?: string
                description?: string
              }
            ) =>
              input.canUseTool!({
                toolName,
                input: toolInput,
                signal: options.signal,
                ...(options.title ? { title: options.title } : {}),
                ...(options.displayName
                  ? { displayName: options.displayName }
                  : {}),
                ...(options.description
                  ? { description: options.description }
                  : {}),
                ...(options.suggestions
                  ? { suggestions: options.suggestions }
                  : {}),
              })) as never,
          }
        : {}),
      ...(input.onUserDialog
        ? {
            onUserDialog: ((
              request: {
                dialogKind: string
                payload: Record<string, unknown>
                toolUseID?: string
              },
              options: { signal: AbortSignal }
            ) =>
              input.onUserDialog!({
                dialogKind: request.dialogKind,
                payload: request.payload,
                ...(request.toolUseID ? { toolUseID: request.toolUseID } : {}),
                signal: options.signal,
              })) as never,
          }
        : {}),
    },
  })

  const raw = live as unknown as RawQuery
  const close = async () => {
    prompt.close()
    if (raw.close) {
      raw.close()
      return
    }
    await Promise.resolve(raw.return?.(undefined)).catch(() => undefined)
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Claude runtime did not complete its initialize handshake within ${timeoutMs}ms`
          )
        ),
      timeoutMs
    )
    timer.unref?.()
  })

  let init: ClaudeInitInfo
  try {
    const handshake = (await Promise.race([
      (
        live as unknown as { initializationResult(): Promise<unknown> }
      ).initializationResult(),
      timeout,
    ])) as {
      models?: ClaudeModelInfo[]
      agents?: ClaudeAgentInfo[]
      account?: ClaudeAccountInfo
    }
    const models = handshake.models ?? []
    init = {
      sessionId: input.sessionId ?? "",
      // The runtime lists the account's default under the literal alias
      // "default"; everything else is an explicit choice.
      defaultModel:
        models.find((model) => model.value === "default")?.value ??
        models[0]?.value,
      account: handshake.account ?? {},
      models,
      agents: handshake.agents ?? [],
    }
  } catch (error) {
    await close()
    throw error
  } finally {
    clearTimeout(timer)
  }

  return {
    query: live as unknown as ClaudeQuery,
    init,
    messages() {
      return {
        [Symbol.asyncIterator]: () => ({
          async next() {
            const next = await raw.next()
            return next.done
              ? { value: undefined as never, done: true as const }
              : {
                  value: next.value as ClaudeStreamMessage,
                  done: false as const,
                }
          },
        }),
      }
    },
    prompt(text: string) {
      prompt.push({
        type: "user",
        message: { role: "user", content: text },
        parent_tool_use_id: null,
        ...(init.sessionId ? { session_id: init.sessionId } : {}),
      })
    },
    close,
  }
}
