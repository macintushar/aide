import { describe, expect, it } from "vitest"
import {
  aideEventSchema,
  harnessInventorySchema,
  instanceConfigSchema,
  type AideEvent,
  type HarnessInventory,
  type InstanceConfig,
  type Request,
  type ResolvedExecution,
  type UserMessage,
} from "@workspace/contracts"
import type {
  HarnessAdapter,
  InstanceHandle,
  NativeSession,
} from "../../src/harness/types"

/**
 * Shared adapter conformance suite.
 *
 * Runs against any HarnessAdapter, including both real SDK adapters and the
 * fake adapter. This suite is the definition of done for adapter tracks: no
 * adapter merges on bespoke tests alone. It exercises only the public
 * adapter contract plus @workspace/contracts — it never imports an adapter
 * implementation directly and never references harness-specific behavior.
 */

export type ConformanceSubject = {
  adapter: HarnessAdapter
  /** Valid instance config for this adapter. */
  instanceConfig: InstanceConfig
  projectDirectory: string
}

/**
 * How much of the contract the adapter claims to implement.
 *
 * `"lifecycle"` covers configuration, start/stop/health, discovery, and MCP
 * normalization — everything a Wave 2 adapter owns. `"full"` adds sessions, the
 * turn script, requests, and interrupt, which arrive with the send path. The
 * suite is the same either way; the scope only selects which of its
 * expectations apply yet.
 */
export type ConformanceScope = "lifecycle" | "full"

export type ConformanceOptions = {
  name: string
  /** Returns a fresh, isolated subject. Called once per test. */
  createSubject: () => Promise<ConformanceSubject> | ConformanceSubject
  /** Defaults to `"full"`. */
  scope?: ConformanceScope
  /** Config value the adapter's configSchema must accept. */
  validConfig?: unknown
  /** Config value the adapter's configSchema must reject. */
  invalidConfig?: unknown
  /** Per-step timeout while awaiting adapter events. */
  stepTimeoutMs?: number
}

const TERMINAL_EVENT_TYPES = new Set([
  "turn.completed",
  "turn.interrupted",
  "turn.failed",
])

const SESSION_EVENT_TYPES = new Set([
  "part.upserted",
  "part.delta",
  "part.removed",
  "message.upserted",
  "turn.queued",
  "turn.started",
  "turn.completed",
  "turn.interrupted",
  "turn.failed",
  "request.opened",
  "request.resolved",
  "request.cancelled",
])

function isTerminal(event: AideEvent): boolean {
  return TERMINAL_EVENT_TYPES.has(event.type)
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`timed out after ${timeoutMs}ms waiting for ${label}`)
        ),
      timeoutMs
    )
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** Event collector with an optional auto-responder for permission and input requests. */
class TurnDriver {
  readonly events: AideEvent[] = []
  private done = false
  private readonly iterator: AsyncIterator<AideEvent>

  constructor(
    private readonly stream: AsyncIterable<AideEvent>,
    private readonly adapter: HarnessAdapter,
    private readonly handle: InstanceHandle,
    private readonly nativeSession: NativeSession,
    private readonly stepTimeoutMs: number,
    private readonly autoRespond = true
  ) {
    this.iterator = stream[Symbol.asyncIterator]()
  }

  /** Pulls events, answering requests when autoRespond is on, until `until` or a terminal event. */
  async run(until?: (event: AideEvent) => boolean): Promise<AideEvent[]> {
    try {
      while (!this.done) {
        const event = await withTimeout(
          this.iterator.next(),
          this.stepTimeoutMs,
          "next adapter event"
        )
        if (event.done) {
          break
        }
        aideEventSchema.parse(event.value)
        this.events.push(event.value)
        if (this.autoRespond && event.value.type === "request.opened") {
          await this.respond(event.value.data.request)
        }
        if (isTerminal(event.value) || until?.(event.value)) {
          break
        }
      }
    } finally {
      this.done = true
      await this.iterator.return?.()
    }
    return this.events
  }

  private async respond(request: Request): Promise<void> {
    const nativeSession = this.nativeSession
    const base = { handle: this.handle, request, nativeSession }
    if (request.kind === "permission") {
      const payloadOptions =
        request.payload.kind === "permission" ? request.payload.options : []
      const optionId =
        payloadOptions.find((option) => option.isDefault)?.id ??
        payloadOptions[0]?.id ??
        "allow"
      await this.adapter.respondToPermission({
        ...base,
        request: {
          ...request,
          resolution: { kind: "permission", optionId },
        },
      })
      return
    }
    const answers: Record<string, { optionIds?: string[]; text?: string }> = {}
    if (request.payload.kind === "input") {
      for (const question of request.payload.questions) {
        if (question.options && question.options.length > 0) {
          const optionId =
            question.options.find((option) => option.isDefault)?.id ??
            question.options[0].id
          answers[question.id] = {
            optionIds: question.allowMultiple ? [optionId] : [optionId],
          }
        } else {
          answers[question.id] = { text: "conformance suite answer" }
        }
      }
    }
    await this.adapter.respondToInput({
      ...base,
      request: {
        ...request,
        resolution: { kind: "input", answers },
      },
    })
  }
}

/** Builds an execution selection strictly from adapter-reported inventory. */
export function defaultExecutionFrom(
  handle: InstanceHandle,
  inventory: HarnessInventory
): ResolvedExecution {
  const model =
    inventory.models.find((entry) => entry.isDefault) ?? inventory.models[0]
  if (!model) {
    throw new Error("adapter reported no models")
  }
  const agent = inventory.capabilities.agentSelection
    ? (inventory.agents.find((entry) => entry.isDefault) ?? inventory.agents[0])
    : undefined
  const interactionMode = inventory.interactionModes.find(
    (entry) => entry.isDefault
  )
  const options: Record<string, string> = {}
  const displayOptions: Record<string, { label: string; valueLabel: string }> =
    {}
  for (const descriptor of model.optionDescriptors) {
    const optionId = descriptor.defaultValue ?? descriptor.options[0]?.id
    if (optionId === undefined) continue
    options[descriptor.id] = optionId
    displayOptions[descriptor.id] = {
      label: descriptor.label,
      valueLabel:
        descriptor.options.find((option) => option.id === optionId)?.label ??
        optionId,
    }
  }
  return {
    selection: {
      instanceId: handle.instanceId,
      driver: inventory.driver,
      model: {
        providerId: model.providerId,
        modelId: model.modelId,
      },
      agent: agent?.id,
      interactionMode: interactionMode?.id,
      options,
    },
    display: {
      instanceName: handle.instanceId,
      modelName: model.displayName,
      agentName: agent?.label,
      interactionModeName: interactionMode?.label,
      options: displayOptions,
    },
    inventoryRevision: inventory.revision,
  }
}

export function buildUserMessage(
  sessionId: string,
  seq: number,
  execution: ResolvedExecution,
  text: string
): UserMessage {
  const id = `conformance-user-${sessionId}-${seq}`
  return {
    id,
    sessionId,
    seq,
    role: "user",
    parts: [
      {
        id: `${id}-part-0`,
        messageId: id,
        index: 0,
        type: "text",
        text,
      },
    ],
    execution,
    createdAt: new Date(0).toISOString(),
  }
}

function assertCommonEventInvariants(events: AideEvent[]): void {
  const eventIds = new Set(events.map((event) => event.eventId))
  expect(eventIds.size, "every eventId is unique").toBe(events.length)

  const durableSequences: number[] = []
  for (const event of events) {
    if (SESSION_EVENT_TYPES.has(event.type)) {
      expect(event.scope.kind, `${event.type} uses session scope`).toBe(
        "session"
      )
    }
    if (event.type === "part.delta") {
      expect(event.delivery.durable, "part.delta is ephemeral").toBe(false)
    } else if (event.delivery.durable) {
      durableSequences.push(event.delivery.sequence)
    }
    if (event.scope.kind === "session") {
      expect(event.instanceId, "session events carry instanceId").toBeDefined()
    }
  }
  for (let index = 1; index < durableSequences.length; index += 1) {
    expect(
      durableSequences[index],
      "durable sequences are strictly increasing"
    ).toBeGreaterThan(durableSequences[index - 1])
  }
}

export function defineHarnessAdapterConformance(
  options: ConformanceOptions
): void {
  const stepTimeoutMs = options.stepTimeoutMs ?? 5_000
  const scope = options.scope ?? "full"
  /** Session-scoped expectations, skipped while an adapter is lifecycle-only. */
  const sessionIt = scope === "full" ? it : it.skip

  describe(`adapter conformance: ${options.name} (${scope})`, () => {
    it("accepts a valid driver config and rejects an invalid one", async () => {
      const subject = await options.createSubject()
      const schema = subject.adapter.configSchema
      const validate = async (value: unknown) =>
        await schema["~standard"].validate(value)
      const valid = await validate(options.validConfig ?? {})
      expect("issues" in valid, "valid config passes configSchema").toBe(false)
      const invalid = await validate(options.invalidConfig ?? { invalid: true })
      expect("issues" in invalid, "invalid config fails configSchema").toBe(
        true
      )
    })

    it("reports driver identity consistently across handle, config, and inventory", async () => {
      const subject = await options.createSubject()
      instanceConfigSchema.parse(subject.instanceConfig)
      const handle = await subject.adapter.start({
        instance: subject.instanceConfig,
        projectDirectory: subject.projectDirectory,
      })
      expect(handle.instanceId).toBe(subject.instanceConfig.instanceId)
      expect(handle.driver).toBe(subject.adapter.driver)
      const inventory = await subject.adapter.discover({
        handle,
        directory: subject.projectDirectory,
      })
      const parsed = harnessInventorySchema.parse(inventory)
      expect(parsed.instanceId).toBe(handle.instanceId)
      expect(parsed.driver).toBe(subject.adapter.driver)
      expect(parsed.models.length).toBeGreaterThan(0)
    })

    it("health reports a ready-family status after start and stopped after stop", async () => {
      const subject = await options.createSubject()
      const handle = await subject.adapter.start({
        instance: subject.instanceConfig,
        projectDirectory: subject.projectDirectory,
      })
      const health = await subject.adapter.health({ handle })
      expect(["ready", "degraded"]).toContain(health.status)
      expect(health.auth.status).toBeDefined()
      await subject.adapter.stop({ handle })
      const stopped = await subject.adapter.health({ handle })
      expect(stopped.status).toBe("stopped")
    })

    sessionIt(
      "openSession and resumeSession preserve native session identity",
      async () => {
        const subject = await options.createSubject()
        const adapter = subject.adapter
        const handle = await adapter.start({
          instance: subject.instanceConfig,
          projectDirectory: subject.projectDirectory,
        })
        const inventory = harnessInventorySchema.parse(
          await adapter.discover({
            handle,
            directory: subject.projectDirectory,
          })
        )
        const execution = defaultExecutionFrom(handle, inventory)
        const opened = await adapter.openSession({
          handle,
          sessionId: "conformance-session-resume",
          projectDirectory: subject.projectDirectory,
          execution,
        })
        expect(opened.nativeSessionId).toBeTruthy()
        const resumed = await adapter.resumeSession({
          handle,
          sessionId: "conformance-session-resume",
          nativeSessionId: opened.nativeSessionId,
          resumeCursor: opened.resumeCursor,
        })
        expect(resumed.nativeSessionId).toBe(opened.nativeSessionId)
      }
    )

    sessionIt(
      "runs a full turn with valid events, requests, and a terminal state",
      async () => {
        const subject = await options.createSubject()
        const adapter = subject.adapter
        const handle = await adapter.start({
          instance: subject.instanceConfig,
          projectDirectory: subject.projectDirectory,
        })
        const inventory = harnessInventorySchema.parse(
          await adapter.discover({
            handle,
            directory: subject.projectDirectory,
          })
        )
        const execution = defaultExecutionFrom(handle, inventory)
        const sessionId = "conformance-session-turn"
        const native = await adapter.openSession({
          handle,
          sessionId,
          projectDirectory: subject.projectDirectory,
          execution,
        })
        const userMessage = buildUserMessage(
          sessionId,
          1,
          execution,
          "conformance turn text"
        )
        const stream = adapter.events({ handle, nativeSession: native })
        const driver = new TurnDriver(
          stream,
          adapter,
          handle,
          native,
          stepTimeoutMs
        )
        await adapter.send({
          handle,
          nativeSession: native,
          commandId: "conformance-command-1",
          turnId: "conformance-turn-1",
          userMessage,
          execution,
        })
        const events = await driver.run()

        assertCommonEventInvariants(events)

        const types = events.map((event) => event.type)
        expect(types).toContain("turn.started")
        expect(types).toContain("message.upserted")
        expect(types).toContain("request.opened")
        expect(types).toContain("request.resolved")
        expect(types.filter((type) => type === "turn.completed")).toHaveLength(
          1
        )

        const toolEvents = events.filter(
          (event) =>
            event.type === "part.upserted" && event.data.part.type === "tool"
        )
        expect(toolEvents.length).toBeGreaterThan(0)
        const toolStatuses = new Set(
          toolEvents.map(
            (event) =>
              event.type === "part.upserted" &&
              event.data.part.type === "tool" &&
              event.data.part.status
          )
        )
        for (const status of ["pending", "running", "completed", "failed"]) {
          expect(toolStatuses, `tool part reaches ${status}`).toContain(status)
        }

        const reasoningEvents = events.filter(
          (event) =>
            event.type === "part.upserted" &&
            event.data.part.type === "reasoning"
        )
        expect(reasoningEvents.length).toBeGreaterThan(0)

        const textEvents = events.filter(
          (event) =>
            event.type === "part.upserted" && event.data.part.type === "text"
        )
        const echoed = textEvents
          .map((event) =>
            event.type === "part.upserted" && event.data.part.type === "text"
              ? event.data.part.text
              : ""
          )
          .join("\n")
        expect(echoed).toContain("conformance turn text")

        const openedRequests = events.filter(
          (event) => event.type === "request.opened"
        )
        const inputOpened = openedRequests.find(
          (event) =>
            event.type === "request.opened" &&
            event.data.request.kind === "input"
        )
        expect(inputOpened).toBeDefined()

        const terminalIndex = events.findIndex(isTerminal)
        expect(terminalIndex).toBeGreaterThan(-1)
        const afterTerminal = events.slice(terminalIndex + 1)
        expect(
          afterTerminal.filter(isTerminal),
          "exactly one terminal event"
        ).toHaveLength(0)
      }
    )

    sessionIt(
      "interrupt is idempotent, cancels open requests, and yields one interrupted terminal",
      async () => {
        const subject = await options.createSubject()
        const adapter = subject.adapter
        const handle = await adapter.start({
          instance: subject.instanceConfig,
          projectDirectory: subject.projectDirectory,
        })
        const inventory = harnessInventorySchema.parse(
          await adapter.discover({
            handle,
            directory: subject.projectDirectory,
          })
        )
        const execution = defaultExecutionFrom(handle, inventory)
        const sessionId = "conformance-session-interrupt"
        const native = await adapter.openSession({
          handle,
          sessionId,
          projectDirectory: subject.projectDirectory,
          execution,
        })
        const userMessage = buildUserMessage(
          sessionId,
          1,
          execution,
          "interrupt me"
        )
        const stream = adapter.events({ handle, nativeSession: native })
        const driver = new TurnDriver(
          stream,
          adapter,
          handle,
          native,
          stepTimeoutMs,
          false
        )
        await adapter.send({
          handle,
          nativeSession: native,
          commandId: "conformance-command-interrupt",
          turnId: "conformance-turn-interrupt",
          userMessage,
          execution,
        })
        await driver.run((event) => event.type === "request.opened")
        expect(
          driver.events.filter((event) => event.type === "request.opened")
            .length
        ).toBeGreaterThan(0)

        const postInterrupt: AideEvent[] = []
        const iterator = adapter
          .events({ handle, nativeSession: native })
          [Symbol.asyncIterator]()

        await adapter.interrupt({
          handle,
          nativeSession: native,
          turnId: "conformance-turn-interrupt",
        })

        const drainDeadline = Date.now() + stepTimeoutMs
        while (Date.now() < drainDeadline) {
          const next = await Promise.race([
            iterator.next(),
            new Promise<"timeout">((resolve) =>
              setTimeout(() => resolve("timeout"), 50)
            ),
          ])
          if (next === "timeout") break
          if (next.done) break
          aideEventSchema.parse(next.value)
          postInterrupt.push(next.value)
          if (isTerminal(next.value)) break
        }
        await iterator.return?.()

        expect(
          postInterrupt.filter((event) => event.type === "turn.interrupted"),
          "exactly one turn.interrupted"
        ).toHaveLength(1)
        expect(
          postInterrupt.filter((event) => event.type === "turn.completed"),
          "no completed event after interrupt"
        ).toHaveLength(0)
        expect(
          postInterrupt.filter((event) => event.type === "request.cancelled")
            .length
        ).toBeGreaterThan(0)
      }
    )

    it("normalizes MCP server configuration into one status per server", async () => {
      const subject = await options.createSubject()
      const adapter = subject.adapter
      const handle = await adapter.start({
        instance: subject.instanceConfig,
        projectDirectory: subject.projectDirectory,
      })
      await adapter.setMcpServers({
        handle,
        servers: {
          "conformance-stdio": {
            type: "stdio",
            command: "conformance-server",
            args: ["--stdio"],
          },
          "conformance-http": {
            type: "http",
            url: "http://127.0.0.1:1/conformance",
          },
        },
      })
      const statuses = await adapter.mcpStatus({ handle })
      expect(statuses).toHaveLength(2)
      const names = new Set(statuses.map((status) => status.name))
      expect(names.has("conformance-stdio")).toBe(true)
      expect(names.has("conformance-http")).toBe(true)
      for (const status of statuses) {
        expect(typeof status.connected).toBe("boolean")
      }
    })

    async function startTwoInstances(subject: ConformanceSubject) {
      const adapter = subject.adapter
      const handleA = await adapter.start({
        instance: subject.instanceConfig,
        projectDirectory: subject.projectDirectory,
      })
      const secondConfig: InstanceConfig = {
        ...subject.instanceConfig,
        instanceId: `${subject.instanceConfig.instanceId}-second`,
      }
      const handleB = await adapter.start({
        instance: secondConfig,
        projectDirectory: subject.projectDirectory,
      })
      return { adapter, handleA, handleB }
    }

    it("isolates the inventory of two instances started from the same adapter", async () => {
      const subject = await options.createSubject()
      const { adapter, handleA, handleB } = await startTwoInstances(subject)
      expect(handleA.instanceId).not.toBe(handleB.instanceId)

      const inventoryA = harnessInventorySchema.parse(
        await adapter.discover({ handle: handleA })
      )
      const inventoryB = harnessInventorySchema.parse(
        await adapter.discover({ handle: handleB })
      )
      expect(inventoryA.instanceId).toBe(handleA.instanceId)
      expect(inventoryB.instanceId).toBe(handleB.instanceId)
    })

    sessionIt("isolates the native sessions of two instances", async () => {
      const subject = await options.createSubject()
      const { adapter, handleA, handleB } = await startTwoInstances(subject)

      const inventoryA = harnessInventorySchema.parse(
        await adapter.discover({ handle: handleA })
      )
      const inventoryB = harnessInventorySchema.parse(
        await adapter.discover({ handle: handleB })
      )

      const sessionA = await adapter.openSession({
        handle: handleA,
        sessionId: "conformance-isolation",
        projectDirectory: subject.projectDirectory,
        execution: defaultExecutionFrom(handleA, inventoryA),
      })
      const sessionB = await adapter.openSession({
        handle: handleB,
        sessionId: "conformance-isolation",
        projectDirectory: subject.projectDirectory,
        execution: defaultExecutionFrom(handleB, inventoryB),
      })
      expect(sessionA.nativeSessionId).not.toBe(sessionB.nativeSessionId)
    })
  })
}
