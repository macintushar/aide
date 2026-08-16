import type { Message, Part, ToolPart, UserMessage } from "@workspace/contracts"

import { ExecutionDisplay } from "./execution-display"

const toolStatusStyles: Record<ToolPart["status"], string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-primary/10 text-primary",
  completed: "bg-muted text-foreground",
  failed: "bg-destructive/10 text-destructive",
}

export function ToolPartView({ part }: { part: ToolPart }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card px-3 py-2">
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
      {part.output !== undefined ? (
        <pre className="overflow-x-auto font-mono text-xs whitespace-pre-wrap text-muted-foreground">
          {part.output}
        </pre>
      ) : null}
    </div>
  )
}

function PartView({ part }: { part: Part }) {
  switch (part.type) {
    case "text":
      return <p className="text-sm">{part.text}</p>
    case "reasoning":
      return (
        <div className="rounded-2xl border border-border/60 bg-muted/30 px-3 py-2 text-muted-foreground opacity-80">
          <span className="text-xs font-medium tracking-wide uppercase">
            Reasoning
          </span>
          <p className="text-sm">{part.text}</p>
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
