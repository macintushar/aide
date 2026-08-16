import { z } from "zod"

import {
  configDefaultsSchema,
  instancesMapSchema,
  mcpServerConfigSchema,
} from "./config"
import {
  executionSelectionSchema,
  inputResolutionSchema,
  permissionResolutionSchema,
} from "./domain"
import { aideErrorSchema, idSchema, timestampSchema } from "./primitives"

export const commandNameSchema = z.enum([
  "project.open",
  "project.updateDefaults",
  "session.create",
  "session.rename",
  "session.delete",
  "turn.send",
  "turn.interrupt",
  "permission.respond",
  "input.respond",
  "inventory.refresh",
  "instance.start",
  "instance.stop",
  "instance.restart",
  "config.update",
  "mcp.reconnect",
])

export type CommandName = z.infer<typeof commandNameSchema>

export const receiptStateSchema = z.enum([
  "accepted",
  "dispatching",
  "dispatched",
  "uncertain",
  "completed",
  "failed",
])

export type ReceiptState = z.infer<typeof receiptStateSchema>

const commandEnvelopeSchema = z.object({
  commandId: idSchema,
})

export const projectOpenCommandSchema = commandEnvelopeSchema.extend({
  name: z.literal("project.open"),
  directory: z.string().min(1),
  projectName: z.string().min(1).optional(),
})

export const projectUpdateDefaultsCommandSchema = commandEnvelopeSchema.extend({
  name: z.literal("project.updateDefaults"),
  projectId: idSchema,
  defaults: configDefaultsSchema,
})

export const sessionCreateCommandSchema = commandEnvelopeSchema.extend({
  name: z.literal("session.create"),
  projectId: idSchema,
  title: z.string().min(1).optional(),
})

export const sessionRenameCommandSchema = commandEnvelopeSchema.extend({
  name: z.literal("session.rename"),
  sessionId: idSchema,
  title: z.string().min(1),
})

export const sessionDeleteCommandSchema = commandEnvelopeSchema.extend({
  name: z.literal("session.delete"),
  sessionId: idSchema,
})

export const turnSendCommandSchema = commandEnvelopeSchema.extend({
  name: z.literal("turn.send"),
  sessionId: idSchema,
  content: z.string().min(1),
  execution: executionSelectionSchema,
})

export const turnInterruptCommandSchema = commandEnvelopeSchema.extend({
  name: z.literal("turn.interrupt"),
  sessionId: idSchema,
  turnId: idSchema,
})

export const permissionRespondCommandSchema = commandEnvelopeSchema.extend({
  name: z.literal("permission.respond"),
  requestId: idSchema,
  resolution: permissionResolutionSchema,
})

export const inputRespondCommandSchema = commandEnvelopeSchema.extend({
  name: z.literal("input.respond"),
  requestId: idSchema,
  resolution: inputResolutionSchema,
})

export const inventoryRefreshCommandSchema = commandEnvelopeSchema.extend({
  name: z.literal("inventory.refresh"),
  instanceId: z.string().min(1),
  directory: z.string().min(1).optional(),
})

export const instanceStartCommandSchema = commandEnvelopeSchema.extend({
  name: z.literal("instance.start"),
  instanceId: z.string().min(1),
})

export const instanceStopCommandSchema = commandEnvelopeSchema.extend({
  name: z.literal("instance.stop"),
  instanceId: z.string().min(1),
})

export const instanceRestartCommandSchema = commandEnvelopeSchema.extend({
  name: z.literal("instance.restart"),
  instanceId: z.string().min(1),
})

export const configUpdateTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("global") }),
  z.object({ kind: z.literal("project"), projectId: idSchema }),
])

export const configUpdateCommandSchema = commandEnvelopeSchema.extend({
  name: z.literal("config.update"),
  target: configUpdateTargetSchema,
  config: z.object({
    projectsDirectory: z.string().min(1).optional(),
    instances: instancesMapSchema.optional(),
    mcpServers: z.record(z.string(), mcpServerConfigSchema).optional(),
    defaults: configDefaultsSchema.optional(),
  }),
})

export const mcpReconnectCommandSchema = commandEnvelopeSchema.extend({
  name: z.literal("mcp.reconnect"),
  instanceId: z.string().min(1),
  serverName: z.string().min(1),
})

export const commandSchema = z.discriminatedUnion("name", [
  projectOpenCommandSchema,
  projectUpdateDefaultsCommandSchema,
  sessionCreateCommandSchema,
  sessionRenameCommandSchema,
  sessionDeleteCommandSchema,
  turnSendCommandSchema,
  turnInterruptCommandSchema,
  permissionRespondCommandSchema,
  inputRespondCommandSchema,
  inventoryRefreshCommandSchema,
  instanceStartCommandSchema,
  instanceStopCommandSchema,
  instanceRestartCommandSchema,
  configUpdateCommandSchema,
  mcpReconnectCommandSchema,
])

export type Command = z.infer<typeof commandSchema>

export const commandReceiptSchema = z.object({
  commandId: idSchema,
  commandName: commandNameSchema,
  state: receiptStateSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  result: z.unknown().optional(),
  error: aideErrorSchema.optional(),
})

export type CommandReceipt = z.infer<typeof commandReceiptSchema>
