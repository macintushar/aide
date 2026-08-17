import { Hono } from "hono"

import { env } from "./env"
import type { HarnessAdapter } from "./harness/types"
import { createCommandGuard } from "./security/command-guard"
import { loopbackOrigins } from "./security/loopback"

export { createCommandRouter } from "./commands"
export type { CommandDispatcher } from "./commands"
export * from "./events"
export * from "./integration"
export * from "./services"

export const app = new Hono()

app.use(
  "/commands/*",
  createCommandGuard({
    bearerToken: env.AIDE_BEARER_TOKEN,
    allowedOrigins: loopbackOrigins(env.PORT),
  })
)

app.get("/", (c) => {
  return c.text("Hello Hono!")
})

export default {
  hostname: env.HOST,
  port: env.PORT,
  fetch: app.fetch,
}

export { env }
export type { HarnessAdapter }
