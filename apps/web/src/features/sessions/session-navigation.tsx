import {
  projectSchema,
  sessionSchema,
  type Project,
} from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { useState, type FormEvent } from "react"

import {
  createCommandClient,
  newCommandId,
} from "@/lib/transport/command-client"

type CommandClient = Pick<ReturnType<typeof createCommandClient>, "send">

export function SessionNavigation({
  commandClient,
  activeSessionId,
  onSelectSession,
}: {
  commandClient: CommandClient
  activeSessionId?: string
  onSelectSession: (sessionId: string) => void
}) {
  const [sessionId, setSessionId] = useState(activeSessionId ?? "")
  const [directory, setDirectory] = useState("")
  const [project, setProject] = useState<Project>()
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)

  function openSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const id = sessionId.trim()
    if (id) onSelectSession(id)
  }

  async function openProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const path = directory.trim()
    if (!path) return
    setError(undefined)
    setPending(true)
    try {
      const receipt = await commandClient.send({
        name: "project.open",
        commandId: newCommandId(),
        directory: path,
      })
      setProject(projectSchema.parse(receipt.result))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  async function createSession() {
    if (!project) return
    setError(undefined)
    setPending(true)
    try {
      const receipt = await commandClient.send({
        name: "session.create",
        commandId: newCommandId(),
        projectId: project.id,
      })
      const session = sessionSchema.parse(receipt.result)
      setSessionId(session.id)
      onSelectSession(session.id)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2" aria-busy={pending}>
      <form
        onSubmit={openProject}
        className="rounded-lg border border-border bg-card p-4"
      >
        <label htmlFor="project-directory" className="text-ui font-medium">
          Project directory
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="project-directory"
            value={directory}
            placeholder="/path/to/project"
            onChange={(event) => setDirectory(event.target.value)}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-ui"
          />
          <Button
            type="submit"
            variant="outline"
            disabled={pending || !directory.trim()}
          >
            Open
          </Button>
        </div>
        {project ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
            <span className="truncate text-ui">{project.name}</span>
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => void createSession()}
            >
              New session
            </Button>
          </div>
        ) : null}
      </form>

      <form
        onSubmit={openSession}
        className="rounded-lg border border-border bg-card p-4"
      >
        <label htmlFor="session-id" className="text-ui font-medium">
          Session ID
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="session-id"
            value={sessionId}
            placeholder="session_…"
            onChange={(event) => setSessionId(event.target.value)}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-ui"
          />
          <Button type="submit" disabled={!sessionId.trim()}>
            View session
          </Button>
        </div>
        <p className="mt-2 text-small text-muted-foreground">
          Resume an existing transcript and its live event stream.
        </p>
      </form>

      {error ? (
        <p role="alert" className="text-ui text-destructive md:col-span-2">
          Navigation failed: {error}
        </p>
      ) : null}
    </div>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error"
}
