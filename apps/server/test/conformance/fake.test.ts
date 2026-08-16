import { describe, expect, it } from "vitest"
import {
  harnessInventorySchema,
  type AideEvent,
  type InstanceConfig,
} from "@workspace/contracts"
import {
  buildUserMessage,
  defaultExecutionFrom,
  defineHarnessAdapterConformance,
} from "./adapter-conformance"
import {
  createFakeHarnessAdapter,
  FakeAdapterError,
  type FakeHarnessControl,
} from "../../src/harness/fake"
import type {
  HarnessAdapter,
  InstanceHandle,
  NativeSession,
} from "../../src/harness/types"

const PROJECT_DIRECTORY = "/tmp/aide-conformance-fake"

function fakeSubject(
  overrides: Partial<{ driver: "opencode" | "claudeAgent" }> = {}
): {
  adapter: HarnessAdapter
  control: FakeHarnessControl
  instanceConfig: InstanceConfig
  projectDirectory: string
} {
  const { adapter, control } = createFakeHarnessAdapter({
    driver: overrides.driver ?? "opencode",
    projectId: "conformance-fake-project",
  })
  const instanceConfig: InstanceConfig = {
    instanceId: "fake-primary",
    driver: adapter.driver,
    displayName: "Fake Primary",
    enabled: true,
    autoStart: true,
    config: {},
  }
  return {
    adapter,
    control,
    instanceConfig,
    projectDirectory: PROJECT_DIRECTORY,
  }
}

defineHarnessAdapterConformance({
  name: "fake",
  createSubject: () => fakeSubject(),
  validConfig: {},
  invalidConfig: { failStart: "yes" },
})

async function bootTurn(options: {
  driver?: "opencode" | "claudeAgent"
  sessionId?: string
}): Promise<{
  adapter: HarnessAdapter
  control: FakeHarnessControl
  handle: InstanceHandle
  native: NativeSession
  stream: AsyncIterable<AideEvent>
}> {
  const subject = fakeSubject({ driver: options.driver })
  const adapter = subject.adapter
  const handle = await adapter.start({
    instance: subject.instanceConfig,
    projectDirectory: subject.projectDirectory,
  })
  const inventory = harnessInventorySchema.parse(
    await adapter.discover({ handle, directory: subject.projectDirectory })
  )
  const execution = defaultExecutionFrom(handle, inventory)
  const sessionId = options.sessionId ?? "fake-session"
  const native = await adapter.openSession({
    handle,
    sessionId,
    projectDirectory: subject.projectDirectory,
    execution,
  })
  const stream = adapter.events({ handle, nativeSession: native })
  return { adapter, control: subject.control, handle, native, stream }
}

async function resolveAllRequests(
  adapter: HarnessAdapter,
  handle: InstanceHandle,
  native: NativeSession,
  stream: AsyncIterable<AideEvent>
): Promise<AideEvent[]> {
  const events: AideEvent[] = []
  const iterator = stream[Symbol.asyncIterator]()
  try {
    for (;;) {
      const result = await Promise.race([
        iterator.next(),
        new Promise<"timeout">((resolve) =>
          setTimeout(() => resolve("timeout"), 200)
        ),
      ])
      if (result === "timeout") break
      if (result.done) break
      const event = result.value
      events.push(event)
      if (event.type === "request.opened") {
        const request = event.data.request
        if (request.kind === "permission") {
          await adapter.respondToPermission({
            handle,
            nativeSession: native,
            request: {
              ...request,
              resolution: { kind: "permission", optionId: "allow" },
            },
          })
        } else {
          await adapter.respondToInput({
            handle,
            nativeSession: native,
            request: {
              ...request,
              resolution: {
                kind: "input",
                answers: {
                  approach: { optionIds: ["fast"] },
                  notes: { text: "fake test notes" },
                },
              },
            },
          })
        }
      }
      if (
        event.type === "turn.completed" ||
        event.type === "turn.interrupted" ||
        event.type === "turn.failed"
      ) {
        break
      }
    }
  } finally {
    await iterator.return?.()
  }
  return events
}

describe("fake harness adapter: dispatch outcomes", () => {
  it("dedupes an exact retry of an acknowledged send", async () => {
    const { adapter, control, handle, native, stream } = await bootTurn({})
    const inventory = harnessInventorySchema.parse(
      await adapter.discover({ handle })
    )
    const execution = defaultExecutionFrom(handle, inventory)
    const userMessage = buildUserMessage(
      "fake-session",
      1,
      execution,
      "idempotent send"
    )
    const input = {
      handle,
      nativeSession: native,
      commandId: "fake-command-idem",
      turnId: "fake-turn-idem",
      userMessage,
      execution,
    }

    await adapter.send(input)
    const events = await resolveAllRequests(adapter, handle, native, stream)
    expect(events.filter((e) => e.type === "turn.completed")).toHaveLength(1)

    await adapter.send(input)

    expect(control.invocationCount(userMessage.id)).toBe(2)
    expect(control.effectCount(userMessage.id)).toBe(1)
  })

  it("records the effect then stays ambiguous on retry", async () => {
    const { adapter, control, handle, native, stream } = await bootTurn({})
    const inventory = harnessInventorySchema.parse(
      await adapter.discover({ handle })
    )
    const execution = defaultExecutionFrom(handle, inventory)
    const userMessage = buildUserMessage(
      "fake-session",
      1,
      execution,
      "ambiguous send"
    )
    const input = {
      handle,
      nativeSession: native,
      commandId: "fake-command-ambiguous",
      turnId: "fake-turn-ambiguous",
      userMessage,
      execution,
    }
    control.setNextDispatchOutcome("ambiguous-after-effect")

    await expect(adapter.send(input)).rejects.toBeInstanceOf(FakeAdapterError)
    const events = await resolveAllRequests(adapter, handle, native, stream)
    expect(events.filter((e) => e.type === "turn.completed")).toHaveLength(1)
    expect(control.effectCount(userMessage.id)).toBe(1)

    await expect(adapter.send(input)).rejects.toBeInstanceOf(FakeAdapterError)
    expect(control.effectCount(userMessage.id)).toBe(1)
  })

  it("rejects a known-not-dispatched send before any effect", async () => {
    const { adapter, control, handle, native } = await bootTurn({})
    const inventory = harnessInventorySchema.parse(
      await adapter.discover({ handle })
    )
    const execution = defaultExecutionFrom(handle, inventory)
    const userMessage = buildUserMessage(
      "fake-session",
      1,
      execution,
      "rejected send"
    )
    control.setNextDispatchOutcome("known-not-dispatched")

    await expect(
      adapter.send({
        handle,
        nativeSession: native,
        commandId: "fake-command-rejected",
        turnId: "fake-turn-rejected",
        userMessage,
        execution,
      })
    ).rejects.toMatchObject({
      aideError: { code: "dispatch_rejected", retryable: true },
    })
    expect(control.effectCount(userMessage.id)).toBe(0)

    const iterator = adapter
      .events({ handle, nativeSession: native })
      [Symbol.asyncIterator]()
    const result = await Promise.race([
      iterator.next(),
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), 50)
      ),
    ])
    await iterator.return?.()
    expect(result).toBe("timeout")
  })

  it("echoes canonical user text without leaking handoff content", async () => {
    const { adapter, handle, native, stream } = await bootTurn({
      sessionId: "fake-session",
    })
    const inventory = harnessInventorySchema.parse(
      await adapter.discover({ handle })
    )
    const execution = defaultExecutionFrom(handle, inventory)
    const userMessage = buildUserMessage(
      "fake-session",
      1,
      execution,
      "hello fake"
    )
    await adapter.send({
      handle,
      nativeSession: native,
      commandId: "fake-command-echo",
      turnId: "fake-turn-echo",
      userMessage,
      execution,
      handoff: {
        id: "fake-handoff-1",
        turnId: "fake-turn-echo",
        instanceId: handle.instanceId,
        nativeSessionId: native.nativeSessionId,
        role: "handoff",
        fromMessageSeq: 0,
        throughMessageSeq: 0,
        content: "HANDOFF SECRET CONTENT",
        createdAt: new Date(0).toISOString(),
      },
    })
    const events = await resolveAllRequests(adapter, handle, native, stream)
    const textParts = events
      .filter(
        (event) =>
          event.type === "part.upserted" && event.data.part.type === "text"
      )
      .map((event) =>
        event.type === "part.upserted" && event.data.part.type === "text"
          ? event.data.part.text
          : ""
      )
    expect(textParts).toEqual(["hello fake"])
    expect(
      events.some((event) =>
        JSON.stringify(event).includes("HANDOFF SECRET CONTENT")
      )
    ).toBe(false)
  })

  it("masquerades as the claudeAgent driver when configured", async () => {
    const { adapter } = await bootTurn({ driver: "claudeAgent" })
    expect(adapter.driver).toBe("claudeAgent")
  })

  it("fails start when configured with failStart", async () => {
    const { adapter } = createFakeHarnessAdapter()
    await expect(
      adapter.start({
        instance: {
          instanceId: "fake-doomed",
          driver: adapter.driver,
          enabled: true,
          autoStart: false,
          config: { failStart: true },
        },
        projectDirectory: PROJECT_DIRECTORY,
      })
    ).rejects.toBeInstanceOf(FakeAdapterError)
  })
})
