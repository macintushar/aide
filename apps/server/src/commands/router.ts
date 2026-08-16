import { commandSchema, type CommandReceipt } from "@workspace/contracts"
import { Hono } from "hono"

import type { CommandDispatcher } from "./dispatcher"

export function commandReceiptStatus(receipt: CommandReceipt): 200 | 202 | 500 {
  if (receipt.state === "completed") return 200
  if (receipt.state === "failed") return 500
  return 202
}

export function createCommandRouter({
  dispatcher,
}: {
  dispatcher: CommandDispatcher
}): Hono {
  const router = new Hono()

  router.post("/commands/:name", async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return c.json({ error: "invalid_command_body" }, 400)
    }

    const routeName = c.req.param("name")
    if ("name" in body && body.name !== routeName) {
      return c.json({ error: "command_name_mismatch" }, 400)
    }

    const parsed = commandSchema.safeParse({ ...body, name: routeName })
    if (!parsed.success) {
      return c.json(
        { error: "invalid_command", issues: parsed.error.issues },
        400
      )
    }

    const receipt = await dispatcher.dispatch(parsed.data)
    return c.json(receipt, commandReceiptStatus(receipt))
  })

  return router
}
