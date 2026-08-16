import { readFile } from "node:fs/promises"
import { resolve, sep } from "node:path"

import { WorkspaceError } from "./errors"

export function resolveWithinBoundary(
  projectDirectory: string,
  relativePath: string
): string {
  const resolvedProject = resolve(projectDirectory)
  const resolvedPath = resolve(resolvedProject, relativePath)
  if (
    resolvedPath !== resolvedProject &&
    !resolvedPath.startsWith(resolvedProject + sep)
  ) {
    throw new WorkspaceError({
      code: "path_outside_boundary",
      message: `Resolved path is outside the project directory: ${resolvedPath}`,
      retryable: false,
      detail: { projectDirectory: resolvedProject, resolvedPath },
    })
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

export async function readFileWithinBoundary(
  projectDirectory: string,
  relativePath: string
): Promise<string> {
  const resolvedPath = resolveWithinBoundary(projectDirectory, relativePath)
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
