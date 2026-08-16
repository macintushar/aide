import { describe, expect, it } from "vitest"

import { instancesMapSchema } from "./config"
import { aideEventSchema, partDeltaEventSchema } from "./events"
import { commandNameSchema, commandSchema } from "./commands"
import { partSchema, projectSchema } from "./domain"

const timestamp = "2026-08-16T09:42:44.782Z"

describe("domain schemas", () => {
  it("parses a project", () => {
    expect(
      projectSchema.parse({
        id: "proj_1",
        name: "aide",
        directory: "/Users/tushar/projects/aide",
        createdAt: timestamp,
        lastOpenedAt: timestamp,
      })
    ).toMatchObject({ id: "proj_1", name: "aide" })
  })

  it("discriminates the five part variants", () => {
    expect(
      partSchema.parse({
        id: "part_1",
        messageId: "msg_1",
        index: 0,
        type: "text",
        text: "hello",
      }).type
    ).toBe("text")

    expect(
      partSchema.parse({
        id: "part_2",
        messageId: "msg_1",
        index: 1,
        type: "reasoning",
        text: "thinking",
      }).type
    ).toBe("reasoning")

    expect(
      partSchema.parse({
        id: "part_3",
        messageId: "msg_1",
        index: 2,
        type: "tool",
        name: "bash",
        category: "shell",
        status: "running",
      }).type
    ).toBe("tool")

    expect(
      partSchema.parse({
        id: "part_4",
        messageId: "msg_1",
        index: 3,
        type: "file",
        path: "src/index.ts",
      }).type
    ).toBe("file")

    expect(
      partSchema.parse({
        id: "part_5",
        messageId: "msg_1",
        index: 4,
        type: "agent",
        name: "explore",
      }).type
    ).toBe("agent")
  })
})

describe("configuration schemas", () => {
  it("rejects an instances map key that does not match instanceId", () => {
    const result = instancesMapSchema.safeParse({
      opencode: {
        instanceId: "claude",
        driver: "opencode",
        enabled: true,
        autoStart: true,
        config: {},
      },
    })

    expect(result.success).toBe(false)
  })

  it("accepts an instances map keyed by instanceId", () => {
    expect(
      instancesMapSchema.parse({
        opencode: {
          instanceId: "opencode",
          driver: "opencode",
          enabled: true,
          autoStart: true,
          config: {},
        },
      })
    ).toHaveProperty("opencode.instanceId", "opencode")
  })
})

describe("command schemas", () => {
  it("lists all 15 command names", () => {
    expect(commandNameSchema.options).toHaveLength(15)
  })

  it("requires commandId on every command", () => {
    const result = commandSchema.safeParse({
      name: "session.create",
      projectId: "proj_1",
    })

    expect(result.success).toBe(false)
  })

  it("parses turn.send", () => {
    expect(
      commandSchema.parse({
        name: "turn.send",
        commandId: "cmd_1",
        sessionId: "ses_1",
        content: "Build the settings panel",
        execution: {
          instanceId: "opencode",
          driver: "opencode",
          model: { modelId: "gpt-5" },
          options: {},
        },
      }).name
    ).toBe("turn.send")
  })
})

describe("event schemas", () => {
  it("rejects durable delivery on part.delta", () => {
    const result = aideEventSchema.safeParse({
      schemaVersion: 1,
      eventId: "evt_1",
      type: "part.delta",
      timestamp,
      delivery: { durable: true, sequence: 1 },
      scope: {
        kind: "session",
        projectId: "proj_1",
        sessionId: "ses_1",
      },
      data: {
        partId: "part_1",
        messageId: "msg_1",
        field: "text",
        text: "Hel",
      },
    })

    expect(result.success).toBe(false)
  })

  it("accepts ephemeral part.delta", () => {
    expect(
      partDeltaEventSchema.parse({
        schemaVersion: 1,
        eventId: "evt_1",
        type: "part.delta",
        timestamp,
        delivery: { durable: false, streamOrdinal: 0 },
        scope: {
          kind: "session",
          projectId: "proj_1",
          sessionId: "ses_1",
          partId: "part_1",
        },
        data: {
          partId: "part_1",
          messageId: "msg_1",
          field: "text",
          text: "Hel",
        },
      }).delivery.durable
    ).toBe(false)
  })

  it("rejects a session event with instances scope", () => {
    const result = aideEventSchema.safeParse({
      schemaVersion: 1,
      eventId: "evt_1",
      type: "turn.queued",
      timestamp,
      delivery: { durable: true, sequence: 1 },
      scope: { kind: "instances" },
      data: {
        turn: {
          id: "turn_1",
          sessionId: "ses_1",
          seq: 0,
          status: "queued",
          execution: {
            selection: {
              instanceId: "opencode",
              driver: "opencode",
              model: { modelId: "gpt-5" },
              options: {},
            },
            display: {
              instanceName: "OpenCode",
              modelName: "GPT-5",
              options: {},
            },
            inventoryRevision: "rev_1",
          },
          commandId: "cmd_1",
          userMessageId: "msg_1",
        },
      },
    })

    expect(result.success).toBe(false)
  })
})
