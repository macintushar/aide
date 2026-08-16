import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { WorkspaceError } from "./errors"

const execFileAsync = promisify(execFile)

export type WorkspaceChangeStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "unmodified"

export type WorkspaceFileChange = {
  path: string
  staged: WorkspaceChangeStatus
  unstaged: WorkspaceChangeStatus
  untracked: boolean
}

export type WorkspaceDiffEntry = {
  path: string
  additions: number | null
  deletions: number | null
  binary: boolean
}

async function execGit(directory: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: directory,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
  return stdout
}

function errorDetail(error: unknown): string {
  if (typeof error === "object" && error !== null && "stderr" in error) {
    const stderr = (error as { stderr?: unknown }).stderr
    if (typeof stderr === "string") {
      return stderr.trim()
    }
    if (Buffer.isBuffer(stderr)) {
      return stderr.toString("utf8").trim()
    }
  }
  return error instanceof Error ? error.message : String(error)
}

async function isInsideWorkTree(directory: string): Promise<boolean> {
  try {
    const stdout = await execGit(directory, [
      "rev-parse",
      "--is-inside-work-tree",
    ])
    return stdout.trim() === "true"
  } catch {
    return false
  }
}

async function execGitChecked(
  directory: string,
  args: string[]
): Promise<string> {
  if (!(await isInsideWorkTree(directory))) {
    throw new WorkspaceError({
      code: "not_a_git_repo",
      message: `Directory is not inside a git repository: ${directory}`,
      retryable: false,
      detail: { directory, args },
    })
  }
  try {
    return await execGit(directory, args)
  } catch (error) {
    throw new WorkspaceError({
      code: "git_failed",
      message: `git ${args.join(" ")} failed in ${directory}`,
      retryable: false,
      detail: { directory, args, stderr: errorDetail(error) },
    })
  }
}

function mapStatusLetter(letter: string): WorkspaceChangeStatus {
  if (letter === "A") {
    return "added"
  }
  if (letter === "M") {
    return "modified"
  }
  if (letter === "D") {
    return "deleted"
  }
  if (letter === "R" || letter === "C") {
    return "renamed"
  }
  return "unmodified"
}

export async function gitStatus(
  directory: string
): Promise<WorkspaceFileChange[]> {
  const stdout = await execGitChecked(directory, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ])
  const records = stdout.split("\0")
  const changes: WorkspaceFileChange[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record === "") {
      continue
    }
    const stagedLetter = record.slice(0, 1)
    const unstagedLetter = record.slice(1, 2)
    if ("RC".includes(stagedLetter) || "RC".includes(unstagedLetter)) {
      index += 1
    }
    const untracked = stagedLetter === "?" && unstagedLetter === "?"
    changes.push({
      path: record.slice(3),
      staged: mapStatusLetter(untracked ? " " : stagedLetter),
      unstaged: mapStatusLetter(untracked ? " " : unstagedLetter),
      untracked,
    })
  }
  return changes
}

export async function gitDiffSummary(
  directory: string
): Promise<WorkspaceDiffEntry[]> {
  const stdout = await execGitChecked(directory, [
    "diff",
    "HEAD",
    "--numstat",
    "--find-renames",
  ])
  const entries: WorkspaceDiffEntry[] = []
  for (const line of stdout.split("\n")) {
    if (line === "") {
      continue
    }
    const fields = line.split("\t")
    const additionsRaw = fields[0] ?? ""
    const deletionsRaw = fields[1] ?? ""
    let filePath = fields.slice(2).join("\t")
    const arrowIndex = filePath.indexOf(" => ")
    if (arrowIndex !== -1) {
      filePath = filePath.slice(arrowIndex + " => ".length)
    }
    if (filePath.startsWith('"') && filePath.endsWith('"')) {
      filePath = filePath.slice(1, -1)
    }
    const binary = additionsRaw === "-" || deletionsRaw === "-"
    entries.push({
      path: filePath,
      additions: binary ? null : Number.parseInt(additionsRaw, 10),
      deletions: binary ? null : Number.parseInt(deletionsRaw, 10),
      binary,
    })
  }
  return entries
}
