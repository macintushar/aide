import { Button } from "@workspace/ui/components/button"

import { newCommandId } from "@/lib/transport/command-client"

import { useInstances } from "./instances-provider"
import { InstancesPanel, type InstanceActions } from "./instances-panel"

export function InstancesView() {
  const {
    state,
    loadError,
    streamError,
    actionError,
    pendingAction,
    send,
    retry,
  } = useInstances()

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
      <p role="status" className="text-ui text-muted-foreground">
        Loading harness instances…
      </p>
    )
  }

  if (!state.snapshotApplied && loadError) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/30 p-4">
        <p className="text-ui text-destructive">
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
        <p role="status" className="text-small text-warn">
          Live updates interrupted. Reconnecting…
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="text-ui text-destructive">
          Command failed: {actionError}
        </p>
      ) : null}
      <InstancesPanel instances={state.instances} actions={actions} />
    </div>
  )
}
