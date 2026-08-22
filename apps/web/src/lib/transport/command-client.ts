import {
  commandReceiptSchema,
  type Command,
  type CommandReceipt,
} from "@workspace/contracts"

import type { SessionAuth } from "./session-auth"

const MAX_ATTEMPTS = 3
const INITIAL_RETRY_DELAY_MS = 100

type Sleep = (milliseconds: number) => Promise<void>

export type CommandClientOptions = {
  baseUrl?: string
  fetchImpl?: typeof fetch
  sleepImpl?: Sleep
  bearerToken?: string
  /** Bootstrap/session auth; takes precedence over a static bearerToken. */
  auth?: SessionAuth
  headers?: HeadersInit
}

export class CommandError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown) {
    super(`Command failed with status ${status}`)
    this.name = "CommandError"
    this.status = status
    this.body = body
  }
}

export function newCommandId(): string {
  return `cmd_${crypto.randomUUID()}`
}

export function createCommandClient(options: CommandClientOptions = {}) {
  const baseUrl = options.baseUrl?.replace(/\/$/, "") ?? ""
  const fetchImpl = options.fetchImpl ?? fetch
  const sleepImpl = options.sleepImpl ?? defaultSleep

  return {
    async send(command: Command): Promise<CommandReceipt> {
      const { name, ...body } = command
      const requestBody = JSON.stringify(body)
      let authRetried = false

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        let response: Response
        let responseBody: unknown

        try {
          response = await fetchImpl(
            `${baseUrl}/commands/${encodeURIComponent(name)}`,
            {
              method: "POST",
              headers: await requestHeaders(options),
              body: requestBody,
            }
          )
          responseBody = await readResponseBody(response)
        } catch (error) {
          if (attempt === MAX_ATTEMPTS - 1) throw error
          await sleepImpl(INITIAL_RETRY_DELAY_MS * 2 ** attempt)
          continue
        }

        if (response.ok) return commandReceiptSchema.parse(responseBody)
        // A rejected session is re-exchanged exactly once; the bootstrap
        // token never rides on data requests.
        if (response.status === 401 && options.auth && !authRetried) {
          authRetried = true
          options.auth.invalidate()
          continue
        }
        if (response.status < 500 || attempt === MAX_ATTEMPTS - 1) {
          throw new CommandError(response.status, responseBody)
        }
        await sleepImpl(INITIAL_RETRY_DELAY_MS * 2 ** attempt)
      }

      throw new Error("Command retry loop exhausted")
    },
  }
}

async function requestHeaders(options: CommandClientOptions): Promise<Headers> {
  const headers = new Headers(options.headers)
  headers.set("content-type", "application/json")
  if (options.auth) {
    headers.set("authorization", `Bearer ${await options.auth.bearer()}`)
  } else if (options.bearerToken) {
    headers.set("authorization", `Bearer ${options.bearerToken}`)
  }
  return headers
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length === 0) return undefined

  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
