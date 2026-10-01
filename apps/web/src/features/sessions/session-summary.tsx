import {
  RiContractLeftRightLine,
  RiDeleteBinLine,
  RiFolder3Line,
  RiGitBranchLine,
  RiMore2Line,
  RiStopFill,
} from "@remixicon/react"
import { sessionSchema } from "@workspace/contracts"
import { Button, IconButton } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { useState, type FormEvent } from "react"

import { Modal } from "@/components/modal"
import { ThreadMeta, ThreadTitle } from "@/components/shell/thread-header"
import { useInstances } from "@/features/instances"
import { useSession } from "@/features/sessions/session-provider"
import {
  latestTurn,
  latestTurnState,
} from "@/features/sessions/session-selectors"
import { elapsed } from "@/features/overview/activity"
import { useNow } from "@/features/overview/overview-provider"
import { TURN_STATE_META } from "@/features/transcript/turn-state"
import { StatusDot } from "@workspace/ui/components/status-dot"
import { cn } from "@workspace/ui/lib/utils"
import { newCommandId } from "@/lib/transport/command-client"

/** The session's title; clicking it renames the session in place. */
export function SessionTitle() {
  const session = useSession()
  const [draft, setDraft] = useState<string>()
  const title = session?.state.session?.title

  if (!session) return <ThreadTitle>Session</ThreadTitle>

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = draft?.trim()
    setDraft(undefined)
    if (!session || !next || next === title) return
    const receipt = await session.send({
      name: "session.rename",
      commandId: newCommandId(),
      sessionId: session.sessionId,
      title: next,
    })
    const renamed = sessionSchema.safeParse(receipt?.result)
    if (renamed.success) session.applySession(renamed.data)
  }

  if (draft !== undefined) {
    return (
      <form onSubmit={(event) => void rename(event)} className="min-w-0 flex-1">
        <input
          aria-label="Session title"
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => event.currentTarget.form?.requestSubmit()}
          onKeyDown={(event) => {
            if (event.key === "Escape") setDraft(undefined)
          }}
          className="h-8 w-full max-w-md rounded-lg border border-[var(--accent-dim)] bg-[var(--n0)] px-2 text-ui font-semibold outline-none focus-visible:ring-3 focus-visible:ring-[var(--accent-glow)]"
        />
      </form>
    )
  }

  return (
    <button
      type="button"
      title="Rename session"
      className="min-w-0 cursor-text rounded-md px-1 py-0.5 text-left hover:bg-[var(--n2)]"
      onClick={() => setDraft(title ?? "")}
    >
      <ThreadTitle>{title ?? session.sessionId}</ThreadTitle>
    </button>
  )
}

/** Project segment preceding the editable session title. */
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

const STATUS_TEXT: Record<string, string> = {
  streaming: "text-accent-ink",
  awaiting: "text-warn",
  failed: "text-danger",
  completed: "text-ok",
}

/** Where the open session stands right now, with a live clock while it runs. */
export function SessionStatus() {
  const session = useSession()
  const state = session
    ? latestTurnState(session.state.turns, session.state.requests)
    : undefined
  const turn = session ? latestTurn(session.state.turns) : undefined
  const live = state === "streaming" || state === "awaiting"
  const now = useNow(live)
  if (!state) return null
  const meta = TURN_STATE_META[state]
  const label =
    state === "streaming"
      ? "Working"
      : state === "awaiting"
        ? "Needs you"
        : meta.label.charAt(0).toUpperCase() + meta.label.slice(1)

  return (
    <span
      data-testid="session-status"
      data-state={state}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--n2)] px-2.5 text-small font-medium",
        STATUS_TEXT[state] ?? "text-[var(--n6)]"
      )}
    >
      <StatusDot tone={meta.dot} pulse={meta.pulse} className="size-1.5" />
      {label}
      {live && turn?.startedAt ? (
        <span className="font-mono text-[0.6875rem] text-[var(--n5)] tabular-nums">
          {elapsed(turn.startedAt, now)}
        </span>
      ) : null}
    </span>
  )
}

function MenuItem({
  children,
  icon,
  onClick,
  disabled,
  danger,
  hint,
}: {
  children: React.ReactNode
  icon?: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  hint?: string
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={hint}
      onClick={onClick}
      className={cn(
        "flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-ui outline-none hover:bg-[var(--n3)] focus-visible:bg-[var(--n3)] disabled:opacity-45 disabled:hover:bg-transparent",
        danger ? "text-danger hover:bg-danger/10" : "text-[var(--n7)]"
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center opacity-80 [&_svg]:size-4">
        {icon}
      </span>
      {children}
    </button>
  )
}

/**
 * The header stays quiet: turn state lives at the message end (typing
 * indicator) and in the Activity surface. Interrupt is the one action shown
 * directly; everything else sits in the session menu.
 */
export function SessionActions() {
  const session = useSession()
  const { state: instancesState } = useInstances()
  const [menuOpen, setMenuOpen] = useState(false)
  const [removingWorktree, setRemovingWorktree] = useState(false)
  const [deleteBranch, setDeleteBranch] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  if (!session) return null

  const { state, send, pending, sessionId, applySession, onDeleted } = session
  const turn = latestTurn(state.turns)
  const busy =
    turn !== undefined &&
    (turn.status === "running" || turn.status === "queued")
  const worktree = state.session?.worktree
  const lastCompleted = [...state.turns]
    .filter((candidate) => candidate.status === "completed")
    .at(-1)
  const compactInstance = lastCompleted
    ? instancesState.instances.find(
        (entry) =>
          entry.instanceId === lastCompleted.execution.selection.instanceId
      )
    : undefined
  const canCompact =
    !busy && compactInstance?.inventory?.capabilities.compact === true

  async function removeWorktree() {
    setRemovingWorktree(false)
    const receipt = await send({
      name: "worktree.remove",
      commandId: newCommandId(),
      sessionId,
      ...(deleteBranch ? { deleteBranch: true } : {}),
    })
    const updated = sessionSchema.safeParse(receipt?.result)
    if (updated.success) applySession(updated.data)
  }

  async function deleteSession() {
    setConfirmingDelete(false)
    const receipt = await send({
      name: "session.delete",
      commandId: newCommandId(),
      sessionId,
    })
    if (receipt?.state === "completed") onDeleted?.()
  }

  return (
    <div className="flex items-center gap-2">
      {worktree ? (
        <span
          title={worktree.path}
          data-testid="worktree-badge"
          className="flex h-6 max-w-48 items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--n2)] px-2 text-small text-[var(--n6)] max-sm:hidden"
        >
          <RiGitBranchLine className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate font-mono text-[0.6875rem]">
            {worktree.branch}
          </span>
        </span>
      ) : null}
      {busy ? (
        <Button
          type="button"
          variant="destructive"
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
          <RiStopFill data-icon="inline-start" aria-hidden="true" />
          <span className="max-sm:sr-only">Interrupt</span>
        </Button>
      ) : null}

      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger
          render={
            <IconButton
              type="button"
              variant="ghost"
              size="icon-sm"
              label="Session actions"
            >
              <RiMore2Line aria-hidden="true" />
            </IconButton>
          }
        />
        <PopoverContent side="bottom" align="end" className="w-60 p-1">
          <div role="menu" aria-label="Session actions">
            <MenuItem
              icon={<RiContractLeftRightLine aria-hidden="true" />}
              disabled={!canCompact || pending}
              hint={
                canCompact
                  ? "Summarise the harness's context to free up room"
                  : busy
                    ? "Compact between turns"
                    : "Needs a completed turn on an instance that can compact"
              }
              onClick={() => {
                setMenuOpen(false)
                void send({
                  name: "session.compact",
                  commandId: newCommandId(),
                  sessionId,
                })
              }}
            >
              Compact context
            </MenuItem>
            {worktree ? (
              <MenuItem
                icon={<RiGitBranchLine aria-hidden="true" />}
                disabled={busy || pending}
                onClick={() => {
                  setMenuOpen(false)
                  setDeleteBranch(false)
                  setRemovingWorktree(true)
                }}
              >
                Remove worktree…
              </MenuItem>
            ) : null}
            <MenuItem
              icon={<RiDeleteBinLine aria-hidden="true" />}
              danger
              disabled={busy || pending}
              onClick={() => {
                setMenuOpen(false)
                setConfirmingDelete(true)
              }}
            >
              Delete session…
            </MenuItem>
          </div>
        </PopoverContent>
      </Popover>

      {removingWorktree && worktree ? (
        <Modal
          title="Remove worktree"
          onClose={() => setRemovingWorktree(false)}
        >
          <p className="text-ui">
            Deletes <span className="font-mono break-all">{worktree.path}</span>
            . Uncommitted changes in it are lost. The session keeps its
            conversation and runs in the project directory afterwards.
          </p>
          <label className="mt-3 flex items-center gap-2 text-ui">
            <input
              type="checkbox"
              checked={deleteBranch}
              onChange={(event) => setDeleteBranch(event.target.checked)}
            />
            Also delete the branch{" "}
            <span className="font-mono">{worktree.branch}</span>
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRemovingWorktree(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void removeWorktree()}>
              Remove worktree
            </Button>
          </div>
        </Modal>
      ) : null}

      {confirmingDelete ? (
        <Modal
          title="Delete session"
          onClose={() => setConfirmingDelete(false)}
        >
          <p className="text-ui">
            Deletes “{state.session?.title ?? sessionId}” and its whole
            conversation from Aide. Files in the project are not touched.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void deleteSession()}
            >
              Delete session
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
