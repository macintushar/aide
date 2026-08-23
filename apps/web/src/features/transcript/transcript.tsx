import type { Message, Part, ToolPart, UserMessage } from "@workspace/contracts"

import { ExecutionDisplay } from "./execution-display"

const toolStatusStyles: Record<ToolPart["status"], string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-primary/10 text-primary",
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
        </p>
      ) : null}
    </div>
  )
}

function PartView({ part }: { part: Part }) {
  switch (part.type) {
    case "text":
      return <p className="text-sm whitespace-pre-wrap">{part.text}</p>
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
      return (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-sm">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Agent
          </span>
          <span className="font-medium">{part.name}</span>
          {part.status ? (
            <span className="text-xs text-muted-foreground">{part.status}</span>
          ) : null}
        </div>
      )
  }
}

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

export function Transcript({ messages }: { messages: Message[] }) {
  const ordered = [...messages].sort(bySeqThenId)
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
            <div className="flex flex-col gap-2">
              {[...message.parts].sort(byIndexThenId).map((part) => (
                <PartView key={part.id} part={part} />
              ))}
            </div>
          </article>
        )
      })}
    </div>
  )
}
