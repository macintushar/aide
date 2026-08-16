import { commandFixtures, type CommandReceipt } from "@workspace/contracts"
import { describe, expect, it, vi } from "vitest"

import {
  CommandError,
  createCommandClient,
  newCommandId,
} from "./command-client"

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

    await expect(result).rejects.toMatchObject<CommandError>({
      status: 400,
      body,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(sleepImpl).not.toHaveBeenCalled()
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}
