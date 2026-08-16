import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createDb } from "../db"
import { Database } from "../db/test/bun-sqlite-shim"
import { ArtifactError, ArtifactStore } from "./index"

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url)
)
const createdAt = "2026-01-01T00:00:00.000Z"

function applyMigrations(client: Database): void {
  for (const file of readdirSync(migrationsFolder)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const migration = readFileSync(`${migrationsFolder}/${file}`, "utf8")
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) client.exec(statement)
    }
  }
}

describe("ArtifactStore", () => {
  let client: Database
  let store: ArtifactStore

  beforeEach(() => {
    client = new Database(":memory:")
    applyMigrations(client)
    store = new ArtifactStore(createDb(client))
  })

  afterEach(() => client.close())

  it("round trips UTF-8 text", async () => {
    const data = "café"
    const metadata = await store.put({
      id: "text",
      mimeType: "text/plain",
      data,
      createdAt,
    })

    expect(metadata).toEqual({
      id: "text",
      mimeType: "text/plain",
      byteLength: Buffer.byteLength(data, "utf8"),
      createdAt,
    })
    expect(Buffer.from((await store.get("text"))!.data).toString("utf8")).toBe(
      data
    )
  })

  it("round trips binary data", async () => {
    const data = Uint8Array.from([0, 1, 127, 128, 255])
    await store.put({
      id: "binary",
      mimeType: "application/octet-stream",
      data,
    })

    expect((await store.get("binary"))?.data).toEqual(data)
  })

  it("returns metadata without data and creates part references", async () => {
    await store.put({
      id: "metadata",
      mimeType: "text/plain",
      data: "hello",
      createdAt,
    })

    expect(await store.metadata("metadata")).toEqual({
      id: "metadata",
      mimeType: "text/plain",
      byteLength: 5,
      createdAt,
    })
    expect(store.asPartReference("metadata")).toEqual({
      artifactId: "metadata",
    })
  })

  it("returns undefined for missing artifacts", async () => {
    await expect(store.get("missing")).resolves.toBeUndefined()
    await expect(store.metadata("missing")).resolves.toBeUndefined()
  })

  it("rejects artifacts over the configured limit", async () => {
    const limitedStore = new ArtifactStore(createDb(client), { maxBytes: 2 })

    await expect(
      limitedStore.put({ id: "large", mimeType: "text/plain", data: "abc" })
    ).rejects.toMatchObject({
      code: "artifact_too_large",
      retryable: false,
    })
  })

  it("rejects empty artifacts", async () => {
    await expect(
      store.put({ id: "empty", mimeType: "text/plain", data: "" })
    ).rejects.toBeInstanceOf(ArtifactError)
    await expect(
      store.put({ id: "empty", mimeType: "text/plain", data: "" })
    ).rejects.toMatchObject({ code: "invalid_artifact" })
  })

  it("isolates persisted and returned data from mutation", async () => {
    const input = Uint8Array.from([1, 2, 3])
    await store.put({
      id: "copies",
      mimeType: "application/octet-stream",
      data: input,
    })
    input[0] = 9
    const first = (await store.get("copies"))!
    first.data[1] = 9

    expect((await store.get("copies"))?.data).toEqual(
      Uint8Array.from([1, 2, 3])
    )
  })

  it("rejects a persisted byte length mismatch", async () => {
    await store.put({ id: "corrupt", mimeType: "text/plain", data: "hello" })
    client.exec("UPDATE artifacts SET byte_length = 4 WHERE id = 'corrupt'")

    await expect(store.get("corrupt")).rejects.toMatchObject({
      code: "invalid_artifact",
    })
  })

  it("rejects duplicate ids like the artifact repository", async () => {
    await store.put({ id: "duplicate", mimeType: "text/plain", data: "one" })

    await expect(
      store.put({ id: "duplicate", mimeType: "text/plain", data: "two" })
    ).rejects.toThrow()
    expect(Buffer.from((await store.get("duplicate"))!.data).toString()).toBe(
      "one"
    )
  })
})
