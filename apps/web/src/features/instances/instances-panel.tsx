import type {
  InstanceAuth,
  InstanceRuntimeStatus,
  InstanceSnapshotEntry,
} from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { HarnessMark } from "@workspace/ui/components/harness-mark"

import { harnessMarkFor } from "./harness-marks"
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
  configured: "bg-[var(--n3)] text-muted-foreground",
  starting: "bg-warn/12 text-warn",
  ready: "bg-ok/12 text-ok",
  degraded: "bg-warn/12 text-warn",
  stopped: "bg-[var(--n3)] text-muted-foreground",
  failed: "bg-danger/12 text-danger",
}

const AUTH_LABEL: Record<InstanceAuth["status"], string> = {
  authenticated: "Signed in",
  unauthenticated: "Not signed in",
  expired: "Session expired",
  unknown: "Auth unknown",
}

const AUTH_TONE: Record<InstanceAuth["status"], string> = {
  authenticated: "text-ok",
  unauthenticated: "text-destructive",
  expired: "text-warn",
  unknown: "text-muted-foreground",
}

export function StatusBadge({ status }: { status: InstanceRuntimeStatus }) {
  return (
    <span
      data-testid="instance-status"
      className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[0.6875rem] font-medium ${STATUS_TONE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

/** Auth is surfaced, never stored or proxied by Aide. */
export function AuthState({ auth }: { auth: InstanceAuth }) {
  const detail = [auth.label, auth.account, auth.organization]
    .filter(Boolean)
    .join(" · ")
  return (
    <div className="flex flex-col gap-1">
      <p className={`text-small ${AUTH_TONE[auth.status]}`}>
        <span className="font-medium">{AUTH_LABEL[auth.status]}</span>
        {detail ? (
          <span className="text-muted-foreground"> — {detail}</span>
        ) : null}
      </p>
      {auth.providers && auth.providers.length > 0 ? (
        <ul
          aria-label="Providers"
          className="flex flex-wrap gap-1.5"
          data-testid="auth-providers"
        >
          {auth.providers.map((provider) => (
            <li
              key={provider.id}
              title={
                provider.method ? `Connected via ${provider.method}` : undefined
              }
              className={`rounded-full px-2 py-0.5 text-small ${
                provider.connected
                  ? "bg-ok/10 text-ok"
                  : "bg-[var(--n3)] text-muted-foreground"
              }`}
            >
              {provider.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export type InstanceActions = {
  onStart?: (instanceId: string) => void
  onStop?: (instanceId: string) => void
  onRestart?: (instanceId: string) => void
  onRefreshInventory?: (instanceId: string) => void
  onReconnectMcp?: (instanceId: string, serverName: string) => void
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
      className="rounded-xl border border-[var(--line)] bg-[var(--n2)] p-4 shadow-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--n1)]">
            <HarnessMark
              src={harnessMarkFor(instance.driver)}
              name={instance.driver}
              size={18}
              muted={!instance.enabled}
              decorative
            />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-ui font-semibold">
              {instance.displayName ?? instance.instanceId}
            </h3>
            <p className="truncate text-small text-muted-foreground">
              {instance.driver}
              {instance.version ? ` · v${instance.version}` : null}
              {instance.installed === false ? " · not installed" : null}
            </p>
          </div>
        </div>
        <StatusBadge status={instance.status} />
      </div>

      <div className="mt-2">
        <AuthState auth={instance.auth} />
      </div>

      {instance.inventory ? (
        <p className="mt-2 text-small text-muted-foreground">
          {instance.inventory.models.length} model
          {instance.inventory.models.length === 1 ? "" : "s"}
          {instance.inventory.stale ? " · inventory stale" : null}
        </p>
      ) : (
        <p className="mt-2 text-small text-muted-foreground">
          No inventory discovered yet
        </p>
      )}

      {instance.mcpServers && instance.mcpServers.length > 0 ? (
        <ul
          className="mt-2 flex flex-col gap-1"
          aria-label={`${instance.displayName ?? instance.instanceId} MCP servers`}
        >
          {instance.mcpServers.map((server) => (
            <li
              key={server.name}
              className="flex items-center gap-2 text-small"
              title={server.error?.message}
            >
              <span
                className={`size-1.5 shrink-0 rounded-full ${
                  server.connected ? "bg-ok" : "bg-destructive"
                }`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate font-mono">
                {server.name}
              </span>
              <span className="text-muted-foreground">
                {server.connected ? "connected" : "disconnected"}
              </span>
              {!server.connected &&
              running &&
              instance.inventory?.capabilities.mcpReconnect === true ? (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    actions.onReconnectMcp?.(instance.instanceId, server.name)
                  }
                >
                  Reconnect
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {instance.error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-small text-danger"
        >
          {instance.error.message}
        </p>
      ) : null}

      {blocked ? (
        <p className="mt-3 text-small text-muted-foreground">{blocked}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-1.5 border-t border-[var(--line)] pt-3">
        {running ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => actions.onStop?.(instance.instanceId)}
          >
            Stop
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={!instance.enabled}
            onClick={() => actions.onStart?.(instance.instanceId)}
          >
            Start
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => actions.onRestart?.(instance.instanceId)}
        >
          Restart
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xs"
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
      <p className="text-ui text-muted-foreground">
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
