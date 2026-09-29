import { sessionSchema, type Command, type Request } from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { EmptyState } from "@workspace/ui/components/empty-state"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { RiQuestionAnswerLine } from "@remixicon/react"
import { useEffect, useRef, useState } from "react"

import { Composer } from "@/features/composer"
import { useInstances } from "@/features/instances"
import { useRequiredSession } from "@/features/sessions/session-provider"
import { RequestCard } from "@/features/transcript/request-card"
import { NoticeView, Transcript } from "@/features/transcript/transcript"
import {
  TranscriptActionsProvider,
  type TranscriptActions,
} from "@/features/transcript/actions"
import { ArtifactModal, FilePreviewModal } from "./viewers"
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
    searchFiles,
    openSession,
    readFile,
    readArtifact,
    sessionInventory,
  } = useRequiredSession()
  const [previewPath, setPreviewPath] = useState<string>()
  const [artifactId, setArtifactId] = useState<string>()
  const { state: instancesState } = useInstances()
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

  // Steering needs a running turn on an instance that says it can steer.
  const runningTurn = state.turns.find((turn) => turn.status === "running")
  const runningInstance = runningTurn
    ? instancesState.instances.find(
        (entry) =>
          entry.instanceId === runningTurn.execution.selection.instanceId
      )
    : undefined
  const canSteer =
    runningTurn !== undefined &&
    runningInstance?.inventory?.capabilities.steer === true
  const canStopSubagent =
    runningTurn !== undefined &&
    runningInstance?.inventory?.capabilities.subagentStop === true

  const actions: TranscriptActions = {
    ...(readFile ? { openFile: setPreviewPath } : {}),
    ...(readArtifact ? { openArtifact: setArtifactId } : {}),
    ...(canStopSubagent && runningTurn
      ? {
          stopSubagent: (taskId: string) => {
            void send({
              name: "subagent.stop",
              commandId: newCommandId(),
              sessionId,
              turnId: runningTurn.id,
              taskId,
            })
          },
        }
      : {}),
  }

  // Notices that belong to no turn, or to a turn with no reply to hang them
  // on, run along the end of the transcript.
  const assistantIds = new Set(
    state.messages.flatMap((message) =>
      message.role === "assistant" ? [message.id] : []
    )
  )
  const turnsWithReply = new Set(
    state.turns.flatMap((turn) =>
      turn.assistantMessageId && assistantIds.has(turn.assistantMessageId)
        ? [turn.id]
        : []
    )
  )
  const looseNotices = state.notices.filter(
    (notice) => !notice.turnId || !turnsWithReply.has(notice.turnId)
  )
  const restorable = new Set(
    state.checkpoints.map((checkpoint) => checkpoint.turnId)
  )

  async function fork(turnId: string) {
    const receipt = await send({
      name: "session.fork",
      commandId: newCommandId(),
      sessionId,
      throughTurnId: turnId,
    })
    const forked = sessionSchema.safeParse(receipt?.result)
    if (forked.success) openSession?.(forked.data.id)
  }

  function restore(turnId: string) {
    const confirmed = window.confirm(
      "Restore the files in this session's working directory to how they were before that turn? Changes made since then are lost. The conversation is kept as it is."
    )
    if (!confirmed) return
    void send({
      name: "session.restore",
      commandId: newCommandId(),
      sessionId,
      turnId,
    })
  }

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
    <TranscriptActionsProvider value={actions}>
      <div className="flex min-h-0 flex-1 flex-col" aria-busy={pending}>
        {previewPath && readFile ? (
          <FilePreviewModal
            path={previewPath}
            load={readFile}
            onClose={() => setPreviewPath(undefined)}
          />
        ) : null}
        {artifactId && readArtifact ? (
          <ArtifactModal
            artifactId={artifactId}
            load={readArtifact}
            onClose={() => setArtifactId(undefined)}
          />
        ) : null}
        <ScrollArea className="flex-1" viewportRef={viewportRef}>
          <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
            {state.messages.length > 0 ? (
              <Transcript
                messages={state.messages}
                turns={state.turns}
                notices={state.notices}
                restorable={restorable}
                onFork={(turnId) => void fork(turnId)}
                onRestore={restore}
                actionsDisabled={pending}
              />
            ) : (
              <EmptyState
                icon={<RiQuestionAnswerLine />}
                title="No messages yet"
                description="Send the first message to start this session."
              />
            )}

            {looseNotices.length > 0 ? (
              <div className="flex flex-col gap-2">
                {looseNotices.map((notice) => (
                  <NoticeView key={notice.id} notice={notice} />
                ))}
              </div>
            ) : null}

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
          sources={{
            instances: instancesState.instances,
            ...(execution ? { lastSent: execution.selection } : {}),
          }}
          disabled={pending}
          {...(searchFiles ? { searchFiles } : {})}
          {...(sessionInventory ? { sessionInventory } : {})}
          onSend={({ content, execution: selection, invocation }) => {
            void send({
              name: "turn.send",
              commandId: newCommandId(),
              sessionId,
              content,
              execution: selection,
              ...(invocation ? { invocation } : {}),
            })
          }}
          {...(canSteer && runningTurn
            ? {
                onSteer: (content: string) => {
                  void send({
                    name: "turn.steer",
                    commandId: newCommandId(),
                    sessionId,
                    turnId: runningTurn.id,
                    content,
                  })
                },
              }
            : {})}
        />
      </div>
    </TranscriptActionsProvider>
  )
}
