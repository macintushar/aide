/**
 * A believable workspace for the full-app demo (`gallery.html#app`): several
 * projects, sessions in every state, and one rich conversation that starts on
 * OpenCode and continues on Claude. Built from contracts types so the real
 * App renders it through its real code paths.
 */
import type {
  AssistantMessage,
  Message,
  Part,
  ProjectSummary,
  Request,
  ResolvedExecution,
  SessionSnapshot,
  SessionSummary,
  Turn,
  UserMessage,
} from "@workspace/contracts"

import { mockInstancesSnapshot } from "./mock-data"

const now = Date.now()
const ago = (ms: number) => new Date(now - ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN

const opencode: ResolvedExecution = {
  selection: {
    instanceId: "opencode",
    driver: "opencode",
    model: { providerId: "openai", modelId: "gpt-5" },
    agent: "build",
    options: {},
  },
  display: {
    instanceName: "OpenCode",
    modelName: "GPT-5",
    agentName: "Build",
    options: {},
  },
  inventoryRevision: "rev_1",
}

const claude: ResolvedExecution = {
  selection: {
    instanceId: "claude",
    driver: "claudeAgent",
    model: { modelId: "opus-5" },
    interactionMode: "build",
    options: { effort: "high" },
  },
  display: {
    instanceName: "Claude Code",
    modelName: "Claude Opus 5",
    interactionModeName: "Build",
    options: { effort: { label: "Reasoning", valueLabel: "High" } },
  },
  inventoryRevision: "rev_2",
}

export const demoProjects: ProjectSummary[] = [
  {
    id: "proj_aide",
    name: "aide",
    directory: "/Users/tushar/code/aide",
    createdAt: ago(30 * 24 * HOUR),
    lastOpenedAt: ago(5 * MIN),
    sessionCount: 5,
  },
  {
    id: "proj_warrant",
    name: "warrant",
    directory: "/Users/tushar/code/warrant",
    createdAt: ago(60 * 24 * HOUR),
    lastOpenedAt: ago(3 * HOUR),
    sessionCount: 2,
  },
  {
    id: "proj_atlas",
    name: "atlas-web",
    directory: "/Users/tushar/code/atlas-web",
    createdAt: ago(10 * 24 * HOUR),
    lastOpenedAt: ago(26 * HOUR),
    sessionCount: 2,
  },
]

const project = (id: string) => {
  const found = demoProjects.find((candidate) => candidate.id === id)!
  return { id: found.id, name: found.name, directory: found.directory }
}

const SESSION_ID = "session_ratelimit"

function text(messageId: string, index: number, value: string): Part {
  return {
    id: `${messageId}_p${index}`,
    messageId,
    index,
    type: "text",
    text: value,
  }
}

const user1: UserMessage = {
  id: "msg_u1",
  sessionId: SESSION_ID,
  seq: 0,
  role: "user",
  parts: [
    text(
      "msg_u1",
      0,
      "Add rate limiting to the public API routes. Sliding window, 100 requests per minute per token, and return `429` with a `Retry-After` header."
    ),
  ],
  execution: opencode,
  createdAt: ago(18 * MIN),
}

const assistant1: AssistantMessage = {
  id: "msg_a1",
  sessionId: SESSION_ID,
  seq: 1,
  role: "assistant",
  parentMessageId: "msg_u1",
  parts: [
    {
      id: "msg_a1_r",
      messageId: "msg_a1",
      index: 0,
      type: "reasoning",
      text: "The public routes are mounted in src/server/routes.ts behind the token guard, so the limiter belongs right after it: the token is already resolved there and anonymous traffic never reaches it.",
    },
    {
      id: "msg_a1_t1",
      messageId: "msg_a1",
      index: 1,
      type: "tool",
      name: "read",
      category: "file_read",
      status: "completed",
      input: { path: "src/server/routes.ts" },
      output:
        "export function publicRoutes(app: Hono) {\n  app.use('/v1/*', tokenGuard)\n  …",
    },
    {
      id: "msg_a1_t2",
      messageId: "msg_a1",
      index: 2,
      type: "tool",
      name: "grep",
      category: "search",
      status: "completed",
      input: { pattern: "tokenGuard", path: "src" },
      output: "src/server/routes.ts:14\nsrc/server/guard.ts:3",
    },
    {
      id: "msg_a1_t3",
      messageId: "msg_a1",
      index: 3,
      type: "tool",
      name: "write",
      category: "file_write",
      status: "completed",
      input: { path: "src/server/rate-limit.ts" },
      output: "Created src/server/rate-limit.ts (48 lines)",
    },
    {
      id: "msg_a1_t4",
      messageId: "msg_a1",
      index: 4,
      type: "tool",
      name: "bash",
      category: "shell",
      status: "completed",
      input: { command: "bun test src/server" },
      output:
        "✓ rate-limit › allows 100 requests in a window\n✓ rate-limit › rejects the 101st with 429\n✓ rate-limit › sets Retry-After\n\n 24 pass  0 fail",
    },
    text(
      "msg_a1",
      5,
      'Added a sliding-window limiter as Hono middleware in [rate-limit.ts](src/server/rate-limit.ts) and mounted it after `tokenGuard`:\n\n```ts\napp.use("/v1/*", tokenGuard, rateLimit({ limit: 100, windowMs: 60_000 }))\n```\n\n- Counts live in an in-memory ring per token, so there is no new dependency.\n- Over the limit it returns **429** with `Retry-After` in seconds.\n- Three new tests cover the boundary; the whole server suite passes.'
    ),
  ],
  usage: {
    inputTokens: 18_420,
    outputTokens: 2_310,
    cacheReadTokens: 9_800,
    costUsd: 0.084,
  },
  createdAt: ago(17 * MIN),
  completedAt: ago(14 * MIN),
}

const user2: UserMessage = {
  id: "msg_u2",
  sessionId: SESSION_ID,
  seq: 2,
  role: "user",
  parts: [
    text(
      "msg_u2",
      0,
      "Review that for race conditions under concurrent requests, then load-test it."
    ),
  ],
  execution: claude,
  createdAt: ago(3 * MIN),
}

const assistant2: AssistantMessage = {
  id: "msg_a2",
  sessionId: SESSION_ID,
  seq: 3,
  role: "assistant",
  parentMessageId: "msg_u2",
  parts: [
    text(
      "msg_a2",
      0,
      "Found one: the window check and the increment are two separate reads of the ring, so two requests that land in the same tick can both see `99` and both pass. I've folded them into a single `hit()` that checks and records atomically."
    ),
    {
      id: "msg_a2_t1",
      messageId: "msg_a2",
      index: 1,
      type: "tool",
      name: "Edit",
      category: "file_write",
      status: "completed",
      input: { file_path: "src/server/rate-limit.ts" },
      output: "Updated hit() to check-and-record in one step",
    },
    {
      id: "msg_a2_t2",
      messageId: "msg_a2",
      index: 2,
      type: "tool",
      name: "Bash",
      category: "shell",
      status: "running",
      input: { command: "bunx autocannon -c 200 -d 10 localhost:3000/v1/ping" },
    },
  ],
  createdAt: ago(2 * MIN),
}

const turn1: Turn = {
  id: "turn_1",
  sessionId: SESSION_ID,
  seq: 0,
  status: "completed",
  execution: opencode,
  commandId: "cmd_1",
  userMessageId: "msg_u1",
  assistantMessageId: "msg_a1",
  startedAt: ago(18 * MIN),
  endedAt: ago(14 * MIN),
}

const turn2: Turn = {
  id: "turn_2",
  sessionId: SESSION_ID,
  seq: 1,
  status: "running",
  execution: claude,
  commandId: "cmd_2",
  userMessageId: "msg_u2",
  assistantMessageId: "msg_a2",
  startedAt: ago(2 * MIN + 14_000),
}

const permission: Request = {
  id: "req_load",
  sessionId: SESSION_ID,
  turnId: "turn_2",
  kind: "permission",
  status: "open",
  payload: {
    kind: "permission",
    toolName: "Bash",
    title: "Run a 10-second load test?",
    detail: "bunx autocannon -c 200 -d 10 localhost:3000/v1/ping",
    options: [
      { id: "allow", label: "Allow once", isDefault: true },
      { id: "always", label: "Always allow" },
      { id: "deny", label: "Deny" },
    ],
  },
}

const messages: Message[] = [user1, assistant1, user2, assistant2]

export const demoSnapshot: SessionSnapshot = {
  schemaVersion: 1,
  scope: { kind: "session", projectId: "proj_aide", sessionId: SESSION_ID },
  cursor: { sequence: 40 },
  project: {
    id: "proj_aide",
    name: "aide",
    directory: "/Users/tushar/code/aide",
    createdAt: ago(30 * 24 * HOUR),
    lastOpenedAt: ago(5 * MIN),
  },
  session: {
    id: SESSION_ID,
    projectId: "proj_aide",
    title: "Rate-limit the public API",
    createdAt: ago(18 * MIN),
    updatedAt: ago(1 * MIN),
    worktree: {
      path: "/Users/tushar/.aide/worktrees/aide/ratelimit",
      branch: "aide/rate-limit",
      baseRef: "main",
    },
  },
  messages,
  turns: [turn1, turn2],
  requests: [permission],
  notices: [],
  checkpoints: [{ turnId: "turn_1", createdAt: ago(18 * MIN) }],
}

function summary(
  partial: Omit<SessionSummary, "openRequests" | "turnCount"> &
    Partial<Pick<SessionSummary, "openRequests" | "turnCount">>
): SessionSummary {
  return { openRequests: 0, turnCount: 1, ...partial }
}

const exec = (execution: ResolvedExecution) => ({
  driver: execution.selection.driver,
  instanceName: execution.display.instanceName,
  modelName: execution.display.modelName,
})

export const demoSummaries: SessionSummary[] = [
  summary({
    session: demoSnapshot.session,
    project: project("proj_aide"),
    activity: "needs_input",
    openRequests: 1,
    turnCount: 2,
    latestExecution: exec(claude),
    lastMessage: {
      role: "assistant",
      text: "Found one: the window check and the increment are two separate reads of the ring…",
    },
    runningSince: ago(2 * MIN + 14_000),
    costUsd: 0.084,
  }),
  summary({
    session: {
      id: "session_flaky",
      projectId: "proj_aide",
      title: "Fix the flaky checkpoint restore test",
      createdAt: ago(9 * MIN),
      updatedAt: ago(20_000),
    },
    project: project("proj_aide"),
    activity: "running",
    latestExecution: exec(opencode),
    lastMessage: {
      role: "assistant",
      text: "The restore races the index lock; reproducing with 50 iterations now.",
    },
    runningSince: ago(4 * MIN + 31_000),
    costUsd: 0.031,
  }),
  summary({
    session: {
      id: "session_docs",
      projectId: "proj_atlas",
      title: "Migrate docs site to Astro 6",
      createdAt: ago(40 * MIN),
      updatedAt: ago(40_000),
      worktree: {
        path: "/Users/tushar/.aide/worktrees/atlas/astro6",
        branch: "aide/astro-6",
        baseRef: "main",
      },
    },
    project: project("proj_atlas"),
    activity: "running",
    turnCount: 3,
    latestExecution: exec(claude),
    lastMessage: {
      role: "assistant",
      text: "Content collections are migrated. Updating the sidebar config next.",
    },
    runningSince: ago(12 * MIN + 5_000),
    costUsd: 0.42,
  }),
  summary({
    session: {
      id: "session_oauth",
      projectId: "proj_warrant",
      title: "Investigate OAuth refresh loop",
      createdAt: ago(3 * HOUR),
      updatedAt: ago(2 * HOUR),
    },
    project: project("proj_warrant"),
    activity: "failed",
    turnCount: 2,
    latestExecution: exec(opencode),
    lastMessage: {
      role: "user",
      text: "Why does the refresh token get rotated twice on a cold start?",
    },
    costUsd: 0.12,
  }),
  summary({
    session: {
      id: "session_settings",
      projectId: "proj_aide",
      title: "Wire the settings panel to config.update",
      createdAt: ago(5 * HOUR),
      updatedAt: ago(4 * HOUR),
    },
    project: project("proj_aide"),
    activity: "completed",
    turnCount: 4,
    latestExecution: exec(opencode),
    lastMessage: {
      role: "assistant",
      text: "Settings now persist through the config merge, with validation errors shown inline.",
    },
    costUsd: 0.27,
  }),
  summary({
    session: {
      id: "session_storm",
      projectId: "proj_warrant",
      title: "Reconnect storm after deploy",
      createdAt: ago(26 * HOUR),
      updatedAt: ago(25 * HOUR),
    },
    project: project("proj_warrant"),
    activity: "completed",
    turnCount: 6,
    latestExecution: exec(claude),
    lastMessage: {
      role: "assistant",
      text: "The storm came from a missing liveness check; added jittered backoff.",
    },
    costUsd: 1.18,
  }),
  summary({
    session: {
      id: "session_icons",
      projectId: "proj_atlas",
      title: "Swap icon set to Remix",
      createdAt: ago(30 * HOUR),
      updatedAt: ago(29 * HOUR),
    },
    project: project("proj_atlas"),
    activity: "interrupted",
    latestExecution: exec(claude),
    lastMessage: { role: "user", text: "Actually, keep Lucide for now." },
    costUsd: 0.05,
  }),
  summary({
    session: {
      id: "session_plan",
      projectId: "proj_aide",
      title: "Plan the Codex adapter",
      createdAt: ago(2 * 24 * HOUR),
      updatedAt: ago(2 * 24 * HOUR),
    },
    project: project("proj_aide"),
    activity: "completed",
    turnCount: 2,
    latestExecution: exec(claude),
    lastMessage: {
      role: "assistant",
      text: "Drafted the adapter boundary: events map 1:1, approvals need a shim.",
    },
    costUsd: 0.19,
  }),
]

export const demoInstancesSnapshot = mockInstancesSnapshot

export const demoReadClient = {
  getInstances: async () => demoInstancesSnapshot,
  getSession: async () => demoSnapshot,
  getConfig: async () => ({ instances: {}, mcpServers: {}, defaults: {} }),
  getProjectConfig: async () => ({ mcpServers: {}, defaults: {} }) as never,
  listProjects: async () => ({ projects: demoProjects }),
  listSessions: async (projectId: string) => ({
    sessions: demoSummaries
      .filter((entry) => entry.project.id === projectId)
      .map((entry) => entry.session),
  }),
  listAllSessions: async () => ({ sessions: demoSummaries }),
  searchFiles: async () => ({ root: "/Users/tushar/code/aide", files: [] }),
  getFile: async (_sessionId: string, path: string) => ({
    path,
    binary: false,
    truncated: false,
    size: 120,
    content: "export function rateLimit() {}\n",
  }),
}
