import {
  aideConfigSchema,
  projectConfigRecordSchema,
} from "@workspace/contracts"
import { Hono } from "hono"

import type { ConfigService } from "./service"

export function createConfigRouter({
  config,
}: {
  config: ConfigService
}): Hono {
  const router = new Hono()

  router.get("/config", (c) =>
    c.json(aideConfigSchema.parse(config.globalConfig()))
  )
  router.get("/projects/:projectId/config", (c) => {
    const projectId = c.req.param("projectId")
    return c.json(
      projectConfigRecordSchema.parse(
        config.projectConfig(projectId) ?? { projectId }
      )
    )
  })

  return router
}
