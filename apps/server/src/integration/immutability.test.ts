import type { ExecutionSelection } from "@workspace/contracts"
import { describe, expect, it } from "vitest"

import { messagesRepo, turnsRepo } from "../db"
import { createFakeHarnessAdapter } from "../harness/fake"
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

const selection: ExecutionSelection = {
  instanceId: "fake-primary",
  driver: "opencode",
  model: { providerId: "fake-provider", modelId: "fake-standard" },
  agent: "build",
  interactionMode: "build",
  options: { variant: "stable" },
}

describe("historical execution immutability", () => {
  it("keeps ResolvedExecution display unchanged after inventory changes", async () => {
    const created = createTestDb()
    const registry = new AdapterRegistry()
    const fake = createFakeHarnessAdapter({ projectId: "project_1" })
    const instance = {
      instanceId: "fake-primary",
      driver: "opencode" as const,
      displayName: "Fake Primary",
      enabled: true,
      autoStart: true,
      config: {},
    }
    const handle = await fake.adapter.start({ instance })
    registry.register({ adapter: fake.adapter, handle, instance })
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
    try {
      const project = subject.services.projects.open(
        "/tmp/immutability",
        "Immutability"
      )
      const session = subject.services.projects.createSession(project.id)

      const receipt = await subject.dispatcher.dispatch({
        commandId: "cmd_immutable_turn",
        name: "turn.send",
        sessionId: session.id,
        content: "remember my execution",
        execution: selection,
      })
      if (receipt.state === "failed") {
        throw new Error(`dispatch failed: ${JSON.stringify(receipt.error)}`)
      }
      const turn = await waitFor(() =>
        turnsRepo
          .listBySession(created.db, session.id)
          .find((candidate) => candidate.commandId === "cmd_immutable_turn")
      )

      // Drive the fake turn to completion so nothing is mid-flight when the
      // inventory changes underneath it.
      const permission = await waitFor(() =>
        subject.snapshotService
          .sessionSnapshot(session.id)
          .requests.find(
            (request) =>
              request.turnId === turn.id &&
              request.kind === "permission" &&
              request.status === "open"
          )
      )
      await subject.dispatcher.dispatch({
        commandId: "cmd_permission",
        name: "permission.respond",
        requestId: permission.id,
        resolution: { kind: "permission", optionId: "allow" },
      })
      const input = await waitFor(() =>
        subject.snapshotService
          .sessionSnapshot(session.id)
          .requests.find(
            (request) =>
              request.turnId === turn.id &&
              request.kind === "input" &&
              request.status === "open"
          )
      )
      await subject.dispatcher.dispatch({
        commandId: "cmd_input",
        name: "input.respond",
        requestId: input.id,
        resolution: {
          kind: "input",
          answers: {
            approach: { optionIds: ["safe"] },
            notes: { text: "immutability" },
          },
        },
      })
      await waitFor(() =>
        turnsRepo
          .listBySession(created.db, session.id)
          .find((candidate) => candidate.id === turn.id)?.status === "completed"
          ? true
          : undefined
      )

      const original = messagesRepo
        .listBySession(created.db, session.id)
        .find((message) => message.role === "user")!
      expect(original.execution.display).toMatchObject({
        instanceName: "Fake Primary",
        modelName: "Fake Standard",
      })
      const originalExecution = structuredClone(original.execution)

      // Inventory changes: the adapter now reports no models at all.
      const discover = fake.adapter.discover.bind(fake.adapter)
      fake.adapter.discover = async (input) => ({
        ...(await discover(input)),
        models: [],
      })

      // A fresh dispatch of the same selection can no longer resolve...
      const stale = await subject.dispatcher.dispatch({
        commandId: "cmd_stale_turn",
        name: "turn.send",
        sessionId: session.id,
        content: "this one cannot resolve",
        execution: selection,
      })
      expect(stale).toMatchObject({
        state: "failed",
        error: { code: "model_unavailable" },
      })

      // ...yet the historical record still renders exactly as dispatched.
      const snapshot = subject.snapshotService.sessionSnapshot(session.id)
      const historical = snapshot.messages.find(
        (message) => message.role === "user" && message.id === original.id
      )
      if (historical?.role !== "user") {
        throw new Error("historical user message missing from snapshot")
      }
      expect(historical.execution).toEqual(originalExecution)
      expect(historical.execution.display.modelName).toBe("Fake Standard")
      expect(historical.execution.inventoryRevision).toBe(
        originalExecution.inventoryRevision
      )
    } finally {
      await fake.adapter.stop({ handle })
      created.client.close()
    }
  })
})
