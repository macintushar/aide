import { commandFixtures, type CommandReceipt } from "@workspace/contracts"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createCommandClient, newCommandId } from "./command-client"

afterEach(() => vi.unstubAllGlobals())

const receipt: CommandReceipt = {
  commandId: "cmd_0001",
  commandName: "project.open",
  state: "completed",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}

describe("createCommandClient", () => {
  it("posts the command without its name and returns the receipt", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(receipt))
    const client = createCommandClient({
      baseUrl: "http://localhost:3000/",
      fetchImpl,
    })

    await expect(client.send(commandFixtures()[0])).resolves.toEqual(receipt)
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:3000/commands/project.open",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          commandId: "cmd_0001",
          directory: "/Users/tushar/projects/aide",
          projectName: "aide",
        }),
      })
    )
    expect(newCommandId()).toMatch(/^cmd_[0-9a-f-]{36}$/)
  })

  it("merges custom headers and bearer authentication", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(receipt))

    await createCommandClient({
      fetchImpl,
      bearerToken: "secret-token",
      headers: { "x-aide-client": "web" },
    }).send(commandFixtures()[0])

    const headers = new Headers(fetchImpl.mock.calls[0]![1]?.headers)
    expect(headers.get("authorization")).toBe("Bearer secret-token")
    expect(headers.get("x-aide-client")).toBe("web")
    expect(headers.get("content-type")).toBe("application/json")
  })

  it("retries network and server failures with the same command id", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(jsonResponse({ error: "busy" }, 503))
      .mockResolvedValueOnce(jsonResponse(receipt))
    const sleepImpl = vi.fn(async () => undefined)

    await createCommandClient({ fetchImpl, sleepImpl }).send(
      commandFixtures()[0]
    )

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(fetchImpl.mock.calls.map((call) => call[1]?.body)).toEqual([
      expect.stringContaining('"commandId":"cmd_0001"'),
      expect.stringContaining('"commandId":"cmd_0001"'),
      expect.stringContaining('"commandId":"cmd_0001"'),
    ])
    expect(sleepImpl.mock.calls).toEqual([[100], [200]])
  })

  it("does not retry a 400 response", async () => {
    const body = { error: "invalid command" }
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(body, 400))
    const sleepImpl = vi.fn(async () => undefined)

    const result = createCommandClient({ fetchImpl, sleepImpl }).send(
      commandFixtures()[0]
    )

    await expect(result).rejects.toMatchObject({
      status: 400,
      body,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(sleepImpl).not.toHaveBeenCalled()
  })

  it("preserves a non-JSON error response body", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("upstream unavailable", { status: 400 }))

    await expect(
      createCommandClient({ fetchImpl }).send(commandFixtures()[0])
    ).rejects.toMatchObject({
      status: 400,
      body: "upstream unavailable",
    })
  })

  it("rejects a malformed successful receipt", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not JSON"))

    await expect(
      createCommandClient({ fetchImpl }).send(commandFixtures()[0])
    ).rejects.toThrow()
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("exhausts retries for 5xx responses", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => jsonResponse({ error: "busy" }, 503))
    const sleepImpl = vi.fn(async () => undefined)

    await expect(
      createCommandClient({ fetchImpl, sleepImpl }).send(commandFixtures()[0])
    ).rejects.toMatchObject({
      status: 503,
      body: { error: "busy" },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleepImpl.mock.calls).toEqual([[100], [200]])
  })
  it("re-exchanges once and retries when a session is rejected with 401", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401))
      .mockResolvedValueOnce(jsonResponse(receipt))
    const auth = {
      bearer: vi.fn(async () => "stale-session"),
      invalidate: vi.fn(),
      hasSession: () => true,
      bootstrapWithToken: async () => undefined,
      bootstrapFromUrl: async () => false,
    }

    await expect(
      createCommandClient({ fetchImpl, auth }).send(commandFixtures()[0])
    ).resolves.toEqual(receipt)
    expect(auth.invalidate).toHaveBeenCalledOnce()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("does not retry a 401 without an auth provider", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401))

    await expect(
      createCommandClient({ fetchImpl }).send(commandFixtures()[0])
    ).rejects.toMatchObject({ status: 401 })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})

describe("newCommandId", () => {
  it("prefixes a random UUID", () => {
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "12345678-1234-1234-1234-123456789abc"),
    })

    expect(newCommandId()).toBe("cmd_12345678-1234-1234-1234-123456789abc")
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}
