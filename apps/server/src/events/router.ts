import { Hono } from "hono"
import { streamSSE } from "hono/streaming"

import type { EventService } from "./service"
import { SnapshotNotFoundError, type SnapshotService } from "./snapshot"
import { eventSseFrame, snapshotSseFrame } from "./sse"

function afterSequence(c: {
  req: { query(name: string): string | undefined }
}): number | undefined {
  const value = c.req.query("afterSequence") ?? "0"
  if (!/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

export function createEventRouter({
  eventService,
  snapshotService,
  maxReplay = 500,
}: {
  eventService: EventService
  snapshotService: SnapshotService
  maxReplay?: number
}): Hono {
  const router = new Hono()

  router.get("/sessions/:id", (c) => {
    try {
      return c.json(snapshotService.sessionSnapshot(c.req.param("id")))
    } catch (error) {
      if (error instanceof SnapshotNotFoundError) {
        return c.json({ error: "session_not_found" }, 404)
      }
      throw error
    }
  })

  router.get("/sessions/:id/events", (c) => {
    const after = afterSequence(c)
    if (after === undefined) {
      return c.json({ error: "invalid_after_sequence" }, 400)
    }

    const sessionId = c.req.param("id")
    try {
      snapshotService.sessionSnapshot(sessionId)
    } catch (error) {
      if (error instanceof SnapshotNotFoundError) {
        return c.json({ error: "session_not_found" }, 404)
      }
      throw error
    }

    const scope = { kind: "session" as const, sessionId }
    const subscription = eventService.subscribe(scope)
    let replay
    try {
      replay = eventService.replayOrSnapshot({
        scope,
        afterSequence: after,
        maxReplay,
        snapshot: () => snapshotService.sessionSnapshot(sessionId),
      })
    } catch (error) {
      void subscription.return()
      throw error
    }

    return streamSSE(c, async (stream) => {
      stream.onAbort(() => {
        void subscription.return()
      })
      try {
        if (replay.mode === "snapshot") {
          await stream.write(snapshotSseFrame(replay.snapshot))
        } else {
          for (const event of replay.events) {
            await stream.write(eventSseFrame(event))
          }
        }

        const replayBoundary = replay.cursor.sequence
        for await (const event of subscription) {
          if (
            event.delivery.durable &&
            event.delivery.sequence <= replayBoundary
          ) {
            continue
          }
          await stream.write(eventSseFrame(event))
        }
      } finally {
        await subscription.return()
      }
    })
  })

  router.get("/instances/events", (c) => {
    const after = afterSequence(c)
    if (after === undefined) {
      return c.json({ error: "invalid_after_sequence" }, 400)
    }

    const scope = { kind: "instances" as const }
    const subscription = eventService.subscribe(scope)
    let replay
    try {
      replay = eventService.replayOrSnapshot({
        scope,
        afterSequence: after,
        maxReplay,
        snapshot: () => snapshotService.instancesSnapshot(),
      })
    } catch (error) {
      void subscription.return()
      throw error
    }

    return streamSSE(c, async (stream) => {
      stream.onAbort(() => {
        void subscription.return()
      })
      try {
        if (replay.mode === "snapshot") {
          await stream.write(snapshotSseFrame(replay.snapshot))
        } else {
          for (const event of replay.events) {
            await stream.write(eventSseFrame(event))
          }
        }

        const replayBoundary = replay.cursor.sequence
        for await (const event of subscription) {
          if (
            event.delivery.durable &&
            event.delivery.sequence <= replayBoundary
          ) {
            continue
          }
          await stream.write(eventSseFrame(event))
        }
      } finally {
        await subscription.return()
      }
    })
  })

  return router
}
