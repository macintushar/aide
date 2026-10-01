import {
  filePreviewSchema,
  fileSearchResultSchema,
  globalConfigRecordSchema,
  harnessInventorySchema,
  projectListSchema,
  sessionListSchema,
  sessionSummaryListSchema,
  instancesSnapshotSchema,
  projectConfigRecordSchema,
  sessionSnapshotSchema,
  type FilePreview,
  type FileSearchResult,
  type HarnessInventory,
  type ProjectList,
  type SessionList,
  type SessionSummaryList,
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

  async function fetchWithAuth(path: string): Promise<Response> {
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
    return response
  }

  async function get(path: string): Promise<unknown> {
    const response = await fetchWithAuth(path)
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

    /** Fuzzy file search in the session's working directory. */
    async searchFiles(
      sessionId: string,
      query: string,
      limit = 12
    ): Promise<FileSearchResult> {
      const params = new URLSearchParams({ query, limit: String(limit) })
      return fileSearchResultSchema.parse(
        await get(
          `/sessions/${encodeURIComponent(sessionId)}/files?${params.toString()}`
        )
      )
    },

    async listProjects(): Promise<ProjectList> {
      return projectListSchema.parse(await get("/projects"))
    },

    async listSessions(projectId: string): Promise<SessionList> {
      return sessionListSchema.parse(
        await get(`/projects/${encodeURIComponent(projectId)}/sessions`)
      )
    },

    /** Every session across projects, with where each one stands. */
    async listAllSessions(): Promise<SessionSummaryList> {
      return sessionSummaryListSchema.parse(await get("/sessions"))
    },

    /** One file from the session's working directory. */
    async getFile(sessionId: string, path: string): Promise<FilePreview> {
      return filePreviewSchema.parse(
        await get(
          `/sessions/${encodeURIComponent(sessionId)}/file?path=${encodeURIComponent(path)}`
        )
      )
    },

    /** Full tool output that was too long to keep inline. */
    async getArtifact(artifactId: string): Promise<string> {
      const response = await fetchWithAuth(
        `/artifacts/${encodeURIComponent(artifactId)}`
      )
      const text = await response.text()
      if (!response.ok) throw new ReadError(response.status, text)
      return text
    },

    /** Inventory for the session's project directory. */
    async getSessionInventory(
      sessionId: string,
      instanceId: string
    ): Promise<HarnessInventory> {
      return harnessInventorySchema.parse(
        await get(
          `/sessions/${encodeURIComponent(sessionId)}/inventory?instanceId=${encodeURIComponent(instanceId)}`
        )
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
