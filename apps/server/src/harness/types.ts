import type { StandardSchemaV1 } from "@standard-schema/spec"
import type {
  AideError,
  AideEvent,
  DriverId,
  HarnessCapabilities,
  HarnessInventory,
  InstanceAuth,
  InstanceConfig,
  InstanceRuntimeStatus,
  McpServerConfig,
  McpServerStatus,
  NativeDispatchInput,
  ResolvedExecution,
  Request,
  Turn,
  UserMessage,
} from "@workspace/contracts"

export type InstanceHandle = {
  instanceId: string
  driver: DriverId
}

export type InstanceHealth = {
  status: InstanceRuntimeStatus
  version?: string
  installed?: boolean
  auth: InstanceAuth
  error?: AideError
}

export type NativeSession = {
  nativeSessionId: string
  resumeCursor?: string
}

export type StartInstanceInput = {
  instance: InstanceConfig
  projectDirectory?: string
}

export type StopInstanceInput = {
  handle: InstanceHandle
}

export type HealthInput = {
  handle: InstanceHandle
}

export type DiscoverInput = {
  handle: InstanceHandle
  directory?: string
}

export type OpenSessionInput = {
  handle: InstanceHandle
  sessionId: string
  projectDirectory: string
  execution: ResolvedExecution
}

export type ResumeSessionInput = {
  handle: InstanceHandle
  sessionId: string
  nativeSessionId: string
  resumeCursor?: string
  /** Present during boot reconciliation so replay can rebuild the live turn. */
  activeTurn?: Turn
}

export type SendTurnInput = {
  handle: InstanceHandle
  nativeSession: NativeSession
  commandId: string
  turnId: string
  userMessage: UserMessage
  execution: ResolvedExecution
  handoff?: NativeDispatchInput
}

export type SteerTurnInput = {
  handle: InstanceHandle
  nativeSession: NativeSession
  /** The running turn the message is delivered into. */
  turnId: string
  message: UserMessage
}

export type InterruptTurnInput = {
  handle: InstanceHandle
  nativeSession: NativeSession
  turnId: string
}

export type ActiveTurnInput = {
  handle: InstanceHandle
  nativeSession: NativeSession
}

export type ActiveNativeTurn = {
  turnId: string
}

export type PermissionResponseInput = {
  handle: InstanceHandle
  request: Request
  nativeSession: NativeSession
}

export type InputResponseInput = {
  handle: InstanceHandle
  request: Request
  nativeSession: NativeSession
}

export type SetMcpServersInput = {
  handle: InstanceHandle
  servers: Record<string, McpServerConfig>
}

export type McpStatusInput = {
  handle: InstanceHandle
}

export type HarnessEventsInput = {
  handle: InstanceHandle
  nativeSession?: NativeSession
}

export type DisposeInput = {
  handle: InstanceHandle
}

export interface HarnessAdapter {
  driver: DriverId
  configSchema: StandardSchemaV1
  capabilities(instance: InstanceHandle): HarnessCapabilities

  start(input: StartInstanceInput): Promise<InstanceHandle>
  stop(input: StopInstanceInput): Promise<void>
  health(input: HealthInput): Promise<InstanceHealth>

  discover(input: DiscoverInput): Promise<HarnessInventory>

  openSession(input: OpenSessionInput): Promise<NativeSession>
  resumeSession(input: ResumeSessionInput): Promise<NativeSession>

  send(input: SendTurnInput): Promise<void>
  /**
   * Delivers a message into the turn that is already running, so the harness
   * takes it into account before it finishes. Adapters that cannot steer omit
   * this, and Aide refuses the steer rather than queueing it silently.
   */
  steer?(input: SteerTurnInput): Promise<void>
  interrupt(input: InterruptTurnInput): Promise<void>
  /**
   * Reports the turn this native session is currently executing, if any.
   * Boot reconciliation needs it because an event stream only carries what
   * happens after subscribing: a turn that reached its terminal state while
   * the server was down would otherwise be waited on forever. Adapters that
   * cannot answer omit this, and the core refuses to reattach rather than
   * risk stranding the session.
   */
  activeTurn?(input: ActiveTurnInput): Promise<ActiveNativeTurn | undefined>
  respondToPermission(input: PermissionResponseInput): Promise<void>
  respondToInput(input: InputResponseInput): Promise<void>

  setMcpServers(input: SetMcpServersInput): Promise<void>
  mcpStatus(input: McpStatusInput): Promise<McpServerStatus[]>

  /**
   * Streams events for an instance, or for one native session. Events emitted
   * after iteration begins must reach the iterator: boot reconciliation pulls
   * once before it decides whether to keep a turn, and a stream that drops
   * whatever arrives before its first `next()` resolves would strand that
   * turn's completion.
   */
  events(input: HarnessEventsInput): AsyncIterable<AideEvent>
  dispose(input: DisposeInput): Promise<void>
}

/**
 * The text a user message carries, and for an invoked command or skill, its
 * arguments: the stored text is what the user typed (`/name args`), so the
 * leading `/name` is stripped here.
 */
export function messageText(message: UserMessage): {
  text: string
  arguments: string
} {
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
  const invocation = message.invocation
  if (!invocation) return { text, arguments: text }
  const prefix = `/${invocation.name}`
  const rest = text.startsWith(prefix) ? text.slice(prefix.length) : text
  return { text, arguments: rest.trim() }
}
