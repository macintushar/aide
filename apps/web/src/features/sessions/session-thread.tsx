import type { Command, Request } from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { EmptyState } from "@workspace/ui/components/empty-state"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { RiQuestionAnswerLine } from "@remixicon/react"
import { useEffect, useRef } from "react"

import { Composer } from "@/features/composer"
import { useRequiredSession } from "@/features/sessions/session-provider"
import { RequestCard } from "@/features/transcript/request-card"
import { Transcript } from "@/features/transcript/transcript"
import { TypingIndicator } from "@/features/transcript/typing-indicator"
import { newCommandId } from "@/lib/transport/command-client"
import {
  latestExecution,
  latestTurnState,
} from "@/features/sessions/session-selectors"

type Resolution = Parameters<typeof RequestCard>[0]["onResolve"] extends (
  value: infer Value
) => void
  ? Value
  : never

export function SessionThread() {
  const {
    state,
    loadError,
    streamError,
    commandError,
    pending,
    send,
    retry,
    sessionId,
  } = useRequiredSession()
  const viewportRef = useRef<HTMLDivElement>(null)
  const messageCount = state.messages.length
  const typingNow = latestTurnState(state.turns, state.requests) === "streaming"

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    // Instant, never smooth: streamed text must not move under the reader (§7).
    viewport.scrollTop = viewport.scrollHeight
  }, [messageCount, typingNow])

  if (!state.snapshotApplied) {
    return loadError ? (
      <div className="flex flex-1 items-center justify-center p-6">
        <div role="alert" className="max-w-sm text-center">
          <p className="text-ui text-destructive">
            Could not load session: {loadError}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            onClick={retry}
          >
            Try again
          </Button>
        </div>
      </div>
    ) : (
      <p
        role="status"
        className="flex flex-1 items-center justify-center text-ui text-muted-foreground"
      >
        Loading session…
      </p>
    )
  }

  const openRequests = state.requests.filter(
    (request) => request.status === "open"
  )
  const execution = latestExecution(state.messages)

  function resolveRequest(request: Request, resolution: Resolution) {
    void send(
      request.kind === "permission"
        ? {
            name: "permission.respond",
            commandId: newCommandId(),
            requestId: request.id,
            resolution: resolution as Extract<
              Command,
              { name: "permission.respond" }
            >["resolution"],
          }
        : {
            name: "input.respond",
            commandId: newCommandId(),
            requestId: request.id,
            resolution: resolution as Extract<
              Command,
              { name: "input.respond" }
            >["resolution"],
          }
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy={pending}>
      <ScrollArea className="flex-1" viewportRef={viewportRef}>
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
          {state.messages.length > 0 ? (
            <Transcript messages={state.messages} />
          ) : (
            <EmptyState
              icon={<RiQuestionAnswerLine />}
              title="No messages yet"
              description="Send the first message to start this session."
            />
          )}

          {openRequests.length > 0 ? (
            <section
              aria-labelledby="requests-heading"
              className="flex flex-col gap-3"
            >
              <h2
                id="requests-heading"
                className="text-label text-warn uppercase"
              >
                Waiting on you
              </h2>
              {openRequests.map((request) => (
                <RequestCard
                  key={request.id}
                  request={request}
                  onResolve={(resolution) =>
                    resolveRequest(request, resolution)
                  }
                />
              ))}
            </section>
          ) : null}

          {typingNow ? (
            <div className="flex flex-col gap-2">
              <span className="text-label text-muted-foreground uppercase">
                Assistant
              </span>
              <TypingIndicator />
            </div>
          ) : null}
        </div>
      </ScrollArea>

      <div className="mx-auto w-full max-w-3xl px-4">
        {streamError ? (
          <p role="status" className="text-small text-warn">
            Live updates interrupted. Reconnecting…
          </p>
        ) : null}
        {commandError ? (
          <p role="alert" className="text-small text-destructive">
            Command failed: {commandError}
          </p>
        ) : null}
      </div>

      <Composer
        execution={execution}
        pending={pending}
        onSend={(content, selection) => {
          void send({
            name: "turn.send",
            commandId: newCommandId(),
            sessionId,
            content,
            execution: selection,
          })
        }}
      />
    </div>
  )
}
