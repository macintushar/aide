import type {
  AgentPart,
  Message,
  Notice,
  Part,
  ToolPart,
  Turn,
  UserMessage,
} from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"

import { useTranscriptActions } from "./actions"
import { ExecutionDisplay } from "./execution-display"
import { Markdown } from "./markdown"
import { formatUsage } from "./usage"

const toolStatusStyles: Record<ToolPart["status"], string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-primary/10 text-accent-ink",
  completed: "bg-muted text-foreground",
  failed: "bg-destructive/10 text-destructive",
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
 * streams, running once it is dispatched, then completed or failed. The card
 * is deliberately the same element throughout so the transcript does not
 * reflow as a call progresses.
 */
export function ToolPartView({ part }: { part: ToolPart }) {
  const input = toolInputText(part.input)
  const { openArtifact } = useTranscriptActions()

  return (
    <div
      data-tool-status={part.status}
      className="flex flex-col gap-1.5 rounded-2xl border border-border bg-card px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{part.name}</span>
        {part.source?.kind === "mcp" ? (
          <span className="text-xs text-muted-foreground">
            {part.source.server}
          </span>
        ) : null}
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${toolStatusStyles[part.status]}`}
        >
          {part.status}
        </span>
      </div>
      {input !== undefined ? (
        <pre
          data-testid="tool-input"
          className="max-h-40 overflow-auto rounded-xl bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground"
        >
          {input}
        </pre>
      ) : null}
      {part.output !== undefined ? (
        <pre
          data-testid="tool-output"
          className="max-h-60 overflow-auto font-mono text-xs whitespace-pre-wrap text-muted-foreground"
        >
          {part.output}
        </pre>
      ) : null}
      {part.artifactId ? (
        <p
          data-artifact-id={part.artifactId}
          className="text-xs text-muted-foreground"
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
          className="rounded-2xl border border-border/60 bg-muted/30 px-3 py-2"
        >
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Reasoning
          </span>
          <p className="text-sm whitespace-pre-wrap">{part.text}</p>
        </div>
      )
    case "tool":
      return <ToolPartView part={part} />
    case "file":
      return (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
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
  running: "bg-primary/10 text-accent-ink",
  completed: "bg-muted text-foreground",
  failed: "bg-destructive/10 text-destructive",
  stopped: "bg-warn/15 text-warn",
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
      className="flex flex-col gap-1 rounded-2xl border border-border/60 px-3 py-2 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Subagent
        </span>
        <span className="font-medium">{part.name}</span>
        {part.status ? (
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              agentStatusStyles[part.status] ?? "bg-muted text-muted-foreground"
            }`}
          >
            {part.status}
          </span>
        ) : null}
        {part.status === "running" && part.taskId && stopSubagent ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
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
        <p className="text-xs text-muted-foreground">{facts.join(" · ")}</p>
      ) : null}
      {part.summary ? (
        <p className="text-sm whitespace-pre-wrap">{part.summary}</p>
      ) : null}
    </div>
  )
}

const noticeStyles: Record<NonNullable<Notice["level"]>, string> = {
  info: "border-border/60 text-muted-foreground",
  warning: "border-warn/30 text-warn",
  error: "border-destructive/30 text-destructive",
}

export function NoticeView({ notice }: { notice: Notice }) {
  return (
    <div
      role="status"
      data-testid="notice"
      className={`rounded-xl border px-3 py-1.5 text-xs ${noticeStyles[notice.level ?? "info"]}`}
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
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {message.invocation.kind === "command" ? "Command" : "Skill"}{" "}
          <span className="font-mono">/{message.invocation.name}</span>
        </span>
      ) : null}
      {message.steer ? (
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-accent-ink">
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

  return (
    <div className="flex flex-col gap-6">
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

        return (
          <article
            key={message.id}
            data-message-id={message.id}
            className="flex flex-col gap-2"
          >
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {message.role === "user" ? "User" : "Assistant"}
            </span>
            {execution ? <ExecutionDisplay execution={execution} /> : null}
            {message.role === "user" ? (
              <UserMessageBadges message={message} />
            ) : null}
            <div className="flex flex-col gap-2">
              {[...message.parts].sort(byIndexThenId).map((part) => (
                <PartView key={part.id} part={part} />
              ))}
            </div>
            {turn
              ? (noticesByTurn.get(turn.id) ?? []).map((notice) => (
                  <NoticeView key={notice.id} notice={notice} />
                ))
              : null}
            {turn?.status === "failed" && turn.error ? (
              <p
                role="alert"
                data-testid="turn-error"
                className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                The turn failed: {turn.error.message}
              </p>
            ) : null}
            {message.role === "assistant" && (message.usage || settled) ? (
              <div className="flex flex-wrap items-center gap-2">
                {message.usage ? (
                  <span
                    data-testid="message-usage"
                    className="text-xs text-muted-foreground"
                  >
                    {formatUsage(message.usage)}
                  </span>
                ) : null}
                {settled && turn && onFork ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={actionsDisabled}
                    onClick={() => onFork(turn.id)}
                  >
                    Fork from here
                  </Button>
                ) : null}
                {settled && turn && onRestore && restorable?.has(turn.id) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={actionsDisabled}
                    onClick={() => onRestore(turn.id)}
                  >
                    Restore files to before this turn
                  </Button>
                ) : null}
              </div>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}
