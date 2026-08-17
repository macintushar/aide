import { randomUUID } from "node:crypto"

import type {
  AideConfig,
  Command,
  InstanceConfig,
  ProjectConfigRecord,
} from "@workspace/contracts"

type ConfigUpdateCommand = Extract<Command, { name: "config.update" }>

import type { AideDb } from "../db"
import { configRepo, withTransaction } from "../db"
import type { EventService } from "../events"
import { restoreRedactedMcpServers } from "../mcp"
import {
  emptyGlobalConfig,
  mergeConfig,
  type DriverConfigValidator,
  type EffectiveConfig,
  type InstanceValidationFailure,
} from "./merge"
import {
  defaultResolutionEnvironment,
  resolveConfigPaths,
  type ResolutionEnvironment,
} from "./paths"

/**
 * The configuration surface of the server.
 *
 * The UI is the only writer and reaches this through the `config.update`
 * command, which carries a durable receipt from the dispatcher. There are no
 * configuration files anywhere — not in the repository, not in `~/.aide`.
 */

export type ConfigTargetInput =
  | { kind: "global" }
  | { kind: "project"; projectId: string }

export type ConfigChangeListener = (
  effective: EffectiveConfig,
  target: ConfigTargetInput
) => void | Promise<void>

export type ConfigServiceOptions = {
  db: AideDb
  eventService?: EventService
  environment?: ResolutionEnvironment
  /** Validates each instance's driver-specific `config` against its adapter. */
  validateDriverConfig?: DriverConfigValidator
  now?: () => string
  id?: () => string
}

export class ConfigService {
  readonly #db: AideDb
  readonly #eventService: EventService | undefined
  readonly #environment: ResolutionEnvironment
  readonly #validateDriverConfig: DriverConfigValidator | undefined
  readonly #now: () => string
  readonly #id: () => string
  readonly #listeners = new Set<ConfigChangeListener>()

  constructor({
    db,
    eventService,
    environment,
    validateDriverConfig,
    now = () => new Date().toISOString(),
    id = () => `event_${randomUUID()}`,
  }: ConfigServiceOptions) {
    this.#db = db
    this.#eventService = eventService
    this.#environment = environment ?? defaultResolutionEnvironment()
    this.#validateDriverConfig = validateDriverConfig
    this.#now = now
    this.#id = id
  }

  globalConfig(): AideConfig {
    return configRepo.get(this.#db, { kind: "global" }) ?? emptyGlobalConfig()
  }

  projectConfig(projectId: string): ProjectConfigRecord | undefined {
    return configRepo.get(this.#db, { kind: "project", projectId })
  }

  /**
   * Assembles the effective configuration, then applies deferred path
   * resolution. Deterministic for a given pair of records, which is what makes
   * a recompute after `config.update` equal to boot.
   */
  effective(projectId?: string): EffectiveConfig {
    const merged = mergeConfig({
      global: this.globalConfig(),
      project: projectId ? this.projectConfig(projectId) : undefined,
      ...(this.#validateDriverConfig
        ? { validateDriverConfig: this.#validateDriverConfig }
        : {}),
    })
    return resolveConfigPaths(merged, this.#environment)
  }

  onChange(listener: ConfigChangeListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /**
   * Applies a validated `config.update`. The record write and the durable
   * `config.updated` event land in the same transaction so a reader never sees
   * one without the other.
   */
  async update(command: ConfigUpdateCommand): Promise<EffectiveConfig> {
    const target: ConfigTargetInput =
      command.target.kind === "global"
        ? { kind: "global" }
        : { kind: "project", projectId: command.target.projectId }

    const timestamp = this.#now()

    const persisted = withTransaction(this.#db, (tx) => {
      if (target.kind === "global") {
        const current = configRepo.get(tx, { kind: "global" })
        const next: AideConfig = {
          ...(command.config.projectsDirectory === undefined
            ? current?.projectsDirectory === undefined
              ? {}
              : { projectsDirectory: current.projectsDirectory }
            : { projectsDirectory: command.config.projectsDirectory }),
          instances:
            restoreRedactedInstanceMcpServers(
              command.config.instances,
              current?.instances
            ) ??
            current?.instances ??
            {},
          mcpServers:
            restoreRedactedMcpServers(
              command.config.mcpServers,
              current?.mcpServers
            ) ??
            current?.mcpServers ??
            {},
          defaults: command.config.defaults ?? current?.defaults ?? {},
        }
        configRepo.put(tx, next, timestamp)
      } else {
        const current = configRepo.get(tx, {
          kind: "project",
          projectId: target.projectId,
        })
        const next: ProjectConfigRecord = {
          projectId: target.projectId,
          ...pickDefined({
            projectsDirectory:
              command.config.projectsDirectory ?? current?.projectsDirectory,
            instances:
              restoreRedactedInstanceMcpServers(
                command.config.instances,
                current?.instances
              ) ?? current?.instances,
            mcpServers:
              restoreRedactedMcpServers(
                command.config.mcpServers,
                current?.mcpServers
              ) ?? current?.mcpServers,
            defaults: command.config.defaults ?? current?.defaults,
          }),
        }
        configRepo.put(tx, next, timestamp)
      }

      const event = this.#eventService?.persistDurable(tx, {
        schemaVersion: 1,
        eventId: this.#id(),
        timestamp,
        scope: { kind: "instances" },
        type: "config.updated",
        data: { target: command.target },
      })
      return event
    })

    const effective = this.effective(
      target.kind === "project" ? target.projectId : undefined
    )

    // Per-instance validation isolation: a malformed instance disables only
    // itself and surfaces a notice. It never blocks the update, the server, or
    // any other instance.
    this.emitInstanceFailures(effective.failures)

    for (const listener of this.#listeners) {
      await listener(effective, target)
    }

    // Persistence remains atomic with the config write, but live consumers only
    // hear about it once refetching can observe reconciled supervisor state.
    if (persisted) {
      this.#eventService?.broadcastDurable(persisted)
    }

    return effective
  }

  /** Emits `harness.instance_failed` for every instance that failed validation. */
  emitInstanceFailures(failures: readonly InstanceValidationFailure[]): void {
    if (!this.#eventService) return
    for (const failure of failures) {
      this.#eventService.appendDurable({
        schemaVersion: 1,
        eventId: this.#id(),
        timestamp: this.#now(),
        scope: { kind: "instances" },
        instanceId: failure.instanceId,
        type: "harness.instance_failed",
        data: { error: failure.error },
      })
    }
  }
}

function restoreRedactedInstanceMcpServers(
  instances: Record<string, InstanceConfig> | undefined,
  current: Record<string, InstanceConfig> | undefined
): Record<string, InstanceConfig> | undefined {
  if (!instances) return undefined
  return Object.fromEntries(
    Object.entries(instances).map(([instanceId, instance]) => [
      instanceId,
      {
        ...instance,
        ...(instance.mcpServers
          ? {
              mcpServers: restoreRedactedMcpServers(
                instance.mcpServers,
                current?.[instanceId]?.mcpServers
              ),
            }
          : {}),
      },
    ])
  )
}

function pickDefined<T extends Record<string, unknown>>(
  value: T
): { [K in keyof T]?: NonNullable<T[K]> } {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as { [K in keyof T]?: NonNullable<T[K]> }
}
