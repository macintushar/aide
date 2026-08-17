import {
  globalConfigRecordSchema,
  instancesSnapshotSchema,
  projectConfigRecordSchema,
  type GlobalConfigRecord,
  type InstancesSnapshot,
  type ProjectConfigRecord,
} from "@workspace/contracts"

export type ReadClientOptions = {
  baseUrl?: string
  fetchImpl?: typeof fetch
  bearerToken?: string
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
    const response = await fetchImpl(`${baseUrl}${path}`, {
      headers: readHeaders(options),
    })
    const body = await readResponseBody(response)
    if (!response.ok) throw new ReadError(response.status, body)
    return body
  }

  return {
    async getInstances(): Promise<InstancesSnapshot> {
      return instancesSnapshotSchema.parse(await get("/instances"))
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

function readHeaders(options: ReadClientOptions): Headers {
  const headers = new Headers(options.headers)
  if (options.bearerToken) {
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
