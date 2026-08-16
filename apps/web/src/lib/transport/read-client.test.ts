import {
  instancesSnapshotFixture,
  type GlobalConfigRecord,
  type ProjectConfigRecord,
} from "@workspace/contracts"
import { describe, expect, it, vi } from "vitest"

import { createReadClient } from "./read-client"

const globalConfig: GlobalConfigRecord = {
  instances: {},
  mcpServers: {},
  defaults: {},
}

describe("createReadClient", () => {
  it("validates instances and global config reads", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(instancesSnapshotFixture()))
      .mockResolvedValueOnce(jsonResponse(globalConfig))
    const client = createReadClient({
      baseUrl: "http://localhost:3000/",
      fetchImpl,
    })

    await expect(client.getInstances()).resolves.toEqual(
      instancesSnapshotFixture()
    )
    await expect(client.getConfig()).resolves.toEqual(globalConfig)
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "http://localhost:3000/instances",
      "http://localhost:3000/config",
    ])
  })

  it("supports an encoded project config route", async () => {
    const config: ProjectConfigRecord = { projectId: "project/one" }
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(config))

    await expect(
      createReadClient({ fetchImpl }).getProjectConfig("project/one")
    ).resolves.toEqual(config)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("/projects/project%2Fone/config")
  })

  it("rejects malformed successful responses and preserves HTTP errors", async () => {
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}))
    await expect(
      createReadClient({ fetchImpl: malformed }).getInstances()
    ).rejects.toThrow()

    const failed = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: "missing" }, 404))
    await expect(
      createReadClient({ fetchImpl: failed }).getConfig()
    ).rejects.toMatchObject({
      status: 404,
      body: { error: "missing" },
    })
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}
