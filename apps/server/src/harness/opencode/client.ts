import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk/v2"
import type {
  McpLocalConfig,
  McpRemoteConfig,
  McpStatus,
  ModelRef,
  QuestionV2Reply,
  SessionInputAdmitted,
  SessionV2Info,
  V2Event,
} from "@opencode-ai/sdk/v2"

import type { OpencodeInstanceConfig } from "./config"

/**
 * The SDK boundary. Everything the adapter needs from `@opencode-ai/sdk` is
 * described structurally here, so the adapter itself is testable against a
 * double and the real client only has to satisfy the shape.
 *
 * This file and its siblings are the only place the OpenCode SDK may be
 * imported; the S0.10 lint rule makes a leak a build failure.
 */

export type OpencodeResult<T> = { data?: T; error?: unknown }

export type OpencodeModel = {
  id: string
  providerID: string
  name: string
  status?: string
  variants?: Record<string, Record<string, unknown>>
}

export type OpencodeProvider = {
  id: string
  name: string
  source?: string
  env?: string[]
  key?: string
  models: Record<string, OpencodeModel>
}

export type OpencodeAgent = {
  name: string
  description?: string
  mode?: "subagent" | "primary" | "all"
  hidden?: boolean
}

export type OpencodeSessionInfo = SessionV2Info
export type OpencodeSessionEvent = V2Event
export type OpencodeModelRef = ModelRef
export type OpencodeMcpStatus = McpStatus
export type OpencodeMcpConfig = McpLocalConfig | McpRemoteConfig

export type OpencodeSessionEventEnvelope = {
  id: string
  event: string
  data: string
}

type SessionResponse<T> = { data: T }

/** The subset of the pinned SDK used by the adapter. */
export type OpencodeApi = {
  global: {
    health(): Promise<OpencodeResult<{ healthy: boolean; version: string }>>
  }
  config: {
    providers(parameters?: { directory?: string }): Promise<
      OpencodeResult<{
        providers: OpencodeProvider[]
        default: Record<string, string>
      }>
    >
  }
  app: {
    agents(parameters?: {
      directory?: string
    }): Promise<OpencodeResult<OpencodeAgent[]>>
  }
  v2?: {
    session: {
      create(parameters?: {
        id?: string
        agent?: string
        model?: OpencodeModelRef
        location?: { directory: string; workspaceID?: string }
      }): Promise<OpencodeResult<SessionResponse<OpencodeSessionInfo>>>
      get(parameters: {
        sessionID: string
      }): Promise<OpencodeResult<SessionResponse<OpencodeSessionInfo>>>
      active(): Promise<
        OpencodeResult<SessionResponse<Record<string, unknown>>>
      >
      switchAgent(parameters: {
        sessionID: string
        agent?: string
      }): Promise<OpencodeResult<void>>
      switchModel(parameters: {
        sessionID: string
        model?: OpencodeModelRef
      }): Promise<OpencodeResult<void>>
      prompt(parameters: {
        sessionID: string
        id?: string
        prompt?: {
          text: string
          files?: Array<{ uri: string; name?: string; description?: string }>
        }
        delivery?: "steer" | "queue"
        resume?: boolean
      }): Promise<OpencodeResult<SessionResponse<SessionInputAdmitted>>>
      wait(parameters: { sessionID: string }): Promise<OpencodeResult<void>>
      events(
        parameters: { sessionID: string; after?: string },
        options?: { signal?: AbortSignal }
      ): Promise<{ stream: AsyncGenerator<OpencodeSessionEventEnvelope> }>
      interrupt(parameters: {
        sessionID: string
      }): Promise<OpencodeResult<void>>
      permission: {
        reply(parameters: {
          sessionID: string
          requestID: string
          reply?: "once" | "always" | "reject"
          message?: string
        }): Promise<OpencodeResult<void>>
      }
      question: {
        reply(parameters: {
          sessionID: string
          requestID: string
          questionV2Reply: QuestionV2Reply
        }): Promise<OpencodeResult<void>>
        reject(parameters: {
          sessionID: string
          requestID: string
        }): Promise<OpencodeResult<void>>
      }
    }
  }
  mcp?: {
    status(parameters?: {
      directory?: string
    }): Promise<OpencodeResult<Record<string, OpencodeMcpStatus>>>
    add(parameters?: {
      directory?: string
      name?: string
      config?: OpencodeMcpConfig
    }): Promise<OpencodeResult<Record<string, OpencodeMcpStatus>>>
    connect(parameters: {
      name: string
      directory?: string
    }): Promise<OpencodeResult<boolean>>
    disconnect(parameters: {
      name: string
      directory?: string
    }): Promise<OpencodeResult<boolean>>
  }
}

/** One connected runtime: the client plus whatever owns its lifetime. */
export type OpencodeRuntime = {
  readonly api: OpencodeApi
  /** Present only when Aide spawned the server and must therefore stop it. */
  close?: () => void | Promise<void>
}

export type OpencodeRuntimeFactory = (input: {
  config: OpencodeInstanceConfig
  directory?: string
}) => Promise<OpencodeRuntime>

/**
 * Default factory. Connects to a user-run server when `baseUrl` is configured,
 * otherwise asks the SDK to manage a local runtime for this instance.
 */
export const createOpencodeRuntime: OpencodeRuntimeFactory = async ({
  config,
  directory,
}) => {
  if (config.baseUrl) {
    const client = createOpencodeClient({
      baseUrl: config.baseUrl,
      ...(directory ? { directory } : {}),
    })
    return { api: client }
  }

  const { client, server } = await createOpencode({
    ...(config.hostname ? { hostname: config.hostname } : {}),
    ...(config.port === undefined ? {} : { port: config.port }),
  })
  return {
    api: client,
    close: () => server.close(),
  }
}
