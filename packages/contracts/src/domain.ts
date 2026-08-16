import { z } from "zod"

import {
  aideErrorSchema,
  driverIdSchema,
  idSchema,
  selectOptionSchema,
  timestampSchema,
} from "./primitives"

export const projectSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  directory: z.string().min(1),
  createdAt: timestampSchema,
  lastOpenedAt: timestampSchema,
})

export type Project = z.infer<typeof projectSchema>

export const sessionSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  title: z.string().min(1),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export type Session = z.infer<typeof sessionSchema>

export const executionSelectionSchema = z.object({
  instanceId: z.string().min(1),
  driver: driverIdSchema,
  model: z.object({
    providerId: z.string().min(1).optional(),
    modelId: z.string().min(1),
  }),
  agent: z.string().min(1).optional(),
  interactionMode: z.string().min(1).optional(),
  options: z.record(z.string(), z.string()),
})

export type ExecutionSelection = z.infer<typeof executionSelectionSchema>

export const executionDisplaySchema = z.object({
  instanceName: z.string().min(1),
  modelName: z.string().min(1),
  agentName: z.string().min(1).optional(),
  interactionModeName: z.string().min(1).optional(),
  options: z.record(
    z.string(),
    z.object({
      label: z.string().min(1),
      valueLabel: z.string().min(1),
    })
  ),
})

export type ExecutionDisplay = z.infer<typeof executionDisplaySchema>

export const resolvedExecutionSchema = z.object({
  selection: executionSelectionSchema,
  display: executionDisplaySchema,
  inventoryRevision: z.string().min(1),
})

export type ResolvedExecution = z.infer<typeof resolvedExecutionSchema>

export const toolCategorySchema = z.enum([
  "shell",
  "file_read",
  "file_write",
  "search",
  "web",
  "agent",
  "mcp",
  "other",
])

export type ToolCategory = z.infer<typeof toolCategorySchema>

export const toolStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
])

export type ToolStatus = z.infer<typeof toolStatusSchema>

const partBaseSchema = z.object({
  id: idSchema,
  messageId: idSchema,
  index: z.number().int().nonnegative(),
})

export const textPartSchema = partBaseSchema.extend({
  type: z.literal("text"),
  text: z.string(),
})

export const reasoningPartSchema = partBaseSchema.extend({
  type: z.literal("reasoning"),
  text: z.string(),
})

export const toolPartSchema = partBaseSchema.extend({
  type: z.literal("tool"),
  name: z.string().min(1),
  category: toolCategorySchema,
  status: toolStatusSchema,
  source: z
    .object({
      kind: z.literal("mcp"),
      server: z.string().min(1),
    })
    .optional(),
  input: z.unknown().optional(),
  output: z.string().optional(),
  artifactId: idSchema.optional(),
})

export const filePartSchema = partBaseSchema.extend({
  type: z.literal("file"),
  path: z.string().min(1),
  mime: z.string().min(1).optional(),
})

export const agentPartSchema = partBaseSchema.extend({
  type: z.literal("agent"),
  name: z.string().min(1),
  status: z.string().min(1).optional(),
})

export const partSchema = z.discriminatedUnion("type", [
  textPartSchema,
  reasoningPartSchema,
  toolPartSchema,
  filePartSchema,
  agentPartSchema,
])

export type Part = z.infer<typeof partSchema>
export type TextPart = z.infer<typeof textPartSchema>
export type ReasoningPart = z.infer<typeof reasoningPartSchema>
export type ToolPart = z.infer<typeof toolPartSchema>
export type FilePart = z.infer<typeof filePartSchema>
export type AgentPart = z.infer<typeof agentPartSchema>

export const userMessageSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  seq: z.number().int().nonnegative(),
  role: z.literal("user"),
  parts: z.array(partSchema),
  execution: resolvedExecutionSchema,
  createdAt: timestampSchema,
})

export type UserMessage = z.infer<typeof userMessageSchema>

export const usageSchema = z.object({
  inputTokens: z.number().nonnegative().optional(),
  outputTokens: z.number().nonnegative().optional(),
  cacheReadTokens: z.number().nonnegative().optional(),
  cacheWriteTokens: z.number().nonnegative().optional(),
  costUsd: z.number().optional(),
})

export type Usage = z.infer<typeof usageSchema>

export const assistantMessageSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  seq: z.number().int().nonnegative(),
  role: z.literal("assistant"),
  parentMessageId: idSchema,
  parts: z.array(partSchema),
  usage: usageSchema.optional(),
  createdAt: timestampSchema,
  completedAt: timestampSchema.optional(),
})

export type AssistantMessage = z.infer<typeof assistantMessageSchema>

export const messageSchema = z.discriminatedUnion("role", [
  userMessageSchema,
  assistantMessageSchema,
])

export type Message = z.infer<typeof messageSchema>

export const userMessageMetadataSchema = userMessageSchema.omit({
  parts: true,
})
export const assistantMessageMetadataSchema = assistantMessageSchema.omit({
  parts: true,
})
export const messageMetadataSchema = z.discriminatedUnion("role", [
  userMessageMetadataSchema,
  assistantMessageMetadataSchema,
])

export type MessageMetadata = z.infer<typeof messageMetadataSchema>

export const nativeDispatchInputSchema = z.object({
  id: idSchema,
  turnId: idSchema,
  instanceId: z.string().min(1),
  nativeSessionId: z.string().min(1),
  role: z.literal("handoff"),
  fromMessageSeq: z.number().int().nonnegative(),
  throughMessageSeq: z.number().int().nonnegative(),
  content: z.string(),
  createdAt: timestampSchema,
})

export type NativeDispatchInput = z.infer<typeof nativeDispatchInputSchema>

export const turnStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "interrupted",
  "failed",
])

export type TurnStatus = z.infer<typeof turnStatusSchema>

export const turnSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  seq: z.number().int().nonnegative(),
  status: turnStatusSchema,
  execution: resolvedExecutionSchema,
  commandId: idSchema,
  userMessageId: idSchema,
  assistantMessageId: idSchema.optional(),
  startedAt: timestampSchema.optional(),
  endedAt: timestampSchema.optional(),
  error: aideErrorSchema.optional(),
})

export type Turn = z.infer<typeof turnSchema>

export const permissionRequestPayloadSchema = z.object({
  kind: z.literal("permission"),
  toolName: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().optional(),
  diff: z.string().optional(),
  options: z.array(selectOptionSchema),
})

export type PermissionRequestPayload = z.infer<
  typeof permissionRequestPayloadSchema
>

export const inputQuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  header: z.string().min(1).optional(),
  options: z.array(selectOptionSchema).optional(),
  allowMultiple: z.boolean(),
  allowFreeText: z.boolean(),
  multiline: z.boolean().optional(),
})

export type InputQuestion = z.infer<typeof inputQuestionSchema>

export const inputRequestPayloadSchema = z.object({
  kind: z.literal("input"),
  questions: z.array(inputQuestionSchema).min(1),
})

export type InputRequestPayload = z.infer<typeof inputRequestPayloadSchema>

export const permissionResolutionSchema = z.object({
  kind: z.literal("permission"),
  optionId: z.string().min(1),
})

export type PermissionResolution = z.infer<typeof permissionResolutionSchema>

export const inputResolutionSchema = z.object({
  kind: z.literal("input"),
  answers: z.record(
    z.string(),
    z.object({
      optionIds: z.array(z.string().min(1)).optional(),
      text: z.string().optional(),
    })
  ),
})

export type InputResolution = z.infer<typeof inputResolutionSchema>

const requestBaseSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  turnId: idSchema,
  status: z.enum(["open", "resolved", "cancelled"]),
})

export const permissionRequestSchema = requestBaseSchema.extend({
  kind: z.literal("permission"),
  payload: permissionRequestPayloadSchema,
  resolution: permissionResolutionSchema.optional(),
})

export const inputRequestSchema = requestBaseSchema.extend({
  kind: z.literal("input"),
  payload: inputRequestPayloadSchema,
  resolution: inputResolutionSchema.optional(),
})

export const requestSchema = z.discriminatedUnion("kind", [
  permissionRequestSchema,
  inputRequestSchema,
])

export type Request = z.infer<typeof requestSchema>
