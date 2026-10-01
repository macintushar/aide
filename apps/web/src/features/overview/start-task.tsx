import {
  RiAddLine,
  RiArrowDownSLine,
  RiCheckLine,
  RiFolder3Line,
  RiGitBranchLine,
} from "@remixicon/react"
import {
  projectSchema,
  sessionSchema,
  type Project,
  type ProjectList,
} from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"
import { useEffect, useState, type FormEvent } from "react"

import { Composer, type ComposerSendInput } from "@/features/composer"
import { useInstances } from "@/features/instances"
import {
  createCommandClient,
  newCommandId,
} from "@/lib/transport/command-client"

type CommandClient = Pick<ReturnType<typeof createCommandClient>, "send">

const LAST_PROJECT_KEY = "aide.last-project"

function readLastProject(): string | undefined {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY) ?? undefined
  } catch {
    return undefined
  }
}

function writeLastProject(projectId: string) {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, projectId)
  } catch {
    // Only a convenience; never fail a send over it.
  }
}

/** The first line of a prompt, trimmed to a readable session title. */
export function titleFromPrompt(content: string): string | undefined {
  const line = content
    .split("\n")
    .map((part) => part.trim())
    .find(Boolean)
  if (!line) return undefined
  return line.length > 64 ? `${line.slice(0, 61).trimEnd()}…` : line
}

/**
 * The fastest path from intent to a running agent: choose a project, choose a
 * harness, type. Sending creates the session (optionally in its own worktree),
 * sends the first message with the chosen execution, and opens it.
 */
export function StartTask({
  commandClient,
  listProjects,
  onStarted,
}: {
  commandClient: CommandClient
  listProjects?: () => Promise<ProjectList>
  onStarted: (sessionId: string) => void
}) {
  const { state: instancesState } = useInstances()
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<string | undefined>(
    readLastProject
  )
  const [pickerOpen, setPickerOpen] = useState(false)
  const [directory, setDirectory] = useState("")
  const [useWorktree, setUseWorktree] = useState(false)
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!listProjects) return
    let active = true
    listProjects()
      .then((list) => {
        if (!active) return
        const sorted = [...list.projects].sort((a, b) =>
          b.lastOpenedAt.localeCompare(a.lastOpenedAt)
        )
        setProjects(sorted)
        setProjectId((current) =>
          current && sorted.some((project) => project.id === current)
            ? current
            : sorted[0]?.id
        )
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [listProjects])

  const project = projects.find((candidate) => candidate.id === projectId)

  function choose(next: Project) {
    setProjectId(next.id)
    writeLastProject(next.id)
    setPickerOpen(false)
  }

  async function openFolder(event: FormEvent<HTMLFormElement>) {
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
      const opened = projectSchema.parse(receipt.result)
      setProjects((current) => [
        opened,
        ...current.filter((candidate) => candidate.id !== opened.id),
      ])
      setDirectory("")
      choose(opened)
    } catch (cause) {
      setError(`Unable to open ${path}: ${errorMessage(cause)}`)
    } finally {
      setPending(false)
    }
  }

  async function start({ content, execution, invocation }: ComposerSendInput) {
    if (!project) {
      setError("Choose a project for the agent to work in first.")
      setPickerOpen(true)
      return
    }
    setError(undefined)
    setPending(true)
    try {
      const title = titleFromPrompt(content)
      const created = await commandClient.send({
        name: "session.create",
        commandId: newCommandId(),
        projectId: project.id,
        ...(title ? { title } : {}),
        ...(useWorktree ? { worktree: {} } : {}),
      })
      const session = sessionSchema.parse(created.result)
      await commandClient.send({
        name: "turn.send",
        commandId: newCommandId(),
        sessionId: session.id,
        content,
        execution,
        ...(invocation ? { invocation } : {}),
      })
      writeLastProject(project.id)
      onStarted(session.id)
    } catch (cause) {
      setError(`Unable to start the task: ${errorMessage(cause)}`)
    } finally {
      setPending(false)
    }
  }

  const projectPicker = (
    <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Project"
            title={project?.directory}
            className={cn(
              "inline-flex h-7 max-w-[14rem] min-w-0 items-center gap-1.5 rounded-lg px-2 text-ui transition-colors duration-[var(--dur-fast)] outline-none hover:bg-[var(--n3)] focus-visible:ring-3 focus-visible:ring-[var(--accent-glow)] aria-expanded:bg-[var(--n3)]",
              project ? "text-[var(--n7)]" : "text-warn"
            )}
          />
        }
      >
        <RiFolder3Line className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">
          {project?.name ?? "Choose project"}
        </span>
        <RiArrowDownSLine
          className="size-3.5 shrink-0 text-[var(--n5)]"
          aria-hidden="true"
        />
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-80 p-1.5">
        {projects.length > 0 ? (
          <ul
            aria-label="Known projects"
            className="flex max-h-60 flex-col gap-0.5 overflow-auto"
          >
            {projects.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  onClick={() => choose(candidate)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-[var(--n3)] focus-visible:bg-[var(--n3)]"
                >
                  <RiFolder3Line
                    className="size-4 shrink-0 text-[var(--n5)]"
                    aria-hidden="true"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-ui text-foreground">
                      {candidate.name}
                    </span>
                    <span className="truncate font-mono text-[0.6875rem] text-[var(--n5)]">
                      {candidate.directory}
                    </span>
                  </span>
                  {candidate.id === projectId ? (
                    <RiCheckLine
                      className="size-4 shrink-0 text-accent-ink"
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <form
          onSubmit={(event) => void openFolder(event)}
          className={cn(
            "flex flex-col gap-1.5 p-1.5",
            projects.length > 0 && "mt-1 border-t border-[var(--line)] pt-2.5"
          )}
        >
          <label
            htmlFor="start-task-directory"
            className="text-small font-medium text-muted-foreground"
          >
            Open a folder
          </label>
          <div className="flex gap-1.5">
            <Input
              id="start-task-directory"
              value={directory}
              placeholder="/path/to/project"
              className="font-mono text-small"
              onChange={(event) => setDirectory(event.target.value)}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={pending || !directory.trim()}
            >
              <RiAddLine data-icon="inline-start" aria-hidden="true" />
              Open
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )

  const worktreeToggle = (
    <button
      type="button"
      aria-pressed={useWorktree}
      title="Run in a new git worktree on its own branch, so edits stay out of your working tree."
      onClick={() => setUseWorktree((current) => !current)}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-ui transition-colors duration-[var(--dur-fast)] outline-none focus-visible:ring-3 focus-visible:ring-[var(--accent-glow)]",
        useWorktree
          ? "bg-accent-subtle text-accent-ink"
          : "text-[var(--n6)] hover:bg-[var(--n3)] hover:text-foreground"
      )}
    >
      <RiGitBranchLine className="size-3.5" aria-hidden="true" />
      Worktree
    </button>
  )

  return (
    <div className="flex flex-col gap-2" aria-busy={pending}>
      <Composer
        sources={{ instances: instancesState.instances }}
        disabled={pending}
        autoFocus
        placeholder="What should an agent work on? / for commands"
        onSend={(input) => void start(input)}
        toolbarStart={
          <>
            {projectPicker}
            {worktreeToggle}
            <span
              aria-hidden="true"
              className="mx-1 h-4 w-px bg-[var(--line-strong)]"
            />
          </>
        }
      />
      {error ? (
        <p role="alert" className="px-2 text-small text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error"
}
