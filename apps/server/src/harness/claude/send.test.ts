import { describe, expect, it } from "vitest"
import type {
  AideEvent,
  InstanceConfig,
  Request,
  ResolvedExecution,
  UserMessage,
} from "@workspace/contracts"

import {
  createClaudeSessionDoubleFactory,
  type ClaudeTurnScriptContext,
} from "../../test/claude-sdk-double"
import { createClaudeAdapter } from "./adapter"
import { normalizeDialogQuestions, permissionDiff } from "./session"

/**
 * The Claude send path against a double that speaks SDK wire shapes.
 *
 * The conformance suite proves the adapter satisfies the shared contract; these
 * cover the parts of the contract that are Claude-specific and therefore have
 * nowhere else to be checked — the effort reopen, the permission inversion's
 * exits, and the result-to-terminal mapping.
 */

const PROJECT_DIRECTORY = "/tmp/aide-claude-send"

const INSTANCE: InstanceConfig = {
  instanceId: "claude",
  driver: "claudeAgent",
  displayName: "Claude",
  enabled: true,
  autoStart: true,
  config: {},
}

function execution(
  overrides: {
    modelId?: string
    interactionMode?: string
    options?: Record<string, string>
  } = {}
): ResolvedExecution {
  return {
    selection: {
      instanceId: "claude",
      driver: "claudeAgent",
      model: { modelId: overrides.modelId ?? "claude-opus-5" },
      interactionMode: overrides.interactionMode ?? "build",
      options: overrides.options ?? {},
    },
    display: {
      instanceName: "Claude",
      modelName: overrides.modelId ?? "claude-opus-5",
      interactionModeName: overrides.interactionMode ?? "Build",
      options: {},
    },
    inventoryRevision: "claude-rev",
  }
}

function userMessage(text: string, seq = 1): UserMessage {
  const id = `user-${seq}`
  return {
    id,
    sessionId: "session-1",
    seq,
    role: "user",
    parts: [{ id: `${id}-p0`, messageId: id, index: 0, type: "text", text }],
    execution: execution(),
    createdAt: new Date(0).toISOString(),
  }
}

function collect(stream: AsyncIterable<AideEvent>) {
  const events: AideEvent[] = []
  const iterator = stream[Symbol.asyncIterator]()
  let stopped = false
  const pump = (async () => {
    while (!stopped) {
      const next = await iterator.next()
      if (next.done) break
      events.push(next.value)
    }
  })()

  return {
    events,
    async waitFor(
      predicate: (event: AideEvent) => boolean,
      label: string,
      timeoutMs = 1_000
    ): Promise<AideEvent> {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const match = events.find(predicate)
        if (match) return match
        await new Promise((resolve) => setTimeout(resolve, 1))
      }
      throw new Error(
        `timed out waiting for ${label}; saw ${events.map((event) => event.type).join(", ")}`
      )
    },
    async stop() {
      stopped = true
      await iterator.return?.()
      await pump
    },
  }
}

/** Parks on a permission prompt and never resolves on its own. */
const parkOnPermission = async (context: ClaudeTurnScriptContext) => {
  context.emit({
    type: "assistant",
    uuid: "uuid-1",
    message: {
      id: "msg_1",
      content: [
        {
          type: "tool_use",
          id: "toolu_1",
          name: "Bash",
          input: { command: "ls" },
        },
      ],
    },
  })
  const decision = await context.requestPermission({
    toolName: "Bash",
    input: { command: "ls" },
    suggestions: [{ type: "addRules", rules: [{ toolName: "Bash" }] }],
  })
  if (context.interrupted()) return
  context.emit({
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: decision.behavior === "allow" ? "ran" : "denied",
          ...(decision.behavior === "deny" ? { is_error: true } : {}),
        },
      ],
    },
  })
  context.emit({ type: "result", subtype: "success", is_error: false })
}

const completeImmediately = async (context: ClaudeTurnScriptContext) => {
  context.emit({
    type: "assistant",
    uuid: `uuid-${context.prompt.length}`,
    message: { id: "msg_1", content: [{ type: "text", text: "done" }] },
  })
  context.emit({ type: "result", subtype: "success", is_error: false })
}

async function startSession(options: {
  script?: (context: ClaudeTurnScriptContext) => Promise<void>
  execution?: ResolvedExecution
}) {
  const createSession = createClaudeSessionDoubleFactory(
    options.script ? { script: options.script } : {}
  )
  const adapter = createClaudeAdapter({ createSession })
  const handle = await adapter.start({
    instance: INSTANCE,
    projectDirectory: PROJECT_DIRECTORY,
  })
  const nativeSession = await adapter.openSession({
    handle,
    sessionId: "session-1",
    projectDirectory: PROJECT_DIRECTORY,
    execution: options.execution ?? execution(),
  })
  return { adapter, handle, nativeSession, createSession }
}

describe("claude send: streaming input", () => {
  it("pushes the user text onto the open prompt stream", async () => {
    const { adapter, handle, nativeSession, createSession } =
      await startSession({ script: completeImmediately })
    const stream = collect(adapter.events({ handle, nativeSession }))

    await adapter.send({
      handle,
      nativeSession,
      commandId: "cmd-1",
      turnId: "turn-1",
      userMessage: userMessage("write the middleware"),
      execution: execution(),
    })
    await stream.waitFor(
      (event) => event.type === "turn.completed",
      "turn.completed"
    )
    await stream.stop()

    // The session query is the second the factory made; the first is the
    // instance-level inventory query.
    expect(createSession.sessions[1].prompts).toEqual(["write the middleware"])
  })

  it("prepends the portable handoff packet to the prompt", async () => {
    const { adapter, handle, nativeSession, createSession } =
      await startSession({ script: completeImmediately })

    await adapter.send({
      handle,
      nativeSession,
      commandId: "cmd-1",
      turnId: "turn-1",
      userMessage: userMessage("continue"),
      execution: execution(),
      handoff: {
        id: "handoff-1",
        turnId: "turn-1",
        instanceId: "claude",
        nativeSessionId: nativeSession.nativeSessionId,
        role: "handoff",
        fromMessageSeq: 0,
        throughMessageSeq: 0,
        content: "PRIOR CONTEXT",
        createdAt: new Date(0).toISOString(),
      },
    })

    expect(createSession.sessions[1].prompts[0]).toBe(
      "PRIOR CONTEXT\n\ncontinue"
    )
  })

  it("refuses a second turn while one is running", async () => {
    const { adapter, handle, nativeSession } = await startSession({
      script: parkOnPermission,
    })
    const stream = collect(adapter.events({ handle, nativeSession }))

    await adapter.send({
      handle,
      nativeSession,
      commandId: "cmd-1",
      turnId: "turn-1",
      userMessage: userMessage("first"),
      execution: execution(),
    })
    await stream.waitFor(
      (event) => event.type === "request.opened",
      "request.opened"
    )

    await expect(
      adapter.send({
        handle,
        nativeSession,
        commandId: "cmd-2",
        turnId: "turn-2",
        userMessage: userMessage("second", 3),
        execution: execution(),
      })
    ).rejects.toMatchObject({ aideError: { code: "turn_already_running" } })
    await stream.stop()
  })
})

describe("claude send: model and permission mode", () => {
  it("applies the model and the mapped permission mode when the query opens", async () => {
    const { createSession } = await startSession({
      execution: execution({
        modelId: "claude-haiku-4-5-20251001",
        interactionMode: "plan",
      }),
    })

    const opened = createSession.sessions[1].openInput
    expect(opened.model).toBe("claude-haiku-4-5-20251001")
    expect(opened.permissionMode).toBe("plan")
  })

  it("switches model and mode in session and skips redundant calls", async () => {
    const { adapter, handle, nativeSession, createSession } =
      await startSession({ script: completeImmediately })
    const query = createSession.sessions[1]
    const stream = collect(adapter.events({ handle, nativeSession }))

    const send = async (turnId: string, next: ResolvedExecution) => {
      await adapter.send({
        handle,
        nativeSession,
        commandId: `cmd-${turnId}`,
        turnId,
        userMessage: userMessage(turnId),
        execution: next,
      })
      await stream.waitFor(
        (event) =>
          event.type === "turn.completed" && event.data.turn.id === turnId,
        `${turnId} completion`
      )
    }

    await send("turn-1", execution())
    await send(
      "turn-2",
      execution({
        modelId: "claude-haiku-4-5-20251001",
        interactionMode: "plan",
      })
    )
    await send(
      "turn-3",
      execution({
        modelId: "claude-haiku-4-5-20251001",
        interactionMode: "plan",
      })
    )
    await stream.stop()

    expect(query.setModelCalls).toEqual(["claude-haiku-4-5-20251001"])
    expect(query.setPermissionModeCalls).toEqual(["plan"])
  })
})

describe("claude send: effort change policy", () => {
  it("leaves the query alone when effort is unchanged", async () => {
    const { adapter, handle, nativeSession, createSession } =
      await startSession({
        script: completeImmediately,
        execution: execution({ options: { effort: "medium" } }),
      })
    const stream = collect(adapter.events({ handle, nativeSession }))

    await adapter.send({
      handle,
      nativeSession,
      commandId: "cmd-1",
      turnId: "turn-1",
      userMessage: userMessage("go"),
      execution: execution({ options: { effort: "medium" } }),
    })
    await stream.waitFor(
      (event) => event.type === "turn.completed",
      "turn.completed"
    )
    await stream.stop()

    expect(createSession.sessions).toHaveLength(2)
  })

  it("reopens the query against the same native session when effort changes", async () => {
    const { adapter, handle, nativeSession, createSession } =
      await startSession({
        script: completeImmediately,
        execution: execution({ options: { effort: "medium" } }),
      })
    const stream = collect(adapter.events({ handle, nativeSession }))

    await adapter.send({
      handle,
      nativeSession,
      commandId: "cmd-1",
      turnId: "turn-1",
      userMessage: userMessage("first"),
      execution: execution({ options: { effort: "medium" } }),
    })
    await stream.waitFor(
      (event) =>
        event.type === "turn.completed" && event.data.turn.id === "turn-1",
      "first completion"
    )

    await adapter.send({
      handle,
      nativeSession,
      commandId: "cmd-2",
      turnId: "turn-2",
      userMessage: userMessage("second", 3),
      execution: execution({ options: { effort: "high" } }),
    })
    await stream.waitFor(
      (event) =>
        event.type === "turn.completed" && event.data.turn.id === "turn-2",
      "second completion"
    )
    await stream.stop()

    const reopened = createSession.sessions[2]
    expect(reopened.openInput.effort).toBe("high")
    expect(reopened.openInput.resume).toBe(nativeSession.nativeSessionId)
    expect(createSession.sessions[1].closed).toBe(true)
    // The native mapping the core keys on must survive the reopen.
    const active = await adapter.activeTurn?.({ handle, nativeSession })
    expect(active).toBeUndefined()
  })

  it("refuses to change effort while a turn is running", async () => {
    const { adapter, handle, nativeSession } = await startSession({
      script: parkOnPermission,
      execution: execution({ options: { effort: "medium" } }),
    })
    const stream = collect(adapter.events({ handle, nativeSession }))

    await adapter.send({
      handle,
      nativeSession,
      commandId: "cmd-1",
      turnId: "turn-1",
      userMessage: userMessage("first"),
      execution: execution({ options: { effort: "medium" } }),
    })
    await stream.waitFor(
      (event) => event.type === "request.opened",
      "request.opened"
    )

    await expect(
      adapter.send({
        handle,
        nativeSession,
        commandId: "cmd-2",
        turnId: "turn-2",
        userMessage: userMessage("second", 3),
        execution: execution({ options: { effort: "high" } }),
      })
    ).rejects.toMatchObject({
      aideError: { code: "turn_already_running" },
    })
    await stream.stop()
  })

  it("seeds a fresh query from the handoff packet when the last turn did not end cleanly", async () => {
    const failThenComplete = async (context: ClaudeTurnScriptContext) => {
      if (context.prompt.includes("first")) {
        context.emit({
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          errors: ["boom"],
        })
        return
      }
      context.emit({ type: "result", subtype: "success", is_error: false })
    }
    const { adapter, handle, nativeSession, createSession } =
      await startSession({
        script: failThenComplete,
        execution: execution({ options: { effort: "medium" } }),
      })
    const stream = collect(adapter.events({ handle, nativeSession }))

    await adapter.send({
      handle,
      nativeSession,
      commandId: "cmd-1",
      turnId: "turn-1",
      userMessage: userMessage("first"),
      execution: execution({ options: { effort: "medium" } }),
    })
    await stream.waitFor((event) => event.type === "turn.failed", "turn.failed")

    await adapter.send({
      handle,
      nativeSession,
      commandId: "cmd-2",
      turnId: "turn-2",
      userMessage: userMessage("second", 3),
      execution: execution({ options: { effort: "high" } }),
      handoff: {
        id: "handoff-1",
        turnId: "turn-2",
        instanceId: "claude",
        nativeSessionId: nativeSession.nativeSessionId,
        role: "handoff",
        fromMessageSeq: 0,
        throughMessageSeq: 1,
        content: "PORTABLE CONTEXT",
        createdAt: new Date(0).toISOString(),
      },
    })
    await stream.waitFor(
      (event) =>
        event.type === "turn.completed" && event.data.turn.id === "turn-2",
      "second completion"
    )
    await stream.stop()

    const reopened = createSession.sessions[2]
    // Resume is not safe after a failure, so the packet carries the context.
    expect(reopened.openInput.resume).toBeUndefined()
    expect(reopened.openInput.effort).toBe("high")
    expect(reopened.prompts[0]).toBe("PORTABLE CONTEXT\n\nsecond")
  })

  it("refuses an effort change it can neither resume nor seed", async () => {
    const failImmediately = async (context: ClaudeTurnScriptContext) => {
      context.emit({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        errors: ["boom"],
      })
    }
    const { adapter, handle, nativeSession } = await startSession({
      script: failImmediately,
      execution: execution({ options: { effort: "medium" } }),
    })
    const stream = collect(adapter.events({ handle, nativeSession }))

    await adapter.send({
      handle,
      nativeSession,
      commandId: "cmd-1",
      turnId: "turn-1",
      userMessage: userMessage("first"),
      execution: execution({ options: { effort: "medium" } }),
    })
    await stream.waitFor((event) => event.type === "turn.failed", "turn.failed")

    await expect(
      adapter.send({
        handle,
        nativeSession,
        commandId: "cmd-2",
        turnId: "turn-2",
        userMessage: userMessage("second", 3),
        execution: execution({ options: { effort: "high" } }),
      })
    ).rejects.toMatchObject({ aideError: { code: "effort_change_unsafe" } })
    await stream.stop()
  })
})

describe("claude send: permission inversion", () => {
  async function openPermission() {
    const started = await startSession({ script: parkOnPermission })
    const stream = collect(
      started.adapter.events({
        handle: started.handle,
        nativeSession: started.nativeSession,
      })
    )
    await started.adapter.send({
      handle: started.handle,
      nativeSession: started.nativeSession,
      commandId: "cmd-1",
      turnId: "turn-1",
      userMessage: userMessage("run it"),
      execution: execution(),
    })
    const opened = await stream.waitFor(
      (event) => event.type === "request.opened",
      "request.opened"
    )
    if (opened.type !== "request.opened") throw new Error("unreachable")
    return { ...started, stream, request: opened.data.request }
  }

  it("publishes the open request before it parks on the decision", async () => {
    const { request, stream } = await openPermission()

    expect(request.kind).toBe("permission")
    expect(request.status).toBe("open")
    if (request.payload.kind !== "permission") throw new Error("unreachable")
    expect(request.payload.toolName).toBe("Bash")
    expect(request.payload.options.map((option) => option.id)).toEqual([
      "allow",
      "allow_always",
      "deny",
    ])
    // Still open: the SDK callback has not returned, so the turn is parked.
    expect(stream.events.some((event) => event.type === "turn.completed")).toBe(
      false
    )
    await stream.stop()
  })

  it("resolves the parked decision from the permission response", async () => {
    const { adapter, handle, nativeSession, stream, request } =
      await openPermission()

    await adapter.respondToPermission({
      handle,
      nativeSession,
      request: {
        ...request,
        resolution: { kind: "permission", optionId: "allow" },
      } as Request,
    })

    await stream.waitFor(
      (event) => event.type === "request.resolved",
      "request.resolved"
    )
    const completed = await stream.waitFor(
      (event) => event.type === "turn.completed",
      "turn.completed"
    )
    expect(completed.type).toBe("turn.completed")
    const toolPart = stream.events.find(
      (event) =>
        event.type === "part.upserted" &&
        event.data.part.type === "tool" &&
        event.data.part.status === "completed"
    )
    expect(toolPart).toBeDefined()
    await stream.stop()
  })

  it("denies through to the SDK when the user denies", async () => {
    const { adapter, handle, nativeSession, stream, request } =
      await openPermission()

    await adapter.respondToPermission({
      handle,
      nativeSession,
      request: {
        ...request,
        resolution: { kind: "permission", optionId: "deny" },
      } as Request,
    })
    await stream.waitFor(
      (event) => event.type === "turn.completed",
      "turn.completed"
    )

    const failedTool = stream.events.find(
      (event) =>
        event.type === "part.upserted" &&
        event.data.part.type === "tool" &&
        event.data.part.status === "failed"
    )
    expect(failedTool).toBeDefined()
    await stream.stop()
  })

  it("rejects an option that was never offered", async () => {
    const { adapter, handle, nativeSession, stream, request } =
      await openPermission()

    await expect(
      adapter.respondToPermission({
        handle,
        nativeSession,
        request: {
          ...request,
          resolution: { kind: "permission", optionId: "maybe" },
        } as Request,
      })
    ).rejects.toMatchObject({ aideError: { code: "invalid_resolution" } })
    await stream.stop()
  })

  it("denies and cancels the request when the turn is interrupted", async () => {
    const { adapter, handle, nativeSession, stream } = await openPermission()

    await adapter.interrupt({ handle, nativeSession, turnId: "turn-1" })

    await stream.waitFor(
      (event) => event.type === "request.cancelled",
      "request.cancelled"
    )
    await stream.waitFor(
      (event) => event.type === "turn.interrupted",
      "turn.interrupted"
    )
    // A denied-by-interrupt turn never also completes.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(
      stream.events.filter((event) => event.type === "turn.completed")
    ).toHaveLength(0)
    expect(
      stream.events.filter((event) => event.type === "turn.interrupted")
    ).toHaveLength(1)
    await stream.stop()
  })

  it("fails the turn rather than dangling when the session closes with a permission open", async () => {
    const { adapter, handle, stream } = await openPermission()

    await adapter.stop({ handle })

    const failed = await stream.waitFor(
      (event) => event.type === "turn.failed",
      "turn.failed"
    )
    if (failed.type !== "turn.failed") throw new Error("unreachable")
    expect(failed.data.turn.error?.code).toBe("native_session_closed")
    expect(
      stream.events.some((event) => event.type === "request.cancelled")
    ).toBe(true)
    await stream.stop()
  })
})

describe("claude send: input requests", () => {
  it("normalizes a dialog into questions and returns the answers", async () => {
    let answered: unknown
    const askDialog = async (context: ClaudeTurnScriptContext) => {
      answered = await context.requestDialog({
        dialogKind: "plan_choice",
        payload: {
          questions: [
            {
              id: "approach",
              prompt: "Which approach?",
              options: [
                { id: "fast", label: "Fast" },
                { id: "safe", label: "Safe" },
              ],
            },
          ],
        },
      })
      context.emit({ type: "result", subtype: "success", is_error: false })
    }
    const { adapter, handle, nativeSession } = await startSession({
      script: askDialog,
    })
    const stream = collect(adapter.events({ handle, nativeSession }))

    await adapter.send({
      handle,
      nativeSession,
      commandId: "cmd-1",
      turnId: "turn-1",
      userMessage: userMessage("plan it"),
      execution: execution(),
    })
    const opened = await stream.waitFor(
      (event) => event.type === "request.opened",
      "request.opened"
    )
    if (opened.type !== "request.opened") throw new Error("unreachable")
    const request = opened.data.request
    if (request.payload.kind !== "input") throw new Error("expected input")
    expect(request.payload.questions[0]).toMatchObject({
      id: "approach",
      prompt: "Which approach?",
      allowMultiple: false,
      allowFreeText: false,
    })

    await adapter.respondToInput({
      handle,
      nativeSession,
      request: {
        ...request,
        resolution: {
          kind: "input",
          answers: { approach: { optionIds: ["safe"] } },
        },
      } as Request,
    })
    await stream.waitFor(
      (event) => event.type === "turn.completed",
      "turn.completed"
    )
    await stream.stop()

    expect(answered).toEqual({
      behavior: "completed",
      result: { answers: { approach: { optionIds: ["safe"] } } },
    })
  })

  it("cancels a dialog kind it cannot render rather than answering it blind", async () => {
    let answered: unknown
    const askOpaque = async (context: ClaudeTurnScriptContext) => {
      answered = await context.requestDialog({
        dialogKind: "some_future_kind",
        payload: { opaque: true },
      })
      context.emit({ type: "result", subtype: "success", is_error: false })
    }
    const { adapter, handle, nativeSession } = await startSession({
      script: askOpaque,
    })
    const stream = collect(adapter.events({ handle, nativeSession }))

    await adapter.send({
      handle,
      nativeSession,
      commandId: "cmd-1",
      turnId: "turn-1",
      userMessage: userMessage("go"),
      execution: execution(),
    })
    await stream.waitFor(
      (event) => event.type === "turn.completed",
      "turn.completed"
    )
    await stream.stop()

    expect(answered).toEqual({ behavior: "cancelled" })
    expect(
      stream.events.filter((event) => event.type === "request.opened")
    ).toHaveLength(0)
  })
})

describe("claude send: result and notice mapping", () => {
  it("maps an error result to turn.failed with a structured error", async () => {
    const failing = async (context: ClaudeTurnScriptContext) => {
      context.emit({
        type: "result",
        subtype: "error_max_turns",
        is_error: true,
        errors: ["hit the turn cap"],
      })
    }
    const { adapter, handle, nativeSession } = await startSession({
      script: failing,
    })
    const stream = collect(adapter.events({ handle, nativeSession }))

    await adapter.send({
      handle,
      nativeSession,
      commandId: "cmd-1",
      turnId: "turn-1",
      userMessage: userMessage("go"),
      execution: execution(),
    })
    const failed = await stream.waitFor(
      (event) => event.type === "turn.failed",
      "turn.failed"
    )
    await stream.stop()

    if (failed.type !== "turn.failed") throw new Error("unreachable")
    expect(failed.data.turn.error).toMatchObject({
      code: "claude_error_max_turns",
      message: "hit the turn cap",
      retryable: false,
    })
  })

  it("maps status, retry, denial, and compaction messages to notices", async () => {
    const noisy = async (context: ClaudeTurnScriptContext) => {
      context.emit({ type: "system", subtype: "status", status: "compacting" })
      context.emit({
        type: "system",
        subtype: "api_retry",
        attempt: 2,
        max_retries: 5,
      })
      context.emit({
        type: "system",
        subtype: "permission_denied",
        tool_name: "Bash",
      })
      context.emit({
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: { trigger: "auto" },
      })
      context.emit({ type: "result", subtype: "success", is_error: false })
    }
    const { adapter, handle, nativeSession } = await startSession({
      script: noisy,
    })
    const stream = collect(adapter.events({ handle, nativeSession }))

    await adapter.send({
      handle,
      nativeSession,
      commandId: "cmd-1",
      turnId: "turn-1",
      userMessage: userMessage("go"),
      execution: execution(),
    })
    await stream.waitFor(
      (event) => event.type === "turn.completed",
      "turn.completed"
    )
    await stream.stop()

    const notices = stream.events.filter(
      (event) => event.type === "notice.created"
    )
    expect(notices).toHaveLength(4)
    expect(
      notices.map((event) =>
        event.type === "notice.created" ? event.data.level : undefined
      )
    ).toEqual(["info", "warning", "warning", "info"])
  })

  it("fails an in-flight turn when the query's stream ends without a result", async () => {
    const silent = async () => {}
    const { adapter, handle, nativeSession, createSession } =
      await startSession({ script: silent })
    const stream = collect(adapter.events({ handle, nativeSession }))

    await adapter.send({
      handle,
      nativeSession,
      commandId: "cmd-1",
      turnId: "turn-1",
      userMessage: userMessage("go"),
      execution: execution(),
    })
    // The runtime is closed from underneath, as a crashed CLI would do.
    await createSession.sessions[1].close()

    const failed = await stream.waitFor(
      (event) => event.type === "turn.failed",
      "turn.failed"
    )
    if (failed.type !== "turn.failed") throw new Error("unreachable")
    expect(failed.data.turn.error?.code).toBe("claude_stream_closed")
    await stream.stop()
  })
})

describe("claude send: resume", () => {
  it("reports the last assistant message as the resume point", async () => {
    const { adapter, handle, nativeSession } = await startSession({
      script: completeImmediately,
    })
    const stream = collect(adapter.events({ handle, nativeSession }))

    await adapter.send({
      handle,
      nativeSession,
      commandId: "cmd-1",
      turnId: "turn-1",
      userMessage: userMessage("go"),
      execution: execution(),
    })
    await stream.waitFor(
      (event) => event.type === "turn.completed",
      "turn.completed"
    )
    await stream.stop()

    const resumed = await adapter.resumeSession({
      handle,
      sessionId: "session-1",
      nativeSessionId: nativeSession.nativeSessionId,
    })
    expect(resumed.nativeSessionId).toBe(nativeSession.nativeSessionId)
    // A message uuid, not a generic cursor: the SDK owns its own session store.
    expect(resumed.resumeCursor).toBe("uuid-2")
  })
})

describe("claude permission diff", () => {
  it("renders an edit as removed and added lines", () => {
    expect(permissionDiff("Edit", { old_string: "a", new_string: "b" })).toBe(
      "- a\n+ b"
    )
  })

  it("renders a write as added lines and reports nothing for other tools", () => {
    expect(permissionDiff("Write", { content: "x\ny" })).toBe("+ x\n+ y")
    expect(permissionDiff("Bash", { command: "ls" })).toBeUndefined()
  })
})

describe("claude dialog normalization", () => {
  const signal = new AbortController().signal

  it("reads a single-question payload", () => {
    const questions = normalizeDialogQuestions({
      dialogKind: "confirm",
      payload: { prompt: "Proceed?" },
      signal,
    })
    expect(questions).toEqual([
      {
        id: "question-0",
        prompt: "Proceed?",
        allowMultiple: false,
        allowFreeText: true,
      },
    ])
  })

  it("reports nothing for a payload it cannot read", () => {
    expect(
      normalizeDialogQuestions({
        dialogKind: "future",
        payload: { data: 1 },
        signal,
      })
    ).toBeUndefined()
  })

  it("accepts plain-string options", () => {
    const questions = normalizeDialogQuestions({
      dialogKind: "choice",
      payload: { prompt: "Pick", choices: ["a", "b"] },
      signal,
    })
    expect(questions?.[0].options).toEqual([
      { id: "a", label: "a" },
      { id: "b", label: "b" },
    ])
    expect(questions?.[0].allowFreeText).toBe(false)
  })
})
