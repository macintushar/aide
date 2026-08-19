import type { Command } from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { useState } from "react"

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
import { useInstancesFeed, type InstancesFeed } from "./use-instances-feed"

type ReadClient = Pick<ReturnType<typeof createReadClient>, "getInstances">
type CommandClient = Pick<ReturnType<typeof createCommandClient>, "send">
type Subscribe = (options: InstancesEventsOptions) => { close(): void }

export type InstancesBoundaryProps = {
  readClient?: ReadClient
  commandClient?: CommandClient
  subscribe?: Subscribe
  /** Supplied when an ancestor already owns the feed; otherwise one is created. */
  feed?: InstancesFeed
}

const defaultReadClient = createReadClient()
const defaultCommandClient = createCommandClient()

export function InstancesBoundary({
  readClient = defaultReadClient,
  commandClient = defaultCommandClient,
  subscribe = subscribeInstancesEvents,
  feed,
}: InstancesBoundaryProps) {
  const ownFeed = useInstancesFeed({
    readClient,
    subscribe,
    enabled: feed === undefined,
  })
  const { state, loadError, streamError, retry } = feed ?? ownFeed
  const [actionError, setActionError] = useState<string>()
  const [pendingAction, setPendingAction] = useState<string>()

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
          onClick={retry}
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
