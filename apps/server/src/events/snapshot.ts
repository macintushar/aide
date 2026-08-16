import {
  instancesSnapshotSchema,
  sessionSnapshotSchema,
  type HarnessInventory,
  type InstancesSnapshot,
  type SessionSnapshot,
} from "@workspace/contracts"

import type { AideDb } from "../db"
import {
  configRepo,
  eventLogRepo,
  inventoryCacheRepo,
  messagesRepo,
  projectsRepo,
  requestsRepo,
  sessionsRepo,
  turnsRepo,
} from "../db"

export class SnapshotNotFoundError extends Error {
  readonly resource: "project" | "session"
  readonly id: string

  constructor(resource: "project" | "session", id: string) {
    super(`${resource} ${id} was not found`)
    this.name = "SnapshotNotFoundError"
    this.resource = resource
    this.id = id
  }
}

export class SnapshotService {
  readonly #db: AideDb

  constructor(db: AideDb) {
    this.#db = db
  }

  sessionSnapshot(sessionId: string): SessionSnapshot {
    const session = sessionsRepo.get(this.#db, sessionId)
    if (!session) throw new SnapshotNotFoundError("session", sessionId)
    const project = projectsRepo.get(this.#db, session.projectId)
    if (!project) throw new SnapshotNotFoundError("project", session.projectId)

    return sessionSnapshotSchema.parse({
      schemaVersion: 1,
      scope: {
        kind: "session",
        projectId: project.id,
        sessionId: session.id,
      },
      cursor: {
        sequence: Math.max(
          0,
          eventLogRepo.latestSequence(this.#db, {
            kind: "session",
            sessionId,
          })
        ),
      },
      project,
      session,
      messages: messagesRepo.listBySession(this.#db, sessionId),
      turns: turnsRepo.listBySession(this.#db, sessionId),
      requests: requestsRepo.listBySession(this.#db, sessionId),
    })
  }

  instancesSnapshot(): InstancesSnapshot {
    const config = configRepo.get(this.#db, { kind: "global" })
    const inventories = new Map<string, HarnessInventory>()
    for (const inventory of inventoryCacheRepo.list(this.#db)) {
      if (!inventories.has(inventory.instanceId)) {
        inventories.set(inventory.instanceId, inventory)
      }
    }

    const instanceIds = new Set([
      ...Object.keys(config?.instances ?? {}),
      ...inventories.keys(),
    ])
    const instances = [...instanceIds].sort().map((instanceId) => {
      const configured = config?.instances[instanceId]
      const inventory = inventories.get(instanceId)
      const driver = configured?.driver ?? inventory?.driver
      if (!driver) {
        throw new Error(`Instance ${instanceId} has no driver`)
      }
      return {
        instanceId,
        driver,
        displayName: configured?.displayName,
        enabled: configured?.enabled ?? false,
        autoStart: configured?.autoStart ?? false,
        status: inventory?.stale
          ? ("degraded" as const)
          : ("configured" as const),
        auth: inventory?.auth ?? { status: "unknown" as const },
        inventory,
      }
    })

    return instancesSnapshotSchema.parse({
      schemaVersion: 1,
      scope: { kind: "instances" },
      cursor: {
        sequence: Math.max(
          0,
          eventLogRepo.latestSequence(this.#db, { kind: "instances" })
        ),
      },
      instances,
    })
  }
}
