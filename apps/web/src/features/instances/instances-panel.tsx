import type {
  InstanceAuth,
  InstanceRuntimeStatus,
  InstanceSnapshotEntry,
} from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"

import { sendBlockedReason } from "./instances-store"

/**
 * Instance status, version, and auth state, driven entirely by `harness.*`
 * events already reduced into the instances store. Nothing here fetches, and
 * nothing polls an adapter.
 */

const STATUS_LABEL: Record<InstanceRuntimeStatus, string> = {
  configured: "Configured",
  starting: "Starting",
  ready: "Ready",
  degraded: "Degraded",
  stopped: "Stopped",
  failed: "Failed",
}

const STATUS_TONE: Record<InstanceRuntimeStatus, string> = {
  configured: "bg-muted text-muted-foreground",
  starting: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  ready: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  degraded: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  stopped: "bg-muted text-muted-foreground",
  failed: "bg-destructive/15 text-destructive",
}

const AUTH_LABEL: Record<InstanceAuth["status"], string> = {
  authenticated: "Signed in",
  unauthenticated: "Not signed in",
  expired: "Session expired",
  unknown: "Auth unknown",
}

const AUTH_TONE: Record<InstanceAuth["status"], string> = {
  authenticated: "text-emerald-700 dark:text-emerald-400",
  unauthenticated: "text-destructive",
  expired: "text-amber-700 dark:text-amber-400",
  unknown: "text-muted-foreground",
}

export function StatusBadge({ status }: { status: InstanceRuntimeStatus }) {
  return (
    <span
      data-testid="instance-status"
      className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${STATUS_TONE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

/** Auth is surfaced, never stored or proxied by Aide. */
export function AuthState({ auth }: { auth: InstanceAuth }) {
  const detail = [auth.label, auth.account].filter(Boolean).join(" · ")
  return (
    <p className={`text-xs ${AUTH_TONE[auth.status]}`}>
      <span className="font-medium">{AUTH_LABEL[auth.status]}</span>
      {detail ? (
        <span className="text-muted-foreground"> — {detail}</span>
      ) : null}
    </p>
  )
}

export type InstanceActions = {
  onStart?: (instanceId: string) => void
  onStop?: (instanceId: string) => void
  onRestart?: (instanceId: string) => void
  onRefreshInventory?: (instanceId: string) => void
}

export function InstanceCard({
  instance,
  actions = {},
}: {
  instance: InstanceSnapshotEntry
  actions?: InstanceActions
}) {
  const blocked = sendBlockedReason(instance)
  const running = instance.status === "ready" || instance.status === "degraded"

  return (
    <article
      aria-label={instance.displayName ?? instance.instanceId}
      className="rounded-2xl border border-border bg-card p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-heading text-base font-medium">
            {instance.displayName ?? instance.instanceId}
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {instance.driver}
            {instance.version ? ` · v${instance.version}` : null}
            {instance.installed === false ? " · not installed" : null}
          </p>
        </div>
        <StatusBadge status={instance.status} />
      </div>

      <div className="mt-2">
        <AuthState auth={instance.auth} />
      </div>

      {instance.inventory ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {instance.inventory.models.length} model
          {instance.inventory.models.length === 1 ? "" : "s"}
          {instance.inventory.stale ? " · inventory stale" : null}
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          No inventory discovered yet
        </p>
      )}

      {instance.error ? (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {instance.error.message}
        </p>
      ) : null}

      {blocked ? (
        <p className="mt-3 text-xs text-muted-foreground">{blocked}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {running ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => actions.onStop?.(instance.instanceId)}
          >
            Stop
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={!instance.enabled}
            onClick={() => actions.onStart?.(instance.instanceId)}
          >
            Start
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => actions.onRestart?.(instance.instanceId)}
        >
          Restart
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!running}
          onClick={() => actions.onRefreshInventory?.(instance.instanceId)}
        >
          Refresh inventory
        </Button>
      </div>
    </article>
  )
}

export function InstancesPanel({
  instances,
  actions,
}: {
  instances: InstanceSnapshotEntry[]
  actions?: InstanceActions
}) {
  if (instances.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No harness instances are configured yet. Add one in settings.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {instances.map((instance) => (
        <InstanceCard
          key={instance.instanceId}
          instance={instance}
          {...(actions ? { actions } : {})}
        />
      ))}
    </div>
  )
}
