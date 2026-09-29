import { execFile } from "node:child_process"
import { readdir } from "node:fs/promises"
import { basename, join, relative, sep } from "node:path"
import { promisify } from "node:util"

import type { FileMatch } from "@workspace/contracts"

const execFileAsync = promisify(execFile)

const WALK_LIMIT = 20_000
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
])

/**
 * Every file in the directory, relative with forward slashes. Inside a git
 * repository that is tracked plus untracked-but-not-ignored files; elsewhere a
 * bounded walk that skips the usual dependency and build directories.
 */
async function listFiles(directory: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: directory, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    )
    return [...new Set(stdout.split("\0").filter((path) => path !== ""))]
  } catch {
    return walk(directory)
  }
}

async function walk(root: string): Promise<string[]> {
  const found: string[] = []
  const pending = [root]
  while (pending.length > 0 && found.length < WALK_LIMIT) {
    const directory = pending.pop()!
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      () => []
    )
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) pending.push(path)
      } else if (entry.isFile()) {
        found.push(relative(root, path).split(sep).join("/"))
      }
    }
  }
  return found
}

/**
 * Ranks a path against the query. Every query character must appear in order
 * (a fuzzy subsequence); matches in the file name, at word starts, and in
 * runs score higher. Returns undefined for no match.
 */
export function scorePath(path: string, query: string): number | undefined {
  const needle = query.toLowerCase()
  if (needle === "") return 0
  const haystack = path.toLowerCase()
  const nameStart = haystack.lastIndexOf("/") + 1
  let score = 0
  let position = -1
  let run = 0
  for (const character of needle) {
    const found = haystack.indexOf(character, position + 1)
    if (found === -1) return undefined
    run = found === position + 1 ? run + 1 : 0
    score += 1 + run * 2
    if (found >= nameStart) score += 2
    const previous = haystack[found - 1]
    if (
      found === 0 ||
      previous === "/" ||
      previous === "-" ||
      previous === "_" ||
      previous === "."
    ) {
      score += 3
    }
    position = found
  }
  if (haystack.slice(nameStart).includes(needle)) score += 10
  // Prefer shorter paths when everything else is equal.
  return score - path.length / 100
}

export async function searchFiles(
  directory: string,
  query: string,
  limit = 20
): Promise<FileMatch[]> {
  const files = await listFiles(directory)
  const trimmed = query.trim()
  const ranked: Array<{ path: string; score: number }> = []
  for (const path of files) {
    const score = scorePath(path, trimmed)
    if (score !== undefined) ranked.push({ path, score })
  }
  ranked.sort(
    (left, right) =>
      right.score - left.score || left.path.localeCompare(right.path)
  )
  return ranked
    .slice(0, limit)
    .map(({ path }) => ({ path, name: basename(path) }))
}
