import {
  RiFolder3Line,
  RiGitBranchLine,
  RiStopCircleLine,
} from "@remixicon/react"
import { sessionSchema } from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"

import { useSession } from "@/features/sessions/session-provider"
import { latestTurn } from "@/features/sessions/session-selectors"
import { ThreadMeta, ThreadTitle } from "@/components/shell/thread-header"
import { newCommandId } from "@/lib/transport/command-client"

export function SessionTitle() {
  const session = useSession()
  const title = session?.state.session?.title

  return <ThreadTitle>{title ?? session?.sessionId ?? "Session"}</ThreadTitle>
}

/** Rendered into the header's far end, opposite the session title. */
export function SessionProject() {
  const session = useSession()
  const project = session?.state.project?.name
  if (!project) return null

  return (
    <ThreadMeta
      icon={<RiFolder3Line className="size-3.5 shrink-0" aria-hidden="true" />}
    >
      {project}
    </ThreadMeta>
  )
}

/**
 * The header stays quiet: turn state lives at the message end (typing
 * indicator) and in the Activity surface — never as header chrome.
 */
export function SessionActions() {
  const session = useSession()
  if (!session) return null

  const { state, send, pending, sessionId, applySession } = session
  const turn = latestTurn(state.turns)
  const interruptible =
    turn && (turn.status === "running" || turn.status === "queued")
  const worktree = state.session?.worktree

  async function removeWorktree() {
    const confirmed = window.confirm(
      `Remove this session's worktree (${worktree?.path})? Uncommitted changes in it are lost. The branch ${worktree?.branch} is kept.`
    )
    if (!confirmed) return
    const receipt = await send({
      name: "worktree.remove",
      commandId: newCommandId(),
      sessionId,
    })
    const updated = sessionSchema.safeParse(receipt?.result)
    if (updated.success) applySession(updated.data)
  }

  return (
    <div className="flex items-center gap-2">
      {worktree ? (
        <span
          title={worktree.path}
          data-testid="worktree-badge"
          className="flex max-w-48 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-small text-muted-foreground"
        >
          <RiGitBranchLine className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate font-mono">{worktree.branch}</span>
        </span>
      ) : null}
      {worktree && !interruptible ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => void removeWorktree()}
        >
          Remove worktree
        </Button>
      ) : null}
      {interruptible ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            void send({
              name: "turn.interrupt",
              commandId: newCommandId(),
              sessionId,
              turnId: turn.id,
            })
          }
        >
          <RiStopCircleLine data-icon="inline-start" aria-hidden="true" />
          Interrupt
        </Button>
      ) : null}
    </div>
  )
}
