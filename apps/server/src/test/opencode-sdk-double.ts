import type {
  OpencodeAgent,
  OpencodeApi,
  OpencodeForm,
  OpencodeLiveEvent,
  OpencodeLogEvent,
  OpencodeModel,
  OpencodeModelRef,
  OpencodePermissionRequest,
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

  subscribe(signal?: AbortSignal): AsyncGenerator<T> {
    const queue = new AsyncQueue<T>()
    this.#subscribers.add(queue)
    const subscribers = this.#subscribers
    signal?.addEventListener("abort", () => queue.close(), { once: true })
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

/** One session's durable history, replayable from any sequence. */
class ReplayEventLog {
  readonly #events: OpencodeLogEvent[] = []
  readonly #live = new EventFanout<OpencodeLogEvent>()

  push(event: OpencodeLogEvent): void {
    this.#events.push(event)
    this.#live.publish(event)
  }

  stream(after: number | undefined, signal?: AbortSignal) {
    const replay = this.#events.filter(
      (event) =>
        event.type !== "log.synced" &&
        (after === undefined || event.durable.seq > after)
    )
    const live = this.#live.subscribe(signal)
    const synced = { type: "log.synced" } as OpencodeLogEvent
    return (async function* () {
      yield* replay
      yield synced
      yield* live
    })()
  }
}

/** Event types OpenCode keeps in a session's durable log. */
const DURABLE_TYPES = new Set<string>([
  "session.created",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.step.started",
  "session.step.ended",
  "session.step.failed",
  "session.text.started",
  "session.text.ended",
  "session.reasoning.started",
  "session.reasoning.ended",
  "session.tool.input.started",
  "session.tool.input.ended",
  "session.tool.called",
  "session.tool.success",
  "session.tool.failed",
  "session.retry.scheduled",
  "session.compaction.started",
  "session.compaction.ended",
])

type SessionState = {
  info: OpencodeSessionInfo
  events: ReplayEventLog
  durableSequence: number
  wait: Deferred<void> | undefined
  permission: Deferred<void> | undefined
  form: Deferred<void> | undefined
  permissions: Map<string, OpencodePermissionRequest>
  forms: Map<string, OpencodeForm>
  interrupted: boolean
  running: boolean
}

type FormAnswer = Record<string, string | number | boolean | string[]>

export type OpencodeDoubleCalls = {
  directories: Array<string | undefined>
  selections: Array<
    | { type: "model"; sessionID: string; model: OpencodeModelRef }
    | { type: "agent"; sessionID: string; agent: string }
    | { type: "prompt"; sessionID: string; id: string; text: string }
  >
  permissionReplies: Array<{ requestID: string; reply: string }>
  formReplies: Array<{ formID: string; answer: FormAnswer }>
  interrupts: string[]
  mcpAdds: Array<{ directory?: string; name: string }>
  mcpRemoves: Array<{ directory?: string; name: string }>
}

export type OpencodeDoubleControls = {
  /** Publishes a native event; durable types also land in the session log. */
  publish(sessionID: string, type: string, data: Record<string, unknown>): void
  failMcpAdd(directory: string | undefined, name: string): void
  mcpServers(directory?: string): string[]
}

export const DOUBLE_MODELS: OpencodeModel[] = [
  {
    id: "claude-opus-5",
    providerID: "anthropic",
    name: "Claude Opus 5",
    enabled: true,
    variants: [{ id: "standard" }, { id: "thinking" }],
  },
  {
    id: "claude-sonnet-5",
    providerID: "anthropic",
    name: "Claude Sonnet 5",
    enabled: true,
    variants: [],
  },
]

export const DOUBLE_AGENTS: OpencodeAgent[] = [
  { id: "build", name: "Build", mode: "primary", hidden: false },
  { id: "plan", name: "Plan", mode: "primary", hidden: false },
  { id: "explore", name: "Explore", mode: "subagent", hidden: false },
  { id: "internal", name: "Internal", mode: "primary", hidden: true },
]

export function createOpencodeSdkDouble(
  options: {
    version?: string
    models?: OpencodeModel[]
    defaultModel?: OpencodeModelRef | null
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
    formReplies: [],
    interrupts: [],
    mcpAdds: [],
    mcpRemoves: [],
  }
  const sessions = new Map<string, SessionState>()
  const live = new EventFanout<OpencodeLiveEvent>()
  const mcpServers = new Map<string, Set<string>>()
  const mcpAddFailures = new Set<string>()
  let nextSession = 0
  let nextEvent = 0

  const mcpKey = (directory: string | undefined, name: string) =>
    `${directory ?? ""}\0${name}`
  const mcpNames = (directory: string | undefined) =>
    mcpServers.get(directory ?? "") ?? new Set<string>()

  const models = options.models ?? DOUBLE_MODELS
  const defaultRef =
    options.defaultModel === undefined
      ? { id: "claude-opus-5", providerID: "anthropic" }
      : options.defaultModel
  const agents = options.agents ?? DOUBLE_AGENTS

  const requireSession = (sessionID: string): SessionState => {
    const session = sessions.get(sessionID)
    if (!session) throw new Error(`unknown OpenCode session ${sessionID}`)
    return session
  }

  const publishSession = (
    state: SessionState,
    type: string,
    data: Record<string, unknown>
  ): void => {
    const id = `native-event-${++nextEvent}`
    if (DURABLE_TYPES.has(type)) {
      const event = {
        id,
        created: Date.now(),
        type,
        durable: {
          aggregateID: state.info.id,
          seq: ++state.durableSequence,
          version: 1,
        },
        data,
      } as unknown as OpencodeLogEvent
      state.events.push(event)
      live.publish(event as unknown as OpencodeLiveEvent)
      return
    }
    live.publish({
      id,
      created: Date.now(),
      type,
      data,
    } as unknown as OpencodeLiveEvent)
  }

  const runTurn = async (
    state: SessionState,
    messageID: string,
    prompt: string
  ): Promise<void> => {
    const sessionID = state.info.id
    const assistantMessageID = `${messageID}-assistant`
    const onMessage = { sessionID, assistantMessageID }
    publishSession(state, "session.execution.started", { sessionID })
    publishSession(state, "session.step.started", {
      ...onMessage,
      agent: state.info.agent ?? "build",
      model: state.info.model,
      started: Date.now(),
    })
    publishSession(state, "session.text.started", { ...onMessage, ordinal: 0 })
    publishSession(state, "session.text.delta", {
      ...onMessage,
      ordinal: 0,
      delta: "OpenCode received: ",
    })
    publishSession(state, "session.text.delta", {
      ...onMessage,
      ordinal: 0,
      delta: prompt,
    })
    publishSession(state, "session.text.ended", {
      ...onMessage,
      ordinal: 0,
      text: `OpenCode received: ${prompt}`,
    })
    publishSession(state, "session.reasoning.started", {
      ...onMessage,
      ordinal: 0,
    })
    publishSession(state, "session.reasoning.ended", {
      ...onMessage,
      ordinal: 0,
      text: "Checking the workspace before making changes.",
    })
    publishSession(state, "session.tool.input.started", {
      ...onMessage,
      id: "tool-1",
      name: "bash",
    })
    publishSession(state, "session.tool.called", {
      ...onMessage,
      id: "tool-1",
      input: { command: "pwd" },
      executed: true,
    })
    publishSession(state, "session.tool.success", {
      ...onMessage,
      id: "tool-1",
      content: [{ type: "text", text: "/tmp/project" }],
      executed: true,
    })
    publishSession(state, "session.tool.input.started", {
      ...onMessage,
      id: "tool-2",
      name: "bash",
    })
    publishSession(state, "session.tool.called", {
      ...onMessage,
      id: "tool-2",
      input: { command: "false" },
      executed: true,
    })
    publishSession(state, "session.tool.failed", {
      ...onMessage,
      id: "tool-2",
      error: { type: "tool", message: "expected conformance failure" },
      executed: true,
    })

    const permission: OpencodePermissionRequest = {
      id: "permission-1",
      sessionID,
      action: "bash",
      resources: ["pwd"],
    }
    state.permissions.set(permission.id, permission)
    state.permission = deferred<void>()
    publishSession(state, "permission.asked", { ...permission })
    await state.permission.promise
    if (state.interrupted) return

    const form: OpencodeForm = {
      id: "question-1",
      sessionID,
      title: "Continue",
      fields: [
        {
          key: "continue",
          type: "string",
          title: "Continue",
          description: "Continue with the conformance turn?",
          required: true,
          options: [
            { value: "Yes", label: "Yes", description: "Continue the turn" },
            { value: "No", label: "No", description: "Stop the turn" },
          ],
          custom: true,
        },
      ],
    }
    state.forms.set(form.id, form)
    state.form = deferred<void>()
    publishSession(state, "form.created", { form })
    await state.form.promise
    if (state.interrupted) return

    publishSession(state, "session.step.ended", {
      ...onMessage,
      finish: "stop",
      cost: 0,
      tokens: {},
    })
    publishSession(state, "session.execution.succeeded", { sessionID })
    state.running = false
    state.wait?.resolve(undefined)
  }

  const api: OpencodeApi = {
    server: {
      async info() {
        return { version: options.version ?? "2.0.18" }
      },
    },
    model: {
      async list(input) {
        calls.directories.push(input?.location?.directory)
        return { data: models }
      },
      async default() {
        return {
          data:
            (defaultRef &&
              models.find(
                (model) =>
                  model.id === defaultRef.id &&
                  model.providerID === defaultRef.providerID
              )) ??
            null,
        }
      },
    },
    agent: {
      async list() {
        return { data: agents }
      },
    },
    session: {
      async create(input) {
        const id = `opencode-session-${++nextSession}`
        const info = {
          id,
          projectID: "project-1",
          ...(input.agent ? { agent: input.agent } : {}),
          ...(input.model ? { model: input.model } : {}),
          cost: 0,
          tokens: {},
          time: { created: Date.now(), updated: Date.now() },
          title: "Aide session",
          location: input.location ?? { directory: "/tmp/project" },
        } as unknown as OpencodeSessionInfo
        const state: SessionState = {
          info,
          events: new ReplayEventLog(),
          durableSequence: 0,
          wait: undefined,
          permission: undefined,
          form: undefined,
          permissions: new Map(),
          forms: new Map(),
          interrupted: false,
          running: false,
        }
        sessions.set(id, state)
        publishSession(state, "session.created", {
          sessionID: id,
          projectID: "project-1",
          location: info.location,
          slug: id,
          version: options.version ?? "2.0.18",
        })
        return info
      },
      async get({ sessionID }) {
        return requireSession(sessionID).info
      },
      async active() {
        return Object.fromEntries(
          [...sessions.entries()]
            .filter(([, state]) => state.running)
            .map(([id]) => [id, { type: "running" as const }])
        )
      },
      async switchAgent({ sessionID, agent }) {
        requireSession(sessionID).info.agent = agent
        calls.selections.push({ type: "agent", sessionID, agent })
      },
      async switchModel({ sessionID, model }) {
        // Mirrors OpenCode, which stores a missing variant as "default".
        requireSession(sessionID).info.model = {
          ...model,
          variant: model.variant ?? "default",
        }
        calls.selections.push({ type: "model", sessionID, model })
      },
      async prompt({ sessionID, id, text }) {
        const state = requireSession(sessionID)
        if (id !== undefined && !id.startsWith("msg_")) {
          throw new Error('Expected a string starting with "msg_"')
        }
        const messageID = id ?? `msg_${Date.now()}`
        calls.selections.push({
          type: "prompt",
          sessionID,
          id: messageID,
          text,
        })
        state.interrupted = false
        state.running = true
        state.wait = deferred<void>()
        queueMicrotask(() => void runTurn(state, messageID, text))
        return { id: messageID }
      },
      async wait({ sessionID }) {
        await requireSession(sessionID).wait?.promise
      },
      async interrupt({ sessionID }) {
        const state = requireSession(sessionID)
        calls.interrupts.push(sessionID)
        state.interrupted = true
        state.running = false
        state.permissions.clear()
        state.forms.clear()
        state.permission?.resolve(undefined)
        state.form?.resolve(undefined)
        state.wait?.resolve(undefined)
        publishSession(state, "session.execution.interrupted", {
          sessionID,
          reason: "user",
        })
        return {}
      },
      log({ sessionID, after }, requestOptions) {
        return requireSession(sessionID).events.stream(
          after,
          requestOptions?.signal
        )
      },
      form: {
        async list({ sessionID }) {
          return [...requireSession(sessionID).forms.values()]
        },
        async reply({ sessionID, formID, answer }) {
          const state = requireSession(sessionID)
          calls.formReplies.push({ formID, answer })
          state.forms.delete(formID)
          publishSession(state, "form.replied", {
            id: formID,
            sessionID,
            answer,
          })
          state.form?.resolve(undefined)
        },
        async cancel({ sessionID, formID }) {
          const state = requireSession(sessionID)
          state.forms.delete(formID)
          publishSession(state, "form.cancelled", { id: formID, sessionID })
          state.form?.resolve(undefined)
        },
      },
    },
    permission: {
      async list({ sessionID }) {
        return [...requireSession(sessionID).permissions.values()]
      },
      async reply({ sessionID, requestID, decision }) {
        const state = requireSession(sessionID)
        calls.permissionReplies.push({ requestID, reply: decision })
        state.permissions.delete(requestID)
        publishSession(state, "permission.replied", {
          sessionID,
          requestID,
          reply: decision,
        })
        state.permission?.resolve(undefined)
      },
    },
    event: {
      subscribe(requestOptions) {
        return live.subscribe(requestOptions?.signal)
      },
    },
    mcp: {
      async list(input) {
        return {
          data: [...mcpNames(input?.location?.directory)].map((name) => ({
            name,
            status: { status: "connected" as const },
          })),
        }
      },
      async add({ location, server }) {
        const directory = location?.directory
        calls.mcpAdds.push({ directory, name: server })
        if (mcpAddFailures.has(mcpKey(directory, server))) {
          throw new Error(`failed to add ${server}`)
        }
        const names = mcpNames(directory)
        names.add(server)
        mcpServers.set(directory ?? "", names)
      },
      async remove({ location, server }) {
        const directory = location?.directory
        calls.mcpRemoves.push({ directory, name: server })
        mcpNames(directory).delete(server)
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
