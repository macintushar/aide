import { z } from "zod"

import {
  messageMetadataSchema,
  partSchema,
  requestSchema,
  turnSchema,
} from "./domain"
import {
  harnessInventorySchema,
  instanceAuthSchema,
  mcpServerStatusSchema,
} from "./inventory"
import {
  aideErrorSchema,
  driverIdSchema,
  idSchema,
  schemaVersionSchema,
  timestampSchema,
} from "./primitives"

export const durableDeliverySchema = z.object({
  durable: z.literal(true),
  sequence: z.number().int().nonnegative(),
})

export const ephemeralDeliverySchema = z.object({
  durable: z.literal(false),
  streamOrdinal: z.number().int().nonnegative(),
})

export const eventDeliverySchema = z.discriminatedUnion("durable", [
  durableDeliverySchema,
  ephemeralDeliverySchema,
])

export type EventDelivery = z.infer<typeof eventDeliverySchema>

export const sessionEventScopeSchema = z.object({
  kind: z.literal("session"),
  projectId: idSchema,
  sessionId: idSchema,
  turnId: idSchema.optional(),
  messageId: idSchema.optional(),
  partId: idSchema.optional(),
})

export const instancesEventScopeSchema = z.object({
  kind: z.literal("instances"),
})

export const eventScopeSchema = z.discriminatedUnion("kind", [
  sessionEventScopeSchema,
  instancesEventScopeSchema,
])

export type EventScope = z.infer<typeof eventScopeSchema>

const aideEventBaseSchema = z.object({
  schemaVersion: schemaVersionSchema,
  eventId: idSchema,
  timestamp: timestampSchema,
  delivery: eventDeliverySchema,
  scope: eventScopeSchema,
  instanceId: z.string().min(1).optional(),
  driver: driverIdSchema.optional(),
})

export const partUpsertedEventSchema = aideEventBaseSchema.extend({
  type: z.literal("part.upserted"),
  data: z.object({ part: partSchema }),
})

export const partDeltaEventSchema = aideEventBaseSchema.extend({
  type: z.literal("part.delta"),
  data: z.object({
    partId: idSchema,
    messageId: idSchema,
    field: z.enum(["text", "reasoning", "input"]),
    text: z.string(),
  }),
})

export const partRemovedEventSchema = aideEventBaseSchema.extend({
  type: z.literal("part.removed"),
  data: z.object({
    partId: idSchema,
    messageId: idSchema,
  }),
})

export const messageUpsertedEventSchema = aideEventBaseSchema.extend({
  type: z.literal("message.upserted"),
  data: z.object({ message: messageMetadataSchema }),
})

export const turnQueuedEventSchema = aideEventBaseSchema.extend({
  type: z.literal("turn.queued"),
  data: z.object({ turn: turnSchema }),
})

export const turnStartedEventSchema = aideEventBaseSchema.extend({
  type: z.literal("turn.started"),
  data: z.object({ turn: turnSchema }),
})

export const turnCompletedEventSchema = aideEventBaseSchema.extend({
  type: z.literal("turn.completed"),
  data: z.object({ turn: turnSchema }),
})

export const turnInterruptedEventSchema = aideEventBaseSchema.extend({
  type: z.literal("turn.interrupted"),
  data: z.object({ turn: turnSchema }),
})

export const turnFailedEventSchema = aideEventBaseSchema.extend({
  type: z.literal("turn.failed"),
  data: z.object({ turn: turnSchema }),
})

export const requestOpenedEventSchema = aideEventBaseSchema.extend({
  type: z.literal("request.opened"),
  data: z.object({ request: requestSchema }),
})

export const requestResolvedEventSchema = aideEventBaseSchema.extend({
  type: z.literal("request.resolved"),
  data: z.object({ request: requestSchema }),
})

export const requestCancelledEventSchema = aideEventBaseSchema.extend({
  type: z.literal("request.cancelled"),
  data: z.object({ request: requestSchema }),
})

export const harnessInstanceStartingEventSchema = aideEventBaseSchema.extend({
  type: z.literal("harness.instance_starting"),
  data: z.object({}),
})

export const harnessConnectedEventSchema = aideEventBaseSchema.extend({
  type: z.literal("harness.connected"),
  data: z.object({
    version: z.string().min(1).optional(),
  }),
})

export const harnessDisconnectedEventSchema = aideEventBaseSchema.extend({
  type: z.literal("harness.disconnected"),
  data: z.object({
    reason: z.string().min(1).optional(),
  }),
})

export const harnessReconnectingEventSchema = aideEventBaseSchema.extend({
  type: z.literal("harness.reconnecting"),
  data: z.object({
    attempt: z.number().int().nonnegative(),
  }),
})

export const harnessInstanceFailedEventSchema = aideEventBaseSchema.extend({
  type: z.literal("harness.instance_failed"),
  data: z.object({
    error: aideErrorSchema,
  }),
})

export const harnessInventoryUpdatedEventSchema = aideEventBaseSchema.extend({
  type: z.literal("harness.inventory_updated"),
  data: z.object({
    inventory: harnessInventorySchema,
  }),
})

export const harnessInventoryFailedEventSchema = aideEventBaseSchema.extend({
  type: z.literal("harness.inventory_failed"),
  data: z.object({
    error: aideErrorSchema,
  }),
})

export const harnessAuthChangedEventSchema = aideEventBaseSchema.extend({
  type: z.literal("harness.auth_changed"),
  data: z.object({
    auth: instanceAuthSchema,
  }),
})

export const harnessMcpStatusChangedEventSchema = aideEventBaseSchema.extend({
  type: z.literal("harness.mcp_status_changed"),
  data: z.object({
    servers: z.array(mcpServerStatusSchema),
  }),
})

export const configUpdatedEventSchema = aideEventBaseSchema.extend({
  type: z.literal("config.updated"),
  data: z.object({
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("global") }),
      z.object({ kind: z.literal("project"), projectId: idSchema }),
    ]),
  }),
})

export const noticeCreatedEventSchema = aideEventBaseSchema.extend({
  type: z.literal("notice.created"),
  data: z.object({
    title: z.string().min(1),
    message: z.string().min(1),
    level: z.enum(["info", "warning", "error"]).optional(),
  }),
})

export const errorOccurredEventSchema = aideEventBaseSchema.extend({
  type: z.literal("error.occurred"),
  data: z.object({
    error: aideErrorSchema,
  }),
})

const SESSION_EVENT_TYPES = [
  "part.upserted",
  "part.delta",
  "part.removed",
  "message.upserted",
  "turn.queued",
  "turn.started",
  "turn.completed",
  "turn.interrupted",
  "turn.failed",
  "request.opened",
  "request.resolved",
  "request.cancelled",
] as const

const INSTANCES_EVENT_TYPES = [
  "harness.instance_starting",
  "harness.connected",
  "harness.disconnected",
  "harness.reconnecting",
  "harness.instance_failed",
  "harness.inventory_updated",
  "harness.inventory_failed",
  "harness.auth_changed",
  "harness.mcp_status_changed",
  "config.updated",
] as const

export const aideEventSchema = z
  .discriminatedUnion("type", [
    partUpsertedEventSchema,
    partDeltaEventSchema,
    partRemovedEventSchema,
    messageUpsertedEventSchema,
    turnQueuedEventSchema,
    turnStartedEventSchema,
    turnCompletedEventSchema,
    turnInterruptedEventSchema,
    turnFailedEventSchema,
    requestOpenedEventSchema,
    requestResolvedEventSchema,
    requestCancelledEventSchema,
    harnessInstanceStartingEventSchema,
    harnessConnectedEventSchema,
    harnessDisconnectedEventSchema,
    harnessReconnectingEventSchema,
    harnessInstanceFailedEventSchema,
    harnessInventoryUpdatedEventSchema,
    harnessInventoryFailedEventSchema,
    harnessAuthChangedEventSchema,
    harnessMcpStatusChangedEventSchema,
    configUpdatedEventSchema,
    noticeCreatedEventSchema,
    errorOccurredEventSchema,
  ])
  .superRefine((event, ctx) => {
    if (event.type === "part.delta" && event.delivery.durable) {
      ctx.addIssue({
        code: "custom",
        message: "part.delta must use ephemeral delivery",
        path: ["delivery"],
      })
    }

    if (
      (SESSION_EVENT_TYPES as readonly string[]).includes(event.type) &&
      event.scope.kind !== "session"
    ) {
      ctx.addIssue({
        code: "custom",
        message: `${event.type} must use session scope`,
        path: ["scope", "kind"],
      })
    }

    if (
      (INSTANCES_EVENT_TYPES as readonly string[]).includes(event.type) &&
      event.scope.kind !== "instances"
    ) {
      ctx.addIssue({
        code: "custom",
        message: `${event.type} must use instances scope`,
        path: ["scope", "kind"],
      })
    }
  })

export type AideEvent = z.infer<typeof aideEventSchema>
