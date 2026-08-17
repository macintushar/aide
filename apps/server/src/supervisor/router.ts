import { Hono } from "hono"

import type { EventService } from "../events"
import type { InstanceSupervisor } from "./supervisor"

/**
 * `GET /instances` is the initial-state read for the instances scope. Health is
 * Aide-owned state that thereafter reaches the UI as `harness.*` events on
 * `GET /instances/events` — the UI must not poll adapters, and it does not need
 * to poll this either.
 */
export function createInstancesRouter({
  supervisor,
  eventService,
}: {
  supervisor: InstanceSupervisor
  eventService: EventService
}): Hono {
  const router = new Hono()

  router.get("/instances", (c) =>
    c.json({
      schemaVersion: 1 as const,
      scope: { kind: "instances" as const },
      cursor: { sequence: eventService.latestSequence({ kind: "instances" }) },
      instances: supervisor.snapshot(),
    })
  )

  return router
}
