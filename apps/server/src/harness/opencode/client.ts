import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

import { OpenCode as OpenCodeClient } from "@opencode/client"
import type {
  AgentInfo,
  FormInfo,
  McpServer,
  ModelInfo,
  ModelRef,
  PermissionRequest,
  SessionActive,
  SessionInboxUser,
  SessionInfo,
  SessionLogOutput,
  V2Event,
} from "@opencode/client"

import { env } from "../../env"
import {
  PINNED_OPENCODE_SDK_VERSION,
  type OpencodeInstanceConfig,
} from "./config"

/**
 * The SDK boundary. Everything the adapter needs from `@opencode/sdk` (an
 * in-process host) and `@opencode/client` (a remote server) is described
 * structurally here, so the adapter itself is testable against a double and
 * either real client only has to satisfy the shape.
 *
 * Both packages throw a `ClientError` on failure rather than returning an
 * error value, so every call here either resolves with data or rejects.
 *
 * This file and its siblings are the only place the OpenCode SDK may be
 * imported; the S0.10 lint rule makes a leak a build failure.
 */

export type OpencodeModel = Pick<
  ModelInfo,
  "id" | "providerID" | "name" | "enabled"
> & { variants: Array<{ id: string }> }
export type OpencodeAgent = Pick<
  AgentInfo,
  "id" | "name" | "mode" | "hidden"
> & {
  description?: string
}
export type OpencodeMcpServer = McpServer
export type OpencodeProviderInfo = {
  id: string
  name: string
  integrationID?: string
  activation?: "auto" | "enabled" | "disabled"
}
export type OpencodeIntegration = {
  id: string
  name: string
  connections: Array<
    | { type: "credential"; id: string; label: string; method: "key" | "oauth" }
    | { type: "env"; name: string }
  >
}
export type OpencodeSessionInfo = SessionInfo
export type OpencodeLiveEvent = V2Event
export type OpencodeLogEvent = SessionLogOutput
export type OpencodeModelRef = ModelRef
export type OpencodeForm = FormInfo
export type OpencodeFormField = FormInfo["fields"][number]
export type OpencodePermissionRequest = PermissionRequest

export type OpencodeMcpConfig =
  | {
      type: "local"
      command: string[]
      environment?: Record<string, string>
    }
  | {
      type: "remote"
      url: string
      headers?: Record<string, string>
      oauth: false
    }

type Location = { location?: { directory?: string } }
type Listed<T> = Promise<{ data: T[] }>
type RequestOptions = { signal?: AbortSignal }

/** The subset of the OpenCode 2.x client used by the adapter. */
export type OpencodeApi = {
  server: {
    info(): Promise<{ version: string }>
  }
  model: {
    list(input?: Location): Listed<OpencodeModel>
    default(input?: Location): Promise<{ data: OpencodeModel | null }>
  }
  agent: {
    list(input?: Location): Listed<OpencodeAgent>
  }
  command: {
    list(input?: Location): Listed<{ name: string; description?: string }>
  }
  skill: {
    list(
      input?: Location
    ): Listed<{ id: string; name: string; description?: string }>
  }
  provider: {
    list(input?: Location): Listed<OpencodeProviderInfo>
  }
  integration: {
    list(input?: Location): Listed<OpencodeIntegration>
  }
  session: {
    create(input: {
      agent?: string
      model?: OpencodeModelRef
      location?: { directory: string }
    }): Promise<OpencodeSessionInfo>
    get(input: { sessionID: string }): Promise<OpencodeSessionInfo>
    active(): Promise<Record<string, SessionActive>>
    switchAgent(input: { sessionID: string; agent: string }): Promise<void>
    switchModel(input: {
      sessionID: string
      model: OpencodeModelRef
    }): Promise<void>
    prompt(input: {
      sessionID: string
      id?: string
      text: string
      files?: Array<{ uri: string; name?: string }>
      skills?: Array<{ id: string }>
      delivery?: "steer" | "queue"
    }): Promise<Pick<SessionInboxUser, "id">>
    /** Runs a command; its text is the command's arguments. */
    command(input: {
      sessionID: string
      name: string
      text: string
      files?: Array<{ uri: string; name?: string }>
      delivery?: "steer" | "queue"
    }): Promise<void>
    /** Adds context to the session; `resume: false` starts no execution. */
    synthetic(input: {
      sessionID: string
      text: string
      description?: string
      resume?: boolean
    }): Promise<unknown>
    wait(input: { sessionID: string }): Promise<void>
    /** Queues a compaction of the session's context. */
    compact(input: { sessionID: string }): Promise<unknown>
    interrupt(input: { sessionID: string }): Promise<unknown>
    /** Durable per-session history; `follow` keeps it open for new events. */
    log(
      input: { sessionID: string; after?: number; follow?: boolean },
      options?: RequestOptions
    ): AsyncIterable<OpencodeLogEvent>
    form: {
      list(input: { sessionID: string }): Promise<OpencodeForm[]>
      reply(input: {
        sessionID: string
        formID: string
        answer: Record<string, string | number | boolean | string[]>
      }): Promise<void>
      cancel(input: { sessionID: string; formID: string }): Promise<void>
    }
  }
  permission: {
    list(input: { sessionID: string }): Promise<OpencodePermissionRequest[]>
    reply(input: {
      sessionID: string
      requestID: string
      decision: "once" | "always" | "reject"
      message?: string
    }): Promise<void>
  }
  /** Live host events, including the ephemeral deltas the log never holds. */
  event: {
    subscribe(options?: RequestOptions): AsyncIterable<OpencodeLiveEvent>
  }
  mcp: {
    list(input?: Location): Listed<OpencodeMcpServer>
    add(
      input: Location & { server: string; config: OpencodeMcpConfig }
    ): Promise<void>
    remove(input: Location & { server: string }): Promise<void>
    connect(input: Location & { server: string }): Promise<void>
  }
}

/** One connected runtime: the client plus whatever owns its lifetime. */
export type OpencodeRuntime = {
  readonly api: OpencodeApi
  /**
   * The runtime version when the runtime cannot report it itself. An
   * in-process host is the bundled SDK, so its version is the pinned one.
   */
  readonly version?: string
  /** Present only when Aide hosts OpenCode and must therefore release it. */
  close?: () => void | Promise<void>
}

export type OpencodeRuntimeFactory = (input: {
  instanceId: string
  config: OpencodeInstanceConfig
}) => Promise<OpencodeRuntime>

/**
 * Default factory. Connects to a user-run server when `baseUrl` is configured,
 * otherwise hosts OpenCode in process. The in-process host keeps sessions in
 * its own database file; without one it would default to memory and every
 * native session would vanish on restart.
 */
export const createOpencodeRuntime: OpencodeRuntimeFactory = async ({
  instanceId,
  config,
}) => {
  if (config.baseUrl) {
    return { api: OpenCodeClient.make({ baseUrl: config.baseUrl }) }
  }

  const databasePath =
    config.databasePath ??
    join(dirname(env.DB_FILE_NAME), `opencode-${instanceId}.sqlite`)
  mkdirSync(dirname(databasePath), { recursive: true })
  // Loaded on demand: the in-process host needs Bun, and a remote-only or
  // test process should not have to load it.
  const { OpenCode } = await import("@opencode/sdk")
  const host = await OpenCode.create({
    database: { path: databasePath },
    // Session logs are empty unless the host persists events, and the log is
    // what lets a restarted Aide replay a turn it was watching.
    events: { persist: true },
  })
  return {
    api: host,
    version: PINNED_OPENCODE_SDK_VERSION,
    close: () => host.close(),
  }
}
