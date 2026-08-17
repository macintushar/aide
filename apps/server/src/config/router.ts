import {
  aideConfigSchema,
  projectConfigRecordSchema,
  type AideConfig,
  type InstanceConfig,
  type ProjectConfigRecord,
} from "@workspace/contracts"
import { Hono } from "hono"

import { redactDriverConfig, redactMcpServers } from "../mcp"
import type { ConfigService } from "./service"

export function createConfigRouter({
  config,
}: {
  config: ConfigService
}): Hono {
  const router = new Hono()

  router.get("/config", (c) =>
    c.json(aideConfigSchema.parse(redactConfig(config.globalConfig())))
  )
  router.get("/projects/:projectId/config", (c) => {
    const projectId = c.req.param("projectId")
    return c.json(
      projectConfigRecordSchema.parse(
        redactConfig(config.projectConfig(projectId) ?? { projectId })
      )
    )
  })

  return router
}

function redactConfig<T extends AideConfig | ProjectConfigRecord>(
  config: T
): T {
  return {
    ...config,
    ...(config.mcpServers
      ? { mcpServers: redactMcpServers(config.mcpServers) }
      : {}),
    ...(config.instances
      ? {
          instances: Object.fromEntries(
            Object.entries(config.instances).map(([instanceId, instance]) => [
              instanceId,
              redactInstanceMcpServers(instance),
            ])
          ),
        }
      : {}),
  } as T
}

function redactInstanceMcpServers(instance: InstanceConfig): InstanceConfig {
  return {
    ...instance,
    config: redactDriverConfig(instance.config),
    ...(instance.mcpServers
      ? { mcpServers: redactMcpServers(instance.mcpServers) }
      : {}),
  }
}
