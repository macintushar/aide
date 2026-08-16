import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterAll, describe, expect, it } from "vitest"

import { WorkspaceError } from "./errors"
import { gitDiffSummary, gitStatus } from "./git"

const execFileAsync = promisify(execFile)

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aide-git-test-"))
  tempDirs.push(directory)
  return directory
}

async function git(directory: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: directory })
}

async function makeRepo(): Promise<string> {
  const directory = await makeTempDir()
  await git(directory, "init")
  await git(directory, "config", "user.email", "aide@example.com")
  await git(directory, "config", "user.name", "Aide Test")
  return directory
}

async function gitCommit(directory: string, message: string): Promise<void> {
  await git(directory, "add", "-A")
  await git(directory, "commit", "-m", message)
}

function binaryBlob(): Buffer {
  return Buffer.concat([randomBytes(16), Buffer.alloc(1), randomBytes(15)])
}

afterAll(async () => {
  await Promise.all(
    tempDirs.map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe("gitStatus", () => {
  it("returns an empty list for a clean repository", async () => {
    const directory = await makeRepo()
    await writeFile(join(directory, "a.txt"), "one\n")
    await gitCommit(directory, "initial")
    expect(await gitStatus(directory)).toEqual([])
  })

  it("reports a modified tracked file as an unstaged modification", async () => {
    const directory = await makeRepo()
    await writeFile(join(directory, "a.txt"), "one\n")
    await gitCommit(directory, "initial")
    await writeFile(join(directory, "a.txt"), "one\ntwo\n")
    expect(await gitStatus(directory)).toEqual([
      {
        path: "a.txt",
        staged: "unmodified",
        unstaged: "modified",
        untracked: false,
      },
    ])
  })

  it("reports a staged new file as a staged addition", async () => {
    const directory = await makeRepo()
    await writeFile(join(directory, "b.txt"), "new\n")
    await git(directory, "add", "b.txt")
    expect(await gitStatus(directory)).toEqual([
      {
        path: "b.txt",
        staged: "added",
        unstaged: "unmodified",
        untracked: false,
      },
    ])
  })

  it("reports an untracked file including nested paths", async () => {
    const directory = await makeRepo()
    await writeFile(join(directory, "keep.txt"), "keep\n")
    await gitCommit(directory, "initial")
    await mkdir(join(directory, "notes"))
    await writeFile(join(directory, "notes", "c.txt"), "note\n")
    expect(await gitStatus(directory)).toEqual([
      {
        path: "notes/c.txt",
        staged: "unmodified",
        unstaged: "unmodified",
        untracked: true,
      },
    ])
  })

  it("reports a deleted tracked file as an unstaged deletion", async () => {
    const directory = await makeRepo()
    await writeFile(join(directory, "d.txt"), "gone\n")
    await gitCommit(directory, "initial")
    await rm(join(directory, "d.txt"))
    expect(await gitStatus(directory)).toEqual([
      {
        path: "d.txt",
        staged: "unmodified",
        unstaged: "deleted",
        untracked: false,
      },
    ])
  })

  it("reports a rename staged with git mv", async () => {
    const directory = await makeRepo()
    await writeFile(join(directory, "e.txt"), "old\n")
    await gitCommit(directory, "initial")
    await git(directory, "mv", "e.txt", "e-renamed.txt")
    expect(await gitStatus(directory)).toEqual([
      {
        path: "e-renamed.txt",
        staged: "renamed",
        unstaged: "unmodified",
        untracked: false,
      },
    ])
  })

  it("throws not_a_git_repo outside a repository", async () => {
    const directory = await makeTempDir()
    const statusPromise = gitStatus(directory)
    await expect(statusPromise).rejects.toThrow(WorkspaceError)
    await expect(statusPromise).rejects.toMatchObject({
      code: "not_a_git_repo",
      retryable: false,
    })
  })
})

describe("gitDiffSummary", () => {
  it("counts additions and deletions against HEAD", async () => {
    const directory = await makeRepo()
    await writeFile(join(directory, "a.txt"), "line1\nline2\nline3\n")
    await gitCommit(directory, "initial")
    await writeFile(join(directory, "a.txt"), "line1\nchanged\nline3\nadded\n")
    expect(await gitDiffSummary(directory)).toEqual([
      { path: "a.txt", additions: 2, deletions: 1, binary: false },
    ])
  })

  it("marks binary files with null counts", async () => {
    const directory = await makeRepo()
    await writeFile(join(directory, "image.bin"), binaryBlob())
    await gitCommit(directory, "initial")
    await writeFile(join(directory, "image.bin"), binaryBlob())
    expect(await gitDiffSummary(directory)).toEqual([
      { path: "image.bin", additions: null, deletions: null, binary: true },
    ])
  })

  it("reports the current path for renames", async () => {
    const directory = await makeRepo()
    await writeFile(join(directory, "e.txt"), "old\n")
    await gitCommit(directory, "initial")
    await git(directory, "mv", "e.txt", "e-renamed.txt")
    expect(await gitDiffSummary(directory)).toEqual([
      { path: "e-renamed.txt", additions: 0, deletions: 0, binary: false },
    ])
  })

  it("throws not_a_git_repo outside a repository", async () => {
    const directory = await makeTempDir()
    const diffPromise = gitDiffSummary(directory)
    await expect(diffPromise).rejects.toThrow(WorkspaceError)
    await expect(diffPromise).rejects.toMatchObject({
      code: "not_a_git_repo",
      retryable: false,
    })
  })

  it("wraps git failures as git_failed with stderr detail", async () => {
    const directory = await makeRepo()
    const diffPromise = gitDiffSummary(directory)
    await expect(diffPromise).rejects.toThrow(WorkspaceError)
    await expect(diffPromise).rejects.toMatchObject({
      code: "git_failed",
      retryable: false,
      detail: expect.objectContaining({ stderr: expect.any(String) }),
    })
  })
})
