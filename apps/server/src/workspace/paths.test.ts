import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"

import { WorkspaceError } from "./errors"
import { readFileWithinBoundary, resolveWithinBoundary } from "./paths"

const tempDirs: string[] = []

async function makeProject(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aide-paths-test-"))
  tempDirs.push(directory)
  return directory
}

afterAll(async () => {
  await Promise.all(
    tempDirs.map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe("resolveWithinBoundary", () => {
  it("resolves a relative path inside the project", async () => {
    const project = await makeProject()
    expect(resolveWithinBoundary(project, "src/main.ts")).toBe(
      join(project, "src", "main.ts")
    )
  })

  it("allows the project directory itself", async () => {
    const project = await makeProject()
    expect(resolveWithinBoundary(project, ".")).toBe(project)
  })

  it("resolves nested traversal that stays inside the project", async () => {
    const project = await makeProject()
    expect(resolveWithinBoundary(project, "x/a/../../b.txt")).toBe(
      join(project, "b.txt")
    )
  })

  it("rejects parent traversal", async () => {
    const project = await makeProject()
    expect(() => resolveWithinBoundary(project, "../escape.txt")).toThrow(
      WorkspaceError
    )
    expect(() => resolveWithinBoundary(project, "../escape.txt")).toThrowError(
      expect.objectContaining({ code: "path_outside_boundary" })
    )
  })

  it("rejects absolute paths outside the project", async () => {
    const project = await makeProject()
    expect(() => resolveWithinBoundary(project, "/etc/passwd")).toThrow(
      WorkspaceError
    )
    expect(() => resolveWithinBoundary(project, "/etc/passwd")).toThrowError(
      expect.objectContaining({ code: "path_outside_boundary" })
    )
    expect(() =>
      resolveWithinBoundary(project, join(tmpdir(), "outside.txt"))
    ).toThrow(WorkspaceError)
  })
})

describe("readFileWithinBoundary", () => {
  it("reads a file inside the project", async () => {
    const project = await makeProject()
    await writeFile(join(project, "notes.txt"), "hello aide")
    await expect(readFileWithinBoundary(project, "notes.txt")).resolves.toBe(
      "hello aide"
    )
  })

  it("throws file_not_found for a missing file", async () => {
    const project = await makeProject()
    const readPromise = readFileWithinBoundary(project, "missing.txt")
    await expect(readPromise).rejects.toThrow(WorkspaceError)
    await expect(readPromise).rejects.toMatchObject({
      code: "file_not_found",
      retryable: false,
    })
  })

  it("rejects reads outside the project boundary", async () => {
    const project = await makeProject()
    await expect(
      readFileWithinBoundary(project, "../secrets.txt")
    ).rejects.toThrow(WorkspaceError)
    await expect(
      readFileWithinBoundary(project, "../secrets.txt")
    ).rejects.toMatchObject({
      code: "path_outside_boundary",
    })
  })
})
