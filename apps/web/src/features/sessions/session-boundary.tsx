import type {
  Command,
  ConfigDefaults,
  ExecutionSelection,
  InstanceSnapshotEntry,
  Request,
} from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import {
  useEffect,
  useEffectEvent,
  useState,
  useSyncExternalStore,
} from "react"

import { Composer } from "@/features/composer"
import { RequestCard } from "@/features/transcript/request-card"
import { Transcript } from "@/features/transcript/transcript"
import {
  createCommandClient,
  newCommandId,
} from "@/lib/transport/command-client"
import {
  subscribeSessionEvents,
  type SessionEventsOptions,
} from "@/lib/transport/event-source"
import { createReadClient } from "@/lib/transport/read-client"
import { createSessionStore } from "@/store/event-store"

type ReadClient = Pick<
  ReturnType<typeof createReadClient>,
  "getSession" | "getConfig" | "getProjectConfig"
>
type CommandClient = Pick<ReturnType<typeof createCommandClient>, "send">
type Subscribe = (options: SessionEventsOptions) => { close(): void }

export type SessionBoundaryProps = {
  sessionId: string
  readClient?: ReadClient
  commandClient?: CommandClient
  subscribe?: Subscribe
  reconnectDelayMs?: number
  /** Harness inventory for the composer, owned by whoever also renders the panel. */
  instances?: InstanceSnapshotEntry[]
}

const defaultReadClient = createReadClient()
const defaultCommandClient = createCommandClient()

export function SessionBoundary(props: SessionBoundaryProps) {
  return <SessionController key={props.sessionId} {...props} />
}

function SessionController({
  sessionId,
  readClient = defaultReadClient,
  commandClient = defaultCommandClient,
  subscribe = subscribeSessionEvents,
  reconnectDelayMs = 1_000,
  instances = [],
}: SessionBoundaryProps) {
  const [store] = useState(createSessionStore)
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [loadError, setLoadError] = useState<string>()
  const [streamError, setStreamError] = useState(false)
  const [commandError, setCommandError] = useState<string>()
  const [pending, setPending] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [defaults, setDefaults] = useState<{
    project?: ConfigDefaults
    user?: ConfigDefaults
  }>({})

  const applyEvent = useEffectEvent(store.applyEvent)
  const applySnapshot = useEffectEvent(store.applySnapshot)

  useEffect(() => {
    let active = true
    let subscription: { close(): void } | undefined
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      if (!active) return
      subscription = subscribe({
        sessionId,
        afterSequence: store.getState().cursor.sequence,
        onEvent: applyEvent,
        onSnapshot: applySnapshot,
        onOpen: () => setStreamError(false),
        onError: () => {
          if (!active || reconnectTimer) return
          setStreamError(true)
          subscription?.close()
          reconnectTimer = setTimeout(() => {
            reconnectTimer = undefined
            connect()
          }, reconnectDelayMs)
        },
      })
    }

    setLoadError(undefined)
    void readClient
      .getSession(sessionId)
      .then((snapshot) => {
        if (!active) return
        applySnapshot(snapshot)
        connect()
      })
      .catch((error: unknown) => {
        if (active) setLoadError(errorMessage(error))
      })

    return () => {
      active = false
      if (reconnectTimer) clearTimeout(reconnectTimer)
      subscription?.close()
    }
  }, [attempt, readClient, reconnectDelayMs, sessionId, store, subscribe])

  const projectId = state.project?.id

  /**
   * Configured defaults feed the composer's precedence chain. They are not
   * required to render a session, so a failure here leaves the chain to fall
   * through to what the harness reports rather than blocking the view.
   */
  useEffect(() => {
    if (!projectId) return
    let active = true

    void Promise.allSettled([
      readClient.getConfig(),
      readClient.getProjectConfig(projectId),
    ]).then(([user, project]) => {
      if (!active) return
      setDefaults({
        ...(user.status === "fulfilled" ? { user: user.value.defaults } : {}),
        ...(project.status === "fulfilled" && project.value.defaults
          ? { project: project.value.defaults }
          : {}),
      })
    })

    return () => {
      active = false
    }
  }, [projectId, readClient])

  async function send(command: Command) {
    setCommandError(undefined)
    setPending(true)
    try {
      await commandClient.send(command)
    } catch (error) {
      setCommandError(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  function resolveRequest(
    request: Request,
    resolution: Parameters<typeof RequestCard>[0]["onResolve"] extends (
      value: infer Value
    ) => void
      ? Value
      : never
  ) {
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

  const composerSources = {
    instances,
    ...(latestExecution(state.messages)
      ? { lastSent: latestExecution(state.messages)! }
      : {}),
    ...(defaults.project ? { projectDefaults: defaults.project } : {}),
    ...(defaults.user ? { userDefaults: defaults.user } : {}),
  }

  if (!state.snapshotApplied && !loadError) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading session…
      </p>
    )
  }

  if (!state.snapshotApplied && loadError) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-destructive/30 p-4"
      >
        <p className="text-sm text-destructive">
          Could not load session: {loadError}
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          onClick={() => setAttempt((current) => current + 1)}
        >
          Try again
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6" aria-busy={pending}>
      <div className="border-b border-border pb-4">
        <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
          {state.project?.name} / Session
        </p>
        <h3 className="mt-1 font-heading text-2xl font-medium">
          {state.session?.title}
        </h3>
      </div>

      {streamError ? (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          Live updates interrupted. Reconnecting…
        </p>
      ) : null}
      {commandError ? (
        <p role="alert" className="text-sm text-destructive">
          Command failed: {commandError}
        </p>
      ) : null}

      {state.messages.length > 0 ? (
        <Transcript messages={state.messages} />
      ) : (
        <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          This session has no messages yet.
        </p>
      )}

      {state.requests.length > 0 ? (
        <section
          aria-labelledby="requests-heading"
          className="flex flex-col gap-3"
        >
          <h4
            id="requests-heading"
            className="font-heading text-lg font-medium"
          >
            Requests
          </h4>
          {state.requests.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              onResolve={(resolution) => resolveRequest(request, resolution)}
            />
          ))}
        </section>
      ) : null}

      <Composer
        sources={composerSources}
        disabled={pending}
        onSend={({ content, execution }) =>
          void send({
            name: "turn.send",
            commandId: newCommandId(),
            sessionId,
            content,
            execution,
          })
        }
      />
    </div>
  )
}

function latestExecution(
  messages: ReturnType<
    ReturnType<typeof createSessionStore>["getState"]
  >["messages"]
): ExecutionSelection | undefined {
  return [...messages]
    .sort((left, right) => right.seq - left.seq)
    .find((message) => message.role === "user")?.execution.selection
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error"
}
