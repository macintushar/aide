import { z } from "zod"

import {
  configDefaultsSchema,
  instancesMapSchema,
  mcpServerConfigSchema,
} from "./config"
import {
  executionSelectionSchema,
  inputResolutionSchema,
  invocationSchema,
  permissionResolutionSchema,
} from "./domain"
import { aideErrorSchema, idSchema, timestampSchema } from "./primitives"

export const commandNameSchema = z.enum([
  "project.open",
  "project.updateDefaults",
  "session.create",
  "session.rename",
  "session.delete",
  "session.fork",
  "session.restore",
  "worktree.remove",
  "turn.send",
  "turn.steer",
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

/**
 * Asks for the session to run in its own git worktree. Aide creates the
 * worktree under its data directory on a new branch cut from `baseRef`
 * (default: the project's current HEAD).
 */
export const worktreeRequestSchema = z.object({
  // Both reach git as arguments, so neither may look like an option.
  branch: z
    .string()
    .min(1)
    .regex(
      /^(?!-)[A-Za-z0-9._/-]+$/,
      "Branch names use letters, digits, . _ / - and do not start with -"
    )
    .optional(),
  baseRef: z
    .string()
    .min(1)
    .regex(
      /^(?!-)[A-Za-z0-9._/@^~{}:-]+$/,
      "A base ref is a branch, tag or commit and does not start with -"
    )
    .optional(),
})

export type WorktreeRequest = z.infer<typeof worktreeRequestSchema>

export const sessionCreateCommandSchema = commandEnvelopeSchema.extend({
  name: z.literal("session.create"),
  projectId: idSchema,
  title: z.string().min(1).optional(),
  worktree: worktreeRequestSchema.optional(),
})

/**
 * Copies a session's history into a new session. With `throughTurnId`, only
 * the messages up to and including that turn are copied. The fork starts
 * without native sessions: its first turn hands the copied history over.
 */
export const sessionForkCommandSchema = commandEnvelopeSchema.extend({
  name: z.literal("session.fork"),
  sessionId: idSchema,
  throughTurnId: idSchema.optional(),
  title: z.string().min(1).optional(),
  worktree: worktreeRequestSchema.optional(),
})

/**
 * Restores the session's working directory to the checkpoint Aide took just
 * before `turnId` ran. The transcript is not rewritten.
 */
export const sessionRestoreCommandSchema = commandEnvelopeSchema.extend({
  name: z.literal("session.restore"),
  sessionId: idSchema,
  turnId: idSchema,
})

/** Deletes the session's worktree and its branch; the session keeps its history. */
export const worktreeRemoveCommandSchema = commandEnvelopeSchema.extend({
  name: z.literal("worktree.remove"),
  sessionId: idSchema,
  /** Also delete the branch, even when it has commits not merged elsewhere. */
  deleteBranch: z.boolean().optional(),
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

export const turnSendCommandSchema = commandEnvelopeSchema
  .extend({
    name: z.literal("turn.send"),
    sessionId: idSchema,
    /** The message, or a command's or skill's arguments (which may be empty). */
    content: z.string(),
    execution: executionSelectionSchema,
    invocation: invocationSchema.optional(),
  })
  .refine(
    (command) => command.invocation !== undefined || command.content.length > 0,
    { message: "A message needs content", path: ["content"] }
  )

/** Adds a message to a turn that is already running instead of queueing one. */
export const turnSteerCommandSchema = commandEnvelopeSchema.extend({
  name: z.literal("turn.steer"),
  sessionId: idSchema,
  turnId: idSchema,
  content: z.string().min(1),
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
  sessionForkCommandSchema,
  sessionRestoreCommandSchema,
  worktreeRemoveCommandSchema,
  turnSendCommandSchema,
  turnSteerCommandSchema,
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
