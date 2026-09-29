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

/**
 * A git worktree Aide created for a session. Aide owns the directory: it lives
 * under Aide's data directory, not inside the project, and turns in the
 * session run there instead of in the project directory.
 */
export const sessionWorktreeSchema = z.object({
  path: z.string().min(1),
  branch: z.string().min(1),
  baseRef: z.string().min(1),
})

export type SessionWorktree = z.infer<typeof sessionWorktreeSchema>

/** Where a forked session's copied history came from. */
export const sessionForkOriginSchema = z.object({
  sessionId: idSchema,
  throughMessageSeq: z.number().int().nonnegative(),
})

export type SessionForkOrigin = z.infer<typeof sessionForkOriginSchema>

export const sessionSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  title: z.string().min(1),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  worktree: sessionWorktreeSchema.optional(),
  forkedFrom: sessionForkOriginSchema.optional(),
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

export const subagentStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "stopped",
])

export type SubagentStatus = z.infer<typeof subagentStatusSchema>

/**
 * A subagent the turn delegated to. One part per subagent, updated in place as
 * it runs, the same way a tool part changes `status`.
 */
export const agentPartSchema = partBaseSchema.extend({
  type: z.literal("agent"),
  name: z.string().min(1),
  status: z.string().min(1).optional(),
  description: z.string().optional(),
  /** The harness's handle for the subagent, for stopping it. */
  taskId: z.string().min(1).optional(),
  /** Latest progress line while running, final report summary once done. */
  summary: z.string().optional(),
  progress: z
    .object({
      totalTokens: z.number().nonnegative().optional(),
      toolUses: z.number().int().nonnegative().optional(),
      durationMs: z.number().nonnegative().optional(),
      lastToolName: z.string().optional(),
    })
    .optional(),
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

/** A harness command or skill the user invoked, with the text as its arguments. */
export const invocationSchema = z.object({
  kind: z.enum(["command", "skill"]),
  name: z.string().min(1),
})

export type Invocation = z.infer<typeof invocationSchema>

export const userMessageSchema = z.object({
  id: idSchema,
  sessionId: idSchema,
  seq: z.number().int().nonnegative(),
  role: z.literal("user"),
  parts: z.array(partSchema),
  execution: resolvedExecutionSchema,
  invocation: invocationSchema.optional(),
  /**
   * Set when the message steered a turn that was already running rather than
   * starting one of its own.
   */
  steer: z.object({ turnId: idSchema }).optional(),
  createdAt: timestampSchema,
})

export type UserMessage = z.infer<typeof userMessageSchema>

export const usageSchema = z.object({
  inputTokens: z.number().nonnegative().optional(),
  outputTokens: z.number().nonnegative().optional(),
  cacheReadTokens: z.number().nonnegative().optional(),
  cacheWriteTokens: z.number().nonnegative().optional(),
  reasoningTokens: z.number().nonnegative().optional(),
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
  /**
   * Set when the call would touch paths outside the project. Structured rather
   * than folded into `detail` because it is the one part of a permission
   * prompt the UI must not let the user skim past.
   */
  boundary: z
    .object({
      projectDirectory: z.string().min(1),
      outsidePaths: z.array(z.string().min(1)).min(1),
    })
    .optional(),
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

/** A harness notice (compaction, retries, and the like) kept with the session. */
export const noticeSchema = z.object({
  id: idSchema,
  turnId: idSchema.optional(),
  title: z.string().min(1),
  message: z.string().min(1),
  level: z.enum(["info", "warning", "error"]).optional(),
  createdAt: timestampSchema,
})

export type Notice = z.infer<typeof noticeSchema>

/** A restore point: the working tree as it was just before a turn ran. */
export const checkpointSchema = z.object({
  turnId: idSchema,
  createdAt: timestampSchema,
})

export type Checkpoint = z.infer<typeof checkpointSchema>

/** One project file matched by a file search. */
export const fileMatchSchema = z.object({
  /** Relative to the session's working directory, with forward slashes. */
  path: z.string().min(1),
  name: z.string().min(1),
})

export type FileMatch = z.infer<typeof fileMatchSchema>

export const fileSearchResultSchema = z.object({
  /** The directory the paths are relative to. */
  root: z.string().min(1),
  files: z.array(fileMatchSchema),
})

export type FileSearchResult = z.infer<typeof fileSearchResultSchema>

/** A project with how many sessions it has, for the project browser. */
export const projectSummarySchema = projectSchema.extend({
  sessionCount: z.number().int().nonnegative(),
})

export type ProjectSummary = z.infer<typeof projectSummarySchema>

export const projectListSchema = z.object({
  projects: z.array(projectSummarySchema),
})

export type ProjectList = z.infer<typeof projectListSchema>

export const sessionListSchema = z.object({
  sessions: z.array(sessionSchema),
})

export type SessionList = z.infer<typeof sessionListSchema>

/** One file from a session's working directory, for previewing a link. */
export const filePreviewSchema = z.object({
  path: z.string().min(1),
  /** Absent for binary files. */
  content: z.string().optional(),
  binary: z.boolean(),
  /** True when the file was larger than the preview limit. */
  truncated: z.boolean(),
  size: z.number().int().nonnegative(),
})

export type FilePreview = z.infer<typeof filePreviewSchema>
