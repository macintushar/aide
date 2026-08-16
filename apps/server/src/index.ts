import { Hono } from "hono"

import { env } from "./env"
import type { HarnessAdapter } from "./harness/types"
import { createCommandGuard } from "./security/command-guard"
import { loopbackOrigins } from "./security/loopback"
import { runProductionServer } from "./integration/production"

export { createCommandRouter } from "./commands"
export type { CommandDispatcher } from "./commands"
export * from "./config"
export * from "./events"
export * from "./integration"
export * from "./inventory"
export * from "./mcp"
export * from "./services"
export * from "./supervisor"

const app = new Hono()

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

export default app
export { env }
export type { HarnessAdapter }

if (import.meta.main) {
  await runProductionServer()
}
