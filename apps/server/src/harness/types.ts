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

export type InterruptTurnInput = {
  handle: InstanceHandle
  nativeSession: NativeSession
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
  interrupt(input: InterruptTurnInput): Promise<void>
  respondToPermission(input: PermissionResponseInput): Promise<void>
  respondToInput(input: InputResponseInput): Promise<void>

  setMcpServers(input: SetMcpServersInput): Promise<void>
  mcpStatus(input: McpStatusInput): Promise<McpServerStatus[]>

  events(input: HarnessEventsInput): AsyncIterable<AideEvent>
  dispose(input: DisposeInput): Promise<void>
}
