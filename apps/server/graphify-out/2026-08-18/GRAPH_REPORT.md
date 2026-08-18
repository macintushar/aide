# Graph Report - server  (2026-08-17)

## Corpus Check
- 68 files · ~33,019 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 484 nodes · 1037 edges · 18 communities
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b7589277`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- fake/index.ts
- service.ts
- app.ts
- turn.ts
- scripts
- repos.ts
- git.ts
- TurnService
- store.ts
- compilerOptions
- turn.test.ts
- schema.ts
- API contracts and Bruno tests
- core.test.ts

## God Nodes (most connected - your core abstractions)
1. `AideDb` - 31 edges
2. `TurnService` - 29 edges
3. `HarnessAdapter` - 22 edges
4. `EventService` - 21 edges
5. `Database` - 19 edges
6. `defineHarnessAdapterConformance()` - 17 edges
7. `scripts` - 16 edges
8. `AdapterRegistry` - 16 edges
9. `createDb()` - 15 edges
10. `ProjectService` - 13 edges

## Surprising Connections (you probably didn't know these)
- `createEventRouter()` --references--> `hono`  [EXTRACTED]
  src/events/router.ts → package.json
- `fakeSubject()` --calls--> `createFakeHarnessAdapter()`  [EXTRACTED]
  test/conformance/fake.test.ts → src/harness/fake/index.ts
- `createCommandRouter()` --references--> `hono`  [EXTRACTED]
  src/commands/router.ts → package.json
- `createAideTestApp()` --references--> `hono`  [EXTRACTED]
  src/integration/app.ts → package.json
- `createApp()` --references--> `hono`  [EXTRACTED]
  src/security/command-guard.test.ts → package.json

## Import Cycles
- None detected.

## Communities (18 total, 0 thin omitted)

### Community 0 - "fake/index.ts"
Cohesion: 0.06
Nodes (43): EventBus, FakeAdapterError, fakeConfigSchema, FakeDispatchMode, FakeGate, FakeHarnessAdapterOptions, FakeHarnessControl, FakeInstance (+35 more)

### Community 1 - "service.ts"
Cohesion: 0.08
Nodes (26): EventScopeTarget, afterSequence(), createEventRouter(), migrationsFolder, createSubscription(), DurableEvent, DurableEventInput, EventService (+18 more)

### Community 2 - "app.ts"
Cohesion: 0.09
Nodes (34): hono, hono, assertReceiptTransition(), CommandDispatcher, CommandFor, CommandHandler, CommandHandlerRegistry, createCommandDispatcher() (+26 more)

### Community 3 - "turn.ts"
Cohesion: 0.10
Nodes (16): inventoryCacheRepo, AdapterRegistry, RegisteredAdapter, CoreServiceError, ExecutionResolver, migrationsFolder, CommandFor, CoreCommandServices (+8 more)

### Community 4 - "scripts"
Cohesion: 0.05
Nodes (40): drizzle-kit, drizzle-orm, dependencies, drizzle-orm, @standard-schema/spec, @t3-oss/env-core, @workspace/contracts, zod (+32 more)

### Community 5 - "repos.ts"
Cohesion: 0.13
Nodes (29): AideDb, RepoError, RepoErrorCode, AdapterIdMapping, AdapterMappingKind, Artifact, artifactSchema, ConfigTarget (+21 more)

### Community 6 - "git.ts"
Cohesion: 0.12
Nodes (23): WorkspaceError, WorkspaceErrorInput, errorDetail(), execFileAsync, execGit(), execGitChecked(), gitDiffSummary(), gitStatus() (+15 more)

### Community 7 - "TurnService"
Cohesion: 0.21
Nodes (4): ExternalCommandContext, withTransaction(), errorOf(), TurnService

### Community 8 - "store.ts"
Cohesion: 0.13
Nodes (9): ArtifactError, ArtifactErrorCode, Artifact, ArtifactMetadata, ArtifactStore, ArtifactStoreOptions, DEFAULT_MAX_ARTIFACT_BYTES, PutArtifactInput (+1 more)

### Community 9 - "compilerOptions"
Cohesion: 0.12
Nodes (15): bun, src, test, vitest.config.ts, compilerOptions, jsx, jsxImportSource, module (+7 more)

### Community 10 - "turn.test.ts"
Cohesion: 0.05
Nodes (41): applyMigrations(), migrationsFolder, applyMigrations(), applyMigrations(), createDb(), getDb(), adapterMappingsRepo, configRepo (+33 more)

### Community 11 - "schema.ts"
Cohesion: 0.13
Nodes (14): adapterIdMappings, artifacts, commandReceipts, configRecords, dispatchInputs, eventLog, inventoryCache, messages (+6 more)

### Community 12 - "API contracts and Bruno tests"
Cohesion: 0.29
Nodes (6): API contracts and Bruno tests, Bruno collection, Checklist for contract changes, Contract sources, Running tests, When to update `apitest/`

### Community 16 - "core.test.ts"
Cohesion: 0.17
Nodes (13): createFakeHarnessAdapter(), fakeError(), applyMigrations(), boot(), command(), createProjectSession(), migrationsFolder, selection (+5 more)

## Knowledge Gaps
- **127 isolated node(s):** `name`, `type`, `dev`, `lint`, `lint:fix` (+122 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `hono` connect `app.ts` to `service.ts`, `scripts`?**
  _High betweenness centrality (0.139) - this node is a cross-community bridge._
- **Why does `dependencies` connect `scripts` to `app.ts`?**
  _High betweenness centrality (0.135) - this node is a cross-community bridge._
- **Why does `AideDb` connect `repos.ts` to `service.ts`, `app.ts`, `turn.ts`, `TurnService`, `store.ts`, `turn.test.ts`?**
  _High betweenness centrality (0.099) - this node is a cross-community bridge._
- **What connects `name`, `type`, `dev` to the rest of the system?**
  _127 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `fake/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05789235639981909 - nodes in this community are weakly interconnected._
- **Should `service.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07918552036199095 - nodes in this community are weakly interconnected._
- **Should `app.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0851063829787234 - nodes in this community are weakly interconnected._