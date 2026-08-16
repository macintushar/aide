import type { Command } from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import {
  useEffect,
  useEffectEvent,
  useState,
  useSyncExternalStore,
} from "react"

import {
  createCommandClient,
  newCommandId,
} from "@/lib/transport/command-client"
import {
  subscribeInstancesEvents,
  type InstancesEventsOptions,
} from "@/lib/transport/event-source"
import { createReadClient } from "@/lib/transport/read-client"

import { InstancesPanel, type InstanceActions } from "./instances-panel"
import { createInstancesStore } from "./instances-store"

type ReadClient = Pick<ReturnType<typeof createReadClient>, "getInstances">
type CommandClient = Pick<ReturnType<typeof createCommandClient>, "send">
type Subscribe = (options: InstancesEventsOptions) => { close(): void }

export type InstancesBoundaryProps = {
  readClient?: ReadClient
  commandClient?: CommandClient
  subscribe?: Subscribe
}

const defaultReadClient = createReadClient()
const defaultCommandClient = createCommandClient()

export function InstancesBoundary({
  readClient = defaultReadClient,
  commandClient = defaultCommandClient,
  subscribe = subscribeInstancesEvents,
}: InstancesBoundaryProps) {
  const [store] = useState(createInstancesStore)
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [loadError, setLoadError] = useState<string>()
  const [streamError, setStreamError] = useState(false)
  const [actionError, setActionError] = useState<string>()
  const [pendingAction, setPendingAction] = useState<string>()
  const [attempt, setAttempt] = useState(0)

  const applyEvent = useEffectEvent(store.applyEvent)
  const applySnapshot = useEffectEvent(store.applySnapshot)

  useEffect(() => {
    let active = true
    let subscription: { close(): void } | undefined

    setLoadError(undefined)
    void readClient
      .getInstances()
      .then((snapshot) => {
        if (!active) return
        applySnapshot(snapshot)
        subscription = subscribe({
          afterSequence: snapshot.cursor.sequence,
          onEvent: applyEvent,
          onSnapshot: applySnapshot,
          onOpen: () => setStreamError(false),
          onError: () => setStreamError(true),
        })
      })
      .catch((error: unknown) => {
        if (active) setLoadError(errorMessage(error))
      })

    return () => {
      active = false
      subscription?.close()
    }
  }, [attempt, readClient, state.configRevision, store, subscribe])

  async function send(command: Command) {
    setActionError(undefined)
    setPendingAction(
      `${command.name}:${"instanceId" in command ? command.instanceId : ""}`
    )
    try {
      await commandClient.send(command)
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setPendingAction(undefined)
    }
  }

  const actions: InstanceActions = {
    onStart: (instanceId) =>
      void send({
        name: "instance.start",
        commandId: newCommandId(),
        instanceId,
      }),
    onStop: (instanceId) =>
      void send({
        name: "instance.stop",
        commandId: newCommandId(),
        instanceId,
      }),
    onRestart: (instanceId) =>
      void send({
        name: "instance.restart",
        commandId: newCommandId(),
        instanceId,
      }),
    onRefreshInventory: (instanceId) =>
      void send({
        name: "inventory.refresh",
        commandId: newCommandId(),
        instanceId,
      }),
  }

  if (!state.snapshotApplied && !loadError) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading harness instances…
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
          Could not load instances: {loadError}
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
    <div
      className="flex flex-col gap-3"
      aria-busy={pendingAction !== undefined}
    >
      {streamError ? (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          Live updates interrupted. Reconnecting…
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="text-sm text-destructive">
          Command failed: {actionError}
        </p>
      ) : null}
      <InstancesPanel instances={state.instances} actions={actions} />
    </div>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error"
}
