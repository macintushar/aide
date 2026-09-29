import { execFile } from "node:child_process"
import { mkdtemp, rm, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { WorkspaceError } from "./errors"

const execFileAsync = promisify(execFile)

/**
 * Checkpoints are Aide's own restore points, independent of any harness: one
 * mechanism covers every harness a session uses, including a switch between
 * harnesses mid-session.
 *
 * A checkpoint is the whole working tree (tracked and untracked files, minus
 * what .gitignore excludes) written as a commit through a throwaway index.
 * Neither the user's index nor their branch moves. The commit is pinned under
 * `refs/aide/checkpoints/` so git's garbage collection keeps it.
 */

const REF_PREFIX = "refs/aide/checkpoints/"

async function git(
  directory: string,
  args: string[],
  indexFile?: string
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: directory,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        ...(indexFile ? { GIT_INDEX_FILE: indexFile } : {}),
        // A checkpoint must not depend on the user having an identity set.
        GIT_AUTHOR_NAME: "Aide",
        GIT_AUTHOR_EMAIL: "aide@localhost",
        GIT_COMMITTER_NAME: "Aide",
        GIT_COMMITTER_EMAIL: "aide@localhost",
      },
    })
    return stdout
  } catch (error) {
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String((error as { stderr: unknown }).stderr).trim()
        : error instanceof Error
          ? error.message
          : String(error)
    throw new WorkspaceError({
      code: "git_failed",
      message: `git ${args[0]} failed in ${directory}`,
      retryable: false,
      detail: { directory, args, stderr },
    })
  }
}

async function withScratchIndex<T>(
  body: (indexFile: string) => Promise<T>
): Promise<T> {
  const scratch = await mkdtemp(join(tmpdir(), "aide-index-"))
  const indexFile = join(scratch, "index")
  try {
    return await body(indexFile)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

/** The working tree as a tree object, without touching the real index. */
async function workingTree(directory: string): Promise<string> {
  return withScratchIndex(async (indexFile) => {
    await git(directory, ["add", "--all", "--", "."], indexFile)
    return (await git(directory, ["write-tree"], indexFile)).trim()
  })
}

async function isRepository(directory: string): Promise<boolean> {
  try {
    const inside = await git(directory, ["rev-parse", "--is-inside-work-tree"])
    return inside.trim() === "true"
  } catch {
    return false
  }
}

async function head(directory: string): Promise<string | undefined> {
  try {
    return (await git(directory, ["rev-parse", "--verify", "HEAD"])).trim()
  } catch {
    return undefined
  }
}

/**
 * Records the working tree and returns the checkpoint commit, or undefined
 * when the directory is not a git repository (there is nothing to anchor a
 * checkpoint to).
 */
export async function createCheckpoint(
  directory: string,
  turnId: string
): Promise<string | undefined> {
  if (!(await isRepository(directory))) return undefined
  const tree = await workingTree(directory)
  const parent = await head(directory)
  const commit = (
    await git(directory, [
      "commit-tree",
      tree,
      ...(parent ? ["-p", parent] : []),
      "-m",
      `Aide checkpoint before turn ${turnId}`,
    ])
  ).trim()
  await git(directory, ["update-ref", `${REF_PREFIX}${turnId}`, commit])
  return commit
}

/**
 * Makes the working tree match a checkpoint: files it holds are written back,
 * and files created since are deleted. Ignored files are left alone, and the
 * user's index and HEAD do not move.
 */
export async function restoreCheckpoint(
  directory: string,
  commit: string
): Promise<{ restored: string[]; removed: string[] }> {
  if (!(await isRepository(directory))) {
    throw new WorkspaceError({
      code: "not_a_git_repo",
      message: `Directory is not inside a git repository: ${directory}`,
      retryable: false,
      detail: { directory },
    })
  }
  const target = `${commit}^{tree}`
  const current = await workingTree(directory)
  const changes = await git(directory, [
    "diff",
    "--name-status",
    "-z",
    "--no-renames",
    target,
    current,
  ])
  const restored: string[] = []
  const removed: string[] = []
  const fields = changes.split("\0").filter((field) => field !== "")
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const status = fields[index]!
    const path = fields[index + 1]!
    // Added since the checkpoint: it did not exist then, so it goes.
    if (status === "A") removed.push(path)
    else restored.push(path)
  }
  for (const path of removed) {
    await unlink(join(directory, path)).catch(() => undefined)
  }
  if (restored.length > 0) {
    await withScratchIndex(async (indexFile) => {
      await git(directory, ["read-tree", target], indexFile)
      // Batched so a large restore stays under the argument-length limit.
      for (let start = 0; start < restored.length; start += 200) {
        await git(
          directory,
          [
            "checkout-index",
            "--force",
            "--",
            ...restored.slice(start, start + 200),
          ],
          indexFile
        )
      }
    })
  }
  return { restored, removed }
}

/** Drops a checkpoint's pinning ref. */
export async function deleteCheckpoint(
  directory: string,
  turnId: string
): Promise<void> {
  await git(directory, ["update-ref", "-d", `${REF_PREFIX}${turnId}`]).catch(
    () => undefined
  )
}
