import { z } from "zod"

import {
  messageSchema,
  projectSchema,
  requestSchema,
  sessionSchema,
  turnSchema,
} from "./domain"
import { instancesEventScopeSchema, sessionEventScopeSchema } from "./events"
import {
  harnessInventorySchema,
  instanceAuthSchema,
  instanceRuntimeStatusSchema,
} from "./inventory"
import {
  aideErrorSchema,
  driverIdSchema,
  schemaVersionSchema,
} from "./primitives"

export const durableCursorSchema = z.object({
  sequence: z.number().int().nonnegative(),
})

export type DurableCursor = z.infer<typeof durableCursorSchema>

export const sessionSnapshotSchema = z.object({
  schemaVersion: schemaVersionSchema,
  scope: sessionEventScopeSchema.pick({
    kind: true,
    projectId: true,
    sessionId: true,
  }),
  cursor: durableCursorSchema,
  project: projectSchema,
  session: sessionSchema,
  messages: z.array(messageSchema),
  turns: z.array(turnSchema),
  requests: z.array(requestSchema),
})

export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>

export const instanceSnapshotEntrySchema = z.object({
  instanceId: z.string().min(1),
  driver: driverIdSchema,
  displayName: z.string().min(1).optional(),
  enabled: z.boolean(),
  autoStart: z.boolean(),
  status: instanceRuntimeStatusSchema,
  version: z.string().optional(),
  installed: z.boolean().optional(),
  auth: instanceAuthSchema,
  inventory: harnessInventorySchema.optional(),
  error: aideErrorSchema.optional(),
})

export type InstanceSnapshotEntry = z.infer<typeof instanceSnapshotEntrySchema>

export const instancesSnapshotSchema = z.object({
  schemaVersion: schemaVersionSchema,
  scope: instancesEventScopeSchema,
  cursor: durableCursorSchema,
  instances: z.array(instanceSnapshotEntrySchema),
})

export type InstancesSnapshot = z.infer<typeof instancesSnapshotSchema>

export const snapshotSchema = z.union([
  sessionSnapshotSchema,
  instancesSnapshotSchema,
])

export type Snapshot = z.infer<typeof snapshotSchema>
