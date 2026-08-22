import {
  permissionRequestFixture,
  sessionSnapshotFixture,
  userMessageFixture,
  type AideEvent,
  type SessionSnapshot,
} from "@workspace/contracts"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { SessionBoundary } from "./session-boundary"

type SubscribeOptions = Parameters<
  NonNullable<Parameters<typeof SessionBoundary>[0]["subscribe"]>
>[0]

type Recording = { options: SubscribeOptions; close: ReturnType<typeof vi.fn> }

function snapshotWithSequence(sequence: number): SessionSnapshot {
  return { ...sessionSnapshotFixture(), cursor: { sequence } }
}

function durableEvent(sequence: number): AideEvent {
  const message = userMessageFixture()
  return {
    schemaVersion: 1,
    eventId: `evt-${sequence}`,
    timestamp: "2026-01-01T00:00:00.000Z",
    delivery: { durable: true, sequence },
    scope: {
      kind: "session",
      sessionId: message.sessionId,
      messageId: `message-${sequence}`,
    },
    instanceId: "instance",
    driver: "opencode",
    type: "message.upserted",
    data: {
      message: {
        id: `message-${sequence}`,
        sessionId: message.sessionId,
        seq: sequence,
        role: "user",
        execution: message.execution,
        createdAt: message.createdAt,
      },
    },
    // The message metadata shape satisfies message.upserted; the text lands
    // through the user message part below by reusing the same id.
  } as unknown as AideEvent
}

function partEvent(sequence: number, text: string): AideEvent {
  const message = userMessageFixture()
  return {
    schemaVersion: 1,
    eventId: `evt-part-${sequence}`,
    timestamp: "2026-01-01T00:00:00.000Z",
    delivery: { durable: true, sequence },
    scope: {
      kind: "session",
      sessionId: message.sessionId,
      messageId: `message-${sequence}`,
      partId: `part-${sequence}`,
    },
    instanceId: "instance",
    driver: "opencode",
    type: "part.upserted",
    data: {
      part: {
        id: `part-${sequence}`,
        messageId: `message-${sequence}`,
        index: 0,
        type: "text",
        text,
      },
    },
  } as AideEvent
}

function bootStream() {
  const subscriptions: Recording[] = []
  const getSession = vi.fn(async () => snapshotWithSequence(4))
  // The composer reads configured defaults; an empty config exercises the
  // fall-through to what the harness reports.
  const getConfig = vi.fn(async () => ({
    instances: {},
    mcpServers: {},
    defaults: {},
  }))
  const getProjectConfig = vi.fn(async () => ({
    projectId: sessionSnapshotFixture().project.id,
  }))
  const subscribe = vi.fn((options: SubscribeOptions) => {
    const recording: Recording = { options, close: vi.fn() }
    subscriptions.push(recording)
    return { close: recording.close }
  })
  return {
    subscriptions,
    getSession,
    getConfig,
    getProjectConfig,
    readClient: {
      getSession,
      getConfig,
      getProjectConfig,
    } as unknown as NonNullable<
      Parameters<typeof SessionBoundary>[0]["readClient"]
    >,
    subscribe: subscribe as NonNullable<
      Parameters<typeof SessionBoundary>[0]["subscribe"]
    >,
  }
}

function boundaryProps(
  stream: ReturnType<typeof bootStream>,
  extra: { reconnectDelayMs?: number } = {}
) {
  return {
    sessionId: "session_1",
    readClient: stream.readClient,
    commandClient: { send: vi.fn() },
    subscribe: stream.subscribe,
    ...extra,
  }
}

describe("SessionBoundary", () => {
  it("loads the initial snapshot before subscribing from its cursor", async () => {
    const stream = bootStream()
    render(<SessionBoundary {...boundaryProps(stream)} />)

    await waitFor(() => expect(stream.subscriptions).toHaveLength(1))
    expect(stream.subscriptions[0]!.options.afterSequence).toBe(4)
    expect(stream.getSession).toHaveBeenCalledTimes(1)
    expect(
      screen.getByText(sessionSnapshotFixture().session.title)
    ).toBeInTheDocument()
  })

  it("applies live session events to the transcript", async () => {
    const stream = bootStream()
    render(<SessionBoundary {...boundaryProps(stream)} />)

    await waitFor(() => expect(stream.subscriptions).toHaveLength(1))
    const subscription = stream.subscriptions[0]!
    await act(async () => {
      subscription.options.onEvent(durableEvent(6))
      subscription.options.onEvent(partEvent(6, "live message"))
    })
    expect(screen.getByText("live message")).toBeInTheDocument()
  })

  it("reconnects from the latest durable cursor after a stream error", async () => {
    const stream = bootStream()
    render(
      <SessionBoundary {...boundaryProps(stream, { reconnectDelayMs: 0 })} />
    )

    await waitFor(() => expect(stream.subscriptions).toHaveLength(1))
    const first = stream.subscriptions[0]!
    await act(async () => {
      first.options.onEvent(partEvent(7, "advanced cursor"))
    })
    act(() => {
      first.options.onError?.(new Event("error"))
    })

    await waitFor(() => expect(stream.subscriptions).toHaveLength(2))
    const second = stream.subscriptions[1]!
    expect(first.close).toHaveBeenCalled()
    expect(second.options.afterSequence).toBe(7)
  })

  it("reports load failures and retries", async () => {
    const stream = bootStream()
    stream.getSession
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(sessionSnapshotFixture())
    render(<SessionBoundary {...boundaryProps(stream)} />)

    expect(
      await screen.findByText(/Could not load session: offline/)
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(
      await screen.findByText(sessionSnapshotFixture().session.title)
    ).toBeInTheDocument()
  })
})

function openPermissionEvent(sequence: number): AideEvent {
  return {
    schemaVersion: 1,
    eventId: `evt-req-${sequence}`,
    timestamp: "2026-01-01T00:00:00.000Z",
    delivery: { durable: true, sequence },
    scope: {
      kind: "session",
      projectId: "proj_1",
      sessionId: "ses_1",
      turnId: "turn_1",
    },
    instanceId: "instance",
    driver: "claudeAgent",
    type: "request.opened",
    data: {
      request: {
        ...permissionRequestFixture(),
        id: "req_open_1",
        status: "open",
        resolution: undefined,
      },
    },
  } as AideEvent
}

describe("SessionBoundary: unresolved requests", () => {
  it("keeps an open request visible across a reconnect and resolves it against the same id", async () => {
    const stream = bootStream()
    const commandClient = { send: vi.fn(async () => undefined) }
    render(
      <SessionBoundary
        {...boundaryProps(stream, { reconnectDelayMs: 0 })}
        commandClient={commandClient as never}
      />
    )

    await waitFor(() => expect(stream.subscriptions).toHaveLength(1))
    const first = stream.subscriptions[0]!
    await act(async () => {
      first.options.onEvent(openPermissionEvent(8))
    })
    // Only an open permission card offers its options; the snapshot's
    // already-resolved request renders as a summary row.
    expect(screen.getByRole("button", { name: "Allow" })).toBeInTheDocument()

    act(() => {
      first.options.onError?.(new Event("error"))
    })
    await waitFor(() => expect(stream.subscriptions).toHaveLength(2))

    // The request is server-side state; a dropped stream must not lose the
    // prompt the user still has to answer.
    expect(screen.getByRole("button", { name: "Allow" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Allow" }))

    await waitFor(() => expect(commandClient.send).toHaveBeenCalled())
    expect(commandClient.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "permission.respond",
        requestId: "req_open_1",
        resolution: { kind: "permission", optionId: "allow" },
      })
    )
  })

  it("shows a request the reconnect snapshot still reports as open", async () => {
    const stream = bootStream()
    render(<SessionBoundary {...boundaryProps(stream)} />)

    await waitFor(() => expect(stream.subscriptions).toHaveLength(1))
    const snapshot = snapshotWithSequence(9)
    snapshot.requests = [
      {
        ...permissionRequestFixture(),
        id: "req_open_2",
        status: "open",
        resolution: undefined,
      },
    ]
    await act(async () => {
      stream.subscriptions[0]!.options.onSnapshot?.(snapshot)
    })

    expect(screen.getByRole("button", { name: "Allow" })).toBeInTheDocument()
  })
})
