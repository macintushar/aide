import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk/v2"

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

/** The subset of `client.v2` this adapter calls in Wave 2. */
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
    return { api: client as unknown as OpencodeApi }
  }

  const { client, server } = await createOpencode({
    ...(config.hostname ? { hostname: config.hostname } : {}),
    ...(config.port === undefined ? {} : { port: config.port }),
  })
  return {
    api: client as unknown as OpencodeApi,
    close: () => server.close(),
  }
}
