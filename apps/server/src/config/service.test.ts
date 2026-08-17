import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import type { AideEvent, Command } from "@workspace/contracts"

import type { AideDb } from "../db"
import { configRepo } from "../db"
import { EventService } from "../events"
import { REDACTED } from "../mcp"
import type { Database } from "../db/test/bun-sqlite-shim"
import { createTestDb } from "../test/db"
import { createDriverConfigValidator } from "./driver-config"
import { ConfigService } from "./service"
import type { ResolutionEnvironment } from "./paths"

type ConfigUpdateCommand = Extract<Command, { name: "config.update" }>

const environment: ResolutionEnvironment = {
  homeDirectory: "/home/dev",
  variables: {},
  baseDirectory: "/work/repo",
}

function updateCommand(
  overrides: Partial<ConfigUpdateCommand> = {}
): ConfigUpdateCommand {
  return {
    commandId: "cmd_config_0001",
    name: "config.update",
    target: { kind: "global" },
    config: {},
    ...overrides,
  } as ConfigUpdateCommand
}

describe("ConfigService", () => {
  let client: Database
  let db: AideDb
  let eventService: EventService
  let service: ConfigService
  let eventId = 0

  beforeEach(() => {
    const created = createTestDb()
    client = created.client
    db = created.db
    eventService = new EventService(db)
    eventId = 0
    service = new ConfigService({
      db,
      eventService,
      environment,
      now: () => "2026-01-01T00:00:00.000Z",
      id: () => `event_${String(++eventId).padStart(4, "0")}`,
    })
  })

  afterEach(() => client.close())

  it("starts from an empty global record rather than requiring one to exist", () => {
    expect(service.globalConfig()).toEqual({
      instances: {},
      mcpServers: {},
      defaults: {},
    })
    expect(service.effective().instances).toEqual({})
  })

  it("persists a global update and emits config.updated durably", async () => {
    await service.update(
      updateCommand({
        config: {
          instances: {
            opencode: {
              instanceId: "opencode",
              driver: "opencode",
              enabled: true,
              autoStart: true,
              config: {},
            },
          },
        },
      })
    )

    expect(
      configRepo.get(db, { kind: "global" })?.instances.opencode
    ).toBeDefined()

    const replay = eventService.replayOrSnapshot({
      scope: { kind: "instances" },
      afterSequence: 0,
      maxReplay: 100,
      snapshot: () => undefined,
    })
    const types = (replay.mode === "events" ? replay.events : []).map(
      (event: AideEvent) => event.type
    )
    expect(types).toContain("config.updated")
  })

  it("merges partial updates instead of replacing the whole record", async () => {
    await service.update(
      updateCommand({ config: { projectsDirectory: "~/projects" } })
    )
    await service.update(
      updateCommand({
        config: {
          instances: {
            claude: {
              instanceId: "claude",
              driver: "claudeAgent",
              enabled: true,
              autoStart: false,
              config: {},
            },
          },
        },
      })
    )

    const global = service.globalConfig()
    expect(global.projectsDirectory).toBe("~/projects")
    expect(Object.keys(global.instances)).toEqual(["claude"])
  })

  it("writes a project record separately from the global one", async () => {
    await service.update(
      updateCommand({
        target: { kind: "project", projectId: "proj_0001" },
        config: { projectsDirectory: "/project-only" },
      })
    )

    expect(service.globalConfig().projectsDirectory).toBeUndefined()
    expect(service.projectConfig("proj_0001")?.projectsDirectory).toBe(
      "/project-only"
    )
    expect(service.effective("proj_0001").projectsDirectory).toBe(
      "/project-only"
    )
  })

  it("preserves redacted MCP secrets when a config form is saved", async () => {
    await service.update(
      updateCommand({
        config: {
          mcpServers: {
            global: {
              type: "stdio",
              command: "global-mcp",
              env: { TOKEN: "global-secret", REGION: "us-east-1" },
            },
          },
          instances: {
            opencode: {
              instanceId: "opencode",
              driver: "opencode",
              enabled: true,
              autoStart: true,
              config: {},
              mcpServers: {
                instance: {
                  type: "http",
                  url: "https://instance.example.test",
                  headers: { Authorization: "instance-secret" },
                },
              },
            },
          },
        },
      })
    )
    await service.update(
      updateCommand({
        config: {
          mcpServers: {
            global: {
              type: "stdio",
              command: "global-mcp",
              env: { TOKEN: REDACTED, REGION: "eu-west-1" },
            },
          },
          instances: {
            opencode: {
              instanceId: "opencode",
              driver: "opencode",
              enabled: true,
              autoStart: true,
              config: {},
              mcpServers: {
                instance: {
                  type: "http",
                  url: "https://instance.example.test",
                  headers: { Authorization: REDACTED },
                },
              },
            },
          },
        },
      })
    )

    expect(service.globalConfig()).toMatchObject({
      mcpServers: {
        global: {
          env: { TOKEN: "global-secret", REGION: "eu-west-1" },
        },
      },
      instances: {
        opencode: {
          mcpServers: {
            instance: { headers: { Authorization: "instance-secret" } },
          },
        },
      },
    })

    await service.update(
      updateCommand({
        target: { kind: "project", projectId: "proj_0001" },
        config: {
          mcpServers: {
            project: {
              type: "sse",
              url: "https://project.example.test/sse",
              headers: { "X-Token": "project-secret" },
            },
          },
          instances: {
            claude: {
              instanceId: "claude",
              driver: "claudeAgent",
              enabled: true,
              autoStart: false,
              config: {},
              mcpServers: {
                instance: {
                  type: "stdio",
                  command: "project-mcp",
                  env: { TOKEN: "project-instance-secret" },
                },
              },
            },
          },
        },
      })
    )
    await service.update(
      updateCommand({
        target: { kind: "project", projectId: "proj_0001" },
        config: {
          mcpServers: {
            project: {
              type: "sse",
              url: "https://project.example.test/sse",
              headers: { "X-Token": REDACTED },
            },
          },
          instances: {
            claude: {
              instanceId: "claude",
              driver: "claudeAgent",
              enabled: true,
              autoStart: false,
              config: {},
              mcpServers: {
                instance: {
                  type: "stdio",
                  command: "project-mcp",
                  env: { TOKEN: REDACTED },
                },
              },
            },
          },
        },
      })
    )

    expect(service.projectConfig("proj_0001")).toMatchObject({
      mcpServers: { project: { headers: { "X-Token": "project-secret" } } },
      instances: {
        claude: {
          mcpServers: {
            instance: { env: { TOKEN: "project-instance-secret" } },
          },
        },
      },
    })
  })

  it("disables only the instance whose driver config is invalid, and reports it", async () => {
    // The record schemas validate `instances` wholesale, so the realistic
    // malformed instance is one whose driver-specific `config` its adapter
    // rejects. Anything the adapter accepts stays enabled.
    const strict = new ConfigService({
      db,
      eventService,
      environment,
      validateDriverConfig: createDriverConfigValidator((driver) =>
        driver === "opencode"
          ? (z.strictObject({
              port: z.number(),
            }) as unknown as StandardSchemaV1)
          : undefined
      ),
      now: () => "2026-01-01T00:00:00.000Z",
      id: () => `event_${String(++eventId).padStart(4, "0")}`,
    })

    const effective = await strict.update(
      updateCommand({
        config: {
          instances: {
            good: {
              instanceId: "good",
              driver: "opencode",
              enabled: true,
              autoStart: true,
              config: { port: 4096 },
            },
            broken: {
              instanceId: "broken",
              driver: "opencode",
              enabled: true,
              autoStart: true,
              config: { port: "not-a-number" },
            },
            noDriver: {
              instanceId: "noDriver",
              driver: "claudeAgent",
              enabled: true,
              autoStart: true,
              config: {},
            },
          },
        },
      })
    )

    expect(Object.keys(effective.instances)).toEqual(["good"])
    expect(
      effective.failures.map((failure) => failure.instanceId).sort()
    ).toEqual(["broken", "noDriver"])

    const replay = eventService.replayOrSnapshot({
      scope: { kind: "instances" },
      afterSequence: 0,
      maxReplay: 100,
      snapshot: () => undefined,
    })
    const failed = (replay.mode === "events" ? replay.events : []).filter(
      (event: AideEvent) => event.type === "harness.instance_failed"
    )
    expect(failed.map((event: AideEvent) => event.instanceId).sort()).toEqual([
      "broken",
      "noDriver",
    ])
  })

  it("notifies change listeners with the recomputed effective config", async () => {
    const seen: string[][] = []
    service.onChange((effective) => {
      seen.push(Object.keys(effective.instances))
    })

    await service.update(
      updateCommand({
        config: {
          instances: {
            opencode: {
              instanceId: "opencode",
              driver: "opencode",
              enabled: true,
              autoStart: true,
              config: {},
            },
          },
        },
      })
    )

    expect(seen).toEqual([["opencode"]])
  })

  it("broadcasts config.updated only after change listeners finish", async () => {
    const order: string[] = []
    service.onChange(async () => {
      await Promise.resolve()
      order.push("reconciled")
    })
    const subscription = eventService.subscribe({ kind: "instances" })
    const broadcast = subscription.next().then((result) => {
      expect(result.value?.type).toBe("config.updated")
      order.push("broadcast")
    })

    await service.update(updateCommand())
    await broadcast

    expect(order).toEqual(["reconciled", "broadcast"])
    await subscription.return()
  })

  it("recomputes after an update to the same value boot would produce", async () => {
    await service.update(
      updateCommand({
        config: {
          projectsDirectory: "~/projects",
          instances: {
            opencode: {
              instanceId: "opencode",
              driver: "opencode",
              enabled: true,
              autoStart: true,
              config: {},
              mcpServers: {
                local: { type: "stdio", command: "./bin/mcp" },
              },
            },
          },
          mcpServers: { remote: { type: "http", url: "https://example.test" } },
        },
      })
    )

    const afterUpdate = service.effective()

    // A fresh service over the same records is exactly what boot does.
    const rebooted = new ConfigService({
      db,
      environment,
      now: () => "2026-01-01T00:00:00.000Z",
    })
    expect(rebooted.effective()).toEqual(afterUpdate)
    expect(afterUpdate.projectsDirectory).toBe("/home/dev/projects")
  })
})
