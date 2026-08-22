import { Hono } from "hono"

import { createCommandDispatcher, createCommandRouter } from "../commands"
import {
  ConfigService,
  createConfigRouter,
  createDriverConfigValidator,
  type ResolutionEnvironment,
} from "../config"
import type { AideDb, ConfigSecrets } from "../db"
import { createEventRouter, EventService, SnapshotService } from "../events"
import type { HarnessAdapter } from "../harness/types"
import { InventoryService } from "../inventory"
import {
  createBootstrapHandler,
  createSessionAuth,
  createSessionGuard,
  type SessionAuth,
} from "../security/session-auth"
import { createDbTokenStore } from "../security/db-token-store"
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
import { SessionChangesTracker } from "../workspace/changes"

export type CoreIntegrationOptions = {
  db: AideDb
  registry?: AdapterRegistry
  /**
   * Route-class auth. Present = /auth/session plus session-guarded data
   * routes; absent = fully open (tests). The bootstrap token, when given,
   * is the boot-generated credential surfaced in server logs.
   */
  auth?: {
    bootstrapToken?: string
    allowedOrigins?: string[]
  }
  /** Driver implementations available to the supervisor. */
  adapters?: HarnessAdapter[]
  /** Project directory used for directory-scoped inventory. */
  projectDirectory?: string
  configEnvironment?: ResolutionEnvironment
  backoff?: BackoffPolicy
  now?: () => string
  id?: (
    kind:
      | "project"
      | "session"
      | "turn"
      | "message"
      | "part"
      | "event"
      | "dispatchInput"
      | "artifact"
  ) => string
  handoffMaxCharacters?: number
  toolOutputMaxCharacters?: number
  configSecrets?: ConfigSecrets
  /**
   * Records which files each turn changes. Off by default because it shells
   * out to git on every turn boundary; production turns it on.
   */
  trackWorkspaceChanges?: boolean
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
  const changes = options.trackWorkspaceChanges
    ? new SessionChangesTracker(
        options.db,
        options.now ? { now: options.now } : {}
      )
    : undefined
  const turns = new TurnService({
    db: options.db,
    registry,
    executionResolver,
    eventService,
    now: options.now,
    id: options.id,
    handoffMaxCharacters: options.handoffMaxCharacters,
    toolOutputMaxCharacters: options.toolOutputMaxCharacters,
    ...(changes ? { changes } : {}),
  })

  const byDriver = new Map(
    (options.adapters ?? []).map((adapter) => [adapter.driver, adapter])
  )

  const eventId = options.id ? () => options.id!("event") : undefined
  const config = new ConfigService({
    db: options.db,
    eventService,
    secrets: options.configSecrets,
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

  // The supervisor owns the global runtime; project records are persisted for
  // project-scoped execution and must not alter that shared runtime.
  config.onChange((effective, target) => {
    if (target.kind === "global") return supervisor.reconcile(effective)
  })

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
  let auth: SessionAuth | undefined
  if (options.auth) {
    auth = createSessionAuth({
      ...(options.auth.bootstrapToken !== undefined
        ? { bootstrapToken: options.auth.bootstrapToken }
        : {}),
      store: createDbTokenStore(options.db),
    })
    const allowedOrigins = options.auth.allowedOrigins ?? []
    const sessionGuard = createSessionGuard(auth, allowedOrigins)
    app.post("/auth/session", createBootstrapHandler(auth, allowedOrigins))
    app.use("/commands/*", sessionGuard)
    app.use("/config", sessionGuard)
    app.use("/projects/:projectId/config", sessionGuard)
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
    auth,
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
