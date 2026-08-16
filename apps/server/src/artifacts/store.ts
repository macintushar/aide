import { artifactsRepo, type AideDb } from "../db"
import { ArtifactError } from "./errors"

export const DEFAULT_MAX_ARTIFACT_BYTES = 10 * 1024 * 1024

export type ArtifactMetadata = {
  id: string
  mimeType: string
  byteLength: number
  createdAt: string
}

export type Artifact = ArtifactMetadata & {
  data: Uint8Array
}

export type PutArtifactInput = {
  id: string
  mimeType: string
  data: Uint8Array | string
  createdAt?: string
}

export type ArtifactStoreOptions = {
  maxBytes?: number
}

export class ArtifactStore {
  readonly maxBytes: number
  readonly #db: AideDb

  constructor(db: AideDb, options: ArtifactStoreOptions = {}) {
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_ARTIFACT_BYTES
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new ArtifactError("invalid_artifact", "maxBytes must be positive")
    }
    this.#db = db
    this.maxBytes = maxBytes
  }

  async put(input: PutArtifactInput): Promise<ArtifactMetadata> {
    if (!input.id || !input.mimeType) {
      throw new ArtifactError(
        "invalid_artifact",
        "Artifact id and MIME type are required"
      )
    }
    const data = this.#normalizeData(input.data)
    if (data.byteLength === 0) {
      throw new ArtifactError(
        "invalid_artifact",
        "Artifact data cannot be empty"
      )
    }
    if (data.byteLength > this.maxBytes) {
      throw new ArtifactError(
        "artifact_too_large",
        `Artifact exceeds the ${this.maxBytes} byte limit`,
        { byteLength: data.byteLength, maxBytes: this.maxBytes }
      )
    }

    const artifact = artifactsRepo.create(this.#db, {
      id: input.id,
      mimeType: input.mimeType,
      data,
      byteLength: data.byteLength,
      createdAt: input.createdAt ?? new Date().toISOString(),
    })
    this.#verifyByteLength(artifact)
    return this.#toMetadata(artifact)
  }

  async get(id: string): Promise<Artifact | undefined> {
    const artifact = artifactsRepo.get(this.#db, id)
    if (!artifact) return undefined
    this.#verifyByteLength(artifact)
    return {
      ...this.#toMetadata(artifact),
      data: new Uint8Array(artifact.data),
    }
  }

  async metadata(id: string): Promise<ArtifactMetadata | undefined> {
    const artifact = await this.get(id)
    if (!artifact) return undefined
    const { data: _data, ...metadata } = artifact
    return metadata
  }

  asPartReference(id: string): { artifactId: string } {
    return { artifactId: id }
  }

  #normalizeData(data: Uint8Array | string): Buffer {
    if (typeof data === "string") return Buffer.from(data, "utf8")
    if (data instanceof Uint8Array) return Buffer.from(data)
    throw new ArtifactError(
      "invalid_artifact",
      "Artifact data must be a string or Uint8Array"
    )
  }

  #verifyByteLength(artifact: {
    id: string
    data: Uint8Array
    byteLength: number
  }): void {
    if (artifact.byteLength !== artifact.data.byteLength) {
      throw new ArtifactError(
        "invalid_artifact",
        `Artifact ${artifact.id} has an invalid persisted byte length`,
        {
          byteLength: artifact.byteLength,
          actualByteLength: artifact.data.byteLength,
        }
      )
    }
  }

  #toMetadata(artifact: ArtifactMetadata): ArtifactMetadata {
    return {
      id: artifact.id,
      mimeType: artifact.mimeType,
      byteLength: artifact.byteLength,
      createdAt: artifact.createdAt,
    }
  }
}
