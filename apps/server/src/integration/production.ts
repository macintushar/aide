import { randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

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
  bootstrapToken?: string
  serve?: ProductionServe
  secrets?: ConfigSecrets
}

function defaultServe(input: Parameters<ProductionServe>[0]) {
  return Bun.serve(input)
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
  const bootstrapToken = options.bootstrapToken ?? generateBootstrapToken()
  const integration = createCoreIntegration({
    db,
    adapters,
    auth: {
      bootstrapToken,
      allowedOrigins: loopbackOrigins(port),
    },
    // Serving the built UI from this origin is what makes the logged
    // sign-in URL work; without a build present, stay API-only.
    ...(webDistRoot() ? { staticRoot: webDistRoot() } : {}),
    configSecrets: secrets,
    trackWorkspaceChanges: true,
  })
  return { integration, bootstrapToken, ownsDb: options.db === undefined }
}

/** Built web app next to the server package, when it has been built. */
function webDistRoot(): string | undefined {
  const dist = fileURLToPath(new URL("../../../web/dist", import.meta.url))
  return existsSync(dist) ? dist : undefined
}

/**
 * The bootstrap credential is generated fresh every boot and surfaced in the
 * logs as a one-click URL; it never lives in the environment.
 */
function generateBootstrapToken(): string {
  return randomBytes(32).toString("hex")
}

export function bootstrapUrl(hostname: string, port: number, token: string) {
  return `http://${hostname === "0.0.0.0" ? "127.0.0.1" : hostname}:${port}/?authToken=${token}`
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
  const { integration, bootstrapToken, ownsDb } =
    createProductionIntegration(options)
  const serve = options.serve ?? defaultServe

  // Binding is deliberately the first lifecycle action: health/config reads are
  // available while independently supervised harnesses are still starting.
  const http = serve({
    hostname,
    port,
    fetch: (request) => integration.app.fetch(request),
  })

  console.log(
    `[aide] ready — open ${bootstrapUrl(hostname, port, bootstrapToken)} to sign in`
  )

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
