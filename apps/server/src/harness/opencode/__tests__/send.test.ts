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
        id: "msg_user-message-1",
        text: "PRIOR CONTEXT\n\nfinish the adapter",
      },
    ])

    await adapter.interrupt({ handle, nativeSession, turnId: "turn-1" })
  })

  it("accepts OpenCode's default variant for a selection without one", async () => {
    const { adapter, handle, nativeSession, calls } = await subject()
    const plain = execution({ modelId: "claude-sonnet-5" })
    const { variant: _variant, ...options } = plain.selection.options
    const selected: ResolvedExecution = {
      ...plain,
      selection: { ...plain.selection, options },
    }

    await adapter.send({
      handle,
      nativeSession,
      commandId: "command-1",
      turnId: "turn-1",
      userMessage: userMessage(selected),
      execution: selected,
    })

    expect(calls.selections).toContainEqual(
      expect.objectContaining({ type: "prompt" })
    )
    await adapter.interrupt({ handle, nativeSession, turnId: "turn-1" })
  })

  it("fails before admission when a selection switch is rejected", async () => {
    const { api, calls } = createOpencodeSdkDouble()
    api.session.switchModel = async () => {
      throw new Error("nope")
    }
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

  it("maps durable parts and live deltas and preserves mixed form answers", async () => {
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
          continue: { optionIds: ["Yes"], text: "custom detail" },
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
    expect(calls.formReplies).toEqual([
      { formID: "question-1", answer: { continue: "Yes\ncustom detail" } },
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

  it("maps tool file content to file parts and ignores other sessions", async () => {
    const { adapter, handle, nativeSession, selected, controls } =
      await subject()
    const iterator = adapter
      .events({ handle, nativeSession })
      [Symbol.asyncIterator]()
    const events: AideEvent[] = []
    const sessionID = nativeSession.nativeSessionId
    const onMessage = {
      sessionID,
      assistantMessageID: "msg_user-message-1-assistant",
    }

    await adapter.send({
      handle,
      nativeSession,
      commandId: "command-1",
      turnId: "turn-1",
      userMessage: userMessage(selected),
      execution: selected,
    })

    controls.publish(sessionID, "session.tool.input.started", {
      ...onMessage,
      id: "read-1",
      name: "read",
    })
    controls.publish(sessionID, "session.tool.success", {
      ...onMessage,
      id: "read-1",
      executed: true,
      content: [
        { type: "text", text: "read three files" },
        { type: "file", uri: "/tmp/plain.txt", mime: "text/plain" },
        {
          type: "file",
          uri: "file:///tmp/aide%20report.txt",
          mime: "text/plain",
        },
        {
          type: "file",
          uri: "file://%",
          mime: "application/octet-stream",
        },
      ],
    })
    controls.publish(sessionID, "session.tool.input.started", {
      ...onMessage,
      sessionID: "another-session",
      id: "foreign-1",
      name: "bash",
    })

    await expect(
      nextMatching(
        iterator,
        (event) =>
          event.type === "part.upserted" &&
          event.data.part.id === "turn-1-file-read-1-3",
        events
      )
    ).resolves.toBeDefined()
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "part.upserted",
          data: {
            part: expect.objectContaining({
              id: "turn-1-tool-read-1",
              type: "tool",
              name: "read",
              category: "file_read",
              status: "completed",
              output: "read three files",
            }),
          },
        }),
        expect.objectContaining({
          type: "part.upserted",
          data: {
            part: expect.objectContaining({
              id: "turn-1-file-read-1-1",
              type: "file",
              path: "/tmp/plain.txt",
            }),
          },
        }),
        expect.objectContaining({
          type: "part.upserted",
          data: {
            part: expect.objectContaining({
              id: "turn-1-file-read-1-2",
              type: "file",
              path: "/tmp/aide report.txt",
            }),
          },
        }),
        expect.objectContaining({
          type: "part.upserted",
          data: {
            part: expect.objectContaining({
              id: "turn-1-file-read-1-3",
              type: "file",
              path: "file://%",
            }),
          },
        }),
      ])
    )
    expect(
      events.some(
        (event) =>
          event.type === "part.upserted" &&
          event.data.part.id === "turn-1-tool-foreign-1"
      )
    ).toBe(false)

    await adapter.interrupt({ handle, nativeSession, turnId: "turn-1" })
    await iterator.return?.()
  })

  it("reconciles forms answered or cancelled outside Aide", async () => {
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

    controls.publish(sessionID, "form.created", {
      form: {
        id: "external-question",
        sessionID,
        title: "Decision",
        fields: [
          {
            key: "decision",
            type: "multiselect",
            title: "Decision",
            description: "Proceed?",
            required: true,
            options: [
              { value: "Yes", label: "Yes" },
              { value: "No", label: "No" },
            ],
            custom: true,
          },
          {
            key: "details",
            type: "string",
            title: "Details",
            description: "Additional details?",
          },
          {
            key: "docs",
            type: "external",
            url: "https://example.com/approve",
          },
        ],
      },
    })
    const opened = await nextMatching(
      iterator,
      (event) =>
        event.type === "request.opened" &&
        event.data.request.id === "external-question"
    )
    expect(opened).toMatchObject({
      data: {
        request: {
          kind: "input",
          payload: {
            questions: [
              {
                id: "decision",
                prompt: "Proceed?",
                header: "Decision",
                allowMultiple: true,
                allowFreeText: true,
              },
              {
                id: "details",
                prompt: "Additional details?",
                allowMultiple: false,
                allowFreeText: true,
              },
            ],
          },
        },
      },
    })

    controls.publish(sessionID, "form.replied", {
      id: "external-question",
      sessionID,
      answer: {
        decision: ["Yes", "custom line one", "custom line two"],
        details: "free-form detail",
      },
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
              decision: {
                optionIds: ["Yes"],
                text: "custom line one\ncustom line two",
              },
              details: { text: "free-form detail" },
            },
          },
        },
      },
    })

    controls.publish(sessionID, "form.created", {
      form: {
        id: "external-rejected-question",
        sessionID,
        title: "Choice",
        fields: [
          {
            key: "choice",
            type: "boolean",
            title: "Choose?",
            required: true,
          },
        ],
      },
    })
    await nextMatching(
      iterator,
      (event) =>
        event.type === "request.opened" &&
        event.data.request.id === "external-rejected-question"
    )
    controls.publish(sessionID, "form.cancelled", {
      sessionID,
      id: "external-rejected-question",
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
            answers: { continue: { optionIds: ["Maybe"] } },
          },
        },
      })
    ).rejects.toMatchObject({ aideError: { code: "invalid_resolution" } })
    const answered: Request = {
      ...input,
      status: "resolved",
      resolution: {
        kind: "input",
        answers: { continue: { optionIds: ["Yes"] } },
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
    expect(calls.formReplies).toEqual([
      { formID: "question-1", answer: { continue: "Yes" } },
    ])

    await expect(
      nextMatching(iterator, (event) => event.type === "turn.completed")
    ).resolves.toMatchObject({ type: "turn.completed" })
    await iterator.return?.()
  })

  it("emits an error before failing a turn on execution failure", async () => {
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

    controls.publish(
      nativeSession.nativeSessionId,
      "session.execution.failed",
      {
        sessionID: nativeSession.nativeSessionId,
        error: { type: "provider", message: "provider failed" },
      }
    )
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

  it("treats execution success as authoritative completion", async () => {
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

    controls.publish(
      nativeSession.nativeSessionId,
      "session.execution.succeeded",
      { sessionID: nativeSession.nativeSessionId }
    )
    await expect(
      nextMatching(iterator, (event) => event.type === "turn.completed")
    ).resolves.toMatchObject({ type: "turn.completed" })
    await iterator.return?.()
  })

  it("completes turns from the live stream when the host keeps no log", async () => {
    const double = createOpencodeSdkDouble()
    double.api.session.log = (_input, requestOptions) =>
      (async function* () {
        yield { type: "log.synced" } as never
        await new Promise((resolve) =>
          requestOptions?.signal?.addEventListener("abort", resolve)
        )
      })()
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

    await expect(
      nextMatching(
        iterator,
        (event) =>
          event.type === "part.upserted" &&
          event.data.part.type === "tool" &&
          event.data.part.status === "completed"
      )
    ).resolves.toBeDefined()
    double.controls.publish(
      nativeSession.nativeSessionId,
      "session.execution.succeeded",
      { sessionID: nativeSession.nativeSessionId }
    )
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

    controls.publish(sessionID, "session.retry.scheduled", {
      sessionID,
      assistantMessageID: "msg_user-message-1-assistant",
      attempt: 2,
      at: Date.now() + 1_000,
      error: { type: "rate_limit", message: "slow down" },
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

  it("lets interruption win when rejecting a request ends execution", async () => {
    const { api, controls, adapter, handle, nativeSession, selected } =
      await subject()
    const interrupt = api.session.interrupt.bind(api.session)
    api.session.interrupt = async (parameters) => {
      controls.publish(parameters.sessionID, "session.execution.succeeded", {
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

  it("applies configured MCP servers to directories used later", async () => {
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
    const onMessage = {
      sessionID: nativeSession.nativeSessionId,
      assistantMessageID: "msg_user-message-1-assistant",
    }
    controls.publish(
      nativeSession.nativeSessionId,
      "session.tool.input.started",
      { ...onMessage, id: "mcp-call-1", name: "docs_search" }
    )
    controls.publish(nativeSession.nativeSessionId, "session.tool.called", {
      ...onMessage,
      id: "mcp-call-1",
      input: { query: "OpenCode" },
      executed: true,
    })

    const tool = await nextMatching(
      iterator,
      (event) =>
        event.type === "part.upserted" &&
        event.data.part.type === "tool" &&
        event.data.part.name === "docs_search" &&
        event.data.part.status === "running"
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

  it("keeps the session agent when a turn selects none", async () => {
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
    controls.publish(
      nativeSession.nativeSessionId,
      "session.execution.succeeded",
      { sessionID: nativeSession.nativeSessionId }
    )
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

    expect(
      calls.selections.filter((selection) => selection.type === "agent")
    ).toEqual([
      {
        type: "agent",
        sessionID: nativeSession.nativeSessionId,
        agent: "build",
      },
    ])
    await adapter.interrupt({ handle, nativeSession, turnId: "turn-2" })
    await iterator.return?.()
  })
})

describe("opencode commands, skills, usage, subagents, steering", () => {
  it("reports the turn's usage summed over its steps", async () => {
    const { adapter, handle, nativeSession, selected, controls } =
      await subject()
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
    const onMessage = {
      sessionID: nativeSession.nativeSessionId,
      assistantMessageID: "msg_user-message-1-assistant",
    }
    for (const cost of [0.01, 0.02]) {
      controls.publish(nativeSession.nativeSessionId, "session.step.ended", {
        ...onMessage,
        finish: "tool-calls",
        cost,
        tokens: {
          input: 100,
          output: 20,
          reasoning: 4,
          cache: { read: 7, write: 1 },
        },
      })
    }
    controls.publish(
      nativeSession.nativeSessionId,
      "session.execution.succeeded",
      { sessionID: nativeSession.nativeSessionId }
    )
    await nextMatching(
      iterator,
      (event) => event.type === "turn.completed",
      events
    )

    const usage = events.flatMap((event) =>
      event.type === "message.upserted" &&
      event.data.message.role === "assistant" &&
      event.data.message.usage
        ? [event.data.message.usage]
        : []
    )
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({
      inputTokens: 200,
      outputTokens: 40,
      reasoningTokens: 8,
      cacheReadTokens: 14,
      cacheWriteTokens: 2,
    })
    expect(usage[0]!.costUsd).toBeCloseTo(0.03)
    await iterator.return?.()
  })

  it("renders the task tool as a subagent part", async () => {
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
    const onMessage = {
      sessionID: nativeSession.nativeSessionId,
      assistantMessageID: "msg_user-message-1-assistant",
    }
    controls.publish(
      nativeSession.nativeSessionId,
      "session.tool.input.started",
      {
        ...onMessage,
        id: "task-call",
        name: "task",
      }
    )
    controls.publish(nativeSession.nativeSessionId, "session.tool.called", {
      ...onMessage,
      id: "task-call",
      input: {
        subagent_type: "explore",
        description: "Map the modules",
        prompt: "…",
      },
      executed: true,
    })
    controls.publish(nativeSession.nativeSessionId, "session.tool.success", {
      ...onMessage,
      id: "task-call",
      executed: true,
      content: [{ type: "text", text: "Three modules found" }],
    })

    await expect(
      nextMatching(
        iterator,
        (event) =>
          event.type === "part.upserted" &&
          event.data.part.type === "agent" &&
          event.data.part.status === "completed"
      )
    ).resolves.toMatchObject({
      data: {
        part: {
          id: "turn-1-agent-task-call",
          name: "explore",
          description: "Map the modules",
          summary: "Three modules found",
        },
      },
    })
    await adapter.interrupt({ handle, nativeSession, turnId: "turn-1" })
    await iterator.return?.()
  })

  it("runs a command with its arguments and hands history over first", async () => {
    const { adapter, handle, nativeSession, selected, calls } = await subject()
    await adapter.send({
      handle,
      nativeSession,
      commandId: "command-1",
      turnId: "turn-1",
      userMessage: {
        ...userMessage(selected),
        parts: [
          {
            id: "user-message-1-part-0",
            messageId: "user-message-1",
            index: 0,
            type: "text",
            text: "/review the last commit",
          },
        ],
        invocation: { kind: "command", name: "review" },
      },
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

    expect(calls.synthetic).toEqual([
      {
        sessionID: nativeSession.nativeSessionId,
        text: "PRIOR CONTEXT",
        resume: false,
      },
    ])
    expect(calls.selections.at(-1)).toEqual({
      type: "command",
      sessionID: nativeSession.nativeSessionId,
      name: "review",
      text: "the last commit",
    })
    await adapter.interrupt({ handle, nativeSession, turnId: "turn-1" })
  })

  it("attaches an invoked skill to the prompt", async () => {
    const { adapter, handle, nativeSession, selected, calls } = await subject()
    await adapter.send({
      handle,
      nativeSession,
      commandId: "command-1",
      turnId: "turn-1",
      userMessage: {
        ...userMessage(selected),
        parts: [
          {
            id: "user-message-1-part-0",
            messageId: "user-message-1",
            index: 0,
            type: "text",
            text: "/pdf summarise report.pdf",
          },
        ],
        invocation: { kind: "skill", name: "pdf" },
      },
      execution: selected,
    })
    expect(calls.skillPrompts).toEqual([
      {
        sessionID: nativeSession.nativeSessionId,
        skills: ["pdf"],
        text: "summarise report.pdf",
      },
    ])
    await adapter.interrupt({ handle, nativeSession, turnId: "turn-1" })
  })

  it("steers the running turn and refuses once it is over", async () => {
    const { adapter, handle, nativeSession, selected, calls } = await subject()
    await adapter.send({
      handle,
      nativeSession,
      commandId: "command-1",
      turnId: "turn-1",
      userMessage: userMessage(selected),
      execution: selected,
    })
    const steer: UserMessage = {
      ...userMessage(selected),
      id: "steer-1",
      seq: 3,
      parts: [
        {
          id: "steer-1-part-0",
          messageId: "steer-1",
          index: 0,
          type: "text",
          text: "skip the tests",
        },
      ],
      steer: { turnId: "turn-1" },
    }
    await adapter.steer?.({
      handle,
      nativeSession,
      turnId: "turn-1",
      message: steer,
    })
    expect(calls.steers).toEqual([
      {
        sessionID: nativeSession.nativeSessionId,
        id: "msg_steer-1",
        text: "skip the tests",
      },
    ])
    await adapter.interrupt({ handle, nativeSession, turnId: "turn-1" })
    await expect(
      adapter.steer?.({
        handle,
        nativeSession,
        turnId: "turn-1",
        message: steer,
      })
    ).rejects.toMatchObject({ aideError: { code: "turn_not_active" } })
  })

  it("lists commands, skills and connected providers in inventory", async () => {
    const { adapter, handle } = await subject()
    const inventory = await adapter.discover({
      handle,
      directory: PROJECT_DIRECTORY,
    })
    expect(inventory.commands).toEqual([
      { name: "init", description: "guided AGENTS.md setup" },
      { name: "review", description: "review changes" },
    ])
    expect(inventory.skills).toEqual([
      { id: "pdf", name: "pdf", description: "Work with PDFs" },
    ])
    expect(inventory.auth.providers).toEqual([
      {
        id: "anthropic",
        label: "Anthropic",
        connected: true,
        method: "env:ANTHROPIC_API_KEY",
      },
      { id: "opencode", label: "OpenCode", connected: true },
    ])
  })
})
