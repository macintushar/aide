import { Hono } from "hono"

import { createCommandDispatcher, createCommandRouter } from "../commands"
import {
  ConfigService,
  createConfigRouter,
  createDriverConfigValidator,
  type ResolutionEnvironment,
} from "../config"
import type { AideDb } from "../db"
import { createEventRouter, EventService, SnapshotService } from "../events"
import type { HarnessAdapter } from "../harness/types"
import { InventoryService } from "../inventory"
import { createCommandGuard } from "../security/command-guard"
import {
  AdapterRegistry,
  createCoreCommandHandlers,
  ExecutionResolver,
  ProjectService,
  TurnService,
} from "../services"
import {
  createInstancesRouter,
  InstanceSupervisor,
  type BackoffPolicy,
} from "../supervisor"

export type CoreIntegrationOptions = {
  db: AideDb
  registry?: AdapterRegistry
  bearerToken?: string
  allowedOrigins?: string[]
  /** Driver implementations available to the supervisor. */
  adapters?: HarnessAdapter[]
  /** Project directory used for directory-scoped inventory. */
  projectDirectory?: string
  configEnvironment?: ResolutionEnvironment
  backoff?: BackoffPolicy
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

  const byDriver = new Map(
    (options.adapters ?? []).map((adapter) => [adapter.driver, adapter])
  )

  const eventId = options.id ? () => options.id!("event") : undefined
  const config = new ConfigService({
    db: options.db,
    eventService,
    // Each adapter validates its own driver-specific `config`, so a malformed
    // instance disables only itself.
    validateDriverConfig: createDriverConfigValidator(
      (driver) => byDriver.get(driver)?.configSchema
    ),
    ...(options.configEnvironment
      ? { environment: options.configEnvironment }
      : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(eventId ? { id: eventId } : {}),
  })
  const inventory = new InventoryService({
    db: options.db,
    eventService,
    ...(options.now ? { now: options.now } : {}),
    ...(eventId ? { id: eventId } : {}),
  })

  const supervisor = new InstanceSupervisor({
    registry,
    adapters: (driver) => byDriver.get(driver),
    inventory,
    eventService,
    ...(options.backoff ? { backoff: options.backoff } : {}),
    ...(options.projectDirectory
      ? { projectDirectory: options.projectDirectory }
      : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(eventId ? { id: eventId } : {}),
  })

  // Config change is reconciled, not restarted wholesale.
  config.onChange((effective) => supervisor.reconcile(effective))

  const dispatcher = createCommandDispatcher({
    db: options.db,
    handlers: createCoreCommandHandlers({
      projects,
      turns,
      config,
      supervisor,
      inventory,
      registry,
    }),
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
  app.route("/", createConfigRouter({ config }))
  app.route(
    "/",
    createEventRouter({
      eventService,
      snapshotService,
      instancesSnapshot: () => ({
        schemaVersion: 1,
        scope: { kind: "instances" },
        cursor: {
          sequence: eventService.latestSequence({ kind: "instances" }),
        },
        instances: supervisor.snapshot(),
      }),
    })
  )
  app.route("/", createInstancesRouter({ supervisor, eventService }))

  return {
    app,
    db: options.db,
    registry,
    dispatcher,
    eventService,
    snapshotService,
    supervisor,
    services: {
      projects,
      turns,
      executionResolver,
      config,
      inventory,
      supervisor,
    },
  }
}

export const createCoreIntegration = createAideTestApp
