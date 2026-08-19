import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"

import { WorkspaceError } from "./errors"
import {
  readFileWithinBoundary,
  resolveRealWithinBoundary,
  resolveWithinBoundary,
} from "./paths"

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

describe("resolveRealWithinBoundary", () => {
  it("resolves a real path inside the project", async () => {
    const project = await makeProject()
    await writeFile(join(project, "notes.txt"), "hello aide")
    await expect(resolveRealWithinBoundary(project, "notes.txt")).resolves.toBe(
      join(await realpath(project), "notes.txt")
    )
  })

  it("resolves a path that does not exist yet", async () => {
    const project = await makeProject()
    await expect(
      resolveRealWithinBoundary(project, "generated/output.txt")
    ).resolves.toBe(join(await realpath(project), "generated", "output.txt"))
  })

  it("follows a symlink that stays inside the project", async () => {
    const project = await makeProject()
    await mkdir(join(project, "src"))
    await writeFile(join(project, "src", "main.ts"), "inside")
    await symlink(join(project, "src"), join(project, "link"))
    await expect(
      resolveRealWithinBoundary(project, "link/main.ts")
    ).resolves.toBe(join(await realpath(project), "src", "main.ts"))
  })

  it("rejects a symlinked file that escapes the project", async () => {
    const project = await makeProject()
    const outside = await makeProject()
    await writeFile(join(outside, "secrets.txt"), "secret")
    await symlink(join(outside, "secrets.txt"), join(project, "secrets.txt"))
    await expect(
      resolveRealWithinBoundary(project, "secrets.txt")
    ).rejects.toMatchObject({ code: "path_outside_boundary" })
  })

  it("rejects a symlinked directory that escapes the project", async () => {
    const project = await makeProject()
    const outside = await makeProject()
    await writeFile(join(outside, "secrets.txt"), "secret")
    await symlink(outside, join(project, "escape"))
    await expect(
      resolveRealWithinBoundary(project, "escape/secrets.txt")
    ).rejects.toMatchObject({ code: "path_outside_boundary" })
  })

  it("rejects a write target under a symlinked directory that escapes", async () => {
    const project = await makeProject()
    const outside = await makeProject()
    await symlink(outside, join(project, "escape"))
    await expect(
      resolveRealWithinBoundary(project, "escape/new-file.txt")
    ).rejects.toMatchObject({ code: "path_outside_boundary" })
  })

  it("rejects lexical parent traversal before touching the disk", async () => {
    const project = await makeProject()
    await expect(
      resolveRealWithinBoundary(project, "../escape.txt")
    ).rejects.toMatchObject({ code: "path_outside_boundary" })
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

  it("rejects reads through a symlink that escapes the project", async () => {
    const project = await makeProject()
    const outside = await makeProject()
    await writeFile(join(outside, "secrets.txt"), "secret")
    await symlink(join(outside, "secrets.txt"), join(project, "secrets.txt"))
    await expect(
      readFileWithinBoundary(project, "secrets.txt")
    ).rejects.toMatchObject({ code: "path_outside_boundary" })
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
