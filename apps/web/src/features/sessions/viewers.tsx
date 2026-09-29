import type { FilePreview } from "@workspace/contracts"
import { useEffect, useState } from "react"

import { Modal } from "@/components/modal"

type Loaded<T> =
  | { state: "loading" }
  | { state: "ready"; value: T }
  | { state: "error"; message: string }

function useLoad<T>(load: () => Promise<T>, key: string): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: "loading" })
  useEffect(() => {
    let current = true
    setLoaded({ state: "loading" })
    load()
      .then((value) => {
        if (current) setLoaded({ state: "ready", value })
      })
      .catch((error: unknown) => {
        if (current) {
          setLoaded({
            state: "error",
            message: error instanceof Error ? error.message : "Could not load",
          })
        }
      })
    return () => {
      current = false
    }
    // `key` identifies what is loaded; `load` is recreated on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return loaded
}

function Body({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-auto rounded-xl bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap">
      {children}
    </pre>
  )
}

/** A file from the session's working directory, opened from a message link. */
export function FilePreviewModal({
  path,
  load,
  onClose,
}: {
  path: string
  load: (path: string) => Promise<FilePreview>
  onClose: () => void
}) {
  const loaded = useLoad(() => load(path), path)
  return (
    <Modal
      title={<span className="font-mono">{path}</span>}
      onClose={onClose}
      wide
    >
      {loaded.state === "loading" ? (
        <p className="text-small text-muted-foreground">Loading…</p>
      ) : loaded.state === "error" ? (
        <p role="alert" className="text-small text-destructive">
          Could not open this file: {loaded.message}
        </p>
      ) : loaded.value.binary ? (
        <p className="text-small text-muted-foreground">
          This is a binary file ({loaded.value.size.toLocaleString()} bytes), so
          there is nothing to preview.
        </p>
      ) : (
        <>
          <Body>{loaded.value.content}</Body>
          {loaded.value.truncated ? (
            <p className="mt-2 text-small text-muted-foreground">
              Showing the start of a {loaded.value.size.toLocaleString()}-byte
              file.
            </p>
          ) : null}
        </>
      )}
    </Modal>
  )
}

/** A tool's full output, kept as an artifact because it was too long inline. */
export function ArtifactModal({
  artifactId,
  load,
  onClose,
}: {
  artifactId: string
  load: (artifactId: string) => Promise<string>
  onClose: () => void
}) {
  const loaded = useLoad(() => load(artifactId), artifactId)
  return (
    <Modal title="Full tool output" onClose={onClose} wide>
      {loaded.state === "loading" ? (
        <p className="text-small text-muted-foreground">Loading…</p>
      ) : loaded.state === "error" ? (
        <p role="alert" className="text-small text-destructive">
          Could not load the output: {loaded.message}
        </p>
      ) : (
        <Body>{loaded.value}</Body>
      )}
    </Modal>
  )
}
