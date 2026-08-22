import { dirname, join } from "node:path"

import {
  closeDb,
  getDb,
  loadConfigSecrets,
  type AideDb,
  type ConfigSecrets,
} from "../db"
import { env } from "../env"
import { createClaudeAdapter } from "../harness/claude"
import { createOpencodeAdapter } from "../harness/opencode"
import type { HarnessAdapter } from "../harness/types"
import { loopbackOrigins } from "../security/loopback"
import { createCoreIntegration } from "./app"

export type ProductionHttpServer = {
  stop(closeActiveConnections?: boolean): void | Promise<void>
}

export type ProductionServe = (input: {
  hostname: string
  port: number
  fetch(request: Request): Response | Promise<Response>
}) => ProductionHttpServer

export type ProductionServerOptions = {
  db?: AideDb
  adapters?: HarnessAdapter[]
  hostname?: string
  port?: number
  bearerToken?: string
  allowedOrigins?: string[]
  serve?: ProductionServe
  secrets?: ConfigSecrets
}

function defaultServe(input: Parameters<ProductionServe>[0]) {
  return Bun.serve({
    ...input,
    // Session and instance SSE stay open; Bun's default 10s idle timeout 502s them.
    idleTimeout: 0,
  })
}

/** Builds the production core without binding a port or starting instances. */
export function createProductionIntegration(
  options: ProductionServerOptions = {}
) {
  const db = options.db ?? getDb()
  const adapters = options.adapters ?? [
    createOpencodeAdapter(),
    createClaudeAdapter(),
  ]
  const port = options.port ?? env.PORT
  const secrets = options.secrets ?? loadConfigSecrets(secretsKeyPath())
  const integration = createCoreIntegration({
    db,
    adapters,
    bearerToken: options.bearerToken ?? env.AIDE_BEARER_TOKEN,
    allowedOrigins: options.allowedOrigins ?? loopbackOrigins(port),
    configSecrets: secrets,
    trackWorkspaceChanges: true,
  })
  return { integration, ownsDb: options.db === undefined }
}

function secretsKeyPath(): string {
  return env.DB_FILE_NAME === ":memory:"
    ? "aide-config.key"
    : join(dirname(env.DB_FILE_NAME), "aide-config.key")
}

export async function startProductionServer(
  options: ProductionServerOptions = {}
) {
  const hostname = options.hostname ?? env.HOST
  const port = options.port ?? env.PORT
  const { integration, ownsDb } = createProductionIntegration(options)
  const serve = options.serve ?? defaultServe

  // Binding is deliberately the first lifecycle action: health/config reads are
  // available while independently supervised harnesses are still starting.
  const http = serve({
    hostname,
    port,
    fetch: (request) => integration.app.fetch(request),
  })

  const effective = integration.services.config.effective()
  integration.services.config.emitInstanceFailures(effective.failures)
  integration.supervisor.boot(effective)
  await integration.services.turns.reconcileRunningTurns()

  let shutdownPromise: Promise<void> | undefined
  const shutdown = () => {
    shutdownPromise ??= (async () => {
      await Promise.resolve(http.stop(false))
      await integration.supervisor.shutdown()
      if (ownsDb) closeDb()
    })()
    return shutdownPromise
  }

  return {
    ...integration,
    hostname,
    port,
    http,
    shutdown,
  }
}

export async function runProductionServer(
  options: ProductionServerOptions = {}
) {
  const server = await startProductionServer(options)
  const shutdown = () => {
    void server.shutdown()
  }
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
  return server
}
