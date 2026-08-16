import { Hono } from "hono"

import { env } from "./env"
import type { HarnessAdapter } from "./harness/types"

const app = new Hono()

app.get("/", (c) => {
  return c.text("Hello Hono!")
})

export default app
export { env }
export type { HarnessAdapter }
