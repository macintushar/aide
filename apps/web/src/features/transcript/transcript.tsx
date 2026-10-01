import {
  RiArrowRightSLine,
  RiBrainLine,
  RiCheckLine,
  RiCloseLine,
  RiFileEditLine,
  RiFileTextLine,
  RiGitForkLine,
  RiGlobalLine,
  RiHistoryLine,
  RiLoader4Line,
  RiPlugLine,
  RiRobot2Line,
  RiSearchLine,
  RiTerminalLine,
  RiToolsLine,
  type RemixiconComponentType,
} from "@remixicon/react"
import type {
  AgentPart,
  Message,
  Notice,
  Part,
  ResolvedExecution,
  ToolPart,
  Turn,
  UserMessage,
} from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { HarnessMark } from "@workspace/ui/components/harness-mark"
import { cn } from "@workspace/ui/lib/utils"
import { Fragment } from "react"

import { harnessMarkFor } from "@/features/instances/harness-marks"

import { useTranscriptActions } from "./actions"
import { ExecutionDisplay } from "./execution-display"
import { Markdown } from "./markdown"
import { formatUsage } from "./usage"

const toolStatusStyles: Record<ToolPart["status"], string> = {
  pending: "text-[var(--n5)]",
  running: "text-accent-ink",
  completed: "text-[var(--n5)]",
  failed: "text-danger",
}

const TOOL_ICONS: Record<ToolPart["category"], RemixiconComponentType> = {
  shell: RiTerminalLine,
  file_read: RiFileTextLine,
  file_write: RiFileEditLine,
  search: RiSearchLine,
  web: RiGlobalLine,
  agent: RiRobot2Line,
  mcp: RiPlugLine,
  other: RiToolsLine,
}

/** The one input field that says what a call did: a command, a path, a query. */
function toolSubject(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined
  const record = input as Record<string, unknown>
  for (const key of [
    "command",
    "file_path",
    "path",
    "filePath",
    "pattern",
    "query",
    "url",
    "description",
  ]) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return undefined
}

function ToolStatusIcon({ status }: { status: ToolPart["status"] }) {
  if (status === "running" || status === "pending")
    return (
      <RiLoader4Line
        className="size-3.5 animate-spin text-accent-ink motion-reduce:animate-none"
        aria-hidden="true"
      />
    )
  if (status === "failed")
    return <RiCloseLine className="size-3.5 text-danger" aria-hidden="true" />
  return <RiCheckLine className="size-3.5 text-ok" aria-hidden="true" />
}

/**
 * Tool input is an object once the call is complete, and the raw partial JSON
 * the adapter streamed while it was still arriving. Both are shown as text so a
 * running call is legible before it settles.
 */
function toolInputText(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined
  if (typeof input === "string") return input
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

/**
 * One tool call is one part that changes `status` — pending while its input
 * streams, running once it is dispatched, then completed or failed. The same
 * disclosure stays mounted throughout; failures open their details.
 */
export function ToolPartView({ part }: { part: ToolPart }) {
  const input = toolInputText(part.input)
  const subject = toolSubject(part.input)
  const { openArtifact } = useTranscriptActions()
  const Icon = TOOL_ICONS[part.category] ?? RiToolsLine

  return (
    <details
      open={part.status === "failed" || undefined}
      data-tool-status={part.status}
      className={cn(
        "group/tool flex flex-col rounded-lg border bg-[var(--n2)] transition-colors duration-[var(--dur-fast)] open:bg-[var(--n2)]",
        part.status === "failed"
          ? "border-danger/30"
          : part.status === "running"
            ? "border-[var(--accent-dim)]/50"
            : "border-[var(--line)] hover:border-[var(--line-strong)]"
      )}
    >
      <summary className="flex h-9 cursor-pointer list-none items-center gap-2.5 rounded-lg px-3 text-ui outline-none focus-visible:ring-3 focus-visible:ring-[var(--accent-glow)] [&::-webkit-details-marker]:hidden">
        <Icon
          className="size-3.5 shrink-0 text-[var(--n5)]"
          aria-hidden="true"
        />
        <span className="shrink-0 font-medium text-foreground">
          {part.name}
        </span>
        {part.source?.kind === "mcp" ? (
          <span className="shrink-0 rounded-full bg-[var(--n3)] px-1.5 text-[0.6875rem] text-muted-foreground">
            {part.source.server}
          </span>
        ) : null}
        {subject ? (
          <span className="min-w-0 truncate font-mono text-[0.75rem] text-[var(--n6)]">
            {subject}
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              "text-[0.6875rem] font-medium",
              toolStatusStyles[part.status]
            )}
          >
            {part.status}
          </span>
          <ToolStatusIcon status={part.status} />
          <RiArrowRightSLine
            className="size-4 shrink-0 text-[var(--n5)] transition-transform duration-[var(--dur-fast)] group-open/tool:rotate-90"
            aria-hidden="true"
          />
        </span>
      </summary>
      <div className="flex flex-col gap-2 border-t border-[var(--line)] p-3">
        {input !== undefined ? (
          <pre
            data-testid="tool-input"
            className="max-h-40 overflow-auto rounded-md bg-[var(--n0)] p-2.5 font-mono text-mono whitespace-pre-wrap text-[var(--n6)]"
          >
            {input}
          </pre>
        ) : null}
        {part.output !== undefined ? (
          <pre
            data-testid="tool-output"
            className="max-h-72 overflow-auto px-0.5 font-mono text-mono whitespace-pre-wrap text-[var(--n7)]"
          >
            {part.output}
          </pre>
        ) : null}
        {part.artifactId ? (
          <p
            data-artifact-id={part.artifactId}
            className="text-small text-muted-foreground"
          >
            Output was truncated; the full text is stored as artifact{" "}
            <span className="font-mono">{part.artifactId}</span>.
            {openArtifact ? (
              <>
                {" "}
                <button
                  type="button"
                  className="text-accent-ink underline underline-offset-2"
                  onClick={() => openArtifact(part.artifactId!)}
                >
                  View full output
                </button>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    </details>
  )
}

function PartView({ part }: { part: Part }) {
  const { openFile } = useTranscriptActions()
  switch (part.type) {
    case "text":
      return (
        <Markdown
          text={part.text}
          {...(openFile ? { onOpenFile: openFile } : {})}
        />
      )
    case "reasoning":
      // Reasoning is suppressed from *transfer* between harnesses, never from
      // display: every native client shows it, and hiding it here would be a
      // regression against all of them.
      return (
        <div
          data-testid="reasoning-part"
          className="flex flex-col gap-1 border-l-2 border-[var(--line-strong)] py-0.5 pl-3"
        >
          <span className="flex items-center gap-1.5 text-small font-medium text-[var(--n5)]">
            <RiBrainLine className="size-3.5 shrink-0" aria-hidden="true" />
            Reasoning
          </span>
          <p className="text-ui leading-relaxed whitespace-pre-wrap text-[var(--n6)]">
            {part.text}
          </p>
        </div>
      )
    case "tool":
      return <ToolPartView part={part} />
    case "file":
      return (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--n2)] px-3 py-2 font-mono text-mono text-muted-foreground">
          <RiFileTextLine className="size-4 shrink-0" aria-hidden="true" />
          <span className="font-sans font-medium text-foreground">File</span>
          <span>{part.path}</span>
          {part.mime ? <span>{part.mime}</span> : null}
        </div>
      )
    case "agent":
      return <AgentPartView part={part} />
  }
}

const agentStatusStyles: Record<string, string> = {
  running: "bg-accent-subtle text-accent-ink",
  completed: "bg-ok/12 text-ok",
  done: "bg-ok/12 text-ok",
  failed: "bg-danger/12 text-danger",
  stopped: "bg-warn/12 text-warn",
}

/** A subagent the turn delegated to, updated in place as it runs. */
export function AgentPartView({ part }: { part: AgentPart }) {
  const progress = part.progress
  const { stopSubagent } = useTranscriptActions()
  const facts = [
    progress?.toolUses !== undefined
      ? `${progress.toolUses} tool call${progress.toolUses === 1 ? "" : "s"}`
      : undefined,
    progress?.totalTokens !== undefined
      ? `${progress.totalTokens.toLocaleString()} tokens`
      : undefined,
    progress?.durationMs !== undefined
      ? `${(progress.durationMs / 1000).toFixed(1)}s`
      : undefined,
    part.status === "running" && progress?.lastToolName
      ? `now: ${progress.lastToolName}`
      : undefined,
  ].filter(Boolean)

  return (
    <div
      data-testid="agent-part"
      data-agent-status={part.status}
      className="flex flex-col gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--n2)] px-3 py-2.5 text-ui"
    >
      <div className="flex flex-wrap items-center gap-2">
        <RiRobot2Line
          className="size-3.5 shrink-0 text-[var(--n5)]"
          aria-hidden="true"
        />
        <span className="text-small text-[var(--n5)]">Subagent</span>
        <span className="font-medium">{part.name}</span>
        {part.status ? (
          <span
            className={cn(
              "rounded-full px-2 py-px text-[0.6875rem] font-medium",
              agentStatusStyles[part.status] ??
                "bg-[var(--n3)] text-muted-foreground"
            )}
          >
            {part.status}
          </span>
        ) : null}
        {part.status === "running" && part.taskId && stopSubagent ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="ml-auto"
            onClick={() => stopSubagent(part.taskId!)}
          >
            Stop subagent
          </Button>
        ) : null}
      </div>
      {part.description ? (
        <p className="text-muted-foreground">{part.description}</p>
      ) : null}
      {facts.length > 0 ? (
        <p className="font-mono text-[0.6875rem] text-[var(--n5)]">
          {facts.join(" · ")}
        </p>
      ) : null}
      {part.summary ? (
        <p className="whitespace-pre-wrap text-[var(--n7)]">{part.summary}</p>
      ) : null}
    </div>
  )
}

const noticeStyles: Record<NonNullable<Notice["level"]>, string> = {
  info: "border-[var(--line)] bg-[var(--n2)] text-muted-foreground",
  warning: "border-warn/25 bg-warn/8 text-warn",
  error: "border-danger/25 bg-danger/8 text-danger",
}

export function NoticeView({ notice }: { notice: Notice }) {
  return (
    <div
      role="status"
      data-testid="notice"
      className={cn(
        "rounded-lg border px-3 py-2 text-small",
        noticeStyles[notice.level ?? "info"]
      )}
    >
      <span className="font-medium">{notice.title}</span>
      <span> — {notice.message}</span>
    </div>
  )
}

function UserMessageBadges({ message }: { message: UserMessage }) {
  if (!message.invocation && !message.steer) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {message.invocation ? (
        <span className="rounded-full border border-[var(--line)] bg-[var(--n2)] px-2 py-0.5 text-small text-muted-foreground">
          {message.invocation.kind === "command" ? "Command" : "Skill"}{" "}
          <span className="font-mono text-accent-ink">
            /{message.invocation.name}
          </span>
        </span>
      ) : null}
      {message.steer ? (
        <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-small text-accent-ink">
          Steered the running turn
        </span>
      ) : null}
    </div>
  )
}

export type TranscriptProps = {
  messages: Message[]
  turns?: Turn[]
  notices?: Notice[]
  /** Turns whose pre-turn files can be restored. */
  restorable?: ReadonlySet<string>
  onFork?: (turnId: string) => void
  onRestore?: (turnId: string) => void
  actionsDisabled?: boolean
}

const SETTLED = new Set(["completed", "interrupted", "failed"])

function bySeqThenId(
  a: { seq: number; id: string },
  b: { seq: number; id: string }
) {
  return a.seq - b.seq || a.id.localeCompare(b.id)
}

function byIndexThenId(
  a: { index: number; id: string },
  b: { index: number; id: string }
) {
  return a.index - b.index || a.id.localeCompare(b.id)
}

export function Transcript({
  messages,
  turns = [],
  notices = [],
  restorable,
  onFork,
  onRestore,
  actionsDisabled = false,
}: TranscriptProps) {
  const ordered = [...messages].sort(bySeqThenId)
  const turnByAssistant = new Map(
    turns.flatMap((turn) =>
      turn.assistantMessageId ? [[turn.assistantMessageId, turn]] : []
    )
  )
  const noticesByTurn = new Map<string, Notice[]>()
  for (const notice of notices) {
    if (!notice.turnId) continue
    noticesByTurn.set(notice.turnId, [
      ...(noticesByTurn.get(notice.turnId) ?? []),
      notice,
    ])
  }
  const executionsByMessageId = new Map<string, UserMessage["execution"]>()
  for (const message of ordered) {
    if (message.role === "user") {
      executionsByMessageId.set(message.id, message.execution)
    }
  }

  let previousExecution: ResolvedExecution | undefined

  return (
    <div className="flex flex-col gap-8">
      {ordered.map((message) => {
        const execution =
          message.role === "user"
            ? message.execution
            : executionsByMessageId.get(message.parentMessageId)
        const turn =
          message.role === "assistant"
            ? turnByAssistant.get(message.id)
            : undefined
        const settled = turn !== undefined && SETTLED.has(turn.status)
        const handoff =
          message.role === "user" &&
          previousExecution !== undefined &&
          !sameExecution(previousExecution, message.execution)
            ? { from: previousExecution, to: message.execution }
            : undefined
        if (message.role === "user") previousExecution = message.execution
        const parts = [...message.parts].sort(byIndexThenId)

        return (
          <Fragment key={message.id}>
            {handoff ? <HandoffDivider {...handoff} /> : null}
            <article
              data-message-id={message.id}
              data-role={message.role}
              className={cn(
                "group/message flex min-w-0 flex-col gap-2",
                message.role === "user" && "items-end"
              )}
            >
              {message.role === "user" ? (
                <>
                  {execution ? (
                    <div className="flex max-w-full items-center gap-1.5 opacity-80">
                      <ExecutionDisplay execution={execution} />
                    </div>
                  ) : null}
                  <UserMessageBadges message={message} />
                  <div className="flex max-w-[85%] min-w-0 flex-col gap-2 rounded-2xl rounded-br-md border border-[var(--line)] bg-[var(--n3)] px-4 py-2.5 text-foreground">
                    {parts.map((part) => (
                      <PartView key={part.id} part={part} />
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--n2)]">
                      {execution ? (
                        <HarnessMark
                          src={harnessMarkFor(execution.selection.driver)}
                          name={execution.display.instanceName}
                          size={15}
                          decorative
                        />
                      ) : null}
                    </span>
                    {execution ? (
                      <ExecutionDisplay execution={execution} />
                    ) : (
                      <span className="text-small text-muted-foreground">
                        Assistant
                      </span>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-col gap-3 sm:pl-9.5">
                    {parts.map((part) => (
                      <PartView key={part.id} part={part} />
                    ))}
                    {turn
                      ? (noticesByTurn.get(turn.id) ?? []).map((notice) => (
                          <NoticeView key={notice.id} notice={notice} />
                        ))
                      : null}
                    {turn?.status === "failed" && turn.error ? (
                      <p
                        role="alert"
                        data-testid="turn-error"
                        className="rounded-lg border border-danger/30 bg-danger/8 px-3 py-2 text-ui text-danger"
                      >
                        The turn failed: {turn.error.message}
                      </p>
                    ) : null}
                    {message.usage || settled ? (
                      <div className="-ml-2 flex flex-wrap items-center gap-1 text-[var(--n5)]">
                        {message.usage ? (
                          <span
                            data-testid="message-usage"
                            className="px-2 font-mono text-[0.6875rem] tabular-nums"
                          >
                            {formatUsage(message.usage)}
                          </span>
                        ) : null}
                        {settled && turn && onFork ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            className="opacity-70 group-hover/message:opacity-100 focus-visible:opacity-100"
                            disabled={actionsDisabled}
                            onClick={() => onFork(turn.id)}
                          >
                            <RiGitForkLine
                              data-icon="inline-start"
                              aria-hidden="true"
                            />
                            Fork from here
                          </Button>
                        ) : null}
                        {settled &&
                        turn &&
                        onRestore &&
                        restorable?.has(turn.id) ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            className="opacity-70 group-hover/message:opacity-100 focus-visible:opacity-100"
                            disabled={actionsDisabled}
                            onClick={() => onRestore(turn.id)}
                          >
                            <RiHistoryLine
                              data-icon="inline-start"
                              aria-hidden="true"
                            />
                            Restore files to before this turn
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </article>
          </Fragment>
        )
      })}
    </div>
  )
}

function sameExecution(a: ResolvedExecution, b: ResolvedExecution): boolean {
  return (
    a.selection.instanceId === b.selection.instanceId &&
    a.selection.model.modelId === b.selection.model.modelId
  )
}

/**
 * aide's signature moment: the conversation carries on under a different
 * harness or model. The seam is shown, not hidden.
 */
function HandoffDivider({
  from,
  to,
}: {
  from: ResolvedExecution
  to: ResolvedExecution
}) {
  const sameHarness = from.selection.instanceId === to.selection.instanceId
  return (
    <div
      role="separator"
      aria-label={`Continued with ${to.display.instanceName} · ${to.display.modelName}`}
      data-testid="handoff"
      className="flex items-center gap-3 text-small text-[var(--n5)]"
    >
      <span className="h-px flex-1 bg-[linear-gradient(90deg,transparent,var(--line-strong))]" />
      <span className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--n2)] py-1 pr-3 pl-1.5">
        <span className="flex items-center -space-x-1">
          <span className="flex size-5 items-center justify-center rounded-full bg-[var(--n3)] ring-2 ring-[var(--n2)]">
            <HarnessMark
              src={harnessMarkFor(from.selection.driver)}
              name={from.display.instanceName}
              size={11}
              decorative
            />
          </span>
          <span className="flex size-5 items-center justify-center rounded-full bg-[var(--n3)] ring-2 ring-[var(--n2)]">
            <HarnessMark
              src={harnessMarkFor(to.selection.driver)}
              name={to.display.instanceName}
              size={11}
              decorative
            />
          </span>
        </span>
        <span>
          {sameHarness ? "Switched model to " : "Handed off to "}
          <span className="font-medium text-[var(--n7)]">
            {sameHarness ? to.display.modelName : to.display.instanceName}
          </span>
        </span>
      </span>
      <span className="h-px flex-1 bg-[linear-gradient(90deg,var(--line-strong),transparent)]" />
    </div>
  )
}
