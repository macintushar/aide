import {
  globalConfigRecordSchema,
  instancesSnapshotSchema,
  projectConfigRecordSchema,
  sessionSnapshotSchema,
  type GlobalConfigRecord,
  type InstancesSnapshot,
  type ProjectConfigRecord,
  type SessionSnapshot,
} from "@workspace/contracts"

import type { SessionAuth } from "./session-auth"

export type ReadClientOptions = {
  baseUrl?: string
  fetchImpl?: typeof fetch
  bearerToken?: string
  /** Bootstrap/session auth; takes precedence over a static bearerToken. */
  auth?: SessionAuth
  headers?: HeadersInit
}

export class ReadError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown) {
    super(`Read failed with status ${status}`)
    this.name = "ReadError"
    this.status = status
    this.body = body
  }
}

export function createReadClient(options: ReadClientOptions = {}) {
  const baseUrl = options.baseUrl?.replace(/\/$/, "") ?? ""
  const fetchImpl = options.fetchImpl ?? fetch

  async function get(path: string): Promise<unknown> {
    let response = await fetchImpl(`${baseUrl}${path}`, {
      headers: await readHeaders(options),
    })
    // A rejected session is re-exchanged exactly once.
    if (response.status === 401 && options.auth) {
      options.auth.invalidate()
      response = await fetchImpl(`${baseUrl}${path}`, {
        headers: await readHeaders(options),
      })
    }
    const body = await readResponseBody(response)
    if (!response.ok) throw new ReadError(response.status, body)
    return body
  }

  return {
    async getInstances(): Promise<InstancesSnapshot> {
      return instancesSnapshotSchema.parse(await get("/instances"))
    },

    async getSession(sessionId: string): Promise<SessionSnapshot> {
      return sessionSnapshotSchema.parse(
        await get(`/sessions/${encodeURIComponent(sessionId)}`)
      )
    },

    async getConfig(): Promise<GlobalConfigRecord> {
      return globalConfigRecordSchema.parse(await get("/config"))
    },

    async getProjectConfig(projectId: string): Promise<ProjectConfigRecord> {
      return projectConfigRecordSchema.parse(
        await get(`/projects/${encodeURIComponent(projectId)}/config`)
      )
    },
  }
}

async function readHeaders(options: ReadClientOptions): Promise<Headers> {
  const headers = new Headers(options.headers)
  if (options.auth) {
    headers.set("authorization", `Bearer ${await options.auth.bearer()}`)
  } else if (options.bearerToken) {
    headers.set("authorization", `Bearer ${options.bearerToken}`)
  }
  return headers
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}
