# Graph Report - aide  (2026-08-22)

## Corpus Check
- 235 files · ~134,727 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2027 nodes · 4543 edges · 112 communities (95 shown, 17 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 18 edges (avg confidence: 0.65)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `693d5a3e`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- config/service.ts
- domain.ts
- commands.ts
- opencode/adapter.ts
- aide — Design System
- snapshot.ts
- fixtures.ts
- claude/adapter.ts
- AideEvent
- supervisor.test.ts
- command-client.ts
- dispatcher.ts
- contracts/src/index.ts
- compilerOptions
- repos.test.ts
- app.ts
- git.ts
- instances-boundary.tsx
- repos.ts
- scripts
- composer-state.ts
- App.tsx
- services/index.ts
- session-navigation.tsx
- claude/index.ts
- config-draft.ts
- store.ts
- compilerOptions
- Aide Plan
- session.ts
- web/components.json
- ui/components.json
- supervisor.ts
- dependencies
- theme-provider.tsx
- schema.ts
- turn.ts
- @tailwindcss/vite
- devDependencies
- compilerOptions
- turn.test.ts
- scripts
- event-source.ts
- Contributor Covenant Code of Conduct
- Aide Build Breakdown — Serial Spine and Parallel Tracks
- @vitest/coverage-istanbul
- scripts
- web/package.json
- session-boundary.tsx
- .oxfmtrc.json
- .exec
- compilerOptions
- dependencies
- devDependencies
- scripts
- compilerOptions
- tasks
- claude-sdk-double.ts
- @testing-library/dom
- generate-tokens.mjs
- send.test.ts
- .oxlintrc.json
- parts.ts
- ui/package.json
- Implementation Phases
- transcript.tsx
- scripts
- scripts
- index.astro
- www/tsconfig.json
- compilerOptions
- AideDb
- API contracts and Bruno tests
- FakeEventSource
- AideError
- compilerOptions
- read-client.test.ts
- Starlight Starter Kit: Basics
- workspace-changes.test.ts
- Testing Strategy
- Aide Events
- web/tsconfig.json
- @testing-library/dom
- db/index.ts
- opencode.json
- vite
- Wave 1 — Kernel
- vitest
- @testing-library/user-event
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
- `entry()` --calls--> `instancesSnapshotFixture()`  [EXTRACTED]
  apps/web/src/features/instances/instances-panel.test.tsx → packages/contracts/src/fixtures.ts
- `durableEvent()` --calls--> `userMessageFixture()`  [EXTRACTED]
  apps/web/src/features/sessions/session-boundary.test.tsx → packages/contracts/src/fixtures.ts
- `ConfigMergeError` --references--> `AideError`  [EXTRACTED]
  apps/server/src/config/merge.ts → packages/contracts/src/primitives.ts
- `createReceiptAndMessages()` --calls--> `assistantMessageFixture()`  [EXTRACTED]
  apps/server/src/db/repos.test.ts → packages/contracts/src/fixtures.ts
- `ClaudeRuntimeFailure` --references--> `AideError`  [EXTRACTED]
  apps/server/src/harness/claude/session.ts → packages/contracts/src/primitives.ts

## Import Cycles
- 2-file cycle: `apps/server/src/db/index.ts -> apps/server/src/db/repos.ts -> apps/server/src/db/index.ts`
- 3-file cycle: `apps/server/src/db/config-secrets-key.ts -> apps/server/src/db/repos.ts -> apps/server/src/db/index.ts -> apps/server/src/db/config-secrets-key.ts`

## Communities (112 total, 17 thin omitted)

### Community 0 - "config/service.ts"
Cohesion: 0.06
Nodes (61): ConfigMergeError, DEFAULT_PROJECTS_DIRECTORY, DriverConfigValidator, EffectiveConfig, emptyGlobalConfig(), instanceValidationError(), InstanceValidationFailure, mergeConfig() (+53 more)

### Community 1 - "domain.ts"
Cohesion: 0.06
Nodes (31): AgentPart, agentPartSchema, assistantMessageMetadataSchema, ExecutionDisplay, executionDisplaySchema, FilePart, filePartSchema, InputQuestion (+23 more)

### Community 2 - "commands.ts"
Cohesion: 0.07
Nodes (33): commandEnvelopeSchema, commandNameSchema, commandSchema, configUpdateCommandSchema, configUpdateTargetSchema, inputRespondCommandSchema, instanceRestartCommandSchema, instanceStartCommandSchema (+25 more)

### Community 3 - "opencode/adapter.ts"
Cohesion: 0.10
Nodes (31): adapterError(), authFromProviders(), CAPABILITIES, closeRuntimes(), createOpencodeAdapter(), notImplemented(), OpencodeAdapterOptions, StartedInstance (+23 more)

### Community 4 - "aide — Design System"
Cohesion: 0.05
Nodes (42): 10.1 Starlight mapping, 10.2 Pages, 10. Marketing site & docs, 11.1 `packages/ui/src/styles/globals.css`, 11.2 Migration checklist, 11. Implementation, 12. Decision log, 1. Brand fundamentals (+34 more)

### Community 5 - "snapshot.ts"
Cohesion: 0.14
Nodes (11): Listener, ReadClientOptions, ReadError, globalConfigRecordSchema, projectConfigRecordSchema, DurableCursor, InstanceSnapshotEntry, InstancesSnapshot (+3 more)

### Community 6 - "fixtures.ts"
Cohesion: 0.12
Nodes (30): bootStream(), durableEvent(), openPermissionEvent(), Recording, snapshotWithSequence(), SubscribeOptions, fixtureEvent(), partEvent() (+22 more)

### Community 7 - "claude/adapter.ts"
Cohesion: 0.08
Nodes (39): CAPABILITIES, EFFORT_LEVELS, effortDescriptor(), INTERACTION_MODES, StartedInstance, toHarnessModel(), createEventBus(), EventBus (+31 more)

### Community 8 - "AideEvent"
Cohesion: 0.10
Nodes (21): FakeHarnessControl, HarnessAdapter, InstanceHandle, NativeSession, assertCommonEventInvariants(), buildUserMessage(), ConformanceOptions, ConformanceScope (+13 more)

### Community 9 - "supervisor.test.ts"
Cohesion: 0.07
Nodes (19): applyMigrations(), migrationsFolder, createDriverConfigValidator(), ConfigUpdateCommand, environment, configRepo, Database, RunResult (+11 more)

### Community 10 - "command-client.ts"
Cohesion: 0.18
Nodes (5): CommandClientOptions, CommandError, createCommandClient(), Sleep, receipt

### Community 11 - "dispatcher.ts"
Cohesion: 0.12
Nodes (23): assertReceiptTransition(), CommandDispatcher, CommandFor, CommandHandler, CommandHandlerRegistry, createCommandDispatcher(), DispatcherOptions, ExternalCommandHandler (+15 more)

### Community 12 - "contracts/src/index.ts"
Cohesion: 0.08
Nodes (53): messageMetadataSchema, messageSchema, turnSchema, aideEventBaseSchema, configUpdatedEventSchema, durableDeliverySchema, ephemeralDeliverySchema, errorOccurredEventSchema (+45 more)

### Community 13 - "compilerOptions"
Cohesion: 0.07
Nodes (26): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection, moduleResolution (+18 more)

### Community 14 - "repos.test.ts"
Cohesion: 0.10
Nodes (26): adapterMappingsRepo, eventLogRepo, projectsRepo, requestsRepo, sessionsRepo, createProjectAndSession(), createReceiptAndMessages(), migrationsFolder (+18 more)

### Community 15 - "app.ts"
Cohesion: 0.12
Nodes (22): getDb(), env, envKeys, serverRoot, validEnv, app, CoreIntegrationOptions, createCoreIntegration (+14 more)

### Community 16 - "git.ts"
Cohesion: 0.11
Nodes (28): WorkspaceError, WorkspaceErrorInput, errorDetail(), execFileAsync, execGit(), execGitChecked(), gitDiffSummary(), gitStatus() (+20 more)

### Community 17 - "instances-boundary.tsx"
Cohesion: 0.11
Nodes (26): CommandClient, defaultCommandClient, defaultReadClient, InstancesBoundary(), InstancesBoundaryProps, ReadClient, Subscribe, AUTH_LABEL (+18 more)

### Community 18 - "repos.ts"
Cohesion: 0.10
Nodes (36): AdapterIdMapping, AdapterMappingKind, Artifact, artifactSchema, CommandReceiptRecord, ConfigTarget, createMessage(), getConfig() (+28 more)

### Community 19 - "scripts"
Cohesion: 0.07
Nodes (27): dependencies, astro, @astrojs/starlight, @fontsource/instrument-serif, @fontsource-variable/instrument-sans, @fontsource-variable/jetbrains-mono, sharp, devDependencies (+19 more)

### Community 20 - "composer-state.ts"
Cohesion: 0.12
Nodes (24): Composer(), ComposerProps, agentChoicesFor(), applyComposerChange(), COMPOSER_CONTROL_IDS, ComposerControl, ComposerDraft, ComposerSources (+16 more)

### Community 21 - "App.tsx"
Cohesion: 0.18
Nodes (11): App(), AppProps, commandClient, readClient, config, transport, SessionBoundary(), SessionBoundaryProps (+3 more)

### Community 22 - "services/index.ts"
Cohesion: 0.05
Nodes (44): inventoryCacheRepo, canSend(), directoryKey(), InventoryLookup, InventoryResult, InventoryScope, InventoryService, InventoryServiceOptions (+36 more)

### Community 23 - "session-navigation.tsx"
Cohesion: 0.22
Nodes (5): CommandClient, Command, Project, projectSchema, sessionSchema

### Community 24 - "claude/index.ts"
Cohesion: 0.12
Nodes (25): ClaudeAdapterOptions, MODELS, never, AideInteractionMode, claudeConfigSchema, ClaudeInstanceConfig, DEFAULT_STARTUP_TIMEOUT_MS, INTERACTION_MODE_TO_PERMISSION_MODE (+17 more)

### Community 25 - "config-draft.ts"
Cohesion: 0.17
Nodes (25): ConfigDraft, configToDraft(), DraftIssue, DraftValidation, DRIVERS, emptyDraft(), issuesFor(), newInstance() (+17 more)

### Community 26 - "store.ts"
Cohesion: 0.13
Nodes (9): ArtifactError, ArtifactErrorCode, Artifact, ArtifactMetadata, ArtifactStore, ArtifactStoreOptions, DEFAULT_MAX_ARTIFACT_BYTES, PutArtifactInput (+1 more)

### Community 27 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit (+12 more)

### Community 28 - "Aide Plan"
Cohesion: 0.10
Nodes (21): Aide Plan, Claude Agent SDK Adapter, Commands, Configuration and Instances, Configuration merge and precedence, Context Ownership and Harness Switching, Core Principles, Current Workspace (+13 more)

### Community 29 - "session.ts"
Cohesion: 0.12
Nodes (24): PartSynthesizer, ClaudeDialogResult, ClaudeSession, ActiveTurn, assertAnswerable(), ClaudeRuntime, ClaudeRuntimeFailure, ClaudeRuntimeOptions (+16 more)

### Community 30 - "web/components.json"
Cohesion: 0.10
Nodes (19): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+11 more)

### Community 31 - "ui/components.json"
Cohesion: 0.10
Nodes (19): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+11 more)

### Community 32 - "supervisor.ts"
Cohesion: 0.11
Nodes (14): backoffDelay(), BackoffPolicy, DEFAULT_BACKOFF, shouldRetry(), AdapterResolver, InstanceSupervisor, sameLifecycleConfig(), sameValue() (+6 more)

### Community 33 - "dependencies"
Cohesion: 0.08
Nodes (25): @base-ui/react, class-variance-authority, clsx, @fontsource-variable/outfit, dependencies, @base-ui/react, class-variance-authority, clsx (+17 more)

### Community 34 - "theme-provider.tsx"
Cohesion: 0.21
Nodes (13): disableTransitionsTemporarily(), getSystemTheme(), isEditableTarget(), isTheme(), ResolvedTheme, ThemeConsumer(), Theme, THEME_VALUES (+5 more)

### Community 35 - "schema.ts"
Cohesion: 0.12
Nodes (15): adapterIdMappings, artifacts, commandReceipts, configRecords, dispatchInputs, eventLog, inventoryCache, messages (+7 more)

### Community 36 - "turn.ts"
Cohesion: 0.05
Nodes (42): ExternalCommandContext, EventScopeTarget, withTransaction(), afterSequence(), createEventRouter(), applyMigrations(), migrationsFolder, createSubscription() (+34 more)

### Community 38 - "devDependencies"
Cohesion: 0.08
Nodes (25): devDependencies, jsdom, tailwindcss, @tailwindcss/vite, @testing-library/jest-dom, @testing-library/react, @types/node, @types/react (+17 more)

### Community 39 - "compilerOptions"
Cohesion: 0.09
Nodes (22): compilerOptions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit, noFallthroughCasesInSwitch (+14 more)

### Community 40 - "turn.test.ts"
Cohesion: 0.08
Nodes (32): hono, createConfigRouter(), createDb(), dispatchInputsRepo, messagesRepo, nativeMappingsRepo, partsRepo, turnsRepo (+24 more)

### Community 41 - "scripts"
Cohesion: 0.04
Nodes (44): @anthropic-ai/claude-agent-sdk, dependencies, @anthropic-ai/claude-agent-sdk, drizzle-orm, @opencode-ai/sdk, @standard-schema/spec, @t3-oss/env-core, @workspace/contracts (+36 more)

### Community 42 - "event-source.ts"
Cohesion: 0.14
Nodes (17): defaultSubscribeInstances(), defaultSubscribeSession(), fixture(), firstId(), snapshot(), EventSourceConstructor, EventSourceLike, EventSubscription (+9 more)

### Community 43 - "Contributor Covenant Code of Conduct"
Cohesion: 0.15
Nodes (12): 1. Correction, 2. Warning, 3. Temporary Ban, 4. Permanent Ban, Attribution, Contributor Covenant Code of Conduct, Enforcement, Enforcement Guidelines (+4 more)

### Community 44 - "Aide Build Breakdown — Serial Spine and Parallel Tracks"
Cohesion: 0.13
Nodes (13): Aide Build Breakdown — Serial Spine and Parallel Tracks, Dependency graph, Fan-out, Fan-out, Rules that make the fan-out safe, Spine, Spine, Staffing the critical path (+5 more)

### Community 46 - "scripts"
Cohesion: 0.17
Nodes (12): scripts, build, dev, format, format:check, lint, lint:fix, preview (+4 more)

### Community 47 - "web/package.json"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 48 - "session-boundary.tsx"
Cohesion: 0.12
Nodes (17): CommandClient, defaultCommandClient, defaultReadClient, errorMessage(), latestExecution(), ReadClient, SessionController(), Subscribe (+9 more)

### Community 49 - ".oxfmtrc.json"
Cohesion: 0.11
Nodes (18): ignorePatterns, **/coverage/**, **/dist/**, **/graphify-out/**, **/node_modules/**, **/.turbo/**, printWidth, $schema (+10 more)

### Community 50 - ".exec"
Cohesion: 0.20
Nodes (10): applyMigrations(), applyMigrations(), applyMigrations(), applyMigrations(), insertProjectAndSession(), insertUserMessage(), migrationsFolder, applyMigrations() (+2 more)

### Community 51 - "compilerOptions"
Cohesion: 0.12
Nodes (15): compilerOptions, jsx, jsxImportSource, module, moduleResolution, noEmit, skipLibCheck, strict (+7 more)

### Community 52 - "dependencies"
Cohesion: 0.18
Nodes (11): dependencies, react, react-dom, @remixicon/react, @workspace/contracts, @workspace/ui, react, react-dom (+3 more)

### Community 53 - "devDependencies"
Cohesion: 0.12
Nodes (17): devDependencies, jsdom, @testing-library/jest-dom, @testing-library/react, @types/node, @types/react, @types/react-dom, typescript (+9 more)

### Community 54 - "scripts"
Cohesion: 0.06
Nodes (34): oxfmt, oxlint, dependencies, @t3-oss/env-core, zod, devDependencies, oxfmt, oxlint (+26 more)

### Community 55 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, jsx, lib, module, moduleResolution, noEmit, paths, skipLibCheck (+12 more)

### Community 56 - "tasks"
Cohesion: 0.05
Nodes (37): ^build, .env*, ^format, ^format:check, ^lint, ^lint:fix, $TURBO_DEFAULT$, ^typecheck (+29 more)

### Community 57 - "claude-sdk-double.ts"
Cohesion: 0.17
Nodes (14): adapterError(), createClaudeAdapter(), ClaudeAgentInfo, ClaudeMcpServerStatus, ClaudePermissionDecision, ClaudeSessionOpenInput, ClaudeSessionDouble, ClaudeSessionDoubleOptions (+6 more)

### Community 59 - "generate-tokens.mjs"
Cohesion: 0.20
Nodes (6): globalsCss, globalsPath, monorepo, outPath, parsed, root

### Community 60 - "send.test.ts"
Cohesion: 0.44
Nodes (11): collect(), completeImmediately(), execution(), INSTANCE, openPermission(), parkOnPermission(), permissionFor(), runOneTurn() (+3 more)

### Community 61 - ".oxlintrc.json"
Cohesion: 0.12
Nodes (15): categories, correctness, env, builtin, ignorePatterns, **/coverage/**, **/dist/**, graphify-out/** (+7 more)

### Community 62 - "parts.ts"
Cohesion: 0.19
Nodes (10): BlockKind, BlockRecord, createPartSynthesizer(), stringifyToolOutput(), SynthesizedDelta, TOOL_CATEGORIES, toolIdentity(), ClaudeRawStreamEvent (+2 more)

### Community 63 - "ui/package.json"
Cohesion: 0.20
Nodes (9): exports, ./components/*, ./globals.css, ./hooks/*, ./lib/*, name, private, type (+1 more)

### Community 64 - "Implementation Phases"
Cohesion: 0.20
Nodes (10): Implementation Phases, Phase 1: Foundation, Phase 2: Configuration and Instance Supervision, Phase 3: Inventory and Composer, Phase 4: Chat on Both Adapters, Phase 5: Parts, Requests, and Recovery, Phase 6: MCP and Dynamic Tools, Phase 7: Workspace Awareness (+2 more)

### Community 67 - "transcript.tsx"
Cohesion: 0.26
Nodes (9): ExecutionDisplay(), byIndexThenId(), bySeqThenId(), toolInputText(), ToolPartView(), toolStatusStyles, Transcript(), AssistantMessage (+1 more)

### Community 68 - "scripts"
Cohesion: 0.08
Nodes (24): dependencies, zod, devDependencies, typescript, vitest, @vitest/coverage-istanbul, exports, typescript (+16 more)

### Community 70 - "scripts"
Cohesion: 0.22
Nodes (9): scripts, format, format:check, lint, lint:fix, test, test:coverage, test:watch (+1 more)

### Community 72 - "index.astro"
Cohesion: 0.17
Nodes (7): ../assets/harnesses/claude.svg?url, ../assets/harnesses/openai.svg?url, ../assets/harnesses/opencode.svg?url, [], panels, tabs, diffRows

### Community 73 - "www/tsconfig.json"
Cohesion: 0.25
Nodes (7): exclude, extends, include, **/*, dist, astro/tsconfigs/strict, .astro/types.d.ts

### Community 75 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, jsx, lib, module, moduleResolution, outDir, skipLibCheck, strict (+10 more)

### Community 76 - "AideDb"
Cohesion: 0.19
Nodes (8): AideDb, SessionFileChange, SnapshotService, CaptureInput, sameChange(), SessionChangesOptions, SessionChangesTracker, WorkspaceFileChange

### Community 77 - "API contracts and Bruno tests"
Cohesion: 0.29
Nodes (6): API contracts and Bruno tests, Bruno collection, Checklist for contract changes, Contract sources, Running tests, When to update `bruno-api-test/`

### Community 80 - "AideError"
Cohesion: 0.43
Nodes (4): ClaudeAdapterError, FakeAdapterError, OpencodeAdapterError, AideError

### Community 82 - "compilerOptions"
Cohesion: 0.29
Nodes (6): compilerOptions, module, moduleResolution, skipLibCheck, strict, target

### Community 83 - "read-client.test.ts"
Cohesion: 0.29
Nodes (4): config, createReadClient(), globalConfig, GlobalConfigRecord

### Community 84 - "Starlight Starter Kit: Basics"
Cohesion: 0.33
Nodes (5): Cloudflare, 🧞 Commands, 🚀 Project Structure, Starlight Starter Kit: Basics, 👀 Want to learn more?

### Community 85 - "workspace-changes.test.ts"
Cohesion: 0.32
Nodes (6): sessionFileChangesRepo, execFileAsync, git(), makeRepo(), selection, tempDirs

### Community 86 - "Testing Strategy"
Cohesion: 0.33
Nodes (6): Adapter Tests, Contract Tests, Cross-Harness Tests, Fake Adapter, Integration Tests, Testing Strategy

### Community 87 - "Aide Events"
Cohesion: 0.33
Nodes (6): Aide Events, Document, General, Instances, Runtime, and Inventory, Requests, Turn

### Community 88 - "web/tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, paths, files, ../../packages/ui/src/*, @workspace/ui/*, references

### Community 91 - "db/index.ts"
Cohesion: 0.12
Nodes (13): ConfigSecretsCipher, ConfigSecretsError, loadConfigSecrets(), resetConfigSecrets(), closeDb(), initializeDb(), migrationsFolder, resetDb() (+5 more)

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
- **672 isolated node(s):** `$schema`, `.opencode/plugins/graphify.js`, `$schema`, `printWidth`, `tabWidth` (+667 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `hono` connect `turn.test.ts` to `scripts`, `dispatcher.ts`, `turn.ts`, `app.ts`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `dependencies` connect `scripts` to `turn.test.ts`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **What connects `$schema`, `.opencode/plugins/graphify.js`, `$schema` to the rest of the system?**
  _672 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `config/service.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06255012028869286 - nodes in this community are weakly interconnected._
- **Should `domain.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0625 - nodes in this community are weakly interconnected._
- **Should `commands.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06825396825396825 - nodes in this community are weakly interconnected._
- **Should `opencode/adapter.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10220673635307782 - nodes in this community are weakly interconnected._