import { homedir } from "node:os"
import { readFile, realpath } from "node:fs/promises"
import { basename, dirname, join, resolve, sep } from "node:path"

import { WorkspaceError } from "./errors"

function outsideBoundary(
  projectDirectory: string,
  resolvedPath: string
): WorkspaceError {
  return new WorkspaceError({
    code: "path_outside_boundary",
    message: `Resolved path is outside the project directory: ${resolvedPath}`,
    retryable: false,
    detail: { projectDirectory, resolvedPath },
  })
}

function contains(projectDirectory: string, candidate: string): boolean {
  return (
    candidate === projectDirectory ||
    candidate.startsWith(projectDirectory + sep)
  )
}

export function resolveWithinBoundary(
  projectDirectory: string,
  relativePath: string
): string {
  const resolvedProject = resolve(projectDirectory)
  const resolvedPath = resolve(resolvedProject, relativePath)
  if (!contains(resolvedProject, resolvedPath)) {
    throw outsideBoundary(resolvedProject, resolvedPath)
  }
  return resolvedPath
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  )
}

/**
 * Canonicalizes as much of `target` as exists on disk, then re-appends the
 * trailing segments that do not exist yet. Paths that are about to be created
 * still get their existing ancestors resolved, so a symlinked parent cannot
 * smuggle a write outside the boundary.
 */
async function canonicalize(target: string): Promise<string> {
  const missing: string[] = []
  let current = target
  for (;;) {
    try {
      const real = await realpath(current)
      return missing.length === 0 ? real : join(real, ...missing.reverse())
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error
      }
      const parent = dirname(current)
      if (parent === current) {
        return target
      }
      missing.push(basename(current))
      current = parent
    }
  }
}

/**
 * Boundary check that survives symlinks: both the project directory and the
 * requested path are canonicalized before comparison, so a link inside the
 * project that points elsewhere is rejected rather than followed.
 */
export async function resolveRealWithinBoundary(
  projectDirectory: string,
  relativePath: string
): Promise<string> {
  const lexical = resolveWithinBoundary(projectDirectory, relativePath)
  const realProject = await canonicalize(resolve(projectDirectory))
  const realPath = await canonicalize(lexical)
  if (!contains(realProject, realPath)) {
    throw outsideBoundary(realProject, realPath)
  }
  return realPath
}

export async function readFileWithinBoundary(
  projectDirectory: string,
  relativePath: string
): Promise<string> {
  const resolvedPath = await resolveRealWithinBoundary(
    projectDirectory,
    relativePath
  )
  try {
    return await readFile(resolvedPath, "utf8")
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new WorkspaceError({
        code: "file_not_found",
        message: `File not found within project: ${relativePath}`,
        retryable: false,
        detail: { resolvedPath },
      })
    }
    throw error
  }
}

/**
 * Expands a leading `~`, which `resolve` would otherwise treat as an ordinary
 * directory name and quietly place *inside* the project.
 */
function expandHome(candidate: string): string {
  if (candidate === "~") return homedir()
  if (candidate.startsWith("~/")) return join(homedir(), candidate.slice(2))
  return candidate
}

/**
 * Which of `candidates` fall outside the project, canonicalized.
 *
 * Reports rather than throws: this answers "should the user be warned before
 * approving this?", where several paths may be involved and one being outside
 * is a fact to surface, not an error to raise. Callers enforcing a hard
 * boundary want {@link resolveRealWithinBoundary} instead.
 */
export async function pathsOutsideBoundary(
  projectDirectory: string,
  candidates: string[]
): Promise<string[]> {
  if (candidates.length === 0) return []
  const realProject = await canonicalize(resolve(projectDirectory))
  const outside: string[] = []
  for (const candidate of candidates) {
    const resolved = await canonicalize(
      resolve(realProject, expandHome(candidate))
    )
    if (!contains(realProject, resolved) && !outside.includes(resolved)) {
      outside.push(resolved)
    }
  }
  return outside
}
