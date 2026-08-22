import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { serveWebApp } from "./web-static"

let dist: string
let serve: ReturnType<typeof serveWebApp>

beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), "aide-web-static-"))
  mkdirSync(join(dist, "assets"))
  writeFileSync(
    join(dist, "index.html"),
    '<!doctype html><title>aide</title><script src="/assets/main.js"></script>'
  )
  writeFileSync(join(dist, "assets", "main.js"), "console.log(1)")
  writeFileSync(join(dist, "..", ".env"), "SECRET=1")
  serve = serveWebApp(dist)
})

afterAll(() => {
  rmSync(dist, { recursive: true, force: true })
})

describe("serveWebApp", () => {
  it("serves index.html at the root", async () => {
    const res = await serve("/")
    expect(res?.status).toBe(200)
    expect(res?.headers.get("content-type")).toContain("text/html")
    expect(await res?.text()).toContain("<!doctype html>")
  })

  it("serves nested assets with their content type", async () => {
    const res = await serve("/assets/main.js")
    expect(res?.status).toBe(200)
    expect(res?.headers.get("content-type")).toContain("text/javascript")
  })

  it("falls back to index.html for client-side routes", async () => {
    const res = await serve("/some/client/route")
    expect(res?.status).toBe(200)
    expect(await res?.text()).toContain("aide")
  })

  it("never falls back to index.html for API prefixes", async () => {
    for (const path of [
      "/commands/nope",
      "/config",
      "/projects/p/config",
      "/sessions/s1/events",
      "/instances",
      "/auth/session",
    ]) {
      // undefined = caller answers (404 JSON), never the SPA shell.
      expect(await serve(path), path).toBeUndefined()
    }
  })

  it("returns undefined for missing assets instead of the shell", async () => {
    expect(await serve("/missing-abc123.js")).toBeUndefined()
    expect(await serve("/no/such/dir/picture.png")).toBeUndefined()
  })

  it("blocks path traversal out of the dist root", async () => {
    expect(await serve("/../../.env")).toBeUndefined()
    expect(await serve("/..%2F..%2F.env")).toBeUndefined()
    expect(await serve("/assets/../../../.env")).toBeUndefined()
  })

  it("ignores query strings when resolving assets", async () => {
    const res = await serve("/?authToken=secret")
    expect(res?.status).toBe(200)
    expect(await res?.text()).toContain("aide")
  })
})
