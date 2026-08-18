# Graph Report - aide  (2026-08-17)

## Corpus Check
- 147 files · ~65,006 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1422 nodes · 2584 edges · 89 communities (75 shown, 14 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6f3ee651`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- contracts/src/index.ts
- adapter-conformance.ts
- compilerOptions
- theme-provider.tsx
- scripts
- compilerOptions
- scripts
- compilerOptions
- events.ts
- commands.ts
- inventory.ts
- compilerOptions
- web/components.json
- ui/components.json
- dependencies
- scripts
- service.ts
- fixtures.ts
- devDependencies
- Contributor Covenant Code of Conduct
- scripts
- .oxfmtrc.json
- web/package.json
- devDependencies
- @vitest/coverage-istanbul
- tasks
- turn.ts
- aide — Design System
- compilerOptions
- git.ts
- Database
- dispatcher.ts
- scripts
- @testing-library/user-event
- fake/index.ts
- events.test.ts
- Aide Plan
- graphify.js
- repos.ts
- compilerOptions
- turn.test.ts
- compilerOptions
- CONTRACTS_SCHEMA_VERSION
- event-source.ts
- index.astro
- db/index.ts
- schema.ts
- Aide Build Breakdown — Serial Spine and Parallel Tracks
- core.test.ts
- TurnService
- store.ts
- config.ts
- Implementation Phases
- generate-tokens.mjs
- API contracts and Bruno tests
- www/tsconfig.json
- web/tsconfig.json
- Testing Strategy
- Aide Events
- Starlight Starter Kit: Basics
- opencode.json
- Wave 1 — Kernel
- CLAUDE.md
- @workspace/contracts
- Initial Scope
- Request
- @testing-library/dom
- vite
- vitest
- content.config.ts
- Server Architecture
- README.md
- snapshots.ts
- repo-error.ts
- @tailwindcss/vite

## God Nodes (most connected - your core abstractions)
1. `AideDb` - 31 edges
2. `TurnService` - 29 edges
3. `AideEvent` - 25 edges
4. `Aide Plan` - 25 edges
5. `HarnessAdapter` - 23 edges
6. `EventService` - 21 edges
7. `Database` - 19 edges
8. `compilerOptions` - 19 edges
9. `Turn` - 19 edges
10. `defineHarnessAdapterConformance()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `HarnessAdapter` --references--> `DriverId`  [EXTRACTED]
  apps/server/src/harness/types.ts → packages/contracts/src/primitives.ts
- `CoreServiceError` --references--> `AideError`  [EXTRACTED]
  apps/server/src/services/errors.ts → packages/contracts/src/primitives.ts
- `resolverFor()` --calls--> `inventoryFixture()`  [EXTRACTED]
  apps/server/src/services/execution.test.ts → packages/contracts/src/fixtures.ts
- `ReceiptTransitionError` --references--> `ReceiptState`  [EXTRACTED]
  apps/server/src/commands/dispatcher.ts → packages/contracts/src/commands.ts
- `createProjectAndSession()` --calls--> `projectFixture()`  [EXTRACTED]
  apps/server/src/db/repos.test.ts → packages/contracts/src/fixtures.ts

## Import Cycles
- None detected.

## Communities (89 total, 14 thin omitted)

### Community 0 - "contracts/src/index.ts"
Cohesion: 0.09
Nodes (42): AgentPart, agentPartSchema, assistantMessageMetadataSchema, assistantMessageSchema, ExecutionDisplay, executionDisplaySchema, executionSelectionSchema, FilePart (+34 more)

### Community 1 - "adapter-conformance.ts"
Cohesion: 0.11
Nodes (18): HarnessAdapter, InstanceHandle, NativeSession, assertCommonEventInvariants(), buildUserMessage(), ConformanceOptions, ConformanceSubject, defaultExecutionFrom() (+10 more)

### Community 2 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, jsx, lib, module, moduleResolution, noEmit, paths, skipLibCheck (+12 more)

### Community 3 - "theme-provider.tsx"
Cohesion: 0.05
Nodes (36): App(), snapshot, disableTransitionsTemporarily(), getSystemTheme(), isEditableTarget(), isTheme(), ResolvedTheme, ThemeConsumer() (+28 more)

### Community 4 - "scripts"
Cohesion: 0.06
Nodes (34): oxfmt, oxlint, dependencies, @t3-oss/env-core, zod, devDependencies, oxfmt, oxlint (+26 more)

### Community 5 - "compilerOptions"
Cohesion: 0.09
Nodes (22): compilerOptions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit, noFallthroughCasesInSwitch (+14 more)

### Community 6 - "scripts"
Cohesion: 0.05
Nodes (40): dependencies, drizzle-orm, @standard-schema/spec, @t3-oss/env-core, @workspace/contracts, zod, devDependencies, drizzle-kit (+32 more)

### Community 7 - "compilerOptions"
Cohesion: 0.07
Nodes (26): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection, moduleResolution (+18 more)

### Community 8 - "events.ts"
Cohesion: 0.06
Nodes (32): aideEventBaseSchema, configUpdatedEventSchema, durableDeliverySchema, ephemeralDeliverySchema, errorOccurredEventSchema, EventDelivery, eventDeliverySchema, EventScope (+24 more)

### Community 9 - "commands.ts"
Cohesion: 0.08
Nodes (25): commandEnvelopeSchema, commandNameSchema, commandSchema, configUpdateCommandSchema, configUpdateTargetSchema, inputRespondCommandSchema, instanceRestartCommandSchema, instanceStartCommandSchema (+17 more)

### Community 10 - "inventory.ts"
Cohesion: 0.11
Nodes (19): HarnessCapabilities, harnessCapabilitiesSchema, harnessInventorySchema, HarnessModel, harnessModelSchema, InstanceAuth, instanceAuthSchema, InstanceRuntimeStatus (+11 more)

### Community 11 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit (+12 more)

### Community 12 - "web/components.json"
Cohesion: 0.10
Nodes (19): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+11 more)

### Community 13 - "ui/components.json"
Cohesion: 0.10
Nodes (19): aliases, components, hooks, lib, ui, utils, iconLibrary, menuAccent (+11 more)

### Community 14 - "dependencies"
Cohesion: 0.05
Nodes (43): @base-ui/react, class-variance-authority, clsx, @fontsource-variable/outfit, dependencies, @base-ui/react, class-variance-authority, clsx (+35 more)

### Community 15 - "scripts"
Cohesion: 0.08
Nodes (24): dependencies, zod, devDependencies, typescript, vitest, @vitest/coverage-istanbul, exports, typescript (+16 more)

### Community 16 - "service.ts"
Cohesion: 0.09
Nodes (26): EventScopeTarget, afterSequence(), createEventRouter(), applyMigrations(), migrationsFolder, createSubscription(), DurableEvent, DurableEventInput (+18 more)

### Community 17 - "fixtures.ts"
Cohesion: 0.08
Nodes (44): createProjectAndSession(), createReceiptAndMessages(), createSessionRecords(), ExecutionDisplay(), byIndexThenId(), bySeqThenId(), ToolPartView(), toolStatusStyles (+36 more)

### Community 18 - "devDependencies"
Cohesion: 0.06
Nodes (31): devDependencies, jsdom, tailwindcss, @tailwindcss/vite, @testing-library/dom, @testing-library/jest-dom, @testing-library/react, @testing-library/user-event (+23 more)

### Community 19 - "Contributor Covenant Code of Conduct"
Cohesion: 0.15
Nodes (12): 1. Correction, 2. Warning, 3. Temporary Ban, 4. Permanent Ban, Attribution, Contributor Covenant Code of Conduct, Enforcement, Enforcement Guidelines (+4 more)

### Community 20 - "scripts"
Cohesion: 0.17
Nodes (12): scripts, build, dev, format, format:check, lint, lint:fix, preview (+4 more)

### Community 21 - ".oxfmtrc.json"
Cohesion: 0.11
Nodes (17): ignorePatterns, **/coverage/**, **/dist/**, graphify-out/**, **/node_modules/**, **/.turbo/**, printWidth, $schema (+9 more)

### Community 22 - "web/package.json"
Cohesion: 0.12
Nodes (15): dependencies, react, react-dom, @remixicon/react, @workspace/contracts, @workspace/ui, react, react-dom (+7 more)

### Community 23 - "devDependencies"
Cohesion: 0.12
Nodes (17): devDependencies, jsdom, @testing-library/jest-dom, @testing-library/react, @types/node, @types/react, @types/react-dom, typescript (+9 more)

### Community 25 - "tasks"
Cohesion: 0.05
Nodes (37): ^build, .env*, ^format, ^format:check, ^lint, ^lint:fix, $TURBO_DEFAULT$, ^typecheck (+29 more)

### Community 26 - "turn.ts"
Cohesion: 0.17
Nodes (12): AdapterRegistry, RegisteredAdapter, CoreServiceError, ExecutionResolver, migrationsFolder, ActiveTurn, PendingDispatch, TurnServiceOptions (+4 more)

### Community 27 - "aide — Design System"
Cohesion: 0.05
Nodes (42): 10.1 Starlight mapping, 10.2 Pages, 10. Marketing site & docs, 11.1 `packages/ui/src/styles/globals.css`, 11.2 Migration checklist, 11. Implementation, 12. Decision log, 1. Brand fundamentals (+34 more)

### Community 28 - "compilerOptions"
Cohesion: 0.29
Nodes (6): compilerOptions, module, moduleResolution, skipLibCheck, strict, target

### Community 29 - "git.ts"
Cohesion: 0.12
Nodes (23): WorkspaceError, WorkspaceErrorInput, errorDetail(), execFileAsync, execGit(), execGitChecked(), gitDiffSummary(), gitStatus() (+15 more)

### Community 30 - "Database"
Cohesion: 0.09
Nodes (18): applyMigrations(), migrationsFolder, applyMigrations(), applyMigrations(), insertProjectAndSession(), insertUserMessage(), migrationsFolder, Database (+10 more)

### Community 31 - "dispatcher.ts"
Cohesion: 0.05
Nodes (51): hono, assertReceiptTransition(), CommandDispatcher, CommandFor, CommandHandler, CommandHandlerRegistry, createCommandDispatcher(), DispatcherOptions (+43 more)

### Community 32 - "scripts"
Cohesion: 0.07
Nodes (27): dependencies, astro, @astrojs/starlight, @fontsource/instrument-serif, @fontsource-variable/instrument-sans, @fontsource-variable/jetbrains-mono, sharp, devDependencies (+19 more)

### Community 34 - "fake/index.ts"
Cohesion: 0.10
Nodes (28): EventBus, FakeAdapterError, fakeConfigSchema, FakeDispatchMode, FakeGate, FakeHarnessAdapterOptions, FakeHarnessControl, FakeInstance (+20 more)

### Community 35 - "events.test.ts"
Cohesion: 0.17
Nodes (16): configRepo, eventLogRepo, inventoryCacheRepo, messagesRepo, projectsRepo, receiptsRepo, requestsRepo, sessionsRepo (+8 more)

### Community 36 - "Aide Plan"
Cohesion: 0.10
Nodes (21): Aide Plan, Claude Agent SDK Adapter, Commands, Configuration and Instances, Configuration merge and precedence, Context Ownership and Harness Switching, Core Principles, Current Workspace (+13 more)

### Community 38 - "repos.ts"
Cohesion: 0.13
Nodes (29): AideDb, AdapterIdMapping, AdapterMappingKind, adapterMappingsRepo, Artifact, artifactSchema, ConfigTarget, createMessage() (+21 more)

### Community 39 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, jsx, lib, module, moduleResolution, outDir, skipLibCheck, strict (+10 more)

### Community 40 - "turn.test.ts"
Cohesion: 0.22
Nodes (4): nativeMappingsRepo, partsRepo, migrationsFolder, selection

### Community 41 - "compilerOptions"
Cohesion: 0.12
Nodes (15): compilerOptions, jsx, jsxImportSource, module, moduleResolution, noEmit, skipLibCheck, strict (+7 more)

### Community 43 - "event-source.ts"
Cohesion: 0.18
Nodes (10): EventSourceConstructor, EventSourceLike, EventSubscription, SessionEventsOptions, subscribe(), subscribeInstancesEvents(), subscribeSessionEvents(), SubscriptionOptions (+2 more)

### Community 45 - "index.astro"
Cohesion: 0.17
Nodes (7): ../assets/harnesses/claude.svg?url, ../assets/harnesses/openai.svg?url, ../assets/harnesses/opencode.svg?url, [], panels, tabs, diffRows

### Community 54 - "db/index.ts"
Cohesion: 0.19
Nodes (7): createDb(), getDb(), ProjectService, ProjectServiceOptions, migrationsFolder, Project, Session

### Community 55 - "schema.ts"
Cohesion: 0.13
Nodes (14): adapterIdMappings, artifacts, commandReceipts, configRecords, dispatchInputs, eventLog, inventoryCache, messages (+6 more)

### Community 56 - "Aide Build Breakdown — Serial Spine and Parallel Tracks"
Cohesion: 0.13
Nodes (13): Aide Build Breakdown — Serial Spine and Parallel Tracks, Dependency graph, Fan-out, Fan-out, Rules that make the fan-out safe, Spine, Spine, Staffing the critical path (+5 more)

### Community 57 - "core.test.ts"
Cohesion: 0.16
Nodes (14): createFakeHarnessAdapter(), fakeError(), applyMigrations(), boot(), command(), createProjectSession(), migrationsFolder, selection (+6 more)

### Community 58 - "TurnService"
Cohesion: 0.26
Nodes (5): withTransaction(), errorOf(), TurnService, withoutDelivery(), Turn

### Community 59 - "store.ts"
Cohesion: 0.13
Nodes (9): ArtifactError, ArtifactErrorCode, Artifact, ArtifactMetadata, ArtifactStore, ArtifactStoreOptions, DEFAULT_MAX_ARTIFACT_BYTES, PutArtifactInput (+1 more)

### Community 60 - "config.ts"
Cohesion: 0.15
Nodes (12): aideConfigSchema, ConfigDefaults, configDefaultsSchema, GlobalConfigRecord, globalConfigRecordSchema, instanceConfigSchema, InstancesMap, McpServerConfig (+4 more)

### Community 61 - "Implementation Phases"
Cohesion: 0.20
Nodes (10): Implementation Phases, Phase 1: Foundation, Phase 2: Configuration and Instance Supervision, Phase 3: Inventory and Composer, Phase 4: Chat on Both Adapters, Phase 5: Parts, Requests, and Recovery, Phase 6: MCP and Dynamic Tools, Phase 7: Workspace Awareness (+2 more)

### Community 62 - "generate-tokens.mjs"
Cohesion: 0.22
Nodes (6): globalsCss, globalsPath, monorepo, outPath, parsed, root

### Community 63 - "API contracts and Bruno tests"
Cohesion: 0.29
Nodes (6): API contracts and Bruno tests, Bruno collection, Checklist for contract changes, Contract sources, Running tests, When to update `apitest/`

### Community 64 - "www/tsconfig.json"
Cohesion: 0.25
Nodes (7): exclude, extends, include, **/*, dist, astro/tsconfigs/strict, .astro/types.d.ts

### Community 65 - "web/tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, paths, files, ../../packages/ui/src/*, @workspace/ui/*, references

### Community 66 - "Testing Strategy"
Cohesion: 0.33
Nodes (6): Adapter Tests, Contract Tests, Cross-Harness Tests, Fake Adapter, Integration Tests, Testing Strategy

### Community 67 - "Aide Events"
Cohesion: 0.33
Nodes (6): Aide Events, Document, General, Instances, Runtime, and Inventory, Requests, Turn

### Community 68 - "Starlight Starter Kit: Basics"
Cohesion: 0.33
Nodes (5): Cloudflare, 🧞 Commands, 🚀 Project Structure, Starlight Starter Kit: Basics, 👀 Want to learn more?

### Community 69 - "opencode.json"
Cohesion: 0.50
Nodes (3): plugin, $schema, .opencode/plugins/graphify.js

### Community 70 - "Wave 1 — Kernel"
Cohesion: 0.50
Nodes (4): Fan-out (parallel — all start when S0 merges), Spikes to run early (throwaway, in Wave 1), Spine (serial, in order), Wave 1 — Kernel

### Community 73 - "Initial Scope"
Cohesion: 0.67
Nodes (3): Excluded Initially, Included, Initial Scope

### Community 74 - "Request"
Cohesion: 0.57
Nodes (4): ExternalCommandContext, InputResolution, PermissionResolution, Request

### Community 84 - "snapshots.ts"
Cohesion: 0.15
Nodes (12): requestSchema, turnSchema, instancesEventScopeSchema, sessionEventScopeSchema, DurableCursor, durableCursorSchema, InstanceSnapshotEntry, instanceSnapshotEntrySchema (+4 more)

## Knowledge Gaps
- **578 isolated node(s):** `$schema`, `.opencode/plugins/graphify.js`, `$schema`, `printWidth`, `tabWidth` (+573 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `hono` connect `dispatcher.ts` to `service.ts`, `scripts`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `dependencies` connect `scripts` to `dispatcher.ts`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **What connects `$schema`, `.opencode/plugins/graphify.js`, `$schema` to the rest of the system?**
  _578 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `contracts/src/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08773784355179703 - nodes in this community are weakly interconnected._
- **Should `adapter-conformance.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10931174089068826 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.09523809523809523 - nodes in this community are weakly interconnected._
- **Should `theme-provider.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.054901960784313725 - nodes in this community are weakly interconnected._