import type {
  ClaudeAccountInfo,
  ClaudeAgentInfo,
  ClaudeDialogResult,
  ClaudeMcpServerStatus,
  ClaudeModelInfo,
  ClaudePermissionDecision,
  ClaudeSession,
  ClaudeSessionFactory,
  ClaudeSessionOpenInput,
  ClaudeStreamMessage,
} from "../harness/claude"

/**
 * Test-only stand-in for a live Claude Agent SDK query.
 *
 * A real query needs a Claude Code install and real credentials, so the adapter
 * is exercised against a double that speaks the SDK's wire shapes — assistant
 * messages carrying content blocks, `stream_event` frames, tool results on user
 * messages, and a result message. That is deliberate: the adapter's hardest job
 * is synthesizing Aide parts out of exactly those shapes, and a double that
 * emitted Aide-shaped events would test nothing.
 */

export const DEFAULT_CLAUDE_MODELS: ClaudeModelInfo[] = [
  {
    value: "claude-opus-5",
    displayName: "Claude Opus 5",
    description: "Most capable",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    value: "claude-haiku-4-5-20251001",
    displayName: "Claude Haiku 4.5",
    description: "Fastest",
    supportsEffort: false,
  },
]

export type ClaudeTurnScriptContext = {
  prompt: string
  emit(message: ClaudeStreamMessage): void
  /** Invokes the host's `canUseTool` and resolves with its decision. */
  requestPermission(input: {
    toolName: string
    input: Record<string, unknown>
    title?: string
    suggestions?: unknown[]
  }): Promise<ClaudePermissionDecision>
  /** Invokes the host's `onUserDialog` and resolves with its answer. */
  requestDialog(input: {
    dialogKind: string
    payload: Record<string, unknown>
  }): Promise<ClaudeDialogResult>
  /** Resolves once the turn has been interrupted. */
  interrupted(): boolean
}

export type ClaudeSessionDoubleOptions = {
  /** Reported on the first turn's `system/init`, as the real runtime does. */
  version?: string
  models?: ClaudeModelInfo[]
  agents?: ClaudeAgentInfo[]
  mcpStatuses?: ClaudeMcpServerStatus[]
  account?: ClaudeAccountInfo
  onDiscover?: () => void
  onOpen?: (input: ClaudeSessionOpenInput) => void
  /** Defaults to {@link conformanceTurnScript}. */
  script?: (context: ClaudeTurnScriptContext) => Promise<void>
}

export type ClaudeSessionDouble = ClaudeSession & {
  readonly openInput: ClaudeSessionOpenInput
  readonly setModelCalls: Array<string | undefined>
  readonly setPermissionModeCalls: string[]
  readonly setMcpServerCalls: Array<Record<string, unknown>>
  readonly interruptCount: number
  readonly closed: boolean
  readonly prompts: string[]
}

type Emitter = {
  emit(message: ClaudeStreamMessage): void
  messages(): AsyncIterable<ClaudeStreamMessage>
  end(): void
}

function createEmitter(): Emitter {
  const queued: ClaudeStreamMessage[] = []
  let waiter:
    | ((result: IteratorResult<ClaudeStreamMessage>) => void)
    | undefined
  let ended = false

  return {
    emit(message) {
      if (ended) return
      const resolve = waiter
      waiter = undefined
      if (resolve) resolve({ value: message, done: false })
      else queued.push(message)
    },
    end() {
      if (ended) return
      ended = true
      const resolve = waiter
      waiter = undefined
      resolve?.({ value: undefined as never, done: true })
    },
    messages() {
      return {
        [Symbol.asyncIterator]: () => ({
          next() {
            const message = queued.shift()
            if (message) return Promise.resolve({ value: message, done: false })
            if (ended) {
              return Promise.resolve({
                value: undefined as never,
                done: true as const,
              })
            }
            return new Promise<IteratorResult<ClaudeStreamMessage>>(
              (resolve) => {
                waiter = resolve
              }
            )
          },
          return() {
            return Promise.resolve({
              value: undefined as never,
              done: true as const,
            })
          },
        }),
      }
    },
  }
}

/**
 * The script the conformance suite runs against: two tools whose parts must
 * walk pending → running → completed and pending → running → failed, a
 * reasoning block, a permission prompt, a user dialog, and an echoed answer.
 */
export const conformanceTurnScript = async (
  context: ClaudeTurnScriptContext
): Promise<void> => {
  const apiMessageId = "msg_conformance"
  context.emit({
    type: "stream_event",
    event: { type: "message_start", message: { id: apiMessageId } },
  })

  context.emit({
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "thinking", thinking: "" },
    },
  })
  context.emit({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "planning the reply" },
    },
  })
  context.emit({
    type: "assistant",
    uuid: "uuid-thinking",
    message: {
      id: apiMessageId,
      content: [{ type: "thinking", thinking: "planning the reply" }],
    },
  })

  context.emit({
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "toolu_ok", name: "Bash" },
    },
  })
  context.emit({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: '{"command":"true"}' },
    },
  })
  context.emit({
    type: "assistant",
    uuid: "uuid-tool-ok",
    message: {
      id: apiMessageId,
      content: [
        { type: "thinking", thinking: "planning the reply" },
        {
          type: "tool_use",
          id: "toolu_ok",
          name: "Bash",
          input: { command: "true" },
        },
      ],
    },
  })

  const decision = await context.requestPermission({
    toolName: "Bash",
    input: { command: "true" },
    title: "Run `true`?",
    suggestions: [{ type: "addRules", rules: [{ toolName: "Bash" }] }],
  })
  if (context.interrupted() || decision.behavior === "deny") return

  context.emit({
    type: "user",
    message: {
      content: [
        { type: "tool_result", tool_use_id: "toolu_ok", content: "ok" },
      ],
    },
  })

  context.emit({
    type: "assistant",
    uuid: "uuid-tool-fail",
    message: {
      id: apiMessageId,
      content: [
        {
          type: "tool_use",
          id: "toolu_fail",
          name: "Bash",
          input: { command: "false" },
        },
      ],
    },
  })
  context.emit({
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_fail",
          content: "exit 1",
          is_error: true,
        },
      ],
    },
  })

  await context.requestDialog({
    dialogKind: "conformance_dialog",
    payload: {
      questions: [
        {
          id: "approach",
          prompt: "Which approach should Claude take?",
          header: "Approach",
          options: [
            { id: "fast", label: "Fast" },
            { id: "safe", label: "Safe" },
          ],
          allowMultiple: true,
        },
        {
          id: "notes",
          prompt: "Any additional notes?",
          allowFreeText: true,
          multiline: true,
        },
      ],
    },
  })
  if (context.interrupted()) return

  context.emit({
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 2,
      content_block: { type: "text", text: "" },
    },
  })
  context.emit({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 2,
      delta: { type: "text_delta", text: context.prompt },
    },
  })
  context.emit({
    type: "assistant",
    uuid: "uuid-text",
    message: {
      id: apiMessageId,
      content: [{ type: "text", text: context.prompt }],
    },
  })

  context.emit({
    type: "result",
    subtype: "success",
    is_error: false,
    result: context.prompt,
  })
}

/**
 * Builds a factory whose every call yields a fresh double with its own native
 * session id, so two instances — and two Aide sessions — stay isolated.
 */
export function createClaudeSessionDoubleFactory(
  options: ClaudeSessionDoubleOptions = {}
): ClaudeSessionFactory & { sessions: ClaudeSessionDouble[] } {
  const sessions: ClaudeSessionDouble[] = []
  let counter = 0

  const open = async (
    input: ClaudeSessionOpenInput
  ): Promise<ClaudeSessionDouble> => {
    counter += 1
    options.onOpen?.(input)
    const emitter = createEmitter()
    const script = options.script ?? conformanceTurnScript
    const abort = new AbortController()

    const state = {
      setModelCalls: [] as Array<string | undefined>,
      setPermissionModeCalls: [] as string[],
      setMcpServerCalls: [] as Array<Record<string, unknown>>,
      interruptCount: 0,
      closed: false,
      prompts: [] as string[],
    }

    const session: ClaudeSessionDouble = {
      openInput: input,
      get setModelCalls() {
        return state.setModelCalls
      },
      get setPermissionModeCalls() {
        return state.setPermissionModeCalls
      },
      get setMcpServerCalls() {
        return state.setMcpServerCalls
      },
      get interruptCount() {
        return state.interruptCount
      },
      get closed() {
        return state.closed
      },
      get prompts() {
        return state.prompts
      },
      init: {
        // Mirrors `initializationResult()`: models, agents, and account, and
        // deliberately no version — the real handshake has none.
        sessionId:
          input.sessionId ?? input.resume ?? `claude-native-${counter}`,
        defaultModel: (options.models ?? DEFAULT_CLAUDE_MODELS)[0]?.value,
        account: options.account ?? {
          email: "double@example.test",
          apiProvider: "firstParty",
          subscriptionType: "Claude Pro",
        },
        models: options.models ?? DEFAULT_CLAUDE_MODELS,
        agents: options.agents ?? [{ name: "Explore" }],
      },
      query: {
        async supportedModels() {
          options.onDiscover?.()
          return options.models ?? DEFAULT_CLAUDE_MODELS
        },
        async supportedAgents() {
          return options.agents ?? [{ name: "Explore" }]
        },
        async mcpServerStatus() {
          return options.mcpStatuses ?? []
        },
        async interrupt() {
          state.interruptCount += 1
          abort.abort()
          return undefined
        },
        async setModel(model) {
          state.setModelCalls.push(model)
        },
        async setPermissionMode(mode) {
          state.setPermissionModeCalls.push(mode)
        },
        async setMcpServers(servers) {
          state.setMcpServerCalls.push(servers)
          return { added: [], removed: [] }
        },
      },
      messages: emitter.messages,
      prompt(text) {
        state.prompts.push(text)
        // The runtime emits system/init at the start of a turn, never before.
        emitter.emit({
          type: "system",
          subtype: "init",
          claude_code_version: options.version ?? "2.1.228",
        } as ClaudeStreamMessage)
        void script({
          prompt: text,
          emit: emitter.emit,
          interrupted: () => abort.signal.aborted,
          requestPermission: (ask) =>
            input.canUseTool
              ? input.canUseTool({
                  toolName: ask.toolName,
                  input: ask.input,
                  signal: abort.signal,
                  ...(ask.title ? { title: ask.title } : {}),
                  ...(ask.suggestions ? { suggestions: ask.suggestions } : {}),
                })
              : Promise.resolve({ behavior: "allow" as const }),
          requestDialog: (ask) =>
            input.onUserDialog
              ? input.onUserDialog({
                  dialogKind: ask.dialogKind,
                  payload: ask.payload,
                  signal: abort.signal,
                })
              : Promise.resolve({ behavior: "cancelled" as const }),
        }).catch(() => undefined)
      },
      async close() {
        state.closed = true
        abort.abort()
        emitter.end()
      },
    }

    sessions.push(session)
    return session
  }

  return Object.assign(open, { sessions })
}
