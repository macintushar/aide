# Aide Build Breakdown — Serial Spine and Parallel Tracks

Companion to [PLAN.md](PLAN.md). PLAN.md says _what_ to build. This says _in what order_ and _by how many workers at once_.

## Task types

**`S` — Serial.** Single owner, merges before its dependents start. A task is serial when it meets any of:

1. It defines a type or interface other tracks import.
2. It owns a single-file bottleneck (the migration chain, the `AideEvent` discriminated union, the command router).
3. It establishes an invariant other tracks must consume rather than re-derive (sequencing, dedupe, receipt states, merge precedence).

Two people writing a type system in parallel produce two type systems. Serial tasks are where that cost lands.

**`P` — Parallel.** Runs concurrently with every other `P` in its wave and with that wave's serial spine. A task is parallel when it owns a directory nobody else writes to and depends only on already-frozen seams.

Each wave has a spine (`S`, sequential within the wave) and a fan-out (`P`, all concurrent). The fan-out starts the moment the _previous_ wave's spine merges — it does not wait for its own wave's spine unless a dependency says so.

Assumes 6–8 concurrent workers. Critical path is 9 serial units; everything else is schedulable around it.

---

## Dependency graph

```text
S0  contracts + adapter interface + env          [blocks everything]
 |
 +--> S1 db schema/migrations/repos
 |     +--> S2 dispatcher + receipts
 |           +--> S3 event log + sequencer + SSE + snapshot
 |                 +--> S4 project/session/message/turn services
 |                       +--> S5 config service + merge resolver
 |                             +--> S6 instance supervisor
 |                                   +--> S7 context builder
 |                                         +--> S8 turn execution orchestration
 |                                               +--> S9 acceptance gate
 |
 +--> P1.1 fake adapter + conformance suite   [unblocks all adapter + UI work]
 +--> P1.2 web transport + event store
 +--> P1.3 web shell + transcript
 +--> P1.4 contract tests + fixtures
 +--> P1.5 security + env boot
 +--> P1.6 git/fs inspection
 +--> P1.7 artifact store
```

---

## Wave 0 — Freeze the seams (serial only)

Nothing else starts. Target: one owner, one to two days, near-pure transcription from PLAN.md.

| ID    | Task                               | Deliverable                                                                                                                                                                                                                       |
| ----- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S0.1  | `packages/contracts` scaffold      | package.json, tsconfig, turbo wiring, `apps/web` + `apps/server` depend on it                                                                                                                                                     |
| S0.2  | Domain schemas                     | `Project`, `Session`, `Part` (5 variants), `UserMessage`/`AssistantMessage`, `Turn`, `Request` + payloads/resolutions, `Usage`, `AideError`, `ExecutionSelection`, `ResolvedExecution`, `OptionDescriptor`, `NativeDispatchInput` |
| S0.3  | Config schemas                     | `InstanceConfig`, `DriverId`, `McpServerConfig`, global + project config records, `defaults`                                                                                                                                      |
| S0.4  | Inventory schemas                  | `HarnessInventory`, `HarnessModel`, `HarnessCapabilities`, `InstanceAuth`                                                                                                                                                         |
| S0.5  | Command schemas                    | all 15 commands, `commandId` envelope, receipt state enum                                                                                                                                                                         |
| S0.6  | Event schemas                      | `AideEvent` envelope, durable/ephemeral delivery union, scope union, every `data` payload, one exported discriminated union                                                                                                       |
| S0.7  | Snapshot schema                    | session snapshot + instances snapshot shapes                                                                                                                                                                                      |
| S0.8  | `apps/server/src/harness/types.ts` | `HarnessAdapter` interface + all its input/output types. Imports contracts only. **No SDK imports.**                                                                                                                              |
| S0.9  | Env validation                     | `@t3-oss/env-core` + zod: bind host/port, per-launch bearer token, `DB_FILE_NAME`                                                                                                                                                 |
| S0.10 | Import firewall                    | oxlint `no-restricted-imports`: `@opencode-ai/*` importable only under `harness/opencode/**`, `@anthropic-ai/*` only under `harness/claude/**`, neither anywhere in `apps/web` or `packages/contracts`                            |

**Exit:** typecheck green; a snapshot test locks the exported schema names so a later rename is a visible diff, not a silent break.

**Freeze rule:** after S0 merges, `packages/contracts` is append-only. A breaking change requires a dedicated PR touching only that package, one integrator, and a note to every active track. This is the whole reason the rest can fan out.

---

## Wave 1 — Kernel

### Spine (serial, in order)

| ID  | Task                                       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Drizzle schema + migrations + repositories | Every table in _Persistence Strategy_: projects, sessions, messages (`seq`), parts (`messageId`+`index`), turns, requests, command receipts + dispatch state, native session mappings (`resumeCursor`, `syncCursor`), dispatch inputs (`role="handoff"`), adapter-private id mappings, inventory cache, artifacts, event log, config records. **Must export repository functions** — parallel tracks depend on the repo surface, not on raw Drizzle. |
| S2  | Command dispatcher + durable receipts      | `POST /commands/:name`, `commandId` dedupe returning the persisted receipt, `accepted → dispatching → dispatched → uncertain → completed \| failed`, local-only fast path `accepted → completed` in one tx                                                                                                                                                                                                                                           |
| S3  | Event log + sequencer + SSE + snapshot     | Per-scope monotonic durable sequence (one per session, one for `instances`); ephemeral `streamOrdinal`; `GET /sessions/:id`, `GET /sessions/:id/events?afterSequence=N`, `GET /instances/events`; **`part.delta` emitted with no SSE `id:`**; snapshot-instead-of-replay when the gap is too large; durable event append in the same tx as its domain rows                                                                                           |
| S4  | Core services                              | project, session, message, part, turn lifecycle; one-active-turn-per-session scheduler; queued turns as new turns retaining captured selection; boot reconciliation of any `running` turn                                                                                                                                                                                                                                                            |

### Fan-out (parallel — all start when S0 merges)

| ID   | Task                                         | Owns                                                                             | Depends on        |
| ---- | -------------------------------------------- | -------------------------------------------------------------------------------- | ----------------- |
| P1.1 | **Fake adapter + adapter conformance suite** | `apps/server/src/harness/fake/**`, `apps/server/test/conformance/**`             | S0.8              |
| P1.2 | Web transport + event store                  | `apps/web/src/lib/transport/**`, `apps/web/src/store/**`                         | S0, P1.4 fixtures |
| P1.3 | Web shell + transcript rendering             | `apps/web/src/features/transcript/**`, app layout                                | S0, P1.4 fixtures |
| P1.4 | Contract test suite + fixtures               | `packages/contracts/test/**`, shared fixture module                              | S0                |
| P1.5 | Security + boot                              | loopback bind, `Origin` allowlist, per-launch bearer on all commands, env wiring | S0.9              |
| P1.6 | Git + filesystem inspection                  | `apps/server/src/workspace/**`                                                   | S0                |
| P1.7 | Artifact store                               | `apps/server/src/artifacts/**`                                                   | S1 (repos)        |

**P1.1 is the highest-leverage task in the project.** It is what makes every adapter track testable without an SDK, and it is the continuous proof no harness assumption leaked into the core. Staff it first, not last. It must: echo text, drive a scripted tool part through all four statuses, emit reasoning, open one permission and one multi-question input request, honor interrupt, and expose controllable idempotent vs. ambiguous dispatch outcomes.

**P1.4 fixtures are the seam between server and UI tracks.** Concrete event/snapshot fixtures published from contracts let P1.2/P1.3 build against a mock server while S1–S4 are still in flight. Without them the UI tracks idle for a wave.

Contract tests to land here (from PLAN's _Contract Tests_): payload validity per event, per-scope sequencing + cross-scope cursor rejection, `part.delta` absent from snapshots/replay/`id:`, stable part order under out-of-order arrival, `commandId` idempotency, one assistant message per user message, immutable `ResolvedExecution.display` after config removal.

**Gate G1:** fake adapter drives a full turn end to end — command → dispatcher → turn → parts → SSE → rendered transcript — and survives a browser reload mid-turn.

### Spikes to run early (throwaway, in Wave 1)

Two items carry real risk of pushing back on the contract. Run them while contracts are still cheap to change:

- **Claude part synthesis** — diffing content blocks across successive `SDKAssistantMessage` snapshots into stable Aide part ids. If `Part` isn't genuinely harness-neutral, this is where it shows.
- **Claude permission inversion** — holding an unresolved `canUseTool` promise across a browser round trip.

Both are throwaway spikes owned by the eventual Claude track owner. Their only deliverable is a yes/no on the contract plus any required S0 amendment, raised before Wave 2.

---

## Wave 2 — Configuration and supervision

### Spine

| ID  | Task                            | Notes                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S5  | Config service + merge resolver | Global + project DB records, `config.update` with durable receipt, the five documented merge rules (not object spread), map-key/`instanceId` mismatch rejection, per-instance validation isolation (one malformed instance disables only itself + `harness.instance_failed`), path/tilde/env resolution _after_ assembly, deterministic recompute matching boot |
| S6  | Instance supervisor             | `configured → starting → ready \| degraded \| stopped \| failed`, concurrent non-blocking boot (HTTP binds before instances are ready), exponential capped backoff, reconcile-on-change (add/remove/restart only what changed), shutdown + orphan reaping, `autoStart: false` lazy start, `harness.*` events, `GET /instances`                                  |

### Fan-out

| ID   | Task                         | Owns                                 | Depends on       |
| ---- | ---------------------------- | ------------------------------------ | ---------------- |
| P2.1 | OpenCode adapter: lifecycle  | `harness/opencode/**`                | S0.8, P1.1 suite |
| P2.2 | Claude adapter: lifecycle    | `harness/claude/**`                  | S0.8, P1.1 suite |
| P2.3 | MCP registry + normalization | `apps/server/src/mcp/**`             | S0.3             |
| P2.4 | Settings UI                  | `apps/web/src/features/settings/**`  | S0.3, S0.5       |
| P2.5 | Instances/health UI          | `apps/web/src/features/instances/**` | S0.4, S0.6       |
| P2.6 | Inventory cache layer        | `apps/server/src/inventory/**`       | S1               |

P2.1/P2.2 scope here is: pin the exact SDK version, author `configSchema`, implement `start`/`stop`/`health`, and get `discover` returning real inventory. Send/stream/interrupt is Wave 3. P2.3 delivers resolution order, additive merge by server name, and secret redaction — adapter-side translation lands with each adapter.

Two implementation notes from the wave, both about how "adapter done = conformance suite green" applies before the send path exists:

- The conformance suite now takes a `scope` of `"lifecycle"` or `"full"`. Wave 2 adapters run at `lifecycle`, which covers config, start/stop/health, discovery, MCP normalization, and instance isolation; the session and turn expectations are skipped until Wave 3 flips each adapter to `full`. Same suite, same file — only which expectations apply changes.
- Both adapters take an injectable SDK factory (`createRuntime` / `createSession`) so the suite runs against a double. A suite needing a live OpenCode server, a Claude Code install, and real provider credentials would not run in CI, and the adapter contract is what is under test.

Per-instance validation isolation (S5.2) lands in the merge rather than in storage: the record schemas validate `instances` as a whole, so anything persisted is already structurally sound. The realistic malformed instance is one whose driver-specific `config` its own adapter rejects, so `mergeConfig` takes a `validateDriverConfig` hook fed from each adapter's `configSchema`.

**Gate G2:** boot with OpenCode, Claude, a second Claude, and one intentionally malformed instance. Supervisor reconciles, UI shows health/auth/version, editing config applies without a server restart, the malformed one fails alone.

---

## Wave 3 — Execution and cross-harness

### Spine

| ID  | Task                         | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S7  | Context builder              | Bounded portable handoff packet, character-budget policy (newest turns first, never split a tool outcome unmarked, always identify omitted ranges), `<handoff>` escaping, `NativeDispatchInput` persistence excluded from transcript + future handoff ranges, `syncCursor` advance-on-clean-completion / mark-unsafe rules, native-resume safety predicate (same instance + mapping row + adapter can open + last turn terminal-clean), **reasoning never crosses** |
| S8  | Turn execution orchestration | Resolve + revalidate selection against current inventory, `(sessionId, instanceId)` native mapping, durable dispatch integration with native idempotency keys, assistant placeholder creation, terminal states, interrupt idempotency, instance-death-mid-turn → `failed` with no silent reroute                                                                                                                                                                    |

S7 lands **before** multi-turn native chat, per PLAN. It is a Day 0 correctness requirement, not a Phase 4 nicety.

### Fan-out

| ID   | Task                                                                                                                                                                                                                                                                                        | Depends on        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| P3.1 | OpenCode adapter: send path — `switchModel`(+variant)/`switchAgent` before prompt admission, `session.prompt` with Aide message id as prompt `id`, `session.events` mapping, `permission.reply`/`question.reply`/`question.reject`, `interrupt`, version-incompat error                     | P2.1, S0.8        |
| P3.2 | Claude adapter: send path — streaming input mode, `includePartialMessages`, part synthesis with stable ids, `setModel`/`setPermissionMode`, effort-change requery policy, `canUseTool` inversion with persisted request before await, `resume`/`resumeSessionAt`/`forkSession`, `interrupt` | P2.2, S0.8, spike |
| P3.3 | Composer UI — capability-driven controls, descriptor-generated selects, 5-level precedence, clear-invalid-then-default on model change, preserve valid agent/mode, block on unauthenticated                                                                                                 | P2.5, P2.6        |
| P3.4 | Requests UI — permission + multi-question/multi-select/free-text input, survives reconnect                                                                                                                                                                                                  | S0.2              |
| P3.5 | Streaming UI — delta application, tool part lifecycle, reasoning rendering                                                                                                                                                                                                                  | P1.3              |
| P3.6 | Cross-harness test suite — written against two _fake_ instances before real adapters land                                                                                                                                                                                                   | P1.1              |

P3.6 written early against two fake instances is what makes S7 verifiable the day it merges.

**Gate G3:** one session, OpenCode → Claude → OpenCode. Second OpenCode send hands off exactly the Claude-authored messages after its `syncCursor`, nothing already represented, no reasoning parts crossing.

---

## Wave 4 — Recovery, tools, workspace (near-fully parallel)

| ID     | Task                                                                                                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P4.1   | Boot recovery: reconcile `dispatching`/`dispatched`/`uncertain` receipts, `running` turns, stranded `canUseTool` promises → failed turn; retry only on provable non-effect or SDK idempotency, else `execution_outcome_unknown` |
| P4.2   | Dynamic MCP: in-process `createSdkMcpServer()` toolsets for Claude, loopback HTTP + per-instance bearer fallback for OpenCode, identical toolset definition both ways, `mcp.reconnect`, `harness.mcp_status_changed`            |
| P4.3   | Workspace UI: changed files panel + diff view (consumes P1.6)                                                                                                                                                                   |
| P4.4   | Usage and cost reporting where reported                                                                                                                                                                                         |
| P4.5   | Artifact path end-to-end for large tool output                                                                                                                                                                                  |
| P4.6   | Integration suite covering acceptance criteria 1–18                                                                                                                                                                             |
| **S9** | **Acceptance gate** — serial. Full Day 0 checklist on one build.                                                                                                                                                                |

---

## Rules that make the fan-out safe

1. **Contracts are append-only after S0.** Breaking changes: dedicated PR, contracts only, one integrator, broadcast to active tracks.
2. **One directory, one owner.** No track edits another track's directory. Cross-track needs go through the seam (contracts, repos, or fixtures), not a direct edit.
3. **SDK imports are firewalled by lint** (S0.10). An SDK type reaching `packages/contracts` or `apps/web` is a build failure, not a review comment.
4. **Adapter done = conformance suite green.** Same suite for fake, OpenCode, and Claude. No adapter merges on bespoke tests alone.
5. **Fixtures, not running servers, unblock UI work.** If a UI track is blocked on a server track, the missing artifact is a fixture — file it against P1.4.
6. **Every task's DoD:** typecheck + oxlint + its own tests green, contracts unchanged, and the relevant wave gate still passes.

## Staffing the critical path

The spine (S0→S9) is ~9 serial units and is the floor on schedule. Everything else absorbs additional workers. If you have people idle, the order to add them is:

1. P1.1 fake adapter + conformance suite (unblocks two adapter tracks and the whole cross-harness suite)
2. P1.4 fixtures (unblocks both UI tracks for a full wave)
3. The two Claude spikes (protects the contract freeze while it's still cheap)

Reordering note vs. PLAN's phases: the inventory cache (PLAN Phase 3) is pulled into Wave 2 because the supervisor needs somewhere to write discovery results at boot, and the context builder (PLAN Phase 4) is the Wave 3 spine rather than a task inside adapter work — PLAN already flags it as a Day 0 correctness requirement that lands before multi-turn native chat.
