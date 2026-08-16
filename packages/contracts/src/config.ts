import { z } from "zod"

import { driverIdSchema, idSchema } from "./primitives"

export const mcpServerConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stdio"),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal("http"),
    url: z.string().min(1),
    headers: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal("sse"),
    url: z.string().min(1),
    headers: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal("aide"),
    toolset: z.string().min(1),
  }),
])

export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>

export const instanceConfigSchema = z.object({
  instanceId: z.string().min(1),
  driver: driverIdSchema,
  displayName: z.string().min(1).optional(),
  enabled: z.boolean(),
  autoStart: z.boolean(),
  config: z.unknown(),
  mcpServers: z.record(z.string(), mcpServerConfigSchema).optional(),
})

export type InstanceConfig = z.infer<typeof instanceConfigSchema>

export const instancesMapSchema = z
  .record(z.string(), instanceConfigSchema)
  .superRefine((instances, ctx) => {
    for (const [key, instance] of Object.entries(instances)) {
      if (key !== instance.instanceId) {
        ctx.addIssue({
          code: "custom",
          message: `instances map key "${key}" must equal instanceId "${instance.instanceId}"`,
          path: [key, "instanceId"],
        })
      }
    }
  })

export type InstancesMap = z.infer<typeof instancesMapSchema>

export const configDefaultsSchema = z
  .object({
    instanceId: z.string().min(1).optional(),
    model: z
      .object({
        providerId: z.string().min(1).optional(),
        modelId: z.string().min(1),
      })
      .optional(),
    agent: z.string().min(1).optional(),
    interactionMode: z.string().min(1).optional(),
    options: z.record(z.string(), z.string()).optional(),
  })
  .strict()

export type ConfigDefaults = z.infer<typeof configDefaultsSchema>

export const aideConfigSchema = z.object({
  projectsDirectory: z.string().min(1).optional(),
  instances: instancesMapSchema,
  mcpServers: z.record(z.string(), mcpServerConfigSchema),
  defaults: configDefaultsSchema,
})

export type AideConfig = z.infer<typeof aideConfigSchema>

export const globalConfigRecordSchema = aideConfigSchema

export type GlobalConfigRecord = z.infer<typeof globalConfigRecordSchema>

export const projectConfigRecordSchema = z.object({
  projectId: idSchema,
  projectsDirectory: z.string().min(1).optional(),
  instances: instancesMapSchema.optional(),
  mcpServers: z.record(z.string(), mcpServerConfigSchema).optional(),
  defaults: configDefaultsSchema.optional(),
})

export type ProjectConfigRecord = z.infer<typeof projectConfigRecordSchema>
