import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"

import { execGitChecked } from "./git"
import { WorkspaceError } from "./errors"

/**
 * Aide's own worktrees. Each one is a `git worktree` of the project checked
 * out into a directory Aide owns (under its data directory, never inside the
 * project), on a branch of its own. Harnesses simply see it as the session's
 * working directory.
 */

export type CreatedWorktree = {
  path: string
  branch: string
  /** The commit the branch was cut from. */
  baseRef: string
}

export async function createWorktree(input: {
  projectDirectory: string
  path: string
  branch: string
  baseRef?: string
}): Promise<CreatedWorktree> {
  const base = (
    await execGitChecked(input.projectDirectory, [
      "rev-parse",
      "--verify",
      `${input.baseRef ?? "HEAD"}^{commit}`,
    ])
  ).trim()
  const existing = await execGitChecked(input.projectDirectory, [
    "branch",
    "--list",
    input.branch,
  ])
  if (existing.trim() !== "") {
    throw new WorkspaceError({
      code: "worktree_branch_exists",
      message: `Branch ${input.branch} already exists; choose another name`,
      retryable: false,
      detail: { branch: input.branch },
    })
  }
  await mkdir(dirname(input.path), { recursive: true })
  await execGitChecked(input.projectDirectory, [
    "worktree",
    "add",
    "-b",
    input.branch,
    input.path,
    base,
  ])
  return { path: input.path, branch: input.branch, baseRef: base }
}

export async function removeWorktree(input: {
  projectDirectory: string
  path: string
  branch: string
  deleteBranch?: boolean
  /** Discard uncommitted changes in the worktree. Defaults to true. */
  force?: boolean
}): Promise<void> {
  await execGitChecked(input.projectDirectory, [
    "worktree",
    "remove",
    ...(input.force === false ? [] : ["--force"]),
    input.path,
  ]).catch(async (error: unknown) => {
    // Already gone from disk: prune the stale registration instead.
    await execGitChecked(input.projectDirectory, ["worktree", "prune"])
    const listed = await execGitChecked(input.projectDirectory, [
      "worktree",
      "list",
      "--porcelain",
    ])
    if (listed.includes(`worktree ${input.path}\n`)) throw error
  })
  if (input.deleteBranch) {
    await execGitChecked(input.projectDirectory, ["branch", "-D", input.branch])
  }
}
