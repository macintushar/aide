import type { ExecutionSelection, SessionSnapshot } from "@workspace/contracts"
import { afterEach, describe, expect, it, vi } from "vitest"

import { dispatchInputsRepo, nativeMappingsRepo, turnsRepo } from "../db"
import { createFakeHarnessAdapter } from "../harness/fake"
import type { SendTurnInput } from "../harness/types"
import { AdapterRegistry } from "../services"
import { createTestDb } from "../test/db"
import { createAideTestApp } from "./app"

async function waitFor<T>(read: () => T | undefined): Promise<T> {
  const deadline = Date.now() + 2_000
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() >= deadline) throw new Error("Timed out waiting for state")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function selection(
  instanceId: string,
  driver: "opencode" | "claudeAgent"
): ExecutionSelection {
  return {
    instanceId,
    driver,
    model: { providerId: "fake-provider", modelId: "fake-standard" },
    agent: "build",
    interactionMode: "build",
    options: { variant: "stable" },
  }
}

describe("Gate G3 cross-harness context", () => {
  const cleanups: Array<() => Promise<void> | void> = []

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
  })

  async function boot() {
    const created = createTestDb()
    const registry = new AdapterRegistry()
    const first = createFakeHarnessAdapter({
      driver: "opencode",
      projectId: "project-cross",
    })
    const second = createFakeHarnessAdapter({
      driver: "claudeAgent",
      projectId: "project-cross",
    })
    const firstInstance = {
      instanceId: "fake-a",
      driver: "opencode" as const,
      displayName: "Fake A",
      enabled: true,
      autoStart: true,
      config: {},
    }
    const secondInstance = {
      instanceId: "fake-b",
      driver: "claudeAgent" as const,
      displayName: "Fake B",
      enabled: true,
      autoStart: true,
      config: {},
    }
    const [firstHandle, secondHandle] = await Promise.all([
      first.adapter.start({ instance: firstInstance }),
      second.adapter.start({ instance: secondInstance }),
    ])
    registry.register({
      adapter: first.adapter,
      handle: firstHandle,
      instance: firstInstance,
    })
    registry.register({
      adapter: second.adapter,
      handle: secondHandle,
      instance: secondInstance,
    })
    const firstSend = vi.spyOn(first.adapter, "send")
    const secondSend = vi.spyOn(second.adapter, "send")
    let tick = 0
    const counters = new Map<string, number>()
    const subject = createAideTestApp({
      db: created.db,
      registry,
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
      id: (kind) => {
        const value = (counters.get(kind) ?? 0) + 1
        counters.set(kind, value)
        return `${kind}_${value}`
      },
    })
    const project = subject.services.projects.open(
      "/tmp/cross-harness",
      "Cross harness"
    )
    const session = subject.services.projects.createSession(project.id)
    cleanups.push(async () => {
      await Promise.all([
        first.adapter.stop({ handle: firstHandle }),
        second.adapter.stop({ handle: secondHandle }),
      ])
      created.client.close()
    })
    return {
      ...subject,
      session,
      first: { ...first, handle: firstHandle, send: firstSend },
      second: { ...second, handle: secondHandle, send: secondSend },
    }
  }

  async function beginTurn(
    subject: Awaited<ReturnType<typeof boot>>,
    commandId: string,
    content: string,
    execution: ExecutionSelection
  ) {
    const receipt = await subject.dispatcher.dispatch({
      commandId,
      name: "turn.send",
      sessionId: subject.session.id,
      content,
      execution,
    })
    if (receipt.state === "failed") {
      throw new Error(`turn dispatch failed: ${JSON.stringify(receipt.error)}`)
    }
    const turn = await waitFor(() =>
      turnsRepo
        .listBySession(subject.db, subject.session.id)
        .find((candidate) => candidate.commandId === commandId)
    )
    let started
    try {
      started = await waitFor(() => {
        const snapshot = subject.snapshotService.sessionSnapshot(
          subject.session.id
        )
        const current = snapshot.turns.find(
          (candidate) => candidate.id === turn.id
        )
        const permission = snapshot.requests.find(
          (request) =>
            request.turnId === turn.id &&
            request.kind === "permission" &&
            request.status === "open"
        )
        return (
          permission ?? (current?.status === "failed" ? current : undefined)
        )
      })
    } catch {
      throw new Error(
        `turn did not reach a request: ${JSON.stringify(subject.snapshotService.sessionSnapshot(subject.session.id))}`
      )
    }
    if ("status" in started && started.status === "failed") {
      throw new Error(
        `turn failed while starting: ${JSON.stringify(started.error)}`
      )
    }
    return turn
  }

  async function finishTurn(
    subject: Awaited<ReturnType<typeof boot>>,
    turnId: string,
    suffix: string
  ): Promise<SessionSnapshot> {
    const permission = subject.snapshotService
      .sessionSnapshot(subject.session.id)
      .requests.find(
        (request) =>
          request.turnId === turnId &&
          request.kind === "permission" &&
          request.status === "open"
      )!
    await subject.dispatcher.dispatch({
      commandId: `permission-${suffix}`,
      name: "permission.respond",
      requestId: permission.id,
      resolution: { kind: "permission", optionId: "allow" },
    })
    const input = await waitFor(() =>
      subject.snapshotService
        .sessionSnapshot(subject.session.id)
        .requests.find(
          (request) =>
            request.turnId === turnId &&
            request.kind === "input" &&
            request.status === "open"
        )
    )
    await subject.dispatcher.dispatch({
      commandId: `input-${suffix}`,
      name: "input.respond",
      requestId: input.id,
      resolution: {
        kind: "input",
        answers: {
          approach: { optionIds: ["safe"] },
          notes: { text: suffix },
        },
      },
    })
    return waitFor(() => {
      const snapshot = subject.snapshotService.sessionSnapshot(
        subject.session.id
      )
      return snapshot.turns.find((turn) => turn.id === turnId)?.status ===
        "completed"
        ? snapshot
        : undefined
    })
  }

  it("synchronizes only the target instance's missing canonical range A to B to A", async () => {
    const subject = await boot()
    const first = await beginTurn(
      subject,
      "turn-a-1",
      "A_ONLY_SENTINEL",
      selection("fake-a", "opencode")
    )
    expect(dispatchInputsRepo.listByTurn(subject.db, first.id)).toEqual([])
    expect(
      nativeMappingsRepo.get(subject.db, subject.session.id, "fake-a")
    ).toMatchObject({ syncCursor: -1, unsafe: true })
    await finishTurn(subject, first.id, "a-1")
    expect(
      nativeMappingsRepo.get(subject.db, subject.session.id, "fake-a")
    ).toMatchObject({ syncCursor: 1, unsafe: false })

    const second = await beginTurn(
      subject,
      "turn-b-1",
      "B_ONLY_SENTINEL",
      selection("fake-b", "claudeAgent")
    )
    const secondHandoff = dispatchInputsRepo.listByTurn(
      subject.db,
      second.id
    )[0]!
    expect(secondHandoff).toMatchObject({
      instanceId: "fake-b",
      fromMessageSeq: 0,
      throughMessageSeq: 1,
    })
    expect(secondHandoff.content).toContain("A_ONLY_SENTINEL")
    expect(secondHandoff.content).not.toContain("B_ONLY_SENTINEL")
    expect(secondHandoff.content).not.toContain("private reasoning")
    expect(secondHandoff.content).not.toContain("thinking about the request")
    expect(secondHandoff.content).not.toContain("fake-native")
    expect(
      (subject.second.send.mock.calls[0]![0] as SendTurnInput).handoff
    ).toEqual(secondHandoff)
    await finishTurn(subject, second.id, "b-1")
    expect(
      nativeMappingsRepo.get(subject.db, subject.session.id, "fake-b")
    ).toMatchObject({ syncCursor: 3, unsafe: false })

    const firstNativeSession = nativeMappingsRepo.get(
      subject.db,
      subject.session.id,
      "fake-a"
    )!.nativeSessionId
    const third = await beginTurn(
      subject,
      "turn-a-2",
      "RETURN_TO_A",
      selection("fake-a", "opencode")
    )
    const thirdHandoff = dispatchInputsRepo.listByTurn(subject.db, third.id)[0]!
    expect(thirdHandoff).toMatchObject({
      instanceId: "fake-a",
      nativeSessionId: firstNativeSession,
      fromMessageSeq: 2,
      throughMessageSeq: 3,
    })
    expect(thirdHandoff.content).toContain("B_ONLY_SENTINEL")
    expect(thirdHandoff.content).not.toContain("A_ONLY_SENTINEL")
    expect(thirdHandoff.content).not.toContain("RETURN_TO_A")
    expect(subject.first.send.mock.calls[1]![0].handoff).toEqual(thirdHandoff)
    await finishTurn(subject, third.id, "a-2")
    expect(
      nativeMappingsRepo.get(subject.db, subject.session.id, "fake-a")
    ).toMatchObject({ syncCursor: 5, unsafe: false })
    expect(
      subject.snapshotService
        .sessionSnapshot(subject.session.id)
        .messages.map((message) => message.role)
    ).toEqual(["user", "assistant", "user", "assistant", "user", "assistant"])
  })

  it("rebuilds an unsafe target with the full retained canonical range", async () => {
    const subject = await boot()
    const first = await beginTurn(
      subject,
      "unsafe-a-1",
      "A_HISTORY",
      selection("fake-a", "opencode")
    )
    await finishTurn(subject, first.id, "unsafe-a-1")
    const second = await beginTurn(
      subject,
      "unsafe-b-1",
      "B_HISTORY",
      selection("fake-b", "claudeAgent")
    )
    await finishTurn(subject, second.id, "unsafe-b-1")
    const oldNativeSession = nativeMappingsRepo.get(
      subject.db,
      subject.session.id,
      "fake-a"
    )!.nativeSessionId
    nativeMappingsRepo.markUnsafe(subject.db, subject.session.id, "fake-a")

    const third = await beginTurn(
      subject,
      "unsafe-a-2",
      "CURRENT_MESSAGE",
      selection("fake-a", "opencode")
    )
    const mapping = nativeMappingsRepo.get(
      subject.db,
      subject.session.id,
      "fake-a"
    )!
    const handoff = dispatchInputsRepo.listByTurn(subject.db, third.id)[0]!
    expect(mapping).toMatchObject({ syncCursor: -1, unsafe: true })
    expect(mapping.nativeSessionId).not.toBe(oldNativeSession)
    expect(handoff).toMatchObject({
      nativeSessionId: mapping.nativeSessionId,
      fromMessageSeq: 0,
      throughMessageSeq: 3,
    })
    expect(handoff.content).toContain("A_HISTORY")
    expect(handoff.content).toContain("B_HISTORY")
    expect(handoff.content).not.toContain("CURRENT_MESSAGE")
    expect(handoff.content).not.toContain("thinking about the request")
    await finishTurn(subject, third.id, "unsafe-a-2")
    expect(
      nativeMappingsRepo.get(subject.db, subject.session.id, "fake-a")
    ).toMatchObject({ syncCursor: 5, unsafe: false })
  })
})
