import { Hono } from "hono"

import { createCommandDispatcher, createCommandRouter } from "../commands"
import type { AideDb } from "../db"
import { createEventRouter, EventService, SnapshotService } from "../events"
import { createCommandGuard } from "../security/command-guard"
import {
  AdapterRegistry,
  createCoreCommandHandlers,
  ExecutionResolver,
  ProjectService,
  TurnService,
} from "../services"

export type CoreIntegrationOptions = {
  db: AideDb
  registry?: AdapterRegistry
  bearerToken?: string
  allowedOrigins?: string[]
  now?: () => string
  id?: (
    kind: "project" | "session" | "turn" | "message" | "part" | "event"
  ) => string
}

export function createAideTestApp(options: CoreIntegrationOptions) {
  const registry = options.registry ?? new AdapterRegistry()
  const eventService = new EventService(options.db)
  const snapshotService = new SnapshotService(options.db)
  const projects = new ProjectService({
    db: options.db,
    now: options.now,
    id: options.id,
  })
  const executionResolver = new ExecutionResolver(options.db, registry)
  const turns = new TurnService({
    db: options.db,
    registry,
    executionResolver,
    eventService,
    now: options.now,
    id: options.id,
  })
  const dispatcher = createCommandDispatcher({
    db: options.db,
    handlers: createCoreCommandHandlers({ projects, turns }),
    now: options.now,
  })

  const app = new Hono()
  if (options.bearerToken) {
    app.use(
      "/commands/*",
      createCommandGuard({
        bearerToken: options.bearerToken,
        allowedOrigins: options.allowedOrigins ?? [],
      })
    )
  }
  app.route("/", createCommandRouter({ dispatcher }))
  app.route("/", createEventRouter({ eventService, snapshotService }))

  return {
    app,
    db: options.db,
    registry,
    dispatcher,
    eventService,
    snapshotService,
    services: { projects, turns, executionResolver },
  }
}

export const createCoreIntegration = createAideTestApp
