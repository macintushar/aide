import { describe, expect, it } from "vitest"
import type {
  AideEvent,
  InstanceConfig,
  Request,
  ResolvedExecution,
  Turn,
  UserMessage,
} from "@workspace/contracts"

import { createOpencodeSdkDouble } from "../../../test/opencode-sdk-double"
import { createOpencodeAdapter } from "../adapter"

const PROJECT_DIRECTORY = "/tmp/aide-opencode-send"

const INSTANCE: InstanceConfig = {
  instanceId: "opencode",
  driver: "opencode",
  displayName: "OpenCode",
  enabled: true,
  autoStart: true,
  config: {},
}

function execution(
  overrides: {
    modelId?: string
    providerId?: string
    agent?: string
    variant?: string
  } = {}
): ResolvedExecution {
  const modelId = overrides.modelId ?? "claude-opus-5"
  return {
    selection: {
      instanceId: "opencode",
      driver: "opencode",
      model: {
        providerId: overrides.providerId ?? "anthropic",
        modelId,
      },
      agent: overrides.agent ?? "build",
      options: { variant: overrides.variant ?? "standard" },
    },
    display: {
      instanceName: "OpenCode",
      modelName: modelId,
      agentName: overrides.agent ?? "build",
      options: {
        variant: {
          label: "Variant",
          valueLabel: overrides.variant ?? "standard",
        },
      },
    },
    inventoryRevision: "opencode-revision",
  }
}

function userMessage(value: ResolvedExecution): UserMessage {
  return {
    id: "user-message-1",
    sessionId: "aide-session-1",
    seq: 1,
    role: "user",
    parts: [
      {
        id: "user-message-1-part-0",
        messageId: "user-message-1",
        index: 0,
        type: "text",
        text: "finish the adapter",
      },
    ],
    execution: value,
    createdAt: new Date(0).toISOString(),
  }
}

async function subject() {
  const double = createOpencodeSdkDouble()
  const adapter = createOpencodeAdapter({
    createRuntime: async () => ({ api: double.api }),
  })
  const handle = await adapter.start({
    instance: INSTANCE,
    projectDirectory: PROJECT_DIRECTORY,
  })
  const selected = execution()
  const nativeSession = await adapter.openSession({
    handle,
    sessionId: "aide-session-1",
    projectDirectory: PROJECT_DIRECTORY,
    execution: selected,
  })
  return { ...double, adapter, handle, nativeSession, selected }
}

async function nextMatching(
  iterator: AsyncIterator<AideEvent>,
  predicate: (event: AideEvent) => boolean,
  seen?: AideEvent[]
): Promise<AideEvent> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const result = await Promise.race([
      iterator.next(),
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), 50)
      ),
    ])
    if (result === "timeout") continue
    if (result.done) throw new Error("OpenCode event stream closed")
    seen?.push(result.value)
    if (predicate(result.value)) return result.value
  }
  throw new Error("Timed out waiting for an OpenCode adapter event")
}

describe("opencode send", () => {
  it("switches model and agent before idempotent queue admission", async () => {
    const { adapter, handle, nativeSession, selected, calls } = await subject()

    await adapter.send({
      handle,
      nativeSession,
      commandId: "command-1",
      turnId: "turn-1",
      userMessage: userMessage(selected),
      execution: selected,
      handoff: {
        id: "handoff-1",
        turnId: "turn-1",
        instanceId: "opencode",
        nativeSessionId: nativeSession.nativeSessionId,
        role: "handoff",
        fromMessageSeq: 0,
        throughMessageSeq: 0,
        content: "PRIOR CONTEXT",
        createdAt: new Date(0).toISOString(),
      },
    })

    expect(calls.selections).toEqual([
      {
        type: "model",
        sessionID: nativeSession.nativeSessionId,
        model: {
          id: "claude-opus-5",
          providerID: "anthropic",
          variant: "standard",
        },
      },
      {
        type: "agent",
        sessionID: nativeSession.nativeSessionId,
        agent: "build",
      },
      {
        type: "prompt",
        sessionID: nativeSession.nativeSessionId,
        id: "user-message-1",
        text: "PRIOR CONTEXT\n\nfinish the adapter",
      },
    ])
    expect(nativeSession.resumeCursor).toBe("1")

    await adapter.interrupt({ handle, nativeSession, turnId: "turn-1" })
  })

  it("fails before admission when a selection switch is rejected", async () => {
    const { api, calls } = createOpencodeSdkDouble()
    api.v2!.session.switchModel = async () => ({ error: { message: "nope" } })
    const adapter = createOpencodeAdapter({
      createRuntime: async () => ({ api }),
    })
    const handle = await adapter.start({
      instance: INSTANCE,
      projectDirectory: PROJECT_DIRECTORY,
    })
    const selected = execution()
    const nativeSession = await adapter.openSession({
      handle,
      sessionId: "aide-session-1",
      projectDirectory: PROJECT_DIRECTORY,
      execution: selected,
    })

    await expect(
      adapter.send({
        handle,
        nativeSession,
        commandId: "command-1",
        turnId: "turn-1",
        userMessage: userMessage(selected),
        execution: selected,
      })
    ).rejects.toMatchObject({ aideError: { code: "model_switch_failed" } })
    expect(calls.selections).toEqual([])
  })

  it("maps pinned snapshots and deltas and preserves mixed question answers", async () => {
    const { adapter, handle, nativeSession, selected, calls } = await subject()
    const iterator = adapter
      .events({ handle, nativeSession })
      [Symbol.asyncIterator]()
    const events: AideEvent[] = []

    await adapter.send({
      handle,
      nativeSession,
      commandId: "command-1",
      turnId: "turn-1",
      userMessage: userMessage(selected),
      execution: selected,
    })

    const permissionEvent = await nextMatching(
      iterator,
      (event) =>
        event.type === "request.opened" &&
        event.data.request.kind === "permission",
      events
    )
    expect(permissionEvent.type).toBe("request.opened")
    if (
      permissionEvent.type !== "request.opened" ||
      permissionEvent.data.request.kind !== "permission"
    ) {
      throw new Error("Expected a permission request")
    }
    const permission: Request = {
      ...permissionEvent.data.request,
      status: "resolved",
      resolution: { kind: "permission", optionId: "allow" },
    }
    await adapter.respondToPermission({
      handle,
      nativeSession,
      request: permission,
    })

    const inputEvent = await nextMatching(
      iterator,
      (event) =>
        event.type === "request.opened" && event.data.request.kind === "input",
      events
    )
    if (
      inputEvent.type !== "request.opened" ||
      inputEvent.data.request.kind !== "input"
    ) {
      throw new Error("Expected an input request")
    }
    const input: Request = {
      ...inputEvent.data.request,
      status: "resolved",
      resolution: {
        kind: "input",
        answers: {
          "question-0": { optionIds: ["Yes"], text: "custom detail" },
        },
      },
    }
    await adapter.respondToInput({ handle, nativeSession, request: input })

    const terminal = await nextMatching(
      iterator,
      (event) => event.type === "turn.completed",
      events
    )
    expect(terminal.type).toBe("turn.completed")
    expect(calls.questionReplies).toEqual([
      { requestID: "question-1", answers: [["Yes", "custom detail"]] },
    ])
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "part.delta",
        delivery: expect.objectContaining({ durable: false }),
      })
    )
    expect(Number(nativeSession.resumeCursor)).toBeGreaterThan(1)

    await iterator.return?.()
  })

  it("normalizes file and agent parts and filters unrelated removals", async () => {
    const { adapter, handle, nativeSession, selected, controls } =
      await subject()
    const iterator = adapter
      .events({ handle, nativeSession })
      [Symbol.asyncIterator]()
    const events: AideEvent[] = []
    const sessionID = nativeSession.nativeSessionId
    const messageID = "user-message-1-assistant"

    await adapter.send({
      handle,
      nativeSession,
      commandId: "command-1",
      turnId: "turn-1",
      userMessage: userMessage(selected),
      execution: selected,
    })

    controls.publish(sessionID, "message.part.updated", {
      sessionID,
      time: Date.now(),
      part: {
        id: "file-plain",
        sessionID,
        messageID,
        type: "file",
        url: "/tmp/plain.txt",
        mime: "text/plain",
      },
    })
    controls.publish(sessionID, "message.part.updated", {
      sessionID,
      time: Date.now(),
      part: {
        id: "file-url",
        sessionID,
        messageID,
        type: "file",
        url: "file:///tmp/aide%20report.txt",
        mime: "text/plain",
      },
    })
    controls.publish(sessionID, "message.part.updated", {
      sessionID,
      time: Date.now(),
      part: {
        id: "file-malformed",
        sessionID,
        messageID,
        type: "file",
        url: "file://%",
        mime: "application/octet-stream",
      },
    })
    controls.publish(sessionID, "message.part.updated", {
      sessionID,
      time: Date.now(),
      part: {
        id: "agent-1",
        sessionID,
        messageID,
        type: "agent",
        name: "explore",
      },
    })
    controls.publish(sessionID, "message.part.updated", {
      sessionID,
      time: Date.now(),
      part: {
        id: "ignored-step",
        sessionID,
        messageID,
        type: "step-start",
      },
    })
    controls.publish(sessionID, "message.part.removed", {
      sessionID: "another-session",
      messageID,
      partID: "file-plain",
    })
    controls.publish(sessionID, "message.part.removed", {
      sessionID,
      messageID,
      partID: "file-plain",
    })

    await expect(
      nextMatching(iterator, (event) => event.type === "part.removed", events)
    ).resolves.toMatchObject({
      type: "part.removed",
      data: {
        partId: "turn-1-file-plain",
        messageId: "turn-1-assistant",
      },
    })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "part.upserted",
          data: {
            part: expect.objectContaining({
              id: "turn-1-file-plain",
              type: "file",
              path: "/tmp/plain.txt",
            }),
          },
        }),
        expect.objectContaining({
          type: "part.upserted",
          data: {
            part: expect.objectContaining({
              id: "turn-1-file-url",
              type: "file",
              path: "/tmp/aide report.txt",
            }),
          },
        }),
        expect.objectContaining({
          type: "part.upserted",
          data: {
            part: expect.objectContaining({
              id: "turn-1-file-malformed",
              type: "file",
              path: "file://%",
            }),
          },
        }),
        expect.objectContaining({
          type: "part.upserted",
          data: {
            part: expect.objectContaining({
              id: "turn-1-agent-1",
              type: "agent",
              name: "explore",
            }),
          },
        }),
      ])
    )
    expect(
      events.some(
        (event) =>
          event.type === "part.upserted" &&
          event.data.part.id === "turn-1-ignored-step"
      )
    ).toBe(false)
    expect(
      events.filter((event) => event.type === "part.removed")
    ).toHaveLength(1)

    await adapter.interrupt({ handle, nativeSession, turnId: "turn-1" })
    await iterator.return?.()
  })

  it("reconciles questions answered or rejected outside Aide", async () => {
    const { adapter, handle, nativeSession, selected, controls } =
      await subject()
    const iterator = adapter
      .events({ handle, nativeSession })
      [Symbol.asyncIterator]()
    const sessionID = nativeSession.nativeSessionId

    await adapter.send({
      handle,
      nativeSession,
      commandId: "command-1",
      turnId: "turn-1",
      userMessage: userMessage(selected),
      execution: selected,
    })

    controls.publish(sessionID, "question.v2.asked", {
      id: "external-question",
      sessionID,
      questions: [
        {
          question: "Proceed?",
          header: "Decision",
          options: [
            { label: "Yes", description: "Continue" },
            { label: "No", description: "Stop" },
          ],
          multiple: true,
          custom: true,
        },
        {
          question: "Additional details?",
          header: "Details",
          options: [],
          custom: true,
        },
      ],
    })
    await nextMatching(
      iterator,
      (event) =>
        event.type === "request.opened" &&
        event.data.request.id === "external-question"
    )

    controls.publish(sessionID, "question.v2.replied", {
      sessionID,
      requestID: "external-question",
      answers: [
        ["Yes", "custom line one", "custom line two"],
        ["free-form detail"],
      ],
    })
    await expect(
      nextMatching(
        iterator,
        (event) =>
          event.type === "request.resolved" &&
          event.data.request.id === "external-question"
      )
    ).resolves.toMatchObject({
      type: "request.resolved",
      data: {
        request: {
          kind: "input",
          status: "resolved",
          resolution: {
            kind: "input",
            answers: {
              "question-0": {
                optionIds: ["Yes"],
                text: "custom line one\ncustom line two",
              },
              "question-1": { text: "free-form detail" },
            },
          },
        },
      },
    })

    controls.publish(sessionID, "question.v2.asked", {
      id: "external-rejected-question",
      sessionID,
      questions: [
        {
          question: "Choose?",
          header: "Choice",
          options: [{ label: "One", description: "First" }],
          custom: false,
        },
      ],
    })
    await nextMatching(
      iterator,
      (event) =>
        event.type === "request.opened" &&
        event.data.request.id === "external-rejected-question"
    )
    controls.publish(sessionID, "question.v2.rejected", {
      sessionID,
      requestID: "external-rejected-question",
    })
    await expect(
      nextMatching(
        iterator,
        (event) =>
          event.type === "request.cancelled" &&
          event.data.request.id === "external-rejected-question"
      )
    ).resolves.toMatchObject({
      type: "request.cancelled",
      data: {
        request: {
          kind: "input",
          status: "cancelled",
        },
      },
    })

    await adapter.interrupt({ handle, nativeSession, turnId: "turn-1" })
    await iterator.return?.()
  })

  it("rejects invalid or stale permission and input responses", async () => {
    const { adapter, handle, nativeSession, selected, calls } = await subject()
    const iterator = adapter
      .events({ handle, nativeSession })
      [Symbol.asyncIterator]()
    await adapter.send({
      handle,
      nativeSession,
      commandId: "command-1",
      turnId: "turn-1",
      userMessage: userMessage(selected),
      execution: selected,
    })

    const permissionEvent = await nextMatching(
      iterator,
      (event) =>
        event.type === "request.opened" &&
        event.data.request.kind === "permission"
    )
    if (
      permissionEvent.type !== "request.opened" ||
      permissionEvent.data.request.kind !== "permission"
    ) {
      throw new Error("Expected a permission request")
    }
    const permission = permissionEvent.data.request
    await expect(
      adapter.respondToPermission({
        handle,
        nativeSession,
        request: { ...permission, status: "resolved" } as Request,
      })
    ).rejects.toMatchObject({ aideError: { code: "invalid_resolution" } })
    await expect(
      adapter.respondToPermission({
        handle,
        nativeSession,
        request: {
          ...permission,
          status: "resolved",
          resolution: { kind: "permission", optionId: "maybe" },
        } as Request,
      })
    ).rejects.toMatchObject({ aideError: { code: "invalid_resolution" } })
    const allowed: Request = {
      ...permission,
      status: "resolved",
      resolution: { kind: "permission", optionId: "allow" },
    }
    await adapter.respondToPermission({
      handle,
      nativeSession,
      request: allowed,
    })
    await expect(
      adapter.respondToPermission({
        handle,
        nativeSession,
        request: allowed,
      })
    ).rejects.toMatchObject({ aideError: { code: "request_not_open" } })

    const inputEvent = await nextMatching(
      iterator,
      (event) =>
        event.type === "request.opened" && event.data.request.kind === "input"
    )
    if (
      inputEvent.type !== "request.opened" ||
      inputEvent.data.request.kind !== "input"
    ) {
      throw new Error("Expected an input request")
    }
    const input = inputEvent.data.request
    await expect(
      adapter.respondToInput({
        handle,
        nativeSession,
        request: { ...input, status: "resolved" } as Request,
      })
    ).rejects.toMatchObject({ aideError: { code: "invalid_resolution" } })
    await expect(
      adapter.respondToInput({
        handle,
        nativeSession,
        request: {
          ...input,
          status: "resolved",
          resolution: { kind: "input", answers: {} },
        },
      })
    ).rejects.toMatchObject({ aideError: { code: "invalid_resolution" } })
    await expect(
      adapter.respondToInput({
        handle,
        nativeSession,
        request: {
          ...input,
          status: "resolved",
          resolution: {
            kind: "input",
            answers: { "question-0": { optionIds: ["Maybe"] } },
          },
        },
      })
    ).rejects.toMatchObject({ aideError: { code: "invalid_resolution" } })
    const answered: Request = {
      ...input,
      status: "resolved",
      resolution: {
        kind: "input",
        answers: { "question-0": { optionIds: ["Yes"] } },
      },
    }
    await adapter.respondToInput({
      handle,
      nativeSession,
      request: answered,
    })
    await expect(
      adapter.respondToInput({
        handle,
        nativeSession,
        request: answered,
      })
    ).rejects.toMatchObject({ aideError: { code: "request_not_open" } })
    expect(calls.permissionReplies).toEqual([
      { requestID: "permission-1", reply: "once" },
    ])
    expect(calls.questionReplies).toEqual([
      { requestID: "question-1", answers: [["Yes"]] },
    ])

    await expect(
      nextMatching(iterator, (event) => event.type === "turn.completed")
    ).resolves.toMatchObject({ type: "turn.completed" })
    await iterator.return?.()
  })

  it("emits an error before failing a turn on session.error", async () => {
    const { adapter, handle, nativeSession, selected, controls } =
      await subject()
    const iterator = adapter
      .events({ handle, nativeSession })
      [Symbol.asyncIterator]()
    await adapter.send({
      handle,
      nativeSession,
      commandId: "command-1",
      turnId: "turn-1",
      userMessage: userMessage(selected),
      execution: selected,
    })

    controls.publish(nativeSession.nativeSessionId, "session.error", {
      sessionID: nativeSession.nativeSessionId,
      error: { name: "UnknownError", data: { message: "provider failed" } },
    })
    const error = await nextMatching(
      iterator,
      (event) => event.type === "error.occurred"
    )
    const failed = await nextMatching(
      iterator,
      (event) => event.type === "turn.failed"
    )
    expect(error).toMatchObject({
      type: "error.occurred",
      data: { error: { message: "provider failed" } },
    })
    expect(failed.type).toBe("turn.failed")
    await iterator.return?.()
  })

  it("treats session.status idle as authoritative completion", async () => {
    const { adapter, handle, nativeSession, selected, controls } =
      await subject()
    const iterator = adapter
      .events({ handle, nativeSession })
      [Symbol.asyncIterator]()
    await adapter.send({
      handle,
      nativeSession,
      commandId: "command-1",
      turnId: "turn-1",
      userMessage: userMessage(selected),
      execution: selected,
    })

    controls.publish(nativeSession.nativeSessionId, "session.status", {
      sessionID: nativeSession.nativeSessionId,
      status: { type: "idle" },
    })
    await expect(
      nextMatching(iterator, (event) => event.type === "turn.completed")
    ).resolves.toMatchObject({ type: "turn.completed" })
    await iterator.return?.()
  })

  it("emits notices for native retry events", async () => {
    const { adapter, handle, nativeSession, selected, controls } =
      await subject()
    const iterator = adapter
      .events({ handle, nativeSession })
      [Symbol.asyncIterator]()
    const events: AideEvent[] = []
    const sessionID = nativeSession.nativeSessionId

    await adapter.send({
      handle,
      nativeSession,
      commandId: "command-1",
      turnId: "turn-1",
      userMessage: userMessage(selected),
      execution: selected,
    })
    controls.publish(sessionID, "session.status", {
      sessionID,
      status: { type: "busy" },
    })
    controls.publish(sessionID, "session.status", {
      sessionID,
      status: {
        type: "retry",
        attempt: 1,
        message: "Provider rate-limited the request",
        next: Date.now() + 1_000,
      },
    })

    await expect(
      nextMatching(iterator, (event) => event.type === "notice.created", events)
    ).resolves.toMatchObject({
      type: "notice.created",
      data: {
        title: "OpenCode is retrying",
        message: "Provider rate-limited the request",
        level: "warning",
      },
      scope: { turnId: "turn-1" },
    })

    controls.publish(sessionID, "session.next.retried", {
      sessionID,
      attempt: 2,
    })
    await expect(
      nextMatching(iterator, (event) => event.type === "notice.created", events)
    ).resolves.toMatchObject({
      type: "notice.created",
      data: {
        title: "OpenCode is retrying",
        message: "Retrying the model request (attempt 2).",
        level: "warning",
      },
      scope: { turnId: "turn-1" },
    })
    expect(
      events.filter((event) => event.type === "notice.created")
    ).toHaveLength(2)

    await adapter.interrupt({ handle, nativeSession, turnId: "turn-1" })
    await iterator.return?.()
  })

  it("lets interruption win when rejecting a request triggers idle", async () => {
    const { api, controls, adapter, handle, nativeSession, selected } =
      await subject()
    const interrupt = api.v2!.session.interrupt.bind(api.v2!.session)
    api.v2!.session.interrupt = async (parameters) => {
      controls.publish(parameters.sessionID, "session.idle", {
        sessionID: parameters.sessionID,
      })
      return interrupt(parameters)
    }
    const iterator = adapter
      .events({ handle, nativeSession })
      [Symbol.asyncIterator]()
    await adapter.send({
      handle,
      nativeSession,
      commandId: "command-1",
      turnId: "turn-1",
      userMessage: userMessage(selected),
      execution: selected,
    })
    await nextMatching(
      iterator,
      (event) =>
        event.type === "request.opened" &&
        event.data.request.kind === "permission"
    )

    await adapter.interrupt({ handle, nativeSession, turnId: "turn-1" })
    await expect(
      nextMatching(iterator, (event) => event.type === "turn.interrupted")
    ).resolves.toMatchObject({ type: "turn.interrupted" })
    await iterator.return?.()
  })

  it("reattaches a persisted running turn through durable replay", async () => {
    const { adapter, handle, nativeSession, selected } = await subject()
    const iterator = adapter
      .events({ handle, nativeSession })
      [Symbol.asyncIterator]()
    await adapter.send({
      handle,
      nativeSession,
      commandId: "command-1",
      turnId: "turn-1",
      userMessage: userMessage(selected),
      execution: selected,
    })
    const permission = await nextMatching(
      iterator,
      (event) =>
        event.type === "request.opened" &&
        event.data.request.kind === "permission"
    )
    await iterator.return?.()
    await adapter.stop({ handle })

    const restarted = await adapter.start({
      instance: INSTANCE,
      projectDirectory: PROJECT_DIRECTORY,
    })
    const activeTurn: Turn = {
      id: "turn-1",
      sessionId: "aide-session-1",
      seq: 0,
      status: "running",
      execution: selected,
      commandId: "command-1",
      userMessageId: "user-message-1",
      assistantMessageId: "turn-1-assistant",
      startedAt: new Date(0).toISOString(),
    }
    const resumed = await adapter.resumeSession({
      handle: restarted,
      sessionId: "aide-session-1",
      nativeSessionId: nativeSession.nativeSessionId,
      resumeCursor: "1",
      activeTurn,
    })
    const replay = adapter
      .events({ handle: restarted, nativeSession: resumed })
      [Symbol.asyncIterator]()
    const replayEvents: AideEvent[] = []
    const replayedPermission = nextMatching(
      replay,
      (event) =>
        event.type === "request.opened" &&
        event.data.request.kind === "permission",
      replayEvents
    )

    await expect(
      adapter.activeTurn?.({ handle: restarted, nativeSession: resumed })
    ).resolves.toEqual({ turnId: "turn-1" })
    await expect(replayedPermission).resolves.toMatchObject({
      eventId: permission.eventId,
    })
    expect(replayEvents.some((event) => event.type === "part.delta")).toBe(
      false
    )
    await adapter.interrupt({
      handle: restarted,
      nativeSession: resumed,
      turnId: "turn-1",
    })
    await replay.return?.()
  })

  it("applies configured MCP servers to runtimes created later", async () => {
    const { adapter, handle, calls } = await subject()
    await adapter.setMcpServers({
      handle,
      servers: {
        docs: { type: "http", url: "http://127.0.0.1:3001/mcp" },
      },
    })
    await adapter.discover({ handle, directory: "/tmp/another-project" })

    expect(calls.mcpAdds).toEqual([
      { directory: PROJECT_DIRECTORY, name: "docs" },
      { directory: "/tmp/another-project", name: "docs" },
    ])
  })

  it("rolls every runtime back when MCP reconfiguration partially fails", async () => {
    const { adapter, handle, controls } = await subject()
    const secondDirectory = "/tmp/another-project"
    await adapter.discover({ handle, directory: secondDirectory })
    await adapter.setMcpServers({
      handle,
      servers: {
        stable: { type: "http", url: "http://127.0.0.1:3001/stable" },
      },
    })
    controls.failMcpAdd(secondDirectory, "replacement")

    await expect(
      adapter.setMcpServers({
        handle,
        servers: {
          replacement: {
            type: "http",
            url: "http://127.0.0.1:3001/replacement",
          },
        },
      })
    ).rejects.toMatchObject({
      aideError: { code: "mcp_reconfigure_failed" },
    })

    expect(controls.mcpServers(PROJECT_DIRECTORY)).toEqual(["stable"])
    expect(controls.mcpServers(secondDirectory)).toEqual(["stable"])
    expect(await adapter.mcpStatus({ handle })).toEqual([
      { name: "stable", connected: true },
    ])
  })

  it("surfaces an MCP rollback failure distinctly", async () => {
    const { adapter, handle, controls } = await subject()
    const secondDirectory = "/tmp/another-project"
    await adapter.discover({ handle, directory: secondDirectory })
    await adapter.setMcpServers({
      handle,
      servers: {
        stable: { type: "http", url: "http://127.0.0.1:3001/stable" },
      },
    })
    controls.failMcpAdd(secondDirectory, "replacement")
    controls.failMcpAdd(PROJECT_DIRECTORY, "stable")

    await expect(
      adapter.setMcpServers({
        handle,
        servers: {
          replacement: {
            type: "http",
            url: "http://127.0.0.1:3001/replacement",
          },
        },
      })
    ).rejects.toMatchObject({
      aideError: { code: "mcp_rollback_failed" },
    })
  })

  it("preserves MCP provenance from OpenCode's tool namespace", async () => {
    const { adapter, handle, nativeSession, selected, controls } =
      await subject()
    await adapter.setMcpServers({
      handle,
      servers: {
        docs: { type: "http", url: "http://127.0.0.1:3001/mcp" },
      },
    })
    const iterator = adapter
      .events({ handle, nativeSession })
      [Symbol.asyncIterator]()
    await adapter.send({
      handle,
      nativeSession,
      commandId: "command-1",
      turnId: "turn-1",
      userMessage: userMessage(selected),
      execution: selected,
    })
    controls.publish(nativeSession.nativeSessionId, "message.part.updated", {
      sessionID: nativeSession.nativeSessionId,
      time: Date.now(),
      part: {
        id: "mcp-tool-1",
        sessionID: nativeSession.nativeSessionId,
        messageID: "user-message-1-assistant",
        type: "tool",
        callID: "mcp-call-1",
        tool: "docs_search",
        state: {
          status: "running",
          input: { query: "OpenCode" },
          time: { start: Date.now() },
        },
      },
    })

    const tool = await nextMatching(
      iterator,
      (event) =>
        event.type === "part.upserted" &&
        event.data.part.type === "tool" &&
        event.data.part.name === "docs_search"
    )
    expect(tool).toMatchObject({
      type: "part.upserted",
      data: {
        part: {
          category: "mcp",
          source: { kind: "mcp", server: "docs" },
        },
      },
    })
    await adapter.interrupt({ handle, nativeSession, turnId: "turn-1" })
    await iterator.return?.()
  })

  it("can clear a previously selected agent", async () => {
    const { adapter, handle, nativeSession, selected, controls, calls } =
      await subject()
    const iterator = adapter
      .events({ handle, nativeSession })
      [Symbol.asyncIterator]()
    await adapter.send({
      handle,
      nativeSession,
      commandId: "command-1",
      turnId: "turn-1",
      userMessage: userMessage(selected),
      execution: selected,
    })
    controls.publish(nativeSession.nativeSessionId, "session.idle", {
      sessionID: nativeSession.nativeSessionId,
    })
    await nextMatching(iterator, (event) => event.type === "turn.completed")

    const { agent: _agent, ...selection } = selected.selection
    const { agentName: _agentName, ...display } = selected.display
    const cleared: ResolvedExecution = { ...selected, selection, display }
    await adapter.send({
      handle,
      nativeSession,
      commandId: "command-2",
      turnId: "turn-2",
      userMessage: {
        ...userMessage(cleared),
        id: "user-message-2",
        seq: 3,
      },
      execution: cleared,
    })

    expect(calls.selections).toContainEqual({
      type: "agent",
      sessionID: nativeSession.nativeSessionId,
      agent: undefined,
    })
    await adapter.interrupt({ handle, nativeSession, turnId: "turn-2" })
    await iterator.return?.()
  })
})
