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

/** The subset of `Query` this adapter uses in Wave 2. */
export type ClaudeQuery = {
  supportedModels(): Promise<ClaudeModelInfo[]>
  supportedAgents(): Promise<ClaudeAgentInfo[]>
  mcpServerStatus(): Promise<ClaudeMcpServerStatus[]>
  interrupt(): Promise<unknown>
}

/** A live query plus the init facts it reported and the means to close it. */
export type ClaudeSession = {
  readonly query: ClaudeQuery
  readonly init: ClaudeInitInfo
  close(): Promise<void>
}

export type ClaudeSessionFactory = (input: {
  config: ClaudeInstanceConfig
  cwd?: string
  timeoutMs: number
}) => Promise<ClaudeSession>

/**
 * A prompt stream that stays open. The query ends when this iterator returns,
 * so holding it open is what keeps the control channel — and therefore
 * inventory — available between turns.
 */
function createPromptStream<T>(): {
  stream: AsyncIterable<T>
  push(value: T): void
  close(): void
} {
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

/**
 * Opens a live query and waits for the runtime's `system/init` message, which
 * is what carries the version, the resolved model, and the auth source.
 */
export const createClaudeSession: ClaudeSessionFactory = async ({
  config,
  cwd,
  timeoutMs,
}) => {
  const prompt = createPromptStream<never>()
  const live = query({
    prompt: prompt.stream as never,
    options: {
      includePartialMessages: true,
      ...((cwd ?? config.cwd) ? { cwd: cwd ?? config.cwd } : {}),
      ...(config.model ? { model: config.model } : {}),
      ...(config.executable
        ? { pathToClaudeCodeExecutable: config.executable }
        : {}),
      ...(config.env ? { env: { ...process.env, ...config.env } } : {}),
    },
  })

  const close = async () => {
    prompt.close()
    await Promise.resolve(live.return?.(undefined)).catch(() => undefined)
  }

  let init: ClaudeInitInfo | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    setTimeout(
      () =>
        reject(
          new Error(
            `Claude runtime did not report system/init within ${timeoutMs}ms`
          )
        ),
      timeoutMs
    ).unref?.()
  })

  const readInit = (async () => {
    for await (const message of live) {
      if (message.type === "system" && message.subtype === "init") {
        init = {
          version: message.claude_code_version,
          model: message.model,
          apiKeySource: message.apiKeySource,
          sessionId: message.session_id,
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
  }

  if (!init) {
    await close()
    throw new Error("Claude runtime closed before reporting system/init")
  }

  return {
    query: live as unknown as ClaudeQuery,
    init,
    close,
  }
}
