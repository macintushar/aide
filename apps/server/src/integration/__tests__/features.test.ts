import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import type {
  CommandReceipt,
  ExecutionSelection,
  FileSearchResult,
  SessionSummaryList,
} from "@workspace/contracts"
import { sessionSummaryListSchema } from "@workspace/contracts"
import { afterAll, afterEach, describe, expect, it } from "vitest"

import { artifactsRepo, eventLogRepo, nativeMappingsRepo } from "../../db"
import { createFakeHarnessAdapter } from "../../harness/fake"
import { AdapterRegistry } from "../../services"
import type { TurnUsageLogEntry } from "../../services/turn"
import { createTestDb } from "../../test/db"
import { createAideTestApp } from ".././app"

/**
 * End-to-end coverage for steering, usage, fork, checkpoints, worktrees, file
 * search and invocations, through the HTTP command surface against the fake
 * harness and real git repositories.
 */

const execFileAsync = promisify(execFile)
const token = "features-token"
const origin = "http://127.0.0.1:3000"
const selection: ExecutionSelection = {
  instanceId: "fake-primary",
  driver: "opencode",
  model: { providerId: "fake-provider", modelId: "fake-standard" },
  agent: "build",
  interactionMode: "build",
  options: { variant: "stable" },
}
const tempDirs: string[] = []
const closers: Array<() => void> = []

afterEach(async () => {
  // Post-turn work (change capture) finishes after the turn is observed done.
  await new Promise((resolve) => setTimeout(resolve, 150))
  for (const close of closers.splice(0)) close()
})

afterAll(async () => {
  await Promise.all(
    tempDirs.map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

async function gitRepo(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aide-features-"))
  tempDirs.push(directory)
  const git = (...args: string[]) =>
    execFileAsync("git", args, { cwd: directory })
  await git("init")
  await git("config", "user.email", "aide@example.com")
  await git("config", "user.name", "Aide Test")
  await writeFile(join(directory, "notes.md"), "original\n")
  await writeFile(join(directory, "src-main.ts"), "export {}\n")
  await git("add", "-A")
  await git("commit", "-m", "base")
  return directory
}

async function waitFor<T>(
  read: () => T | undefined,
  timeout = 3000
): Promise<T> {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = read()
    if (value !== undefined) return value
    if (Date.now() >= deadline) throw new Error("Timed out waiting")
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function boot(options: { directory: string; worktreeRoot?: string }) {
  const created = createTestDb()
  closers.push(() => created.client.close())
  const registry = new AdapterRegistry()
  const { adapter, control } = createFakeHarnessAdapter({
    projectId: "project_1",
  })
  const instance = {
    instanceId: "fake-primary",
    driver: adapter.driver,
    displayName: "Fake Primary",
    enabled: true,
    autoStart: true,
    config: {},
  } as const
  const handle = await adapter.start({
    instance,
    projectDirectory: options.directory,
  })
  registry.register({ adapter, handle, instance })
  const usage: TurnUsageLogEntry[] = []
  const integration = createAideTestApp({
    db: created.db,
    registry,
    auth: { bootstrapToken: token, allowedOrigins: [origin] },
    checkpoints: true,
    trackWorkspaceChanges: true,
    logUsage: (entry) => usage.push(entry),
    ...(options.worktreeRoot ? { worktreeRoot: options.worktreeRoot } : {}),
  })

  const exchange = await integration.app.request("/auth/session", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, origin },
  })
  const { sessionToken } = (await exchange.json()) as { sessionToken: string }
  const headers = { authorization: `Bearer ${sessionToken}`, origin }

  let counter = 0
  async function command(
    name: string,
    body: Record<string, unknown>
  ): Promise<CommandReceipt> {
    const response = await integration.app.request(`/commands/${name}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        name,
        commandId: `cmd_${name}_${++counter}`,
        ...body,
      }),
    })
    return (await response.json()) as CommandReceipt
  }

  const project = (
    await command("project.open", { directory: options.directory })
  ).result as { id: string }

  const snapshot = (sessionId: string) =>
    integration.snapshotService.sessionSnapshot(sessionId)

  /** Runs one full fake turn: send, allow the permission, answer the input. */
  async function completeTurn(sessionId: string, content: string) {
    await command("turn.send", { sessionId, content, execution: selection })
    const turnId = await waitFor(
      () => snapshot(sessionId).turns.find((t) => t.status === "running")?.id
    )
    const permission = await waitFor(() =>
      snapshot(sessionId).requests.find(
        (r) =>
          r.turnId === turnId && r.kind === "permission" && r.status === "open"
      )
    )
    await command("permission.respond", {
      requestId: permission.id,
      resolution: { kind: "permission", optionId: "allow" },
    })
    const input = await waitFor(() =>
      snapshot(sessionId).requests.find(
        (r) => r.turnId === turnId && r.kind === "input" && r.status === "open"
      )
    )
    await command("input.respond", {
      requestId: input.id,
      resolution: {
        kind: "input",
        answers: { approach: { optionIds: ["fast"] }, notes: { text: "ok" } },
      },
    })
    await waitFor(() =>
      snapshot(sessionId).turns.find(
        (t) => t.id === turnId && t.status === "completed"
      )
    )
    return turnId
  }

  return {
    ...integration,
    control,
    headers,
    command,
    project,
    snapshot,
    usage,
    completeTurn,
  }
}

describe("usage, steering and invocations", () => {
  it("stores and logs the usage a harness reports", async () => {
    const directory = await gitRepo()
    const subject = await boot({ directory })
    const session = (
      await subject.command("session.create", { projectId: subject.project.id })
    ).result as { id: string }

    const turnId = await subject.completeTurn(session.id, "hello")

    const assistant = subject
      .snapshot(session.id)
      .messages.find((message) => message.role === "assistant")
    expect(assistant?.role === "assistant" && assistant.usage).toEqual({
      inputTokens: 120,
      outputTokens: 40,
      cacheReadTokens: 8,
      cacheWriteTokens: 2,
      costUsd: 0.0042,
    })
    expect(subject.usage).toEqual([
      expect.objectContaining({
        turnId,
        sessionId: session.id,
        model: "fake-standard",
        status: "completed",
        usage: expect.objectContaining({ costUsd: 0.0042 }),
      }),
    ])
  })

  it("steers a running turn and does not hand the steer over again", async () => {
    const directory = await gitRepo()
    const subject = await boot({ directory })
    const session = (
      await subject.command("session.create", { projectId: subject.project.id })
    ).result as { id: string }

    await subject.command("turn.send", {
      sessionId: session.id,
      content: "start",
      execution: selection,
    })
    const turnId = await waitFor(
      () =>
        subject.snapshot(session.id).requests.find((r) => r.status === "open")
          ?.turnId
    )
    const receipt = await subject.command("turn.steer", {
      sessionId: session.id,
      turnId,
      content: "use the smaller approach",
    })
    expect(receipt.state).toBe("completed")
    expect(subject.control.steers()).toEqual([
      { turnId, text: "use the smaller approach" },
    ])
    const steer = subject
      .snapshot(session.id)
      .messages.find(
        (message) => message.role === "user" && message.steer?.turnId === turnId
      )
    expect(steer).toBeDefined()

    // Finish the turn, then check the sync cursor covers the steer.
    const permission = subject
      .snapshot(session.id)
      .requests.find((r) => r.kind === "permission" && r.status === "open")!
    await subject.command("permission.respond", {
      requestId: permission.id,
      resolution: { kind: "permission", optionId: "allow" },
    })
    const input = await waitFor(() =>
      subject
        .snapshot(session.id)
        .requests.find((r) => r.kind === "input" && r.status === "open")
    )
    await subject.command("input.respond", {
      requestId: input.id,
      resolution: {
        kind: "input",
        answers: { approach: { optionIds: ["fast"] }, notes: { text: "x" } },
      },
    })
    await waitFor(() =>
      subject
        .snapshot(session.id)
        .turns.find((t) => t.id === turnId && t.status === "completed")
    )
    const mapping = nativeMappingsRepo.get(
      subject.db,
      session.id,
      "fake-primary"
    )
    expect(mapping?.syncCursor).toBeGreaterThanOrEqual(steer!.seq)
  })

  it("refuses to steer a turn that is not running", async () => {
    const directory = await gitRepo()
    const subject = await boot({ directory })
    const session = (
      await subject.command("session.create", { projectId: subject.project.id })
    ).result as { id: string }
    const turnId = await subject.completeTurn(session.id, "done")
    const receipt = await subject.command("turn.steer", {
      sessionId: session.id,
      turnId,
      content: "too late",
    })
    expect(receipt).toMatchObject({
      state: "failed",
      error: { code: "turn_not_active" },
    })
  })

  it("says so when the harness does not take a steering message", async () => {
    const directory = await gitRepo()
    const subject = await boot({ directory })
    const session = (
      await subject.command("session.create", { projectId: subject.project.id })
    ).result as { id: string }
    await subject.command("turn.send", {
      sessionId: session.id,
      content: "start",
      execution: selection,
    })
    const turnId = await waitFor(
      () =>
        subject.snapshot(session.id).requests.find((r) => r.status === "open")
          ?.turnId
    )
    const entry = subject.registry.get("fake-primary")
    const original = entry.adapter.steer!.bind(entry.adapter)
    entry.adapter.steer = async () => {
      throw new Error("the turn just ended")
    }
    try {
      const receipt = await subject.command("turn.steer", {
        sessionId: session.id,
        turnId,
        content: "late words",
      })
      // Dispatch had begun, so the receipt state machine reports uncertain.
      expect(["failed", "uncertain"]).toContain(receipt.state)
      expect(subject.snapshot(session.id).notices).toContainEqual(
        expect.objectContaining({
          turnId,
          title: "Steering not delivered",
        })
      )
    } finally {
      entry.adapter.steer = original
      await subject.command("turn.interrupt", { sessionId: session.id, turnId })
    }
  })

  it("rejects worktree names that git would read as options", async () => {
    const directory = await gitRepo()
    const subject = await boot({ directory })
    const response = await subject.app.request("/commands/session.create", {
      method: "POST",
      headers: { ...subject.headers, "content-type": "application/json" },
      body: JSON.stringify({
        name: "session.create",
        commandId: "cmd_bad_branch",
        projectId: subject.project.id,
        worktree: { branch: "--delete" },
      }),
    })
    expect(response.status).toBe(400)
  })

  it("records an offered command invocation and rejects an unknown one", async () => {
    const directory = await gitRepo()
    const subject = await boot({ directory })
    const session = (
      await subject.command("session.create", { projectId: subject.project.id })
    ).result as { id: string }

    const rejected = await subject.command("turn.send", {
      sessionId: session.id,
      content: "",
      execution: selection,
      invocation: { kind: "command", name: "does-not-exist" },
    })
    expect(rejected).toMatchObject({
      state: "failed",
      error: { code: "invocation_not_offered" },
    })

    await subject.command("turn.send", {
      sessionId: session.id,
      content: "the last commit",
      execution: selection,
      invocation: { kind: "command", name: "review" },
    })
    const user = await waitFor(() =>
      subject
        .snapshot(session.id)
        .messages.find((message) => message.role === "user")
    )
    expect(user).toMatchObject({
      invocation: { kind: "command", name: "review" },
      parts: [expect.objectContaining({ text: "/review the last commit" })],
    })
    const running = await waitFor(() =>
      subject.snapshot(session.id).turns.find((t) => t.status === "running")
    )
    await subject.command("turn.interrupt", {
      sessionId: session.id,
      turnId: running.id,
    })
  })
})

describe("fork, checkpoints and restore", () => {
  it("forks a session's settled history up to a turn", async () => {
    const directory = await gitRepo()
    const subject = await boot({ directory })
    const session = (
      await subject.command("session.create", {
        projectId: subject.project.id,
        title: "Original",
      })
    ).result as { id: string }
    const first = await subject.completeTurn(session.id, "first")
    await subject.completeTurn(session.id, "second")

    const forked = (
      await subject.command("session.fork", {
        sessionId: session.id,
        throughTurnId: first,
      })
    ).result as { id: string; title: string }

    const snapshot = subject.snapshot(forked.id)
    expect(snapshot.session).toMatchObject({
      title: "Original (fork)",
      forkedFrom: { sessionId: session.id },
    })
    expect(snapshot.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ])
    expect(snapshot.messages[0]?.parts[0]).toMatchObject({ text: "first" })
    expect(snapshot.turns).toEqual([])

    // The fork's first turn opens a native session of its own.
    const before = subject.control.openedDirectories().length
    await subject.completeTurn(forked.id, "continue in the fork")
    expect(subject.control.openedDirectories().length).toBe(before + 1)
  })

  it("restores the working tree to the checkpoint before a turn", async () => {
    const directory = await gitRepo()
    const subject = await boot({ directory })
    const session = (
      await subject.command("session.create", { projectId: subject.project.id })
    ).result as { id: string }
    await writeFile(join(directory, "notes.md"), "edited before the turn\n")

    const turnId = await subject.completeTurn(session.id, "edit things")
    expect(subject.snapshot(session.id).checkpoints).toEqual([
      expect.objectContaining({ turnId }),
    ])
    expect(
      eventLogRepo.listByType(
        subject.db,
        { kind: "session", sessionId: session.id },
        "checkpoint.created"
      )
    ).toEqual([
      expect.objectContaining({
        data: { checkpoint: expect.objectContaining({ turnId }) },
      }),
    ])
    // What the turn "did".
    await writeFile(join(directory, "notes.md"), "edited by the turn\n")
    await writeFile(join(directory, "new-file.ts"), "created\n")

    const receipt = await subject.command("session.restore", {
      sessionId: session.id,
      turnId,
    })
    expect(receipt.state).toBe("completed")
    expect(await readFile(join(directory, "notes.md"), "utf8")).toBe(
      "edited before the turn\n"
    )
    expect(existsSync(join(directory, "new-file.ts"))).toBe(false)
    expect(subject.snapshot(session.id).notices).toContainEqual(
      expect.objectContaining({ title: "Checkpoint restored" })
    )
  })
})

describe("worktrees and file search", () => {
  it("runs a session in its own worktree and removes it", async () => {
    const directory = await gitRepo()
    const worktreeRoot = await mkdtemp(join(tmpdir(), "aide-worktrees-"))
    tempDirs.push(worktreeRoot)
    const subject = await boot({ directory, worktreeRoot })

    const session = (
      await subject.command("session.create", {
        projectId: subject.project.id,
        worktree: { branch: "aide/feature-x" },
      })
    ).result as { id: string; worktree: { path: string; branch: string } }

    expect(session.worktree.branch).toBe("aide/feature-x")
    expect(session.worktree.path.startsWith(worktreeRoot)).toBe(true)
    expect(existsSync(join(session.worktree.path, "notes.md"))).toBe(true)

    await subject.completeTurn(session.id, "work in the worktree")
    expect(subject.control.openedDirectories()).toContain(session.worktree.path)

    const search = await subject.app.request(
      `/sessions/${session.id}/files?query=notes`,
      { headers: subject.headers }
    )
    const found = (await search.json()) as FileSearchResult
    expect(found.root).toBe(session.worktree.path)
    expect(found.files[0]).toEqual({ path: "notes.md", name: "notes.md" })

    const removed = await subject.command("worktree.remove", {
      sessionId: session.id,
      deleteBranch: true,
    })
    expect(removed.state).toBe("completed")
    expect(existsSync(session.worktree.path)).toBe(false)
    expect(subject.snapshot(session.id).session.worktree).toBeUndefined()
  })

  it("refuses a worktree when the server has no worktree directory", async () => {
    const directory = await gitRepo()
    const subject = await boot({ directory })
    const receipt = await subject.command("session.create", {
      projectId: subject.project.id,
      worktree: {},
    })
    expect(receipt).toMatchObject({
      state: "failed",
      error: { code: "worktrees_unavailable" },
    })
  })

  it("guards file search behind the session token", async () => {
    const directory = await gitRepo()
    const subject = await boot({ directory })
    const session = (
      await subject.command("session.create", { projectId: subject.project.id })
    ).result as { id: string }

    const anonymous = await subject.app.request(
      `/sessions/${session.id}/files?query=main`
    )
    expect(anonymous.status).toBe(401)

    const response = await subject.app.request(
      `/sessions/${session.id}/files?query=main`,
      { headers: subject.headers }
    )
    const result = (await response.json()) as FileSearchResult
    expect(result.root).toBe(directory)
    expect(result.files.map((file) => file.path)).toEqual(["src-main.ts"])
  })
})

describe("browsing, previews, compaction and subagents", () => {
  it("lists projects and their sessions", async () => {
    const directory = await gitRepo()
    const subject = await boot({ directory })
    await subject.command("session.create", {
      projectId: subject.project.id,
      title: "One",
    })
    await subject.command("session.create", {
      projectId: subject.project.id,
      title: "Two",
    })

    const projects = await (
      await subject.app.request("/projects", { headers: subject.headers })
    ).json()
    expect(projects).toEqual({
      projects: [
        expect.objectContaining({ id: subject.project.id, sessionCount: 2 }),
      ],
    })
    const sessions = await (
      await subject.app.request(`/projects/${subject.project.id}/sessions`, {
        headers: subject.headers,
      })
    ).json()
    expect(
      (sessions as { sessions: Array<{ title: string }> }).sessions
        .map((session) => session.title)
        .sort()
    ).toEqual(["One", "Two"])
    expect((await subject.app.request("/projects")).status).toBe(401)
  })

  it("summarizes every session with where it stands", async () => {
    const directory = await gitRepo()
    const subject = await boot({ directory })
    await subject.command("session.create", {
      projectId: subject.project.id,
      title: "Idle",
    })
    const done = (
      await subject.command("session.create", {
        projectId: subject.project.id,
        title: "Done",
      })
    ).result as { id: string }
    await subject.completeTurn(done.id, "finish this")
    const waiting = (
      await subject.command("session.create", {
        projectId: subject.project.id,
        title: "Waiting",
      })
    ).result as { id: string }
    await subject.command("turn.send", {
      sessionId: waiting.id,
      content: "ask me first",
      execution: selection,
    })
    await waitFor(() =>
      subject.snapshot(waiting.id).requests.find((r) => r.status === "open")
    )

    const response = await subject.app.request("/sessions", {
      headers: subject.headers,
    })
    const { sessions } = (await response.json()) as SessionSummaryList
    const byTitle = new Map(sessions.map((s) => [s.session.title, s]))

    expect(byTitle.get("Idle")).toMatchObject({
      activity: "idle",
      openRequests: 0,
      turnCount: 0,
      project: { id: subject.project.id },
    })
    expect(byTitle.get("Idle")?.latestExecution).toBeUndefined()
    expect(byTitle.get("Done")).toMatchObject({
      activity: "completed",
      turnCount: 1,
      latestExecution: { driver: selection.driver, modelName: expect.any(String) },
      costUsd: 0.0042,
    })
    expect(byTitle.get("Waiting")).toMatchObject({
      activity: "needs_input",
      openRequests: 1,
      lastMessage: { role: "user", text: "ask me first" },
      runningSince: expect.any(String),
    })
    expect(sessionSummaryListSchema.parse({ sessions })).toBeTruthy()
    expect((await subject.app.request("/sessions")).status).toBe(401)
  })

  it("previews a file inside the working directory and refuses one outside", async () => {
    const directory = await gitRepo()
    const subject = await boot({ directory })
    const session = (
      await subject.command("session.create", { projectId: subject.project.id })
    ).result as { id: string }

    const preview = await subject.app.request(
      `/sessions/${session.id}/file?path=notes.md`,
      { headers: subject.headers }
    )
    expect(await preview.json()).toEqual({
      path: "notes.md",
      content: "original\n",
      binary: false,
      truncated: false,
      size: 9,
    })
    const escape = await subject.app.request(
      `/sessions/${session.id}/file?path=${encodeURIComponent("../../etc/passwd")}`,
      { headers: subject.headers }
    )
    expect(escape.status).toBe(403)
    const missing = await subject.app.request(
      `/sessions/${session.id}/file?path=nope.md`,
      { headers: subject.headers }
    )
    expect(missing.status).toBe(404)
  })

  it("serves stored tool output as an artifact", async () => {
    const directory = await gitRepo()
    const subject = await boot({ directory })
    artifactsRepo.create(subject.db, {
      id: "artifact_1",
      mimeType: "text/plain; charset=utf-8",
      data: Buffer.from("the full output", "utf8"),
      byteLength: 15,
      createdAt: "2026-01-01T00:00:00.000Z",
    })
    const response = await subject.app.request("/artifacts/artifact_1", {
      headers: subject.headers,
    })
    expect(response.headers.get("content-type")).toContain("text/plain")
    expect(await response.text()).toBe("the full output")
    expect((await subject.app.request("/artifacts/artifact_1")).status).toBe(
      401
    )
  })

  it("serves inventory for the session's project, including commands", async () => {
    const directory = await gitRepo()
    const subject = await boot({ directory })
    const session = (
      await subject.command("session.create", { projectId: subject.project.id })
    ).result as { id: string }
    const response = await subject.app.request(
      `/sessions/${session.id}/inventory?instanceId=fake-primary`,
      { headers: subject.headers }
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      instanceId: "fake-primary",
      commands: [{ name: "review" }],
      skills: [{ id: "pdf" }],
    })
  })

  it("compacts the native session between turns", async () => {
    const directory = await gitRepo()
    const subject = await boot({ directory })
    const session = (
      await subject.command("session.create", { projectId: subject.project.id })
    ).result as { id: string }

    const early = await subject.command("session.compact", {
      sessionId: session.id,
    })
    expect(early).toMatchObject({
      state: "failed",
      error: { code: "nothing_to_compact" },
    })

    await subject.completeTurn(session.id, "hello")
    const receipt = await subject.command("session.compact", {
      sessionId: session.id,
    })
    expect(receipt.state).toBe("completed")
    expect(subject.control.compactions()).toHaveLength(1)
    expect(subject.snapshot(session.id).notices).toContainEqual(
      expect.objectContaining({ title: "Context compacted" })
    )
  })

  it("stops one subagent of the running turn", async () => {
    const directory = await gitRepo()
    const subject = await boot({ directory })
    const session = (
      await subject.command("session.create", { projectId: subject.project.id })
    ).result as { id: string }
    await subject.command("turn.send", {
      sessionId: session.id,
      content: "delegate",
      execution: selection,
    })
    const turnId = await waitFor(
      () =>
        subject.snapshot(session.id).requests.find((r) => r.status === "open")
          ?.turnId
    )
    const receipt = await subject.command("subagent.stop", {
      sessionId: session.id,
      turnId,
      taskId: "task-7",
    })
    expect(receipt.state).toBe("completed")
    expect(subject.control.stoppedSubagents()).toEqual([
      { turnId, taskId: "task-7" },
    ])
    await subject.command("turn.interrupt", { sessionId: session.id, turnId })
  })
})
