import type {
  AssistantMessage,
  Project,
  Request,
  ResolvedExecution,
  Session,
  TextPart,
  ToolPart,
  Turn,
  TurnStatus,
  Usage,
  UserMessage,
} from "./domain"
import type { AideEvent } from "./events"
import type { Command } from "./commands"
import type { HarnessInventory } from "./inventory"
import type { InstancesSnapshot, SessionSnapshot } from "./snapshots"

type PermissionRequest = Extract<Request, { kind: "permission" }>
type InputRequest = Extract<Request, { kind: "input" }>

/**
 * Canonical fixtures for every wire value. These are the seam between the
 * server spine and the UI tracks: web and server tests build against these
 * while S1-S4 are still in flight. Additive only — never change the meaning
 * of an existing fixture (same freeze policy as the rest of this package).
 */

const TIMESTAMP = "2026-01-01T00:00:00.000Z"

function clone<T>(value: T): T {
  return structuredClone(value)
}

export function projectFixture(): Project {
  return clone({
    id: "proj_1",
    name: "aide",
    directory: "/Users/tushar/projects/aide",
    createdAt: TIMESTAMP,
    lastOpenedAt: TIMESTAMP,
  })
}

export function sessionFixture(): Session {
  return clone({
    id: "ses_1",
    projectId: "proj_1",
    title: "Fixture session",
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  })
}

export function resolvedExecutionFixture(): ResolvedExecution {
  return clone({
    selection: {
      instanceId: "opencode",
      driver: "opencode",
      model: { providerId: "openai", modelId: "gpt-5" },
      agent: "build",
      options: { variant: "stable" },
    },
    display: {
      instanceName: "OpenCode",
      modelName: "GPT-5",
      agentName: "Build",
      options: {
        variant: { label: "Variant", valueLabel: "Stable" },
      },
    },
    inventoryRevision: "rev_1",
  })
}

export function usageFixture(): Usage {
  return clone({
    inputTokens: 1200,
    outputTokens: 340,
    cacheReadTokens: 80,
    cacheWriteTokens: 0,
    costUsd: 0.012,
  })
}

export function textPartFixture(index = 0): TextPart {
  return clone({
    id: `part_text_${index}`,
    messageId: "msg_assistant_1",
    index,
    type: "text",
    text: "Implemented the settings panel.",
  })
}

export function toolPartFixture(
  status: ToolPart["status"] = "completed",
  index = 1
): ToolPart {
  return clone({
    id: `part_tool_${index}`,
    messageId: "msg_assistant_1",
    index,
    type: "tool",
    name: "bash",
    category: "shell",
    status,
    input: { command: "bun test" },
    output: "16 passed",
  })
}

export function userMessageFixture(): UserMessage {
  return clone({
    id: "msg_user_1",
    sessionId: "ses_1",
    seq: 0,
    role: "user",
    parts: [
      {
        id: "part_user_text_0",
        messageId: "msg_user_1",
        index: 0,
        type: "text",
        text: "Implement the settings panel.",
      },
    ],
    execution: resolvedExecutionFixture(),
    createdAt: TIMESTAMP,
  })
}

export function assistantMessageFixture(): AssistantMessage {
  return clone({
    id: "msg_assistant_1",
    sessionId: "ses_1",
    seq: 1,
    role: "assistant",
    parentMessageId: "msg_user_1",
    parts: [
      {
        id: "part_reasoning_0",
        messageId: "msg_assistant_1",
        index: 0,
        type: "reasoning",
        text: "Considered the component layout.",
      },
      textPartFixture(1),
      toolPartFixture("completed", 2),
    ],
    usage: usageFixture(),
    createdAt: TIMESTAMP,
    completedAt: TIMESTAMP,
  })
}

export function turnFixture(status: TurnStatus = "completed"): Turn {
  return clone({
    id: "turn_1",
    sessionId: "ses_1",
    seq: 0,
    status,
    execution: resolvedExecutionFixture(),
    commandId: "cmd_0001",
    userMessageId: "msg_user_1",
    assistantMessageId: "msg_assistant_1",
    startedAt: TIMESTAMP,
    endedAt: status === "queued" ? undefined : TIMESTAMP,
  })
}

export function permissionRequestFixture(): PermissionRequest {
  return clone({
    id: "req_perm_1",
    sessionId: "ses_1",
    turnId: "turn_1",
    kind: "permission",
    status: "resolved",
    payload: {
      kind: "permission",
      toolName: "bash",
      title: "Run bun test?",
      detail: "Executes the test suite.",
      diff: "--- a/src/index.ts\n+++ b/src/index.ts",
      options: [
        { id: "allow", label: "Allow", isDefault: true },
        { id: "deny", label: "Deny" },
      ],
    },
    resolution: { kind: "permission", optionId: "allow" },
  })
}

export function inputRequestFixture(): InputRequest {
  return clone({
    id: "req_input_1",
    sessionId: "ses_1",
    turnId: "turn_1",
    kind: "input",
    status: "resolved",
    payload: {
      kind: "input",
      questions: [
        {
          id: "approach",
          prompt: "Which approach?",
          header: "Approach",
          options: [
            { id: "fast", label: "Fast" },
            { id: "safe", label: "Safe", isDefault: true },
          ],
          allowMultiple: true,
          allowFreeText: false,
        },
        {
          id: "notes",
          prompt: "Any notes?",
          allowMultiple: false,
          allowFreeText: true,
          multiline: true,
        },
      ],
    },
    resolution: {
      kind: "input",
      answers: {
        approach: { optionIds: ["safe"] },
        notes: { text: "Fixture answer" },
      },
    },
  })
}

export function inventoryFixture(): HarnessInventory {
  return clone({
    instanceId: "opencode",
    driver: "opencode",
    revision: "rev_1",
    discoveredAt: TIMESTAMP,
    stale: false,
    capabilities: {
      inventoryScope: "directory",
      agentSelection: true,
      interactionModes: [],
      sessionModelSwitch: "in-session",
      steer: true,
      interrupt: true,
      permissions: true,
      userInput: true,
      reasoningParts: true,
      mcp: {
        stdio: true,
        http: true,
        sse: true,
        inProcess: false,
        runtimeReconfigure: true,
      },
    },
    auth: {
      status: "authenticated",
      type: "api_key",
      label: "OpenCode",
      account: "tushar",
    },
    models: [
      {
        providerId: "openai",
        modelId: "gpt-5",
        displayName: "GPT-5",
        description: "Default fixture model",
        isDefault: true,
        optionDescriptors: [
          {
            id: "variant",
            label: "Variant",
            type: "select",
            options: [
              { id: "stable", label: "Stable", isDefault: true },
              { id: "preview", label: "Preview" },
            ],
            defaultValue: "stable",
          },
        ],
      },
    ],
    agents: [
      { id: "build", label: "Build", isDefault: true },
      { id: "plan", label: "Plan" },
    ],
    interactionModes: [],
  })
}

export function commandFixtures(): Command[] {
  return clone([
    {
      name: "project.open",
      commandId: "cmd_0001",
      directory: "/Users/tushar/projects/aide",
      projectName: "aide",
    },
    {
      name: "project.updateDefaults",
      commandId: "cmd_0002",
      projectId: "proj_1",
      defaults: { instanceId: "opencode" },
    },
    {
      name: "session.create",
      commandId: "cmd_0003",
      projectId: "proj_1",
      title: "New session",
    },
    {
      name: "session.rename",
      commandId: "cmd_0004",
      sessionId: "ses_1",
      title: "Renamed",
    },
    { name: "session.delete", commandId: "cmd_0005", sessionId: "ses_1" },
    {
      name: "turn.send",
      commandId: "cmd_0006",
      sessionId: "ses_1",
      content: "Implement the settings panel.",
      execution: resolvedExecutionFixture().selection,
    },
    {
      name: "turn.interrupt",
      commandId: "cmd_0007",
      sessionId: "ses_1",
      turnId: "turn_1",
    },
    {
      name: "permission.respond",
      commandId: "cmd_0008",
      requestId: "req_perm_1",
      resolution: { kind: "permission", optionId: "allow" },
    },
    {
      name: "input.respond",
      commandId: "cmd_0009",
      requestId: "req_input_1",
      resolution: inputRequestFixture().resolution!,
    },
    {
      name: "inventory.refresh",
      commandId: "cmd_0010",
      instanceId: "opencode",
    },
    { name: "instance.start", commandId: "cmd_0011", instanceId: "opencode" },
    { name: "instance.stop", commandId: "cmd_0012", instanceId: "opencode" },
    { name: "instance.restart", commandId: "cmd_0013", instanceId: "opencode" },
    {
      name: "config.update",
      commandId: "cmd_0014",
      target: { kind: "global" },
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
        mcpServers: {},
        defaults: {},
      },
    },
    {
      name: "mcp.reconnect",
      commandId: "cmd_0015",
      instanceId: "opencode",
      serverName: "docs",
    },
  ])
}

type SessionEventShape = {
  type: AideEvent["type"]
  data: unknown
  turnId?: string
  messageId?: string
  partId?: string
  ephemeral?: boolean
}

type InstancesEventShape = {
  type: AideEvent["type"]
  data: unknown
}

function buildEventFixtures(): AideEvent[] {
  const events: AideEvent[] = []
  let eventId = 0
  let sessionSequence = 0
  let streamOrdinal = 0
  let instancesSequence = 0
  const nextEventId = () => `evt_${String(++eventId).padStart(4, "0")}`

  const sessionEvent = (shape: SessionEventShape): AideEvent =>
    ({
      schemaVersion: 1,
      eventId: nextEventId(),
      type: shape.type,
      timestamp: TIMESTAMP,
      delivery: shape.ephemeral
        ? { durable: false, streamOrdinal: streamOrdinal++ }
        : { durable: true, sequence: sessionSequence++ },
      scope: {
        kind: "session",
        projectId: "proj_1",
        sessionId: "ses_1",
        turnId: shape.turnId,
        messageId: shape.messageId,
        partId: shape.partId,
      },
      instanceId: "opencode",
      driver: "opencode",
      data: shape.data,
    }) as AideEvent

  const instancesEvent = (shape: InstancesEventShape): AideEvent =>
    ({
      schemaVersion: 1,
      eventId: nextEventId(),
      type: shape.type,
      timestamp: TIMESTAMP,
      delivery: { durable: true, sequence: instancesSequence++ },
      scope: { kind: "instances" },
      instanceId: "opencode",
      driver: "opencode",
      data: shape.data,
    }) as AideEvent

  const textPart = textPartFixture()
  const toolPart = toolPartFixture("running")

  events.push(
    sessionEvent({
      type: "turn.queued",
      data: { turn: turnFixture("queued") },
      turnId: "turn_1",
    }),
    sessionEvent({
      type: "turn.started",
      data: { turn: turnFixture("running") },
      turnId: "turn_1",
    }),
    sessionEvent({
      type: "message.upserted",
      data: {
        message: {
          id: "msg_assistant_1",
          sessionId: "ses_1",
          seq: 1,
          role: "assistant",
          parentMessageId: "msg_user_1",
          createdAt: TIMESTAMP,
        },
      },
      turnId: "turn_1",
      messageId: "msg_assistant_1",
    }),
    sessionEvent({
      type: "part.delta",
      data: {
        partId: "part_text_0",
        messageId: "msg_assistant_1",
        field: "text",
        text: "Implemented the se",
      },
      turnId: "turn_1",
      messageId: "msg_assistant_1",
      partId: "part_text_0",
      ephemeral: true,
    }),
    sessionEvent({
      type: "part.upserted",
      data: { part: textPart },
      turnId: "turn_1",
      messageId: textPart.messageId,
      partId: textPart.id,
    }),
    sessionEvent({
      type: "part.upserted",
      data: { part: toolPart },
      turnId: "turn_1",
      messageId: toolPart.messageId,
      partId: toolPart.id,
    }),
    sessionEvent({
      type: "part.removed",
      data: { partId: "part_text_0", messageId: "msg_assistant_1" },
      turnId: "turn_1",
      messageId: "msg_assistant_1",
      partId: "part_text_0",
    }),
    sessionEvent({
      type: "request.opened",
      data: { request: permissionRequestFixture() },
      turnId: "turn_1",
    }),
    sessionEvent({
      type: "request.resolved",
      data: { request: permissionRequestFixture() },
      turnId: "turn_1",
    }),
    sessionEvent({
      type: "request.cancelled",
      data: { request: { ...inputRequestFixture(), status: "cancelled" } },
      turnId: "turn_1",
    }),
    sessionEvent({
      type: "turn.completed",
      data: { turn: turnFixture("completed") },
      turnId: "turn_1",
    }),
    sessionEvent({
      type: "turn.interrupted",
      data: { turn: turnFixture("interrupted") },
      turnId: "turn_1",
    }),
    sessionEvent({
      type: "turn.failed",
      data: { turn: turnFixture("failed") },
      turnId: "turn_1",
    }),
    instancesEvent({ type: "harness.instance_starting", data: {} }),
    instancesEvent({ type: "harness.connected", data: { version: "2.0.0" } }),
    instancesEvent({
      type: "harness.inventory_updated",
      data: { inventory: inventoryFixture() },
    }),
    instancesEvent({
      type: "harness.mcp_status_changed",
      data: {
        servers: [{ name: "docs", connected: true }],
      },
    }),
    instancesEvent({
      type: "harness.auth_changed",
      data: { auth: { status: "authenticated", type: "api_key" } },
    }),
    instancesEvent({
      type: "harness.inventory_failed",
      data: {
        error: {
          code: "discovery_failed",
          message: "Provider list unavailable",
          retryable: true,
        },
      },
    }),
    instancesEvent({
      type: "harness.instance_failed",
      data: {
        error: {
          code: "start_failed",
          message: "Instance exited during boot",
          instanceId: "opencode",
          retryable: true,
        },
      },
    }),
    instancesEvent({
      type: "harness.reconnecting",
      data: { attempt: 2 },
    }),
    instancesEvent({
      type: "harness.disconnected",
      data: { reason: "runtime closed" },
    }),
    instancesEvent({
      type: "config.updated",
      data: { target: { kind: "global" } },
    }),
    instancesEvent({
      type: "notice.created",
      data: {
        title: "Permission denied",
        message: "The tool call was denied.",
        level: "info",
      },
    }),
    instancesEvent({
      type: "error.occurred",
      data: {
        error: {
          code: "execution_failed",
          message: "The turn failed mid-execution",
          instanceId: "opencode",
          retryable: false,
        },
      },
    })
  )

  return events
}

export function eventFixtures(): AideEvent[] {
  return clone(buildEventFixtures())
}

export function sessionSnapshotFixture(): SessionSnapshot {
  return clone({
    schemaVersion: 1,
    scope: { kind: "session", projectId: "proj_1", sessionId: "ses_1" },
    cursor: { sequence: 12 },
    project: projectFixture(),
    session: sessionFixture(),
    messages: [userMessageFixture(), assistantMessageFixture()],
    turns: [turnFixture("completed")],
    requests: [permissionRequestFixture(), inputRequestFixture()],
  })
}

export function instancesSnapshotFixture(): InstancesSnapshot {
  return clone({
    schemaVersion: 1,
    scope: { kind: "instances" },
    cursor: { sequence: 6 },
    instances: [
      {
        instanceId: "opencode",
        driver: "opencode",
        displayName: "OpenCode",
        enabled: true,
        autoStart: true,
        status: "ready",
        version: "2.0.0",
        installed: true,
        auth: { status: "authenticated", type: "api_key" },
        inventory: inventoryFixture(),
      },
      {
        instanceId: "claude",
        driver: "claudeAgent",
        displayName: "Claude",
        enabled: true,
        autoStart: true,
        status: "starting",
        auth: { status: "unknown" },
      },
    ],
  })
}
