import { execFile } from "node:child_process"
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import {
  projectFixture,
  resolvedExecutionFixture,
  sessionFixture,
  userMessageFixture,
} from "@workspace/contracts"
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  messagesRepo,
  projectsRepo,
  receiptsRepo,
  sessionsRepo,
  turnsRepo,
  type AideDb,
} from "../db"
import { Database } from "../db/test/bun-sqlite-shim"
import { createTestDb } from "../test/db"
import { SessionChangesTracker } from "./changes"

const execFileAsync = promisify(execFile)
const timestamp = "2026-01-01T00:00:00.000Z"
const tempDirs: string[] = []

async function git(directory: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: directory })
}

async function makeRepo(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aide-changes-test-"))
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

describe("SessionChangesTracker", () => {
  let client: Database
  let db: AideDb
  let clock = 0

  function now(): string {
    clock += 1
    return new Date(Date.UTC(2026, 0, 1, 0, 0, clock)).toISOString()
  }

  function createTurn(id: string) {
    const commandId = `cmd_${id}`
    receiptsRepo.upsertAccepted(db, {
      commandId,
      commandName: "turn.send",
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    const { seq: _seq, ...user } = userMessageFixture()
    const userMessageId = `msg_user_${id}`
    messagesRepo.createUser(db, {
      ...user,
      id: userMessageId,
      parts: user.parts.map((part) => ({
        ...part,
        id: `${part.id}_${id}`,
        messageId: userMessageId,
      })),
    })
    return turnsRepo.create(db, {
      id,
      sessionId: "ses_1",
      execution: resolvedExecutionFixture(),
      commandId,
      userMessageId,
    })
  }

  beforeEach(() => {
    const created = createTestDb()
    client = created.client
    db = created.db
    clock = 0
    projectsRepo.upsertByDirectory(db, projectFixture())
    sessionsRepo.create(db, sessionFixture())
  })

  afterEach(() => client.close())

  it("records nothing for a clean working tree", async () => {
    const directory = await makeRepo()
    const tracker = new SessionChangesTracker(db, { now })
    await expect(
      tracker.capture({ sessionId: "ses_1", directory })
    ).resolves.toEqual([])
  })

  it("captures a baseline without attributing it to a turn", async () => {
    const directory = await makeRepo()
    await writeFile(join(directory, "tracked.txt"), "two\n")
    const tracker = new SessionChangesTracker(db, { now })

    const baseline = await tracker.capture({ sessionId: "ses_1", directory })

    expect(baseline).toEqual([
      {
        sessionId: "ses_1",
        path: "tracked.txt",
        staged: "unmodified",
        unstaged: "modified",
        untracked: false,
        firstSeenAt: "2026-01-01T00:00:01.000Z",
        lastSeenAt: "2026-01-01T00:00:01.000Z",
      },
    ])
  })

  it("attributes new and changed files to the capturing turn", async () => {
    const directory = await makeRepo()
    await writeFile(join(directory, "tracked.txt"), "two\n")
    const tracker = new SessionChangesTracker(db, { now })
    await tracker.capture({ sessionId: "ses_1", directory })
    const turn = createTurn("turn_1")

    await writeFile(join(directory, "created.txt"), "new\n")
    const changes = await tracker.capture({
      sessionId: "ses_1",
      directory,
      turnId: turn.id,
    })

    expect(changes).toMatchObject([
      { path: "created.txt", turnId: "turn_1", untracked: true },
      { path: "tracked.txt", turnId: undefined },
    ])
    expect(tracker.listByTurn("turn_1")).toHaveLength(1)
  })

  it("reattributes a pre-existing file once the turn changes it further", async () => {
    const directory = await makeRepo()
    await writeFile(join(directory, "tracked.txt"), "two\n")
    const tracker = new SessionChangesTracker(db, { now })
    const [baseline] = await tracker.capture({ sessionId: "ses_1", directory })
    const turn = createTurn("turn_1")

    await git(directory, "add", "tracked.txt")
    const [changed] = await tracker.capture({
      sessionId: "ses_1",
      directory,
      turnId: turn.id,
    })

    expect(changed).toMatchObject({
      path: "tracked.txt",
      turnId: "turn_1",
      staged: "modified",
      unstaged: "unmodified",
    })
    // The window the session has been watching this file stays intact.
    expect(changed?.firstSeenAt).toBe(baseline?.firstSeenAt)
    expect(changed?.lastSeenAt).not.toBe(baseline?.lastSeenAt)
  })

  it("keeps attribution to the first turn when a later turn leaves a file alone", async () => {
    const directory = await makeRepo()
    const tracker = new SessionChangesTracker(db, { now })
    const first = createTurn("turn_1")
    await writeFile(join(directory, "tracked.txt"), "two\n")
    await tracker.capture({
      sessionId: "ses_1",
      directory,
      turnId: first.id,
    })

    const second = createTurn("turn_2")
    const [change] = await tracker.capture({
      sessionId: "ses_1",
      directory,
      turnId: second.id,
    })

    expect(change).toMatchObject({ path: "tracked.txt", turnId: "turn_1" })
  })

  it("drops a file once the working tree matches HEAD again", async () => {
    const directory = await makeRepo()
    const tracker = new SessionChangesTracker(db, { now })
    const turn = createTurn("turn_1")
    await writeFile(join(directory, "scratch.txt"), "temp\n")
    expect(
      await tracker.capture({ sessionId: "ses_1", directory, turnId: turn.id })
    ).toHaveLength(1)

    await unlink(join(directory, "scratch.txt"))

    expect(
      await tracker.capture({ sessionId: "ses_1", directory, turnId: turn.id })
    ).toEqual([])
    expect(tracker.list("ses_1")).toEqual([])
  })

  it("tracks deletions of committed files", async () => {
    const directory = await makeRepo()
    const tracker = new SessionChangesTracker(db, { now })
    const turn = createTurn("turn_1")
    await unlink(join(directory, "tracked.txt"))

    const [change] = await tracker.capture({
      sessionId: "ses_1",
      directory,
      turnId: turn.id,
    })

    expect(change).toMatchObject({
      path: "tracked.txt",
      turnId: "turn_1",
      unstaged: "deleted",
    })
  })

  it("keeps each session's changes separate", async () => {
    const directory = await makeRepo()
    sessionsRepo.create(db, { ...sessionFixture(), id: "ses_2" })
    const tracker = new SessionChangesTracker(db, { now })
    await writeFile(join(directory, "tracked.txt"), "two\n")

    await tracker.capture({ sessionId: "ses_1", directory })

    expect(tracker.list("ses_1")).toHaveLength(1)
    expect(tracker.list("ses_2")).toEqual([])
  })
})
