import { randomBytes } from "node:crypto"
import { Hono } from "hono"

import { env } from "./env"
import type { HarnessAdapter } from "./harness/types"
import {
  createBootstrapHandler,
  createSessionAuth,
  createSessionGuard,
} from "./security/session-auth"
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

export const app = new Hono()

const bootstrapToken = randomBytes(32).toString("hex")
const auth = createSessionAuth({ bootstrapToken })
const allowedOrigins = loopbackOrigins(env.PORT)

app.post("/auth/session", createBootstrapHandler(auth, allowedOrigins))
app.use("/commands/*", createSessionGuard(auth, allowedOrigins))

app.get("/", (c) => {
  return c.text("Hello Hono!")
})

export { env }
export type { HarnessAdapter }

if (import.meta.main) {
  await runProductionServer()
}
