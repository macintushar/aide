import { z } from "zod"

import {
  aideErrorSchema,
  driverIdSchema,
  optionDescriptorSchema,
  selectOptionSchema,
  timestampSchema,
} from "./primitives"

export const harnessCapabilitiesSchema = z.object({
  inventoryScope: z.enum(["directory", "runtime"]),
  agentSelection: z.boolean(),
  interactionModes: z.array(selectOptionSchema),
  sessionModelSwitch: z.enum(["in-session", "unsupported"]),
  steer: z.boolean(),
  interrupt: z.boolean(),
  permissions: z.boolean(),
  userInput: z.boolean(),
  reasoningParts: z.boolean(),
  mcp: z.object({
    stdio: z.boolean(),
    http: z.boolean(),
    sse: z.boolean(),
    inProcess: z.boolean(),
    runtimeReconfigure: z.boolean(),
  }),
})

export type HarnessCapabilities = z.infer<typeof harnessCapabilitiesSchema>

export const instanceAuthSchema = z.object({
  status: z.enum(["authenticated", "unauthenticated", "expired", "unknown"]),
  type: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  account: z.string().min(1).optional(),
})

export type InstanceAuth = z.infer<typeof instanceAuthSchema>

export const harnessModelSchema = z.object({
  providerId: z.string().min(1).optional(),
  modelId: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
  optionDescriptors: z.array(optionDescriptorSchema),
  supportedAgents: z.array(z.string().min(1)).optional(),
})

export type HarnessModel = z.infer<typeof harnessModelSchema>

export const harnessInventorySchema = z.object({
  instanceId: z.string().min(1),
  driver: driverIdSchema,
  revision: z.string().min(1),
  discoveredAt: timestampSchema,
  stale: z.boolean(),
  capabilities: harnessCapabilitiesSchema,
  auth: instanceAuthSchema,
  models: z.array(harnessModelSchema),
  agents: z.array(selectOptionSchema),
  interactionModes: z.array(selectOptionSchema),
})

export type HarnessInventory = z.infer<typeof harnessInventorySchema>

export const instanceRuntimeStatusSchema = z.enum([
  "configured",
  "starting",
  "ready",
  "degraded",
  "stopped",
  "failed",
])

export type InstanceRuntimeStatus = z.infer<typeof instanceRuntimeStatusSchema>

export const mcpServerStatusSchema = z.object({
  name: z.string().min(1),
  connected: z.boolean(),
  error: aideErrorSchema.optional(),
})

export type McpServerStatus = z.infer<typeof mcpServerStatusSchema>
