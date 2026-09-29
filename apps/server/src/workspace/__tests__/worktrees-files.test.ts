import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterAll, describe, expect, it } from "vitest"

import { scorePath, searchFiles } from "../files"
import { createWorktree, removeWorktree } from "../worktrees"

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []

async function git(directory: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: directory })
  return stdout
}

async function tempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(directory)
  return directory
}

async function makeRepo(): Promise<string> {
  const directory = await tempDir("aide-worktree-test-")
  await git(directory, "init")
  await git(directory, "config", "user.email", "aide@example.com")
  await git(directory, "config", "user.name", "Aide Test")
  await mkdir(join(directory, "src", "components"), { recursive: true })
  await writeFile(join(directory, "README.md"), "# readme\n")
  await writeFile(join(directory, "src", "components", "Button.tsx"), "x\n")
  await writeFile(join(directory, "src", "button-utils.ts"), "x\n")
  await writeFile(join(directory, ".gitignore"), "secret.env\n")
  await writeFile(join(directory, "secret.env"), "TOKEN=1\n")
  await git(directory, "add", "-A")
  await git(directory, "commit", "-m", "base")
  return directory
}

afterAll(async () => {
  await Promise.all(
    tempDirs.map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe("worktrees", () => {
  it("creates a worktree on a new branch in an Aide-owned directory and removes it", async () => {
    const repo = await makeRepo()
    const root = await tempDir("aide-worktree-root-")
    const path = join(root, "proj_1", "session_1")

    const created = await createWorktree({
      projectDirectory: repo,
      path,
      branch: "aide/session-1",
    })

    expect(created.path).toBe(path)
    expect(created.baseRef).toBe((await git(repo, "rev-parse", "HEAD")).trim())
    expect(existsSync(join(path, "README.md"))).toBe(true)
    expect((await git(path, "branch", "--show-current")).trim()).toBe(
      "aide/session-1"
    )

    await expect(
      createWorktree({
        projectDirectory: repo,
        path: join(root, "other"),
        branch: "aide/session-1",
      })
    ).rejects.toMatchObject({ code: "worktree_branch_exists" })

    await removeWorktree({
      projectDirectory: repo,
      path,
      branch: "aide/session-1",
      deleteBranch: true,
    })
    expect(existsSync(path)).toBe(false)
    expect((await git(repo, "branch", "--list", "aide/session-1")).trim()).toBe(
      ""
    )
  })

  it("refuses to remove a dirty worktree unless forced", async () => {
    const repo = await makeRepo()
    const root = await tempDir("aide-worktree-root-")
    const path = join(root, "proj_1", "session_2")
    await createWorktree({
      projectDirectory: repo,
      path,
      branch: "aide/session-2",
    })
    await writeFile(join(path, "README.md"), "uncommitted edit\n")

    await expect(
      removeWorktree({
        projectDirectory: repo,
        path,
        branch: "aide/session-2",
        force: false,
      })
    ).rejects.toBeDefined()
    expect(existsSync(path)).toBe(true)

    await removeWorktree({
      projectDirectory: repo,
      path,
      branch: "aide/session-2",
    })
    expect(existsSync(path)).toBe(false)
  })
})

describe("file search", () => {
  it("ranks file-name matches first and leaves ignored files out", async () => {
    const repo = await makeRepo()
    await writeFile(join(repo, "untracked-button.md"), "new\n")

    const matches = await searchFiles(repo, "button")
    const paths = matches.map((match) => match.path)

    expect(paths).toContain("src/components/Button.tsx")
    expect(paths).toContain("src/button-utils.ts")
    expect(paths).toContain("untracked-button.md")
    expect(paths).not.toContain("secret.env")
    expect(matches[0]?.name.toLowerCase()).toContain("button")
    expect(await searchFiles(repo, "secret")).toEqual([])
  })

  it("matches fuzzy subsequences and rejects missing characters", () => {
    expect(scorePath("src/components/Button.tsx", "scbt")).toBeDefined()
    expect(scorePath("src/components/Button.tsx", "zzz")).toBeUndefined()
    expect(scorePath("a/button.ts", "button")!).toBeGreaterThan(
      scorePath("button/a.ts", "button")!
    )
  })

  it("walks directories that are not repositories", async () => {
    const directory = await tempDir("aide-files-plain-")
    await mkdir(join(directory, "node_modules", "dep"), { recursive: true })
    await writeFile(join(directory, "node_modules", "dep", "index.js"), "x")
    await writeFile(join(directory, "notes.txt"), "x")
    expect(
      (await searchFiles(directory, "")).map((match) => match.path)
    ).toEqual(["notes.txt"])
  })
})
