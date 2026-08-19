import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import type { ExecutionSelection } from "@workspace/contracts"
import { afterAll, describe, expect, it } from "vitest"

import { sessionFileChangesRepo, turnsRepo } from "../db"
import { createFakeHarnessAdapter } from "../harness/fake"
import { AdapterRegistry } from "../services"
import { createTestDb } from "../test/db"
import { createAideTestApp } from "./app"

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []

async function waitFor<T>(read: () => T | undefined): Promise<T> {
  const deadline = Date.now() + 5_000
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() >= deadline) throw new Error("Timed out waiting for state")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function git(directory: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: directory })
}

async function makeRepo(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aide-workspace-test-"))
  tempDirs.push(directory)
  await git(directory, "init")
  await git(directory, "config", "user.email", "aide@example.com")
  await git(directory, "config", "user.name", "Aide Test")
  await writeFile(join(directory, "tracked.txt"), "one\n")
  await git(directory, "add", "-A")
  await git(directory, "commit", "-m", "initial")
  return directory
}

afterAll(async () => {
  await Promise.all(
    tempDirs.map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

const selection: ExecutionSelection = {
  instanceId: "fake-primary",
  driver: "opencode",
  model: { providerId: "fake-provider", modelId: "fake-standard" },
  agent: "build",
  interactionMode: "build",
  options: { variant: "stable" },
}

describe("workspace change tracking", () => {
  it("credits files touched during a turn to that turn", async () => {
    const directory = await makeRepo()
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
      trackWorkspaceChanges: true,
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
      id: (kind) => {
        const value = (counters.get(kind) ?? 0) + 1
        counters.set(kind, value)
        return `${kind}_${value}`
      },
    })
    try {
      const project = subject.services.projects.open(directory, "Workspace")
      const session = subject.services.projects.createSession(project.id)

      // A dirty file that predates the turn must stay unattributed.
      await writeFile(join(directory, "tracked.txt"), "two\n")

      const receipt = await subject.dispatcher.dispatch({
        commandId: "cmd_turn",
        name: "turn.send",
        sessionId: session.id,
        content: "touch the workspace",
        execution: selection,
      })
      if (receipt.state === "failed") {
        throw new Error(`dispatch failed: ${JSON.stringify(receipt.error)}`)
      }
      const turn = await waitFor(() =>
        turnsRepo
          .listBySession(created.db, session.id)
          .find((candidate) => candidate.commandId === "cmd_turn")
      )
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

      // The harness "writes" a file while the turn is in flight.
      await writeFile(join(directory, "generated.txt"), "from the turn\n")

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
            notes: { text: "workspace" },
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

      const changes = await waitFor(() => {
        const current = sessionFileChangesRepo.listBySession(
          created.db,
          session.id
        )
        return current.length === 2 ? current : undefined
      })
      expect(changes).toMatchObject([
        { path: "generated.txt", turnId: turn.id, untracked: true },
        { path: "tracked.txt", turnId: undefined },
      ])
      expect(sessionFileChangesRepo.listByTurn(created.db, turn.id)).toEqual([
        changes[0],
      ])
    } finally {
      await fake.adapter.stop({ handle })
      created.client.close()
    }
  })
})
