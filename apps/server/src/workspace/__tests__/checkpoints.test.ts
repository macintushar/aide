import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterAll, describe, expect, it } from "vitest"

import { createCheckpoint, restoreCheckpoint } from "../checkpoints"

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []

async function git(directory: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: directory })
  return stdout
}

async function makeRepo(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aide-checkpoint-test-"))
  tempDirs.push(directory)
  await git(directory, "init")
  await git(directory, "config", "user.email", "aide@example.com")
  await git(directory, "config", "user.name", "Aide Test")
  return directory
}

afterAll(async () => {
  await Promise.all(
    tempDirs.map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe("checkpoints", () => {
  it("restores edits, deletions and new files without moving the index or HEAD", async () => {
    const repo = await makeRepo()
    await writeFile(join(repo, "kept.txt"), "original\n")
    await writeFile(join(repo, "deleted.txt"), "will be deleted\n")
    await writeFile(join(repo, ".gitignore"), "ignored.log\n")
    await git(repo, "add", "-A")
    await git(repo, "commit", "-m", "base")
    // An uncommitted, untracked file is part of the working tree too.
    await writeFile(join(repo, "draft.txt"), "draft before the turn\n")
    await git(repo, "add", "kept.txt")
    const head = (await git(repo, "rev-parse", "HEAD")).trim()
    const index = await git(repo, "diff", "--cached", "--name-only")

    const commit = await createCheckpoint(repo, "turn_1")
    expect(commit).toMatch(/^[0-9a-f]{40}$/)
    expect(
      (await git(repo, "rev-parse", "refs/aide/checkpoints/turn_1")).trim()
    ).toBe(commit)

    // What a turn might do.
    await writeFile(join(repo, "kept.txt"), "edited by the turn\n")
    await rm(join(repo, "deleted.txt"))
    await rm(join(repo, "draft.txt"))
    await writeFile(join(repo, "created.txt"), "new from the turn\n")
    await writeFile(join(repo, "ignored.log"), "ignored stays\n")

    const result = await restoreCheckpoint(repo, commit!)

    expect(await readFile(join(repo, "kept.txt"), "utf8")).toBe("original\n")
    expect(await readFile(join(repo, "deleted.txt"), "utf8")).toBe(
      "will be deleted\n"
    )
    expect(await readFile(join(repo, "draft.txt"), "utf8")).toBe(
      "draft before the turn\n"
    )
    expect(existsSync(join(repo, "created.txt"))).toBe(false)
    expect(existsSync(join(repo, "ignored.log"))).toBe(true)
    expect(result.removed).toEqual(["created.txt"])
    expect(result.restored.sort()).toEqual(
      ["deleted.txt", "draft.txt", "kept.txt"].sort()
    )
    expect((await git(repo, "rev-parse", "HEAD")).trim()).toBe(head)
    expect(await git(repo, "diff", "--cached", "--name-only")).toBe(index)
  })

  it("works in a repository with no commits yet", async () => {
    const repo = await makeRepo()
    await writeFile(join(repo, "first.txt"), "one\n")
    const commit = await createCheckpoint(repo, "turn_empty")
    await writeFile(join(repo, "first.txt"), "two\n")
    await restoreCheckpoint(repo, commit!)
    expect(await readFile(join(repo, "first.txt"), "utf8")).toBe("one\n")
  })

  it("skips directories that are not repositories", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aide-checkpoint-plain-"))
    tempDirs.push(directory)
    await expect(createCheckpoint(directory, "turn_x")).resolves.toBeUndefined()
  })
})
