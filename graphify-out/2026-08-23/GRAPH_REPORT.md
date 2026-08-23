# Graph Report - /Users/tushar/projects/aide  (2026-08-23)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1986 nodes · 4138 edges · 128 communities (118 shown, 10 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.59)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9022a521`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- config/index.ts
- supervisor.ts
- production.ts
- contracts/src/index.ts
- turn.test.ts
- claude/adapter.ts
- turn.ts
- aide — Design System
- TurnService
- git.ts
- commands.ts
- instances-boundary.tsx
- snapshots.ts
- config-draft.ts
- fixtures.ts
- composer-state.ts
- compilerOptions
- events.ts
- events/index.ts
- Database
- db/index.ts
- opencode/adapter.ts
- AideDb
- supervisor.test.ts
- session.ts
- session-boundary.tsx
- query.ts
- command-client.ts
- compilerOptions
- Aide Plan
- store.ts
- repos.ts
- app.ts
- web/components.json
- ui/components.json
- send.test.ts
- dependencies
- parseRecord
- claude/index.ts
- dependencies
- App.tsx
- theme-provider.tsx
- scripts
- schema.ts
- web/package.json
- parts.ts
- devDependencies
- compilerOptions
- opencode/adapter.test.ts
- devDependencies
- event-store.ts
- dependencies
- tasks
- devDependencies
- event-source.ts
- Contributor Covenant Code of Conduct
- Aide Build Breakdown — Serial Spine and Parallel Tracks
- ConfigSecretsCipher
- scripts
- .oxfmtrc.json
- compilerOptions
- typescript
- transcript.tsx
- ignorePatterns
- scripts
- compilerOptions
- read-client.ts
- generate-tokens.mjs
- .oxlintrc.json
- package.json
- ui/package.json
- Implementation Phases
- session-boundary.test.tsx
- contracts/package.json
- scripts
- **/node_modules/**
- scripts
- include
- scripts
- InstallTabs.astro
- www/tsconfig.json
- devDependencies
- compilerOptions
- build
- API contracts and Bruno tests
- FakeEventSource
- www/package.json
- lib
- compilerOptions
- dependencies
- Starlight Starter Kit: Basics
- tsconfig.lint.json
- Testing Strategy
- Aide Events
- instances-store.test.ts
- repo-error.ts
- opencode.json
- lint:fix
- Wave 1 — Kernel
- @tailwindcss/vite
- @types/node
- @types/react-dom
- @vitejs/plugin-react
- AGENTS.md
- graphify.js
- @workspace/contracts
- Initial Scope
- typecheck
- test
- turbo.json
- ClaudeAdapterError
- content.config.ts
- Configuration and Instances
- README.md

## God Nodes (most connected - your core abstractions)
1. `AideDb` - 48 edges
2. `InstanceSupervisor` - 35 edges
3. `HarnessAdapter` - 31 edges
4. `TurnService` - 31 edges
5. `EventService` - 27 edges
6. `Database` - 26 edges
7. `Aide Plan` - 25 edges
8. `defineHarnessAdapterConformance()` - 20 edges
9. `compilerOptions` - 19 edges
10. `AideError` - 18 edges

## Surprising Connections (you probably didn't know these)
- `fixture()` --calls--> `instancesSnapshotFixture()`  [EXTRACTED]
  apps/web/src/features/instances/instances-boundary.test.tsx → packages/contracts/src/fixtures.ts
- `entry()` --calls--> `instancesSnapshotFixture()`  [EXTRACTED]
  apps/web/src/features/instances/instances-panel.test.tsx → packages/contracts/src/fixtures.ts
- `plugins` --extends--> `typescript`  [EXTRACTED]
  .oxlintrc.json → apps/web/package.json
- `ignorePatterns` --extends--> `**/graphify-out/**`  [EXTRACTED]
  .oxlintrc.json → .oxfmtrc.json
- `ConfigMergeError` --references--> `AideError`  [EXTRACTED]
  apps/server/src/config/merge.ts → packages/contracts/src/primitives.ts

## Import Cycles
- 2-file cycle: `apps/server/src/db/index.ts -> apps/server/src/db/repos.ts -> apps/server/src/db/index.ts`
- 3-file cycle: `apps/server/src/db/config-secrets-key.ts -> apps/server/src/db/repos.ts -> apps/server/src/db/index.ts -> apps/server/src/db/config-secrets-key.ts`

## Communities (128 total, 10 thin omitted)

### Community 0 - "config/index.ts"
Cohesion: 0.05
Nodes (69): createDriverConfigValidator(), ConfigMergeError, DEFAULT_PROJECTS_DIRECTORY, DriverConfigValidator, EffectiveConfig, emptyGlobalConfig(), instanceValidationError(), InstanceValidationFailure (+61 more)

### Community 1 - "supervisor.ts"
Cohesion: 0.05
Nodes (36): OpencodeAdapterError, HarnessAdapter, backoffDelay(), BackoffPolicy, DEFAULT_BACKOFF, shouldRetry(), createInstancesRouter(), AdapterResolver (+28 more)

### Community 2 - "production.ts"
Cohesion: 0.06
Nodes (42): assertReceiptTransition(), CommandDispatcher, CommandFor, CommandHandler, CommandHandlerRegistry, createCommandDispatcher(), DispatcherOptions, ExternalCommandContext (+34 more)

### Community 3 - "contracts/src/index.ts"
Cohesion: 0.07
Nodes (54): AgentPart, agentPartSchema, AssistantMessage, assistantMessageMetadataSchema, assistantMessageSchema, ExecutionDisplay, executionDisplaySchema, ExecutionSelection (+46 more)

### Community 4 - "turn.test.ts"
Cohesion: 0.07
Nodes (33): createDb(), dispatchInputsRepo, messagesRepo, nativeMappingsRepo, turnsRepo, createFakeHarnessAdapter(), createAideTestApp(), applyMigrations() (+25 more)

### Community 5 - "claude/adapter.ts"
Cohesion: 0.09
Nodes (37): CAPABILITIES, EFFORT_LEVELS, effortDescriptor(), INTERACTION_MODES, StartedInstance, toHarnessModel(), createEventBus(), EventBus (+29 more)

### Community 6 - "turn.ts"
Cohesion: 0.09
Nodes (19): inventoryCacheRepo, AdapterRegistry, RegisteredAdapter, CoreServiceError, ExecutionResolver, migrationsFolder, resolverFor(), CommandFor (+11 more)

### Community 7 - "aide — Design System"
Cohesion: 0.05
Nodes (42): 10.1 Starlight mapping, 10.2 Pages, 10. Marketing site & docs, 11.1 `packages/ui/src/styles/globals.css`, 11.2 Migration checklist, 11. Implementation, 12. Decision log, 1. Brand fundamentals (+34 more)

### Community 8 - "TurnService"
Cohesion: 0.11
Nodes (16): withTransaction(), applyPortableHandoffBudget(), BuildPortableHandoffInput, buildPortableHandoffPacket(), escapeHandoffTags(), omittedRanges(), PortableHandoffMessage, PortableHandoffPacket (+8 more)

### Community 9 - "git.ts"
Cohesion: 0.11
Nodes (29): WorkspaceError, WorkspaceErrorInput, errorDetail(), execFileAsync, execGit(), execGitChecked(), gitDiffSummary(), gitStatus() (+21 more)

### Community 10 - "commands.ts"
Cohesion: 0.07
Nodes (34): commandEnvelopeSchema, CommandName, commandNameSchema, commandSchema, configUpdateCommandSchema, configUpdateTargetSchema, inputRespondCommandSchema, instanceRestartCommandSchema (+26 more)

### Community 11 - "instances-boundary.tsx"
Cohesion: 0.10
Nodes (28): CommandClient, defaultCommandClient, defaultReadClient, InstancesBoundary(), InstancesBoundaryProps, ReadClient, Subscribe, fixture() (+20 more)

### Community 12 - "snapshots.ts"
Cohesion: 0.08
Nodes (28): turnSchema, instancesEventScopeSchema, sessionEventScopeSchema, harnessCapabilitiesSchema, harnessInventorySchema, HarnessModel, harnessModelSchema, InstanceAuth (+20 more)

### Community 13 - "config-draft.ts"
Cohesion: 0.15
Nodes (26): ConfigDraft, configToDraft(), DraftIssue, DraftValidation, DRIVERS, emptyDraft(), issuesFor(), newInstance() (+18 more)

### Community 14 - "fixtures.ts"
Cohesion: 0.15
Nodes (31): lifecycleAdapter(), inventory(), createStubAdapter(), requestSchema, aideEventSchema, assistantMessageFixture(), buildEventFixtures(), clone() (+23 more)

### Community 15 - "composer-state.ts"
Cohesion: 0.12
Nodes (24): Composer(), ComposerProps, agentChoicesFor(), applyComposerChange(), COMPOSER_CONTROL_IDS, ComposerControl, ComposerDraft, ComposerSources (+16 more)

### Community 16 - "compilerOptions"
Cohesion: 0.06
Nodes (31): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection, moduleResolution (+23 more)

### Community 17 - "events.ts"
Cohesion: 0.06
Nodes (32): aideEventBaseSchema, configUpdatedEventSchema, durableDeliverySchema, ephemeralDeliverySchema, errorOccurredEventSchema, EventDelivery, eventDeliverySchema, EventScope (+24 more)

### Community 18 - "events/index.ts"
Cohesion: 0.11
Nodes (20): migrationsFolder, afterSequence(), createEventRouter(), migrationsFolder, DurableEvent, DurableEventInput, EventServiceError, EventServiceErrorCode (+12 more)

### Community 19 - "Database"
Cohesion: 0.09
Nodes (17): applyMigrations(), migrationsFolder, applyMigrations(), insertProjectAndSession(), insertUserMessage(), migrationsFolder, Database, RunResult (+9 more)

### Community 20 - "db/index.ts"
Cohesion: 0.12
Nodes (17): closeDb(), getDb(), initializeDb(), migrationsFolder, resetDb(), migrationsFolder, artifactsRepo, configRepo (+9 more)

### Community 21 - "opencode/adapter.ts"
Cohesion: 0.15
Nodes (22): adapterError(), authFromProviders(), CAPABILITIES, closeRuntimes(), createOpencodeAdapter(), notImplemented(), OpencodeAdapterOptions, StartedInstance (+14 more)

### Community 22 - "AideDb"
Cohesion: 0.18
Nodes (8): AideDb, EventScopeTarget, createSubscription(), EventService, eventTarget(), sameScope(), scopeKey(), validateSequence()

### Community 23 - "supervisor.test.ts"
Cohesion: 0.18
Nodes (12): canSend(), directoryKey(), InventoryLookup, InventoryResult, InventoryScope, InventoryService, InventoryServiceOptions, RUNTIME_DIRECTORY_KEY (+4 more)

### Community 24 - "session.ts"
Cohesion: 0.14
Nodes (22): ClaudeSession, ActiveTurn, assertAnswerable(), ClaudeRuntime, ClaudeRuntimeFailure, ClaudeRuntimeOptions, createClaudeRuntime(), effortFor() (+14 more)

### Community 25 - "session-boundary.tsx"
Cohesion: 0.13
Nodes (13): CommandClient, defaultCommandClient, defaultReadClient, errorMessage(), latestExecution(), ReadClient, SessionController(), Subscribe (+5 more)

### Community 26 - "query.ts"
Cohesion: 0.12
Nodes (20): ClaudeAccountInfo, ClaudeAgentInfo, ClaudeDialogAsk, ClaudeDialogResult, ClaudeInitInfo, ClaudeMcpServerStatus, ClaudePermissionAsk, ClaudePermissionDecision (+12 more)

### Community 27 - "command-client.ts"
Cohesion: 0.12
Nodes (10): CommandClient, CommandClientOptions, CommandError, createCommandClient(), newCommandId(), Sleep, receipt, Command (+2 more)

### Community 28 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit (+12 more)

### Community 29 - "Aide Plan"
Cohesion: 0.10
Nodes (21): Aide Plan, Claude Agent SDK Adapter, Commands, Context Ownership and Harness Switching, Core Principles, Current Workspace, Day 0 Acceptance Criteria, Domain Model (+13 more)

### Community 30 - "store.ts"
Cohesion: 0.14
Nodes (8): ArtifactError, ArtifactErrorCode, Artifact, ArtifactMetadata, ArtifactStore, ArtifactStoreOptions, DEFAULT_MAX_ARTIFACT_BYTES, PutArtifactInput

### Community 31 - "repos.ts"
Cohesion: 0.12
Nodes (17): AdapterIdMapping, AdapterMappingKind, adapterMappingsRepo, Artifact, artifactSchema, CommandReceiptRecord, ConfigSecrets, ConfigTarget (+9 more)

### Community 32 - "app.ts"
Cohesion: 0.14
Nodes (11): receiptsRepo, SessionFileChange, sessionFileChangesRepo, CaptureInput, sameChange(), SessionChangesOptions, SessionChangesTracker, execFileAsync (+3 more)

### Community 33 - "web/components.json"
Cohesion: 0.10
Nodes (19): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+11 more)

### Community 34 - "ui/components.json"
Cohesion: 0.10
Nodes (19): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+11 more)

### Community 35 - "send.test.ts"
Cohesion: 0.25
Nodes (17): adapterError(), createClaudeAdapter(), collect(), completeImmediately(), execution(), INSTANCE, openPermission(), parkOnPermission() (+9 more)

### Community 36 - "dependencies"
Cohesion: 0.11
Nodes (19): @base-ui/react, class-variance-authority, clsx, @fontsource-variable/outfit, dependencies, @base-ui/react, class-variance-authority, clsx (+11 more)

### Community 37 - "parseRecord"
Cohesion: 0.20
Nodes (18): createMessage(), getProject(), getReceipt(), getRequest(), getSession(), getTurn(), optionalJson(), parseEventRow() (+10 more)

### Community 38 - "claude/index.ts"
Cohesion: 0.20
Nodes (13): ClaudeAdapterOptions, MODELS, never, AideInteractionMode, claudeConfigSchema, ClaudeInstanceConfig, DEFAULT_STARTUP_TIMEOUT_MS, INTERACTION_MODE_TO_PERMISSION_MODE (+5 more)

### Community 39 - "dependencies"
Cohesion: 0.12
Nodes (17): @anthropic-ai/claude-agent-sdk, dependencies, @anthropic-ai/claude-agent-sdk, drizzle-orm, hono, @opencode-ai/sdk, @standard-schema/spec, @workspace/contracts (+9 more)

### Community 40 - "App.tsx"
Cohesion: 0.16
Nodes (10): App(), AppProps, commandClient, readClient, config, transport, SessionBoundary(), SessionBoundaryProps (+2 more)

### Community 41 - "theme-provider.tsx"
Cohesion: 0.19
Nodes (14): disableTransitionsTemporarily(), getSystemTheme(), isEditableTarget(), isTheme(), ResolvedTheme, ThemeConsumer(), Theme, THEME_VALUES (+6 more)

### Community 42 - "scripts"
Cohesion: 0.12
Nodes (16): scripts, db:generate, db:migrate, db:push, db:studio, dev, format, format:check (+8 more)

### Community 43 - "schema.ts"
Cohesion: 0.12
Nodes (15): adapterIdMappings, artifacts, commandReceipts, configRecords, dispatchInputs, eventLog, inventoryCache, messages (+7 more)

### Community 44 - "web/package.json"
Cohesion: 0.12
Nodes (15): dependencies, react, react-dom, @remixicon/react, @workspace/ui, name, private, type (+7 more)

### Community 45 - "parts.ts"
Cohesion: 0.17
Nodes (10): BlockKind, BlockRecord, createPartSynthesizer(), PartSynthesizer, stringifyToolOutput(), SynthesizedDelta, TOOL_CATEGORIES, toolIdentity() (+2 more)

### Community 46 - "devDependencies"
Cohesion: 0.13
Nodes (15): @types/react, devDependencies, jsdom, tailwindcss, @testing-library/dom, @testing-library/jest-dom, @testing-library/react, @turbo/gen (+7 more)

### Community 47 - "compilerOptions"
Cohesion: 0.13
Nodes (15): compilerOptions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit, noFallthroughCasesInSwitch (+7 more)

### Community 48 - "opencode/adapter.test.ts"
Cohesion: 0.16
Nodes (10): AGENTS, AgentsPayload, PROVIDERS, ProvidersPayload, OpencodeApi, OpencodeRuntimeFactory, createFakeOpencodeApi(), OpencodeAgents (+2 more)

### Community 49 - "devDependencies"
Cohesion: 0.16
Nodes (14): devDependencies, jsdom, @testing-library/dom, @testing-library/jest-dom, @testing-library/react, @testing-library/user-event, vite, vitest (+6 more)

### Community 50 - "event-store.ts"
Cohesion: 0.18
Nodes (7): createSessionStore(), initialState(), Listener, LiveFragment, SessionStoreState, fixtureEvent(), partEvent()

### Community 51 - "dependencies"
Cohesion: 0.14
Nodes (14): dependencies, astro, @astrojs/starlight, @fontsource/instrument-serif, @fontsource-variable/instrument-sans, @fontsource-variable/jetbrains-mono, sharp, @fontsource-variable/instrument-sans (+6 more)

### Community 52 - "tasks"
Cohesion: 0.14
Nodes (14): ^format, ^format:check, ^lint, cache, persistent, cache, dependsOn, dependsOn (+6 more)

### Community 53 - "devDependencies"
Cohesion: 0.15
Nodes (12): devDependencies, drizzle-kit, @types/bun, @usebruno/cli, vitest, @vitest/coverage-istanbul, vitest, name (+4 more)

### Community 54 - "event-source.ts"
Cohesion: 0.24
Nodes (11): EventSourceConstructor, EventSourceLike, EventSubscription, InstancesEventsOptions, Parser, SessionEventsOptions, subscribe(), subscribeInstancesEvents() (+3 more)

### Community 55 - "Contributor Covenant Code of Conduct"
Cohesion: 0.15
Nodes (12): 1. Correction, 2. Warning, 3. Temporary Ban, 4. Permanent Ban, Attribution, Contributor Covenant Code of Conduct, Enforcement, Enforcement Guidelines (+4 more)

### Community 56 - "Aide Build Breakdown — Serial Spine and Parallel Tracks"
Cohesion: 0.18
Nodes (11): Aide Build Breakdown — Serial Spine and Parallel Tracks, Dependency graph, Fan-out, Rules that make the fan-out safe, Spine, Staffing the critical path, Task types, Wave 0 — Freeze the seams (serial only) (+3 more)

### Community 57 - "ConfigSecretsCipher"
Cohesion: 0.27
Nodes (4): ConfigSecretsCipher, ConfigSecretsError, loadConfigSecrets(), resetConfigSecrets()

### Community 58 - "scripts"
Cohesion: 0.17
Nodes (12): scripts, build, dev, format, format:check, lint, lint:fix, preview (+4 more)

### Community 59 - ".oxfmtrc.json"
Cohesion: 0.17
Nodes (11): printWidth, $schema, semi, singleQuote, sortTailwindcss, functions, stylesheet, tabWidth (+3 more)

### Community 60 - "compilerOptions"
Cohesion: 0.18
Nodes (11): compilerOptions, jsx, jsxImportSource, module, moduleResolution, noEmit, skipLibCheck, strict (+3 more)

### Community 61 - "typescript"
Cohesion: 0.18
Nodes (11): typescript, @vitest/coverage-istanbul, @vitest/coverage-istanbul, devDependencies, typescript, vitest, @vitest/coverage-istanbul, vitest (+3 more)

### Community 62 - "transcript.tsx"
Cohesion: 0.33
Nodes (7): ExecutionDisplay(), byIndexThenId(), bySeqThenId(), toolInputText(), ToolPartView(), toolStatusStyles, Transcript()

### Community 63 - "ignorePatterns"
Cohesion: 0.20
Nodes (11): ignorePatterns, ignorePatterns, **/dist/**, **/.turbo/**, **/coverage/**, **/dist/**, **/drizzle/meta/**, **/graphify-out/** (+3 more)

### Community 64 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, dev, format, format:check, lint, lint:check, lint:fix (+3 more)

### Community 65 - "compilerOptions"
Cohesion: 0.18
Nodes (11): compilerOptions, jsx, module, moduleResolution, noEmit, paths, skipLibCheck, strict (+3 more)

### Community 66 - "read-client.ts"
Cohesion: 0.22
Nodes (4): createReadClient(), ReadClientOptions, ReadError, globalConfig

### Community 67 - "generate-tokens.mjs"
Cohesion: 0.20
Nodes (6): globalsCss, globalsPath, monorepo, outPath, parsed, root

### Community 68 - ".oxlintrc.json"
Cohesion: 0.20
Nodes (9): categories, correctness, env, builtin, overrides, plugins, $schema, oxc (+1 more)

### Community 69 - "package.json"
Cohesion: 0.20
Nodes (9): engines, node, name, packageManager, private, version, workspaces, apps/* (+1 more)

### Community 70 - "ui/package.json"
Cohesion: 0.20
Nodes (9): exports, ./components/*, ./globals.css, ./hooks/*, ./lib/*, name, private, type (+1 more)

### Community 71 - "Implementation Phases"
Cohesion: 0.20
Nodes (10): Implementation Phases, Phase 1: Foundation, Phase 2: Configuration and Instance Supervision, Phase 3: Inventory and Composer, Phase 4: Chat on Both Adapters, Phase 5: Parts, Requests, and Recovery, Phase 6: MCP and Dynamic Tools, Phase 7: Workspace Awareness (+2 more)

### Community 72 - "session-boundary.test.tsx"
Cohesion: 0.25
Nodes (4): bootStream(), Recording, snapshotWithSequence(), SubscribeOptions

### Community 73 - "contracts/package.json"
Cohesion: 0.22
Nodes (8): dependencies, zod, exports, zod, name, private, type, version

### Community 74 - "scripts"
Cohesion: 0.22
Nodes (9): scripts, format, format:check, lint, lint:fix, test, test:coverage, test:watch (+1 more)

### Community 75 - "**/node_modules/**"
Cohesion: 0.22
Nodes (7): exclude, dist, exclude, include, ., dist, **/node_modules/**

### Community 76 - "scripts"
Cohesion: 0.22
Nodes (9): scripts, format, format:check, lint, lint:fix, test, test:coverage, test:watch (+1 more)

### Community 77 - "include"
Cohesion: 0.25
Nodes (7): include, src, test, vitest.config.ts, include, src, test

### Community 78 - "scripts"
Cohesion: 0.25
Nodes (8): scripts, astro, build, dev, generate:tokens, preview, preview:cf, start

### Community 79 - "InstallTabs.astro"
Cohesion: 0.25
Nodes (4): [], panels, tabs, diffRows

### Community 80 - "www/tsconfig.json"
Cohesion: 0.25
Nodes (7): exclude, extends, include, **/*, dist, astro/tsconfigs/strict, .astro/types.d.ts

### Community 81 - "devDependencies"
Cohesion: 0.25
Nodes (8): oxfmt, oxlint, devDependencies, oxfmt, oxlint, turbo, typescript, turbo

### Community 82 - "compilerOptions"
Cohesion: 0.25
Nodes (8): compilerOptions, jsx, module, moduleResolution, outDir, skipLibCheck, strict, target

### Community 83 - "build"
Cohesion: 0.25
Nodes (8): ^build, .env*, $TURBO_DEFAULT$, dependsOn, inputs, outputs, dist/**, build

### Community 84 - "API contracts and Bruno tests"
Cohesion: 0.29
Nodes (6): API contracts and Bruno tests, Bruno collection, Checklist for contract changes, Contract sources, Running tests, When to update `bruno-api-test/`

### Community 86 - "www/package.json"
Cohesion: 0.29
Nodes (6): devDependencies, wrangler, name, type, version, wrangler

### Community 87 - "lib"
Cohesion: 0.29
Nodes (7): lib, DOM, DOM.Iterable, ES2022, lib, DOM, ES2022

### Community 88 - "compilerOptions"
Cohesion: 0.29
Nodes (6): compilerOptions, module, moduleResolution, skipLibCheck, strict, target

### Community 89 - "dependencies"
Cohesion: 0.33
Nodes (6): @t3-oss/env-core, dependencies, @t3-oss/env-core, zod, zod, @t3-oss/env-core

### Community 90 - "Starlight Starter Kit: Basics"
Cohesion: 0.33
Nodes (5): Cloudflare, 🧞 Commands, 🚀 Project Structure, Starlight Starter Kit: Basics, 👀 Want to learn more?

### Community 91 - "tsconfig.lint.json"
Cohesion: 0.33
Nodes (5): exclude, include, dist, src, turbo

### Community 92 - "Testing Strategy"
Cohesion: 0.33
Nodes (6): Adapter Tests, Contract Tests, Cross-Harness Tests, Fake Adapter, Integration Tests, Testing Strategy

### Community 93 - "Aide Events"
Cohesion: 0.33
Nodes (6): Aide Events, Document, General, Instances, Runtime, and Inventory, Requests, Turn

### Community 94 - "instances-store.test.ts"
Cohesion: 0.50
Nodes (3): event(), firstId(), snapshot()

### Community 96 - "opencode.json"
Cohesion: 0.50
Nodes (3): plugin, $schema, .opencode/plugins/graphify.js

### Community 97 - "lint:fix"
Cohesion: 0.50
Nodes (4): ^lint:fix, cache, dependsOn, lint:fix

### Community 98 - "Wave 1 — Kernel"
Cohesion: 0.50
Nodes (4): Fan-out (parallel — all start when S0 merges), Spikes to run early (throwaway, in Wave 1), Spine (serial, in order), Wave 1 — Kernel

### Community 99 - "@tailwindcss/vite"
Cohesion: 0.67
Nodes (3): @tailwindcss/vite, @tailwindcss/vite, @tailwindcss/vite

### Community 100 - "@types/node"
Cohesion: 0.67
Nodes (3): @types/node, @types/node, @types/node

### Community 101 - "@types/react-dom"
Cohesion: 0.67
Nodes (3): @types/react-dom, @types/react-dom, @types/react-dom

### Community 102 - "@vitejs/plugin-react"
Cohesion: 0.67
Nodes (3): @vitejs/plugin-react, @vitejs/plugin-react, @vitejs/plugin-react

### Community 106 - "Initial Scope"
Cohesion: 0.67
Nodes (3): Excluded Initially, Included, Initial Scope

### Community 107 - "typecheck"
Cohesion: 0.67
Nodes (3): ^typecheck, typecheck, dependsOn

### Community 108 - "test"
Cohesion: 0.67
Nodes (3): ^test, test, dependsOn

## Knowledge Gaps
- **617 isolated node(s):** `$schema`, `.opencode/plugins/graphify.js`, `$schema`, `unicorn`, `oxc` (+612 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `plugins` connect `.oxlintrc.json` to `theme-provider.tsx`, `typescript`?**
  _High betweenness centrality (0.239) - this node is a cross-community bridge._
- **Why does `react` connect `theme-provider.tsx` to `.oxlintrc.json`, `App.tsx`, `instances-boundary.tsx`, `config-draft.ts`, `composer-state.ts`, `session-boundary.tsx`, `command-client.ts`?**
  _High betweenness centrality (0.237) - this node is a cross-community bridge._
- **Why does `typescript` connect `typescript` to `devDependencies`, `.oxlintrc.json`?**
  _High betweenness centrality (0.149) - this node is a cross-community bridge._
- **What connects `$schema`, `.opencode/plugins/graphify.js`, `$schema` to the rest of the system?**
  _617 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `config/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.053289473684210525 - nodes in this community are weakly interconnected._
- **Should `supervisor.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05030643513789581 - nodes in this community are weakly interconnected._
- **Should `production.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.061343204653622425 - nodes in this community are weakly interconnected._