# Graph Report - aide  (2026-08-20)

## Corpus Check
- 235 files · ~133,812 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2025 nodes · 4538 edges · 121 communities (103 shown, 18 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 18 edges (avg confidence: 0.65)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f20e8aad`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- config/service.ts
- contracts/src/index.ts
- commands.ts
- opencode/index.ts
- aide — Design System
- snapshots.ts
- fixtures.ts
- opencode/adapter.ts
- AideEvent
- db/index.ts
- EventService
- claude/adapter.test.ts
- events.ts
- compilerOptions
- repos.test.ts
- app.ts
- git.ts
- instances-boundary.tsx
- AideDb
- scripts
- composer-state.ts
- TurnService
- AdapterRegistry
- event-store.ts
- claude/index.ts
- config-draft.ts
- store.ts
- compilerOptions
- Aide Plan
- session.ts
- web/components.json
- ui/components.json
- InstanceSupervisor
- dependencies
- theme-provider.tsx
- schema.ts
- events/index.ts
- supervisor.ts
- devDependencies
- compilerOptions
- core.test.ts
- scripts
- App.tsx
- Contributor Covenant Code of Conduct
- Aide Build Breakdown — Serial Spine and Parallel Tracks
- @vitest/coverage-istanbul
- scripts
- request-card.tsx
- session-boundary.tsx
- .oxfmtrc.json
- .exec
- compilerOptions
- web/package.json
- devDependencies
- scripts
- compilerOptions
- tasks
- claude/adapter.ts
- turn.test.ts
- generate-tokens.mjs
- send.test.ts
- .oxlintrc.json
- parts.ts
- ui/package.json
- Implementation Phases
- services/index.ts
- supervisor.test.ts
- transcript.tsx
- scripts
- contract-tests.test.ts
- scripts
- turn.ts
- index.astro
- www/tsconfig.json
- changes.test.ts
- compilerOptions
- changes.ts
- API contracts and Bruno tests
- handlers.ts
- FakeEventSource
- AideError
- ArtifactStore
- compilerOptions
- instancesSnapshotFixture
- Starlight Starter Kit: Basics
- workspace-changes.test.ts
- Testing Strategy
- Aide Events
- web/tsconfig.json
- jsdom
- @testing-library/dom
- repos.ts
- opencode.json
- vite
- Wave 1 — Kernel
- vitest
- @testing-library/user-event
- @testing-library/react
- @testing-library/user-event
- @turbo/gen
- CONTRACTS_SCHEMA_VERSION
- AGENTS.md
- graphify.js
- @workspace/contracts
- Initial Scope
- Server Architecture
- content.config.ts
- README.md

## God Nodes (most connected - your core abstractions)
1. `AideDb` - 48 edges
2. `InstanceSupervisor` - 37 edges
3. `AideEvent` - 35 edges
4. `TurnService` - 34 edges
5. `EventService` - 32 edges
6. `HarnessAdapter` - 32 edges
7. `AideError` - 32 edges
8. `Database` - 26 edges
9. `Aide Plan` - 25 edges
10. `createAideTestApp()` - 23 edges

## Surprising Connections (you probably didn't know these)
- `lifecycleAdapter()` --calls--> `inventoryFixture()`  [EXTRACTED]
  apps/server/src/integration/production.test.ts → packages/contracts/src/fixtures.ts
- `inventory()` --calls--> `inventoryFixture()`  [EXTRACTED]
  apps/server/src/inventory/service.test.ts → packages/contracts/src/fixtures.ts
- `createStubAdapter()` --calls--> `inventoryFixture()`  [EXTRACTED]
  apps/server/src/supervisor/supervisor.test.ts → packages/contracts/src/fixtures.ts
- `ConfigMergeError` --references--> `AideError`  [EXTRACTED]
  apps/server/src/config/merge.ts → packages/contracts/src/primitives.ts
- `ClaudeRuntimeFailure` --references--> `AideError`  [EXTRACTED]
  apps/server/src/harness/claude/session.ts → packages/contracts/src/primitives.ts

## Import Cycles
- 2-file cycle: `apps/server/src/db/index.ts -> apps/server/src/db/repos.ts -> apps/server/src/db/index.ts`
- 3-file cycle: `apps/server/src/db/config-secrets-key.ts -> apps/server/src/db/repos.ts -> apps/server/src/db/index.ts -> apps/server/src/db/config-secrets-key.ts`

## Communities (121 total, 18 thin omitted)

### Community 0 - "config/service.ts"
Cohesion: 0.06
Nodes (63): ConfigMergeError, DEFAULT_PROJECTS_DIRECTORY, DriverConfigValidator, emptyGlobalConfig(), instanceValidationError(), InstanceValidationFailure, mergeConfig(), mergeDefaults() (+55 more)

### Community 1 - "contracts/src/index.ts"
Cohesion: 0.08
Nodes (42): AgentPart, agentPartSchema, assistantMessageMetadataSchema, assistantMessageSchema, ExecutionDisplay, executionDisplaySchema, executionSelectionSchema, FilePart (+34 more)

### Community 2 - "commands.ts"
Cohesion: 0.08
Nodes (25): commandEnvelopeSchema, configUpdateCommandSchema, configUpdateTargetSchema, inputRespondCommandSchema, instanceRestartCommandSchema, instanceStartCommandSchema, instanceStopCommandSchema, inventoryRefreshCommandSchema (+17 more)

### Community 3 - "opencode/index.ts"
Cohesion: 0.13
Nodes (23): authFromProviders(), createOpencodeAdapter(), AGENTS, AgentsPayload, PROVIDERS, ProvidersPayload, createOpencodeRuntime(), OpencodeAgent (+15 more)

### Community 4 - "aide — Design System"
Cohesion: 0.05
Nodes (42): 10.1 Starlight mapping, 10.2 Pages, 10. Marketing site & docs, 11.1 `packages/ui/src/styles/globals.css`, 11.2 Migration checklist, 11. Implementation, 12. Decision log, 1. Brand fundamentals (+34 more)

### Community 5 - "snapshots.ts"
Cohesion: 0.08
Nodes (28): ReadClientOptions, ReadError, globalConfigRecordSchema, projectConfigRecordSchema, turnSchema, instancesEventScopeSchema, sessionEventScopeSchema, harnessCapabilitiesSchema (+20 more)

### Community 6 - "fixtures.ts"
Cohesion: 0.14
Nodes (29): createReceiptAndMessages(), bootStream(), durableEvent(), openPermissionEvent(), partEvent(), Recording, snapshotWithSequence(), SubscribeOptions (+21 more)

### Community 7 - "opencode/adapter.ts"
Cohesion: 0.09
Nodes (33): fakeConfigSchema, FakeDispatchMode, FakeGate, FakeHarnessAdapterOptions, FakeInstance, FakeNativeSession, FakeTurn, adapterError() (+25 more)

### Community 8 - "AideEvent"
Cohesion: 0.10
Nodes (21): FakeHarnessControl, HarnessAdapter, InstanceHandle, NativeSession, assertCommonEventInvariants(), buildUserMessage(), ConformanceOptions, ConformanceScope (+13 more)

### Community 9 - "db/index.ts"
Cohesion: 0.09
Nodes (22): applyMigrations(), migrationsFolder, ConfigUpdateCommand, environment, closeDb(), createDb(), getDb(), initializeDb() (+14 more)

### Community 10 - "EventService"
Cohesion: 0.11
Nodes (18): EventScopeTarget, createSubscription(), EventService, eventTarget(), sameScope(), scopeKey(), validateSequence(), canSend() (+10 more)

### Community 11 - "claude/adapter.test.ts"
Cohesion: 0.18
Nodes (10): MODELS, never, AideInteractionMode, claudeConfigSchema, ClaudeInstanceConfig, DEFAULT_STARTUP_TIMEOUT_MS, INTERACTION_MODE_TO_PERMISSION_MODE, isCompatibleRuntimeVersion() (+2 more)

### Community 12 - "events.ts"
Cohesion: 0.06
Nodes (32): aideEventBaseSchema, configUpdatedEventSchema, durableDeliverySchema, ephemeralDeliverySchema, errorOccurredEventSchema, EventDelivery, eventDeliverySchema, EventScope (+24 more)

### Community 13 - "compilerOptions"
Cohesion: 0.07
Nodes (26): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection, moduleResolution (+18 more)

### Community 14 - "repos.test.ts"
Cohesion: 0.16
Nodes (16): eventLogRepo, projectsRepo, receiptsRepo, requestsRepo, sessionsRepo, createProjectAndSession(), migrationsFolder, createSessionRecords() (+8 more)

### Community 15 - "app.ts"
Cohesion: 0.05
Nodes (53): hono, assertReceiptTransition(), CommandDispatcher, CommandFor, CommandHandler, CommandHandlerRegistry, createCommandDispatcher(), DispatcherOptions (+45 more)

### Community 16 - "git.ts"
Cohesion: 0.11
Nodes (28): WorkspaceError, WorkspaceErrorInput, errorDetail(), execFileAsync, execGit(), execGitChecked(), gitDiffSummary(), gitStatus() (+20 more)

### Community 17 - "instances-boundary.tsx"
Cohesion: 0.11
Nodes (28): CommandClient, defaultCommandClient, defaultReadClient, InstancesBoundary(), InstancesBoundaryProps, ReadClient, Subscribe, AUTH_LABEL (+20 more)

### Community 18 - "AideDb"
Cohesion: 0.22
Nodes (19): AideDb, createMessage(), getConfig(), getProject(), getReceipt(), getRequest(), getSession(), getTurn() (+11 more)

### Community 19 - "scripts"
Cohesion: 0.07
Nodes (27): dependencies, astro, @astrojs/starlight, @fontsource/instrument-serif, @fontsource-variable/instrument-sans, @fontsource-variable/jetbrains-mono, sharp, devDependencies (+19 more)

### Community 20 - "composer-state.ts"
Cohesion: 0.12
Nodes (24): Composer(), ComposerProps, agentChoicesFor(), applyComposerChange(), COMPOSER_CONTROL_IDS, ComposerControl, ComposerDraft, ComposerSources (+16 more)

### Community 21 - "TurnService"
Cohesion: 0.23
Nodes (5): withTransaction(), errorOf(), TurnService, event(), Turn

### Community 22 - "AdapterRegistry"
Cohesion: 0.17
Nodes (9): AdapterRegistry, RegisteredAdapter, entry(), instance(), CoreServiceError, ExecutionResolver, ProjectServiceOptions, ExecutionSelection (+1 more)

### Community 23 - "event-store.ts"
Cohesion: 0.15
Nodes (6): ProjectService, Listener, LiveFragment, SessionStoreState, Project, Session

### Community 24 - "claude/index.ts"
Cohesion: 0.16
Nodes (24): ClaudeAccountInfo, ClaudeAgentInfo, ClaudeContentBlock, ClaudeDialogAsk, ClaudeDialogResult, ClaudeInitInfo, ClaudeMcpServerStatus, ClaudeModelInfo (+16 more)

### Community 25 - "config-draft.ts"
Cohesion: 0.15
Nodes (26): ConfigDraft, configToDraft(), DraftIssue, DraftValidation, DRIVERS, emptyDraft(), issuesFor(), newInstance() (+18 more)

### Community 26 - "store.ts"
Cohesion: 0.20
Nodes (8): ArtifactError, ArtifactErrorCode, Artifact, ArtifactMetadata, ArtifactStoreOptions, DEFAULT_MAX_ARTIFACT_BYTES, PutArtifactInput, artifactsRepo

### Community 27 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit (+12 more)

### Community 28 - "Aide Plan"
Cohesion: 0.10
Nodes (21): Aide Plan, Claude Agent SDK Adapter, Commands, Configuration and Instances, Configuration merge and precedence, Context Ownership and Harness Switching, Core Principles, Current Workspace (+13 more)

### Community 29 - "session.ts"
Cohesion: 0.16
Nodes (20): ActiveTurn, assertAnswerable(), ClaudeRuntimeOptions, createClaudeRuntime(), effortFor(), firstString(), normalizeDialogQuestions(), PATH_INPUT_KEYS (+12 more)

### Community 30 - "web/components.json"
Cohesion: 0.10
Nodes (19): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+11 more)

### Community 31 - "ui/components.json"
Cohesion: 0.10
Nodes (19): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+11 more)

### Community 32 - "InstanceSupervisor"
Cohesion: 0.15
Nodes (5): EffectiveConfig, InstanceSupervisor, sameLifecycleConfig(), sameValue(), toAideError()

### Community 33 - "dependencies"
Cohesion: 0.08
Nodes (25): @base-ui/react, class-variance-authority, clsx, @fontsource-variable/outfit, dependencies, @base-ui/react, class-variance-authority, clsx (+17 more)

### Community 34 - "theme-provider.tsx"
Cohesion: 0.21
Nodes (13): disableTransitionsTemporarily(), getSystemTheme(), isEditableTarget(), isTheme(), ResolvedTheme, ThemeConsumer(), Theme, THEME_VALUES (+5 more)

### Community 35 - "schema.ts"
Cohesion: 0.12
Nodes (15): adapterIdMappings, artifacts, commandReceipts, configRecords, dispatchInputs, eventLog, inventoryCache, messages (+7 more)

### Community 36 - "events/index.ts"
Cohesion: 0.13
Nodes (20): afterSequence(), createEventRouter(), migrationsFolder, DurableEvent, DurableEventInput, EventServiceError, EventServiceErrorCode, EventSubscription (+12 more)

### Community 37 - "supervisor.ts"
Cohesion: 0.23
Nodes (10): backoffDelay(), BackoffPolicy, DEFAULT_BACKOFF, shouldRetry(), createInstancesRouter(), AdapterResolver, SupervisedInstance, SupervisorOptions (+2 more)

### Community 38 - "devDependencies"
Cohesion: 0.08
Nodes (25): devDependencies, jsdom, tailwindcss, @tailwindcss/vite, @testing-library/dom, @testing-library/jest-dom, @types/node, @types/react (+17 more)

### Community 39 - "compilerOptions"
Cohesion: 0.09
Nodes (22): compilerOptions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit, noFallthroughCasesInSwitch (+14 more)

### Community 40 - "core.test.ts"
Cohesion: 0.14
Nodes (12): dispatchInputsRepo, nativeMappingsRepo, SendTurnInput, command(), createProjectSession(), migrationsFolder, resolveOpenRequests(), selection (+4 more)

### Community 41 - "scripts"
Cohesion: 0.04
Nodes (44): @anthropic-ai/claude-agent-sdk, dependencies, @anthropic-ai/claude-agent-sdk, drizzle-orm, @opencode-ai/sdk, @standard-schema/spec, @t3-oss/env-core, @workspace/contracts (+36 more)

### Community 42 - "App.tsx"
Cohesion: 0.12
Nodes (21): App(), AppProps, commandClient, defaultSubscribeInstances(), defaultSubscribeSession(), readClient, config, transport (+13 more)

### Community 43 - "Contributor Covenant Code of Conduct"
Cohesion: 0.15
Nodes (12): 1. Correction, 2. Warning, 3. Temporary Ban, 4. Permanent Ban, Attribution, Contributor Covenant Code of Conduct, Enforcement, Enforcement Guidelines (+4 more)

### Community 44 - "Aide Build Breakdown — Serial Spine and Parallel Tracks"
Cohesion: 0.13
Nodes (13): Aide Build Breakdown — Serial Spine and Parallel Tracks, Dependency graph, Fan-out, Fan-out, Rules that make the fan-out safe, Spine, Spine, Staffing the critical path (+5 more)

### Community 46 - "scripts"
Cohesion: 0.17
Nodes (12): scripts, build, dev, format, format:check, lint, lint:fix, preview (+4 more)

### Community 47 - "request-card.tsx"
Cohesion: 0.21
Nodes (5): RequestCard(), RequestResolution, Button(), buttonVariants, cn()

### Community 48 - "session-boundary.tsx"
Cohesion: 0.09
Nodes (22): CommandClient, defaultCommandClient, defaultReadClient, errorMessage(), latestExecution(), ReadClient, SessionBoundary(), SessionBoundaryProps (+14 more)

### Community 49 - ".oxfmtrc.json"
Cohesion: 0.11
Nodes (18): ignorePatterns, **/coverage/**, **/dist/**, **/graphify-out/**, **/node_modules/**, **/.turbo/**, printWidth, $schema (+10 more)

### Community 50 - ".exec"
Cohesion: 0.24
Nodes (9): applyMigrations(), applyMigrations(), insertProjectAndSession(), insertUserMessage(), migrationsFolder, applyMigrations(), applyMigrations(), applyMigrations() (+1 more)

### Community 51 - "compilerOptions"
Cohesion: 0.12
Nodes (15): compilerOptions, jsx, jsxImportSource, module, moduleResolution, noEmit, skipLibCheck, strict (+7 more)

### Community 52 - "web/package.json"
Cohesion: 0.12
Nodes (15): dependencies, react, react-dom, @remixicon/react, @workspace/contracts, @workspace/ui, react, react-dom (+7 more)

### Community 53 - "devDependencies"
Cohesion: 0.12
Nodes (17): devDependencies, @tailwindcss/vite, @testing-library/jest-dom, @testing-library/react, @types/node, @types/react, @types/react-dom, typescript (+9 more)

### Community 54 - "scripts"
Cohesion: 0.06
Nodes (34): oxfmt, oxlint, dependencies, @t3-oss/env-core, zod, devDependencies, oxfmt, oxlint (+26 more)

### Community 55 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, jsx, lib, module, moduleResolution, noEmit, paths, skipLibCheck (+12 more)

### Community 56 - "tasks"
Cohesion: 0.05
Nodes (37): ^build, .env*, ^format, ^format:check, ^lint, ^lint:fix, $TURBO_DEFAULT$, ^typecheck (+29 more)

### Community 57 - "claude/adapter.ts"
Cohesion: 0.13
Nodes (13): adapterError(), CAPABILITIES, ClaudeAdapterOptions, EFFORT_LEVELS, effortDescriptor(), INTERACTION_MODES, StartedInstance, toHarnessModel() (+5 more)

### Community 58 - "turn.test.ts"
Cohesion: 0.13
Nodes (13): inventoryCacheRepo, partsRepo, createFakeHarnessAdapter(), fakeError(), boot(), applyMigrations(), migrationsFolder, resolverFor() (+5 more)

### Community 59 - "generate-tokens.mjs"
Cohesion: 0.20
Nodes (6): globalsCss, globalsPath, monorepo, outPath, parsed, root

### Community 60 - "send.test.ts"
Cohesion: 0.26
Nodes (17): createClaudeAdapter(), collect(), completeImmediately(), execution(), INSTANCE, openPermission(), parkOnPermission(), permissionFor() (+9 more)

### Community 61 - ".oxlintrc.json"
Cohesion: 0.12
Nodes (15): categories, correctness, env, builtin, ignorePatterns, **/coverage/**, **/dist/**, graphify-out/** (+7 more)

### Community 62 - "parts.ts"
Cohesion: 0.19
Nodes (10): BlockKind, BlockRecord, createPartSynthesizer(), PartSynthesizer, stringifyToolOutput(), SynthesizedDelta, TOOL_CATEGORIES, toolIdentity() (+2 more)

### Community 63 - "ui/package.json"
Cohesion: 0.20
Nodes (9): exports, ./components/*, ./globals.css, ./hooks/*, ./lib/*, name, private, type (+1 more)

### Community 64 - "Implementation Phases"
Cohesion: 0.20
Nodes (10): Implementation Phases, Phase 1: Foundation, Phase 2: Configuration and Instance Supervision, Phase 3: Inventory and Composer, Phase 4: Chat on Both Adapters, Phase 5: Parts, Requests, and Recovery, Phase 6: MCP and Dynamic Tools, Phase 7: Workspace Awareness (+2 more)

### Community 65 - "services/index.ts"
Cohesion: 0.30
Nodes (12): applyPortableHandoffBudget(), BuildPortableHandoffInput, buildPortableHandoffPacket(), escapeHandoffTags(), omittedRanges(), PortableHandoffMessage, PortableHandoffPacket, PortableToolOutcome (+4 more)

### Community 66 - "supervisor.test.ts"
Cohesion: 0.25
Nodes (4): createStubAdapter(), effective(), effectiveWithMcp(), runTimers()

### Community 67 - "transcript.tsx"
Cohesion: 0.26
Nodes (9): ExecutionDisplay(), byIndexThenId(), bySeqThenId(), toolInputText(), ToolPartView(), toolStatusStyles, Transcript(), AssistantMessage (+1 more)

### Community 68 - "scripts"
Cohesion: 0.08
Nodes (24): dependencies, zod, devDependencies, typescript, vitest, @vitest/coverage-istanbul, exports, typescript (+16 more)

### Community 69 - "contract-tests.test.ts"
Cohesion: 0.16
Nodes (12): commandNameSchema, commandReceiptSchema, commandSchema, instancesMapSchema, partSchema, projectSchema, requestSchema, aideEventSchema (+4 more)

### Community 70 - "scripts"
Cohesion: 0.22
Nodes (9): scripts, format, format:check, lint, lint:fix, test, test:coverage, test:watch (+1 more)

### Community 71 - "turn.ts"
Cohesion: 0.27
Nodes (9): ExternalCommandContext, ActiveTurn, PendingDispatch, startedStream(), TurnServiceOptions, withoutDelivery(), InputResolution, PermissionResolution (+1 more)

### Community 72 - "index.astro"
Cohesion: 0.17
Nodes (7): ../assets/harnesses/claude.svg?url, ../assets/harnesses/openai.svg?url, ../assets/harnesses/opencode.svg?url, [], panels, tabs, diffRows

### Community 73 - "www/tsconfig.json"
Cohesion: 0.25
Nodes (7): exclude, extends, include, **/*, dist, astro/tsconfigs/strict, .astro/types.d.ts

### Community 74 - "changes.test.ts"
Cohesion: 0.21
Nodes (8): messagesRepo, turnsRepo, selection, createTurn(), execFileAsync, git(), makeRepo(), tempDirs

### Community 75 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, jsx, lib, module, moduleResolution, outDir, skipLibCheck, strict (+10 more)

### Community 76 - "changes.ts"
Cohesion: 0.24
Nodes (7): SessionFileChange, sessionFileChangesRepo, CaptureInput, sameChange(), SessionChangesOptions, SessionChangesTracker, WorkspaceFileChange

### Community 77 - "API contracts and Bruno tests"
Cohesion: 0.29
Nodes (6): API contracts and Bruno tests, Bruno collection, Checklist for contract changes, Contract sources, Running tests, When to update `bruno-api-test/`

### Community 78 - "handlers.ts"
Cohesion: 0.22
Nodes (7): CommandFor, CoreCommandServices, createCoreCommandHandlers(), createSupervisionHandlers(), context, db, CommandName

### Community 80 - "AideError"
Cohesion: 0.29
Nodes (5): ClaudeAdapterError, FakeAdapterError, OpencodeAdapterError, SupervisorError, AideError

### Community 82 - "compilerOptions"
Cohesion: 0.29
Nodes (6): compilerOptions, module, moduleResolution, skipLibCheck, strict, target

### Community 83 - "instancesSnapshotFixture"
Cohesion: 0.36
Nodes (5): fixture(), entry(), firstId(), snapshot(), instancesSnapshotFixture()

### Community 84 - "Starlight Starter Kit: Basics"
Cohesion: 0.33
Nodes (5): Cloudflare, 🧞 Commands, 🚀 Project Structure, Starlight Starter Kit: Basics, 👀 Want to learn more?

### Community 85 - "workspace-changes.test.ts"
Cohesion: 0.38
Nodes (5): execFileAsync, git(), makeRepo(), selection, tempDirs

### Community 86 - "Testing Strategy"
Cohesion: 0.33
Nodes (6): Adapter Tests, Contract Tests, Cross-Harness Tests, Fake Adapter, Integration Tests, Testing Strategy

### Community 87 - "Aide Events"
Cohesion: 0.33
Nodes (6): Aide Events, Document, General, Instances, Runtime, and Inventory, Requests, Turn

### Community 88 - "web/tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, paths, files, ../../packages/ui/src/*, @workspace/ui/*, references

### Community 91 - "repos.ts"
Cohesion: 0.09
Nodes (18): RepoError, RepoErrorCode, AdapterIdMapping, AdapterMappingKind, adapterMappingsRepo, Artifact, artifactSchema, CommandReceiptRecord (+10 more)

### Community 92 - "opencode.json"
Cohesion: 0.50
Nodes (3): plugin, $schema, .opencode/plugins/graphify.js

### Community 94 - "Wave 1 — Kernel"
Cohesion: 0.50
Nodes (4): Fan-out (parallel — all start when S0 merges), Spikes to run early (throwaway, in Wave 1), Spine (serial, in order), Wave 1 — Kernel

### Community 104 - "Initial Scope"
Cohesion: 0.67
Nodes (3): Excluded Initially, Included, Initial Scope

## Knowledge Gaps
- **671 isolated node(s):** `$schema`, `.opencode/plugins/graphify.js`, `$schema`, `printWidth`, `tabWidth` (+666 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `hono` connect `app.ts` to `config/service.ts`, `scripts`, `events/index.ts`, `supervisor.ts`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `dependencies` connect `scripts` to `app.ts`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **What connects `$schema`, `.opencode/plugins/graphify.js`, `$schema` to the rest of the system?**
  _671 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `config/service.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05787545787545788 - nodes in this community are weakly interconnected._
- **Should `contracts/src/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0821256038647343 - nodes in this community are weakly interconnected._
- **Should `commands.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08262108262108261 - nodes in this community are weakly interconnected._
- **Should `opencode/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12873563218390804 - nodes in this community are weakly interconnected._