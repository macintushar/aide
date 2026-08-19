import {
  sessionSnapshotFixture,
  userMessageFixture,
  type AideEvent,
  type SessionSnapshot,
} from "@workspace/contracts"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { createReadClient } from "@/lib/transport/read-client"

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
  const subscribe = vi.fn((options: SubscribeOptions) => {
    const recording: Recording = { options, close: vi.fn() }
    subscriptions.push(recording)
    return { close: recording.close }
  })
  return {
    subscriptions,
    getSession,
    readClient: { getSession } as unknown as Pick<
      ReturnType<typeof createReadClient>,
      "getSession"
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
      first.options.onError(new Event("error"))
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
