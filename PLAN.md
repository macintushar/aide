# Aide Plan

## Product Definition

Aide is a local server and web UI for running one coding conversation across interchangeable coding harnesses.

An Aide session belongs to Aide, not to a harness. A user selects the harness, model, agent or agent mode, and model variant for every message. Aide stores the canonical conversation history and supplies the relevant context to the selected harness.

This enables a workflow such as:

1. Start a task with OpenCode.
2. Continue it with Claude Code.
3. Finish it with Codex.
4. Keep all user and assistant messages in one Aide session.

Day 0 supports OpenCode v2 only. Future harnesses must integrate through their official SDKs.

## Core Principles

1. Aide owns sessions and conversation history.
2. A message has exactly one of two roles: `user` or `assistant`.
3. Every user message selects its execution configuration.
4. Every assistant message answers exactly one user message.
5. Harness-native sessions are implementation details, not product sessions.
6. Harness events are normalized before reaching the UI.
7. The UI never imports or interprets harness-specific SDK types.
8. Integration uses official harness SDKs only.
9. No ACP, terminal-output parsing, reverse-engineered protocols, or direct transport calls around an SDK.
10. The application runs entirely on the local machine and binds to loopback by default.

## Initial Scope

### Included

- Local Node.js server.
- Browser-based chat UI.
- Local project directories.
- Aide-owned sessions and message history.
- OpenCode v2 integration through its official TypeScript SDK.
- Per-message harness selection, with OpenCode as the only Day 0 option.
- Per-message model selection.
- Per-message OpenCode agent selection.
- Per-message model variant selection, such as `medium`, `high`, or `xhigh` when supported.
- Streaming assistant output and tool activity.
- Permission and user-input requests.
- Turn interruption.
- Session restoration after restarting the browser or Aide server.
- Current workspace changes and Git diff inspection.

### Excluded Initially

- Desktop packaging.
- Remote execution or remote access.
- Cloud sandboxes.
- Multi-user support.
- ACP integrations.
- CLI output parsing for harness functionality or inventory.
- Mobile clients.
- Git staging, committing, pushing, reverting, or checkpoint restoration.
- A general embedded terminal unless later proven necessary.

## User Experience

The primary interface is a chat view. The composer includes four controls:

```text
[Harness] [Model] [Agent/Mode] [Variant]
Write the authentication middleware...
                                        [Send]
```

Each sent user message permanently records the selected values. Changing the composer after sending must not alter previously sent or queued messages.

The effective execution configuration is visible on historical messages:

```text
User
OpenCode / GPT-5 / build / high

Implement the settings panel.

Assistant
OpenCode / GPT-5 / build / high

Implemented the settings panel...
```

The composer uses the following precedence:

1. Current composer selection.
2. Most recently sent selection in the Aide session.
3. Project defaults.
4. Defaults reported by the harness.

The application must not invent model, agent, or variant options. A `Default` variant may be offered by omitting the variant and allowing the harness to choose.

## Domain Model

Keep the user-facing domain intentionally small.

```ts
type Project = {
  id: string
  name: string
  directory: string
  createdAt: string
  lastOpenedAt: string
}

type Session = {
  id: string
  projectId: string
  title: string
  createdAt: string
  updatedAt: string
}

type ExecutionSelection = {
  harnessId: string
  model: {
    providerId: string
    modelId: string
  }
  agentMode: string
  variant?: string
}

type UserMessage = {
  id: string
  sessionId: string
  role: "user"
  content: string
  execution: ExecutionSelection
  createdAt: string
}

type AssistantMessage = {
  id: string
  sessionId: string
  role: "assistant"
  parentMessageId: string
  content: string
  createdAt: string
  completedAt?: string
}

type Message = UserMessage | AssistantMessage
```

`agentMode` is the normalized product field. An adapter may map it to an agent, mode, or equivalent harness concept. For OpenCode, it maps to `agent`.

Operational state must remain separate from messages:

- Tool calls and results.
- Permission requests.
- User-input requests.
- Errors and notices.
- Usage and cost.
- Native harness session and message IDs.
- Context synchronization state.
- Streaming state.

## Turn Lifecycle

One user message and its assistant response form a turn.

```text
draft -> queued -> running -> completed
                         |-> interrupted
                         |-> failed
```

Requirements:

- Persist the user message before calling a harness.
- Resolve and validate its execution selection before execution.
- Create one assistant response placeholder when execution starts.
- Allow only one active turn per Aide session initially.
- Queued turns retain the execution selection captured when sent.
- Every running turn reaches exactly one terminal state: completed, interrupted, or failed.
- Interrupt is idempotent.
- Closing the browser does not terminate a running turn.

## Context Ownership and Harness Switching

Aide's database is the source of truth for conversation history. Harness-native sessions may be reused for efficiency, but cannot be required for correctness.

For each user message:

1. Persist the user message and execution selection.
2. Select the requested harness adapter.
3. Build the context required by that harness from Aide's canonical history.
4. Reuse a compatible native harness session when safe.
5. Otherwise create a native session and seed it with portable Aide context.
6. Send the current user message using the selected model, agent mode, and variant.
7. Normalize native events and stream them to the UI.
8. Assemble and persist the assistant response.

The context passed between harnesses may include:

- User messages.
- Final assistant messages.
- Current task and constraints.
- Relevant completed tool outcomes.
- Working directory.
- Current Git status and diff summary.
- Files changed during the session.
- Outstanding tasks and unresolved errors.

Do not transfer hidden chain-of-thought, harness-specific system prompts, native tool identifiers, permission state, secrets, or unbounded raw logs.

Returning to a previously used harness may resume its native session only if Aide can prove that its context is synchronized with the canonical history. Otherwise, Aide must rebuild context from its database.

## Server Architecture

```text
Browser UI
    |
    | Aide commands, snapshots, and normalized events
    v
Local Aide server
    |-- Application services
    |-- SQLite persistence
    |-- Git and filesystem inspection
    |-- Harness registry
            |
            | HarnessAdapter
            v
        OpenCode v2 adapter
            |
            | Official OpenCode SDK
            v
        OpenCode runtime
```

The server owns:

- Project and session lifecycle.
- Canonical messages.
- Turn scheduling and interruption.
- Harness lifecycle and native session mappings.
- Context construction.
- Event normalization and sequencing.
- Persistence and reconnect snapshots.
- Filesystem and Git inspection.

The browser owns only ephemeral presentation state such as the current draft and open panels.

## Harness Adapter Contract

The adapter API is internal and capability-driven.

```ts
interface HarnessAdapter {
  discover(input: DiscoverInput): Promise<HarnessInventory>
  start(input: StartHarnessSessionInput): Promise<NativeSession>
  resume(input: ResumeHarnessSessionInput): Promise<NativeSession>
  send(input: SendTurnInput): Promise<void>
  interrupt(input: InterruptTurnInput): Promise<void>
  respondToPermission(input: PermissionResponseInput): Promise<void>
  respondToInput(input: InputResponseInput): Promise<void>
  events(input: HarnessEventsInput): AsyncIterable<NormalizedEvent>
  dispose(input: DisposeHarnessSessionInput): Promise<void>
}
```

Adapters maintain private mappings between Aide IDs and native IDs:

- Aide session to native harness session.
- Aide message to native message.
- Aide activity to native tool call.
- Aide request to native permission or input request.

Adding a harness requires an official SDK that provides structured support for:

- Session creation or equivalent execution context.
- Prompt submission.
- Structured messages and streaming events.
- Model and mode selection.
- Interruption.
- Permission handling when the harness requires permissions.

If the official SDK cannot expose a required capability, the harness remains unsupported rather than receiving an ACP or CLI-parser fallback.

## OpenCode v2 Adapter

Day 0 targets only the OpenCode v2 SDK API.

The adapter must:

- Manage or connect to the local OpenCode runtime through supported SDK facilities.
- Scope clients and sessions to the selected project directory.
- Discover configured providers and models through the SDK.
- Discover available OpenCode agents through the SDK.
- Discover model variants through SDK-provided model metadata.
- Create and resume native sessions.
- Submit prompts asynchronously.
- Map `ExecutionSelection.model` to OpenCode `providerID` and `modelID`.
- Map `ExecutionSelection.agentMode` to OpenCode `agent`.
- Map `ExecutionSelection.variant` to OpenCode `variant`.
- Subscribe to native OpenCode events.
- Normalize text, tool, permission, input, error, status, and completion events.
- Reply to permission and input requests through the SDK.
- Interrupt active execution through the SDK.
- Detect incompatible SDK/runtime versions and return an actionable error.

Conceptually, per-message execution maps to:

```ts
await client.session.promptAsync({
  path: { sessionID },
  body: {
    model: {
      providerID: selection.model.providerId,
      modelID: selection.model.modelId,
    },
    agent: selection.agentMode,
    variant: selection.variant,
    parts,
  },
})
```

Exact calls must follow the pinned OpenCode v2 SDK version during implementation.

There will be no CLI fallback for inventory discovery. If discovery fails:

1. Use a previously cached inventory and mark it stale.
2. If no cache exists, disable sending and show the discovery error.

## Inventory and Capabilities

Inventory is directory-scoped because project OpenCode configuration may change available agents and models.

```ts
type HarnessInventory = {
  harnessId: string
  revision: string
  discoveredAt: string
  stale: boolean
  models: HarnessModel[]
  agentModes: SelectOption[]
}

type HarnessModel = {
  providerId: string
  modelId: string
  displayName: string
  variants: SelectOption[]
  defaultVariant?: string
  supportedAgentModes?: string[]
}
```

UI requirements:

- Only show reported options.
- Hide or disable variant selection when unsupported.
- Clear an incompatible variant after a model change.
- Preserve an agent selection when it remains valid.
- Fall back to a reported default when a selection becomes invalid.
- Preserve removed options on historical messages but prevent selecting them for new messages.
- Revalidate all selections on the server before execution.

## Normalized Events

All harness-native events cross one normalization boundary before they are persisted or sent to the UI.

```ts
type EventEnvelope<TType extends string, TData> = {
  schemaVersion: 1
  eventId: string
  sequence: number
  type: TType
  timestamp: string
  projectId: string
  sessionId: string
  turnId?: string
  messageId?: string
  harnessId?: string
  data: TData
}
```

Initial event set:

### Turn

- `turn.queued`
- `turn.started`
- `turn.completed`
- `turn.interrupted`
- `turn.failed`

### Message Streaming

- `message.started`
- `message.text_delta`
- `message.completed`

### Tool Activity

- `tool.started`
- `tool.updated`
- `tool.completed`
- `tool.failed`

Tool categories are normalized to:

- `shell`
- `file_read`
- `file_write`
- `search`
- `web`
- `agent`
- `other`

### Permissions

- `permission.requested`
- `permission.resolved`
- `permission.cancelled`

### User Input

- `input.requested`
- `input.resolved`
- `input.cancelled`

### Runtime and Inventory

- `harness.connected`
- `harness.disconnected`
- `harness.reconnecting`
- `harness.inventory_updated`
- `harness.inventory_failed`

### General

- `notice.created`
- `error.occurred`

Every event ID must be deduplicatable, and sequence numbers must define ordering within an Aide session. Native event names and payloads may be retained in private diagnostic logs, but the UI must never branch on them.

## Persistence Strategy

Use SQLite for local durable state.

Persist:

- Projects.
- Aide sessions.
- User and assistant messages.
- Requested and resolved execution selections.
- Turn lifecycle and terminal state.
- Completed tool activity summaries.
- Permission and input requests and resolutions.
- Errors.
- Usage and cost when reported.
- Native session mappings and synchronization cursors.
- Cached harness inventories.

Broadcast but compact rather than permanently storing every update:

- Token-level text deltas.
- High-frequency progress events.
- Streaming shell output.
- Connection heartbeats.

Persist the final assembled assistant message and final bounded tool results. Large outputs should be stored as referenced artifacts rather than duplicated in events.

On reconnect, the UI receives a current snapshot followed by live events. It should not need to replay every historical streaming delta.

## Commands

Commands represent UI intent and remain separate from events:

- `project.open`
- `project.updateDefaults`
- `session.create`
- `session.rename`
- `session.delete`
- `turn.send`
- `turn.interrupt`
- `permission.respond`
- `input.respond`
- `inventory.refresh`

The UI may show a temporary local sending state, but it must not invent authoritative lifecycle events.

## Reliability and Safety

- Bind servers to `127.0.0.1` by default.
- Never execute code merely by opening a project.
- Always display the active project directory.
- Prevent a message from being sent to the wrong project or session.
- Validate paths and prevent accidental operation outside the project boundary where practical.
- Recover persisted sessions after an Aide server restart.
- Reconcile native harness state without losing canonical Aide history.
- Deduplicate repeated SDK events.
- Bound and truncate high-volume output while preserving retrievable artifacts.
- Keep unresolved permission and input requests visible after UI reconnects.
- Redact secrets from diagnostics where possible.
- Never claim native session continuity when context was reconstructed.
- Preserve errors with enough structured detail to diagnose adapter failures.

## Testing Strategy

### Contract Tests

- Validate every normalized event payload against its schema.
- Verify event sequencing and deduplication.
- Verify requested and resolved execution selections are preserved.
- Verify one assistant message maps to one user message.

### Adapter Tests

- Map OpenCode text streaming to message events.
- Map tool lifecycle events.
- Map permission and input requests.
- Pass provider, model, agent, and variant on every prompt.
- Interrupt active turns.
- Handle runtime disconnection and restart.
- Reject invalid or stale inventory selections.
- Restore or reconstruct context after losing a native session.

### Integration Tests

- Create a project and Aide session.
- Send messages with different OpenCode models, agents, and variants in one session.
- Reload the browser during an active turn.
- Restart the Aide server and restore conversation state.
- Queue a message with one execution selection, change the composer, and verify the queued selection is unchanged.
- Resolve permissions from the UI.
- Inspect file changes produced by a turn.

### Future Cross-Harness Tests

- Start with one harness and continue with another in the same Aide session.
- Return to a previous harness with synchronized native context.
- Reconstruct context when native resumption is unsafe.
- Confirm that only portable canonical history crosses harness boundaries.

## Implementation Phases

### Phase 1: Foundation

- Establish the server and web application structure.
- Define runtime-validated shared contracts.
- Add SQLite schema and migrations.
- Implement projects, Aide sessions, two-role messages, and turn lifecycle.
- Implement snapshot plus live-event transport.

### Phase 2: OpenCode Inventory

- Pin the OpenCode v2 SDK version.
- Implement runtime lifecycle and compatibility checks.
- Discover directory-scoped models, agents, and variants through the SDK.
- Cache inventory and represent stale state.
- Build composer selectors and project defaults.

### Phase 3: OpenCode Chat

- Create and map native OpenCode sessions.
- Send prompts with per-message model, agent, and variant.
- Stream normalized assistant text.
- Persist final messages and execution metadata.
- Implement interruption and terminal turn states.

### Phase 4: Activities and Recovery

- Normalize and render tool activity.
- Implement permission and input request flows.
- Add reconnect snapshots and event deduplication.
- Recover after browser, Aide server, and OpenCode runtime restarts.
- Add bounded artifact storage for large outputs.

### Phase 5: Workspace Awareness

- Add Git status and diff inspection.
- Associate file changes with turns where observable.
- Show changed files beside the conversation.
- Add usage and cost reporting when supplied by OpenCode.

### Phase 6: Additional Harnesses

- Add only harnesses with sufficient official SDKs.
- Implement each adapter against the same normalized contracts.
- Build canonical context reconstruction for cross-harness continuation.
- Add capability-driven composer behavior for harness-specific agents or modes.
- Verify that the Aide session remains continuous across harness changes.

## Day 0 Acceptance Criteria

Day 0 is complete when a user can:

1. Start the local Aide server and open the web UI.
2. Open a local project directory.
3. Create an Aide session.
4. See OpenCode-discovered models, agents, and variants.
5. Select model, agent, and variant independently for every message.
6. Send multiple messages with different selections in one session.
7. Watch assistant text and tool activity stream consistently.
8. Approve or deny permission requests.
9. Interrupt an active turn.
10. Reload the browser without losing history or active state.
11. Restart Aide and restore persisted conversation history.
12. Inspect the files and Git diff changed during the work.

The architecture is ready for future harnesses when adding one requires a new SDK adapter and normalization mapping, not changes to the core session, message, composer, or UI event model.
