import { RiArrowDownSLine, RiArrowRightSLine } from "@remixicon/react"
import type {
  ProjectList,
  ProjectSummary,
  Session,
  SessionList,
} from "@workspace/contracts"
import { cn } from "@workspace/ui/lib/utils"
import { useEffect, useState } from "react"

export type ProjectBrowserClient = {
  listProjects: () => Promise<ProjectList>
  listSessions: (projectId: string) => Promise<SessionList>
}

/**
 * Every project the server knows, with its sessions loaded when expanded.
 * `refreshKey` changes whenever navigation may have added or removed one.
 */
export function ProjectBrowser({
  client,
  activeSessionId,
  refreshKey,
  onSelectSession,
}: {
  client: ProjectBrowserClient
  activeSessionId?: string
  refreshKey?: unknown
  onSelectSession: (sessionId: string) => void
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>()
  const [error, setError] = useState<string>()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [sessions, setSessions] = useState<Record<string, Session[]>>({})

  useEffect(() => {
    let active = true
    client
      .listProjects()
      .then((list) => {
        if (!active) return
        setProjects(list.projects)
        setError(undefined)
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause))
      })
    return () => {
      active = false
    }
  }, [client, refreshKey])

  const openIds = Object.keys(expanded).filter((id) => expanded[id])
  const openKey = openIds.join(",")
  useEffect(() => {
    let active = true
    for (const projectId of openKey ? openKey.split(",") : []) {
      client
        .listSessions(projectId)
        .then((list) => {
          if (active)
            setSessions((current) => ({
              ...current,
              [projectId]: list.sessions,
            }))
        })
        .catch(() => undefined)
    }
    return () => {
      active = false
    }
  }, [client, openKey, refreshKey])

  if (error)
    return (
      <p className="px-2 py-2 text-small text-muted-foreground">
        Projects unavailable: {error}
      </p>
    )
  if (!projects) return null
  if (projects.length === 0)
    return (
      <p className="px-2 py-2 text-small text-muted-foreground">
        Projects you open show up here.
      </p>
    )

  return (
    <ul className="flex flex-col gap-0.5" aria-label="Projects">
      {projects.map((project) => {
        const open = expanded[project.id] === true
        const Icon = open ? RiArrowDownSLine : RiArrowRightSLine
        const list = sessions[project.id]
        return (
          <li key={project.id}>
            <button
              type="button"
              aria-expanded={open}
              title={project.directory}
              onClick={() =>
                setExpanded((current) => ({ ...current, [project.id]: !open }))
              }
              className="flex h-8 w-full items-center gap-1 rounded-md px-1 text-left text-ui text-[var(--n6)] hover:bg-[var(--n2)] hover:text-foreground"
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              <span className="text-small text-muted-foreground">
                {project.sessionCount}
              </span>
            </button>
            {open ? (
              <ul
                className="ml-4 flex flex-col gap-0.5"
                aria-label={`${project.name} sessions`}
              >
                {!list ? (
                  <li className="px-2 py-1 text-small text-muted-foreground">
                    Loading…
                  </li>
                ) : list.length === 0 ? (
                  <li className="px-2 py-1 text-small text-muted-foreground">
                    No sessions yet.
                  </li>
                ) : (
                  list.map((session) => (
                    <li key={session.id}>
                      <button
                        type="button"
                        aria-current={
                          session.id === activeSessionId ? "page" : undefined
                        }
                        onClick={() => onSelectSession(session.id)}
                        className={cn(
                          "flex w-full items-center rounded-md px-2 py-1 text-left text-ui",
                          session.id === activeSessionId
                            ? "bg-accent-subtle text-accent-ink"
                            : "text-[var(--n6)] hover:bg-[var(--n2)] hover:text-foreground"
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {session.title}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error"
}
