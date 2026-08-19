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

export type ClaudeInitInfo = {
  version: string
  model: string
  apiKeySource: string
  sessionId: string
  agents?: string[]
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
 * Opens a live query and waits for the runtime's `system/init` message, which
 * is what carries the version, the resolved model, and the auth source.
 *
 * The init read pulls the shared iterator by hand rather than with `for await`:
 * breaking out of `for await` calls `return()` on the generator, which would
 * close the very query the caller is about to send turns through.
 */
export const createClaudeSession: ClaudeSessionFactory = async (input) => {
  const { config, cwd, timeoutMs } = input
  const prompt = createPromptStream<unknown>()
  const live = query({
    prompt: prompt.stream as never,
    options: {
      includePartialMessages: true,
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

  let init: ClaudeInitInfo | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Claude runtime did not report system/init within ${timeoutMs}ms`
          )
        ),
      timeoutMs
    )
    timer.unref?.()
  })

  const readInit = (async () => {
    for (;;) {
      const next = await raw.next()
      if (next.done) return
      const message = next.value as {
        type?: string
        subtype?: string
        claude_code_version?: string
        model?: string
        apiKeySource?: string
        session_id?: string
        agents?: string[]
      }
      if (message.type === "system" && message.subtype === "init") {
        init = {
          version: message.claude_code_version ?? "",
          model: message.model ?? "",
          apiKeySource: message.apiKeySource ?? "",
          sessionId: message.session_id ?? "",
          ...(message.agents ? { agents: message.agents } : {}),
        }
        return
      }
    }
  })()

  try {
    await Promise.race([readInit, timeout])
  } catch (error) {
    await close()
    throw error
  } finally {
    clearTimeout(timer)
  }

  if (!init) {
    await close()
    throw new Error("Claude runtime closed before reporting system/init")
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
        session_id: init!.sessionId,
      })
    },
    close,
  }
}
