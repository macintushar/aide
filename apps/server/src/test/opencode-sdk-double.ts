import type {
  OpencodeAgent,
  OpencodeApi,
  OpencodeModelRef,
  OpencodeProvider,
  OpencodeSessionEvent,
  OpencodeSessionEventEnvelope,
  OpencodeSessionInfo,
} from "../harness/opencode/client"

type Deferred<T> = {
  promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

class AsyncQueue<T> {
  readonly #values: T[] = []
  readonly #waiters: Array<(result: IteratorResult<T>) => void> = []
  #closed = false

  push(value: T): void {
    if (this.#closed) return
    const waiter = this.#waiters.shift()
    if (waiter) waiter({ value, done: false })
    else this.#values.push(value)
  }

  close(): void {
    this.#closed = true
    for (const waiter of this.#waiters.splice(0)) {
      waiter({ value: undefined, done: true })
    }
  }

  stream(): AsyncGenerator<T> {
    const nextValue = (): Promise<IteratorResult<T>> => {
      const value = this.#values.shift()
      if (value !== undefined) {
        return Promise.resolve({ value, done: false })
      }
      if (this.#closed) {
        return Promise.resolve({ value: undefined, done: true })
      }
      return new Promise<IteratorResult<T>>((resolve) => {
        this.#waiters.push(resolve)
      })
    }
    return (async function* () {
      while (true) {
        const next = await nextValue()
        if (next.done) return
        yield next.value
      }
    })()
  }
}

class EventFanout<T> {
  readonly #subscribers = new Set<AsyncQueue<T>>()

  publish(value: T): void {
    for (const subscriber of this.#subscribers) subscriber.push(value)
  }

  subscribe(): AsyncGenerator<T> {
    const queue = new AsyncQueue<T>()
    this.#subscribers.add(queue)
    const subscribers = this.#subscribers
    return (async function* () {
      try {
        yield* queue.stream()
      } finally {
        subscribers.delete(queue)
        queue.close()
      }
    })()
  }
}

class ReplayEventLog {
  readonly #events: OpencodeSessionEventEnvelope[] = []
  readonly #live = new EventFanout<OpencodeSessionEventEnvelope>()

  push(event: OpencodeSessionEventEnvelope): void {
    this.#events.push(event)
    this.#live.publish(event)
  }

  stream(after?: string): AsyncGenerator<OpencodeSessionEventEnvelope> {
    const sequence = after === undefined ? -1 : Number(after)
    const replay = this.#events.filter((event) => Number(event.id) > sequence)
    const live = this.#live.subscribe()
    return (async function* () {
      yield* replay
      yield* live
    })()
  }
}

type SessionState = {
  info: OpencodeSessionInfo
  events: ReplayEventLog
  durableSequence: number
  wait: Deferred<void> | undefined
  permission: Deferred<void> | undefined
  question: Deferred<void> | undefined
  interrupted: boolean
  running: boolean
}

export type OpencodeDoubleCalls = {
  directories: Array<string | undefined>
  selections: Array<
    | { type: "model"; sessionID: string; model: OpencodeModelRef }
    | { type: "agent"; sessionID: string; agent: string | undefined }
    | { type: "prompt"; sessionID: string; id: string; text: string }
  >
  permissionReplies: Array<{ requestID: string; reply: string }>
  questionReplies: Array<{ requestID: string; answers: string[][] }>
  interrupts: string[]
  mcpAdds: Array<{ directory?: string; name: string }>
  mcpDisconnects: Array<{ directory?: string; name: string }>
}

export type OpencodeDoubleControls = {
  publish(
    sessionID: string,
    type: OpencodeSessionEvent["type"],
    data: Record<string, unknown>
  ): void
  failMcpAdd(directory: string | undefined, name: string): void
  mcpServers(directory?: string): string[]
}

export function createOpencodeSdkDouble(
  options: {
    version?: string
    providers?: {
      providers: OpencodeProvider[]
      default: Record<string, string>
    }
    agents?: OpencodeAgent[]
  } = {}
): {
  api: OpencodeApi
  calls: OpencodeDoubleCalls
  controls: OpencodeDoubleControls
} {
  const calls: OpencodeDoubleCalls = {
    directories: [],
    selections: [],
    permissionReplies: [],
    questionReplies: [],
    interrupts: [],
    mcpAdds: [],
    mcpDisconnects: [],
  }
  const sessions = new Map<string, SessionState>()
  const mcpServers = new Map<string, Set<string>>()
  const mcpAddFailures = new Set<string>()
  let nextSession = 0
  let nextEvent = 0

  const mcpKey = (directory: string | undefined, name: string) =>
    `${directory ?? ""}\0${name}`
  const mcpNames = (directory: string | undefined) =>
    mcpServers.get(directory ?? "") ?? new Set<string>()

  const providers = options.providers ?? {
    providers: [
      {
        id: "anthropic",
        name: "Anthropic",
        source: "env",
        env: ["ANTHROPIC_API_KEY"],
        key: "set",
        models: {
          "claude-opus-5": {
            id: "claude-opus-5",
            providerID: "anthropic",
            name: "Claude Opus 5",
            variants: { standard: {}, thinking: {} },
          },
          "claude-sonnet-5": {
            id: "claude-sonnet-5",
            providerID: "anthropic",
            name: "Claude Sonnet 5",
          },
        },
      },
    ],
    default: { anthropic: "claude-opus-5" },
  }
  const agents = options.agents ?? [
    { name: "build", mode: "primary" as const },
    { name: "plan", mode: "primary" as const },
    { name: "explore", mode: "subagent" as const },
    { name: "internal", mode: "primary" as const, hidden: true },
  ]

  const requireSession = (sessionID: string): SessionState => {
    const session = sessions.get(sessionID)
    if (!session) throw new Error(`unknown OpenCode session ${sessionID}`)
    return session
  }

  const publishSession = (
    state: SessionState,
    type: OpencodeSessionEvent["type"],
    data: Record<string, unknown>
  ): void => {
    const sequence = ++state.durableSequence
    const event = {
      id: `native-event-${++nextEvent}`,
      type,
      durable: {
        aggregateID: state.info.id,
        seq: sequence,
        version: 1,
      },
      location: state.info.location,
      data,
    } as OpencodeSessionEvent
    state.events.push({
      id: String(sequence),
      event: type,
      data: JSON.stringify(event),
    })
  }

  const runTurn = async (
    state: SessionState,
    messageID: string,
    prompt: string
  ): Promise<void> => {
    const sessionID = state.info.id
    const assistantMessageID = `${messageID}-assistant`
    publishSession(state, "session.next.step.started", {
      timestamp: Date.now(),
      sessionID,
      assistantMessageID,
      agent: state.info.agent ?? "build",
      model: state.info.model,
    })
    publishSession(state, "message.part.updated", {
      sessionID,
      time: Date.now(),
      part: {
        id: "text-1",
        sessionID,
        messageID: assistantMessageID,
        type: "text",
        text: "OpenCode received: ",
      },
    })
    publishSession(state, "message.part.delta", {
      sessionID,
      messageID: assistantMessageID,
      partID: "text-1",
      field: "text",
      delta: prompt,
    })
    publishSession(state, "message.part.updated", {
      sessionID,
      time: Date.now(),
      part: {
        id: "text-1",
        sessionID,
        messageID: assistantMessageID,
        type: "text",
        text: `OpenCode received: ${prompt}`,
      },
    })
    publishSession(state, "message.part.updated", {
      sessionID,
      time: Date.now(),
      part: {
        id: "reasoning-1",
        sessionID,
        messageID: assistantMessageID,
        type: "reasoning",
        text: "Checking the workspace before making changes.",
        time: { start: Date.now() },
      },
    })
    publishSession(state, "message.part.updated", {
      sessionID,
      time: Date.now(),
      part: {
        id: "tool-1",
        sessionID,
        messageID: assistantMessageID,
        type: "tool",
        callID: "tool-1",
        tool: "bash",
        state: {
          status: "pending",
          input: { command: "pwd" },
          raw: JSON.stringify({ command: "pwd" }),
        },
      },
    })
    publishSession(state, "message.part.updated", {
      sessionID,
      time: Date.now(),
      part: {
        id: "tool-1",
        sessionID,
        messageID: assistantMessageID,
        type: "tool",
        callID: "tool-1",
        tool: "bash",
        state: {
          status: "running",
          input: { command: "pwd" },
          time: { start: Date.now() },
        },
      },
    })
    publishSession(state, "message.part.updated", {
      sessionID,
      time: Date.now(),
      part: {
        id: "tool-1",
        sessionID,
        messageID: assistantMessageID,
        type: "tool",
        callID: "tool-1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "pwd" },
          output: "/tmp/project",
          title: "pwd",
          metadata: {},
          time: { start: Date.now(), end: Date.now() },
        },
      },
    })
    publishSession(state, "message.part.updated", {
      sessionID,
      time: Date.now(),
      part: {
        id: "tool-2",
        sessionID,
        messageID: assistantMessageID,
        type: "tool",
        callID: "tool-2",
        tool: "bash",
        state: {
          status: "pending",
          input: { command: "false" },
          raw: JSON.stringify({ command: "false" }),
        },
      },
    })
    publishSession(state, "message.part.updated", {
      sessionID,
      time: Date.now(),
      part: {
        id: "tool-2",
        sessionID,
        messageID: assistantMessageID,
        type: "tool",
        callID: "tool-2",
        tool: "bash",
        state: {
          status: "running",
          input: { command: "false" },
          time: { start: Date.now() },
        },
      },
    })
    publishSession(state, "message.part.updated", {
      sessionID,
      time: Date.now(),
      part: {
        id: "tool-2",
        sessionID,
        messageID: assistantMessageID,
        type: "tool",
        callID: "tool-2",
        tool: "bash",
        state: {
          status: "error",
          input: { command: "false" },
          error: "expected conformance failure",
          time: { start: Date.now(), end: Date.now() },
        },
      },
    })

    state.permission = deferred<void>()
    publishSession(state, "permission.v2.asked", {
      id: "permission-1",
      sessionID,
      action: "bash",
      resources: ["pwd"],
    })
    await state.permission.promise
    if (state.interrupted) return

    state.question = deferred<void>()
    publishSession(state, "question.v2.asked", {
      id: "question-1",
      sessionID,
      questions: [
        {
          question: "Continue with the conformance turn?",
          header: "Continue",
          options: [
            { label: "Yes", description: "Continue the turn" },
            { label: "No", description: "Stop the turn" },
          ],
          custom: true,
        },
      ],
    })
    await state.question.promise
    if (state.interrupted) return

    publishSession(state, "session.idle", { sessionID })
    state.running = false
    state.wait?.resolve(undefined)
  }

  const api: OpencodeApi = {
    global: {
      async health() {
        return {
          data: { healthy: true, version: options.version ?? "1.18.16" },
        }
      },
    },
    config: {
      async providers(parameters) {
        calls.directories.push(parameters?.directory)
        return { data: providers }
      },
    },
    app: {
      async agents() {
        return { data: agents }
      },
    },
    v2: {
      session: {
        async create(parameters) {
          const id = parameters?.id ?? `opencode-session-${++nextSession}`
          const info: OpencodeSessionInfo = {
            id,
            projectID: "project-1",
            ...(parameters?.agent ? { agent: parameters.agent } : {}),
            ...(parameters?.model ? { model: parameters.model } : {}),
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            time: { created: Date.now(), updated: Date.now() },
            title: "Aide session",
            location: parameters?.location ?? { directory: "/tmp/project" },
          }
          sessions.set(id, {
            info,
            events: new ReplayEventLog(),
            durableSequence: 0,
            wait: undefined,
            permission: undefined,
            question: undefined,
            interrupted: false,
            running: false,
          })
          return { data: { data: info } }
        },
        async get({ sessionID }) {
          return { data: { data: requireSession(sessionID).info } }
        },
        async active() {
          return {
            data: {
              data: Object.fromEntries(
                [...sessions.entries()]
                  .filter(([, state]) => state.running)
                  .map(([id]) => [id, { type: "running" as const }])
              ),
            },
          }
        },
        async switchAgent({ sessionID, agent }) {
          const state = requireSession(sessionID)
          state.info.agent = agent
          calls.selections.push({ type: "agent", sessionID, agent })
          return {}
        },
        async switchModel({ sessionID, model }) {
          const state = requireSession(sessionID)
          state.info.model = model
          if (model) calls.selections.push({ type: "model", sessionID, model })
          return {}
        },
        async prompt({ sessionID, id, prompt }) {
          const state = requireSession(sessionID)
          const messageID = id ?? `message-${Date.now()}`
          const text = prompt?.text ?? ""
          calls.selections.push({
            type: "prompt",
            sessionID,
            id: messageID,
            text,
          })
          state.interrupted = false
          state.running = true
          state.wait = deferred<void>()
          const admittedSeq = ++state.durableSequence
          queueMicrotask(() => void runTurn(state, messageID, text))
          return {
            data: {
              data: {
                admittedSeq,
                id: messageID,
                sessionID,
                prompt: { text },
                delivery: "queue",
                timeCreated: Date.now(),
              },
            },
          }
        },
        async wait({ sessionID }) {
          await requireSession(sessionID).wait?.promise
          return {}
        },
        async events({ sessionID, after }) {
          return { stream: requireSession(sessionID).events.stream(after) }
        },
        async interrupt({ sessionID }) {
          const state = requireSession(sessionID)
          calls.interrupts.push(sessionID)
          state.interrupted = true
          state.running = false
          state.permission?.resolve(undefined)
          state.question?.resolve(undefined)
          state.wait?.resolve(undefined)
          return {}
        },
        permission: {
          async reply({ sessionID, requestID, reply }) {
            const state = requireSession(sessionID)
            calls.permissionReplies.push({ requestID, reply: reply ?? "once" })
            publishSession(state, "permission.v2.replied", {
              sessionID,
              requestID,
              reply: reply ?? "once",
            })
            state.permission?.resolve(undefined)
            return {}
          },
        },
        question: {
          async reply({ sessionID, requestID, questionV2Reply }) {
            const state = requireSession(sessionID)
            calls.questionReplies.push({
              requestID,
              answers: questionV2Reply.answers,
            })
            publishSession(state, "question.v2.replied", {
              sessionID,
              requestID,
              answers: questionV2Reply.answers,
            })
            state.question?.resolve(undefined)
            return {}
          },
          async reject({ sessionID, requestID }) {
            const state = requireSession(sessionID)
            publishSession(state, "question.v2.rejected", {
              sessionID,
              requestID,
            })
            state.question?.resolve(undefined)
            return {}
          },
        },
      },
    },
    mcp: {
      async status(parameters) {
        return {
          data: Object.fromEntries(
            [...mcpNames(parameters?.directory)].map((name) => [
              name,
              { status: "connected" },
            ])
          ),
        }
      },
      async add(parameters) {
        const { directory, name } = parameters ?? {}
        if (name) calls.mcpAdds.push({ directory, name })
        if (name && mcpAddFailures.has(mcpKey(directory, name))) {
          return { error: { message: `failed to add ${name}` } }
        }
        if (name) {
          const names = mcpNames(directory)
          names.add(name)
          mcpServers.set(directory ?? "", names)
        }
        return {
          data: Object.fromEntries(
            [...mcpNames(directory)].map((entry) => [
              entry,
              { status: "connected" },
            ])
          ),
        }
      },
      async connect() {
        return { data: true }
      },
      async disconnect({ directory, name }) {
        calls.mcpDisconnects.push({ directory, name })
        mcpNames(directory).delete(name)
        return { data: true }
      },
    },
  }

  return {
    api,
    calls,
    controls: {
      publish(sessionID, type, data) {
        publishSession(requireSession(sessionID), type, data)
      },
      failMcpAdd(directory, name) {
        mcpAddFailures.add(mcpKey(directory, name))
      },
      mcpServers(directory) {
        return [...mcpNames(directory)].sort()
      },
    },
  }
}
