/**
 * Every value the gallery renders comes from here, and everything here comes
 * from `@workspace/contracts` fixtures — the same fixtures the tests use.
 *
 * To point a gallery entry at real data, swap the mock client below for the
 * real `createReadClient()`. To delete the gallery entirely, remove
 * `src/gallery/`, `gallery.html`, and the `gallery` input in `vite.config.ts`.
 */
import {
  assistantMessageFixture,
  inputRequestFixture,
  instancesSnapshotFixture,
  inventoryFixture,
  permissionRequestFixture,
  resolvedExecutionFixture,
  sessionSnapshotFixture,
  turnFixture,
  userMessageFixture,
  type InstanceSnapshotEntry,
  type InstancesSnapshot,
  type Message,
  type Request,
  type ResolvedExecution,
  type SessionSnapshot,
  type Turn,
  type TurnStatus,
} from "@workspace/contracts"

import type { RecentSession } from "@/lib/recent-sessions"

export const mockExecution: ResolvedExecution = resolvedExecutionFixture()

export const mockMessages: Message[] = [
  userMessageFixture(),
  assistantMessageFixture(),
]

/** Fixtures resolve by default; the gallery wants the actionable state. */
export const mockRequests: Request[] = [
  { ...permissionRequestFixture(), status: "open", resolution: undefined },
  { ...inputRequestFixture(), status: "open", resolution: undefined },
]

export const mockResolvedRequests: Request[] = [
  permissionRequestFixture(),
  inputRequestFixture(),
]

export const mockTurns: Turn[] = (
  [
    "queued",
    "running",
    "completed",
    "interrupted",
    "failed",
  ] satisfies TurnStatus[]
).map((status, index) => ({
  ...turnFixture(status),
  id: `turn_${index}`,
  seq: index,
}))

/** Two harnesses with inventories, so the picker's rail has somewhere to go. */
export const mockInstancesSnapshot: InstancesSnapshot = (() => {
  const base = instancesSnapshotFixture()
  const claudeInventory = inventoryFixture()
  return {
    ...base,
    instances: [
      base.instances[0]!,
      {
        ...base.instances[1]!,
        status: "ready",
        auth: { status: "authenticated", type: "oauth" },
        inventory: {
          ...claudeInventory,
          instanceId: "claude",
          driver: "claudeAgent",
          capabilities: {
            ...claudeInventory.capabilities,
            agentSelection: false,
            interactionModes: [
              { id: "build", label: "Build", isDefault: true },
              { id: "plan", label: "Plan" },
            ],
          },
          agents: [],
          models: [
            {
              modelId: "opus-5",
              displayName: "Claude Opus 5",
              isDefault: true,
              optionDescriptors: [
                {
                  id: "effort",
                  label: "Reasoning",
                  type: "select",
                  options: [
                    { id: "low", label: "Low" },
                    { id: "high", label: "High", isDefault: true },
                  ],
                  defaultValue: "high",
                },
              ],
            },
            {
              modelId: "sonnet-5",
              displayName: "Claude Sonnet 5",
              optionDescriptors: [],
            },
          ],
        },
      },
    ],
  }
})()

export const mockInstances: InstanceSnapshotEntry[] =
  mockInstancesSnapshot.instances

export const mockSnapshot: SessionSnapshot = {
  ...sessionSnapshotFixture(),
  turns: mockTurns,
}

export const mockRecents: RecentSession[] = [
  {
    sessionId: "session_1",
    title: "Wire the settings panel",
    projectName: "aide",
    lastMessage: "Settings now persist through the config merge.",
    harnessName: "OpenCode",
    openedAt: Date.now(),
  },
  {
    sessionId: "session_2",
    title: "Port the OpenCode adapter send path",
    projectName: "aide",
    lastMessage: "The send path now resolves execution first.",
    harnessName: "OpenCode",
    openedAt: Date.now() - 3_600_000,
  },
  {
    sessionId: "session_3",
    title: "Investigate reconnect storm",
    projectName: "warrant",
    lastMessage: "The storm came from a missing liveness check.",
    harnessName: "Claude Code",
    openedAt: Date.now() - 86_400_000,
  },
]

/** Stands in for `createReadClient()`; resolves fixtures instead of fetching. */
export const mockReadClient = {
  getSession: async () => mockSnapshot,
}

/** Stands in for `createCommandClient()`; records nothing, fails nothing. */
export const mockCommandClient = {
  send: async () => ({}) as never,
}

/** Stands in for an SSE subscription that never emits. */
export const mockSubscribe = () => ({ close: () => {} })
