import type { McpServerConfig } from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { useMemo, useState, type FormEvent } from "react"

import {
  DRIVERS,
  emptyDraft,
  issuesFor,
  newInstance,
  newMcpServer,
  validateDraft,
  type ConfigDraft,
  type DraftValidation,
} from "./config-draft"

/**
 * The entire configuration surface of the product.
 *
 * Three sections — instances, MCP servers, and project defaults — over one
 * draft, submitted as a single validated `config.update`. The form never writes
 * a file and never talks to a harness; it produces a command payload.
 */

export type SettingsTarget =
  | { kind: "global" }
  | { kind: "project"; projectId: string }

export type SettingsFormProps = {
  initial?: ConfigDraft
  target: SettingsTarget
  onSubmit: (
    payload: NonNullable<DraftValidation["payload"]>,
    target: SettingsTarget
  ) => void | Promise<void>
}

const FIELD =
  "h-9 w-full rounded-xl border border-input bg-background px-3 text-sm"
const LABEL = "text-xs font-medium text-muted-foreground"

function IssueList({ issues }: { issues: ReturnType<typeof issuesFor> }) {
  if (issues.length === 0) return null
  return (
    <ul role="alert" className="mt-2 flex flex-col gap-1">
      {issues.map((issue, index) => (
        <li key={`${issue.path}-${index}`} className="text-xs text-destructive">
          {issue.message}
        </li>
      ))}
    </ul>
  )
}

export function SettingsForm({ initial, target, onSubmit }: SettingsFormProps) {
  const [draft, setDraft] = useState<ConfigDraft>(initial ?? emptyDraft())
  const [submitted, setSubmitted] = useState(false)
  const validation = useMemo(() => validateDraft(draft), [draft])

  function update(patch: Partial<ConfigDraft>) {
    setDraft((current) => ({ ...current, ...patch }))
  }

  function updateInstance(index: number, patch: Record<string, unknown>) {
    update({
      instances: draft.instances.map((instance, instanceIndex) =>
        instanceIndex === index ? { ...instance, ...patch } : instance
      ),
    })
  }

  function updateServer(
    index: number,
    patch: { name?: string; config?: McpServerConfig }
  ) {
    update({
      mcpServers: draft.mcpServers.map((server, serverIndex) =>
        serverIndex === index ? { ...server, ...patch } : server
      ),
    })
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    if (!validation.payload) return
    await onSubmit(validation.payload, target)
  }

  const showIssues = submitted

  return (
    <form className="flex flex-col gap-8" onSubmit={submit} noValidate>
      <section aria-labelledby="settings-instances">
        <h2
          id="settings-instances"
          className="font-heading text-lg font-medium"
        >
          Instances
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A named, running use of a driver. Run several of the same driver to
          point at different servers or accounts.
        </p>

        <div className="mt-4 flex flex-col gap-4">
          {draft.instances.map((instance, index) => (
            <fieldset
              key={index}
              className="rounded-2xl border border-border bg-card p-4"
            >
              <legend className="px-1 text-sm font-medium">
                {instance.displayName || instance.instanceId || "New instance"}
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Instance id</span>
                  <input
                    className={FIELD}
                    value={instance.instanceId}
                    onChange={(event) =>
                      updateInstance(index, {
                        instanceId: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Driver</span>
                  <select
                    className={FIELD}
                    value={instance.driver}
                    onChange={(event) =>
                      updateInstance(index, { driver: event.target.value })
                    }
                  >
                    {DRIVERS.map((driver) => (
                      <option key={driver.id} value={driver.id}>
                        {driver.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Display name</span>
                  <input
                    className={FIELD}
                    value={instance.displayName ?? ""}
                    onChange={(event) =>
                      updateInstance(index, {
                        displayName: event.target.value || undefined,
                      })
                    }
                  />
                </label>
                <div className="flex items-end gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={instance.enabled}
                      onChange={(event) =>
                        updateInstance(index, { enabled: event.target.checked })
                      }
                    />
                    Enabled
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={instance.autoStart}
                      onChange={(event) =>
                        updateInstance(index, {
                          autoStart: event.target.checked,
                        })
                      }
                    />
                    Start at boot
                  </label>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Leave &ldquo;Start at boot&rdquo; off for an expensive instance:
                it stays selectable and starts on first send.
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-3"
                onClick={() =>
                  update({
                    instances: draft.instances.filter(
                      (_entry, entryIndex) => entryIndex !== index
                    ),
                  })
                }
              >
                Remove instance
              </Button>
            </fieldset>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          className="mt-3"
          onClick={() =>
            update({
              instances: [
                ...draft.instances,
                newInstance(draft.instances.length),
              ],
            })
          }
        >
          Add instance
        </Button>
        {showIssues ? (
          <IssueList issues={issuesFor(validation, "instances")} />
        ) : null}
      </section>

      <section aria-labelledby="settings-mcp">
        <h2 id="settings-mcp" className="font-heading text-lg font-medium">
          MCP servers
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Merged by name: these, then this project&rsquo;s, then each
          instance&rsquo;s. Aide never edits a harness&rsquo;s own config file.
        </p>

        <div className="mt-4 flex flex-col gap-4">
          {draft.mcpServers.map((server, index) => (
            <fieldset
              key={index}
              className="rounded-2xl border border-border bg-card p-4"
            >
              <legend className="px-1 text-sm font-medium">
                {server.name || "New server"}
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Name</span>
                  <input
                    className={FIELD}
                    value={server.name}
                    onChange={(event) =>
                      updateServer(index, { name: event.target.value })
                    }
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Transport</span>
                  <select
                    className={FIELD}
                    value={server.config.type}
                    onChange={(event) =>
                      updateServer(index, {
                        config: transportDefault(event.target.value),
                      })
                    }
                  >
                    <option value="stdio">stdio</option>
                    <option value="http">http</option>
                    <option value="sse">sse</option>
                    <option value="aide">Aide toolset</option>
                  </select>
                </label>

                {server.config.type === "stdio" ? (
                  <label className="flex flex-col gap-1 sm:col-span-2">
                    <span className={LABEL}>Command</span>
                    <input
                      className={FIELD}
                      value={server.config.command}
                      onChange={(event) =>
                        updateServer(index, {
                          config: {
                            ...(server.config as Extract<
                              McpServerConfig,
                              { type: "stdio" }
                            >),
                            command: event.target.value,
                          },
                        })
                      }
                    />
                  </label>
                ) : null}

                {server.config.type === "http" ||
                server.config.type === "sse" ? (
                  <label className="flex flex-col gap-1 sm:col-span-2">
                    <span className={LABEL}>URL</span>
                    <input
                      className={FIELD}
                      value={server.config.url}
                      onChange={(event) =>
                        updateServer(index, {
                          config: {
                            ...(server.config as Extract<
                              McpServerConfig,
                              { type: "http" | "sse" }
                            >),
                            url: event.target.value,
                          },
                        })
                      }
                    />
                  </label>
                ) : null}

                {server.config.type === "aide" ? (
                  <label className="flex flex-col gap-1 sm:col-span-2">
                    <span className={LABEL}>Toolset</span>
                    <input
                      className={FIELD}
                      value={server.config.toolset}
                      onChange={(event) =>
                        updateServer(index, {
                          config: {
                            type: "aide",
                            toolset: event.target.value,
                          },
                        })
                      }
                    />
                  </label>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                className="mt-3"
                onClick={() =>
                  update({
                    mcpServers: draft.mcpServers.filter(
                      (_entry, entryIndex) => entryIndex !== index
                    ),
                  })
                }
              >
                Remove server
              </Button>
            </fieldset>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          className="mt-3"
          onClick={() =>
            update({
              mcpServers: [
                ...draft.mcpServers,
                newMcpServer(draft.mcpServers.length),
              ],
            })
          }
        >
          Add MCP server
        </Button>
        {showIssues ? (
          <IssueList issues={issuesFor(validation, "mcpServers")} />
        ) : null}
      </section>

      <section aria-labelledby="settings-defaults">
        <h2 id="settings-defaults" className="font-heading text-lg font-medium">
          {target.kind === "project" ? "Project defaults" : "Defaults"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The selection a new session starts from. Project values win over
          global ones, field by field.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Projects directory</span>
            <input
              className={FIELD}
              value={draft.projectsDirectory}
              placeholder="~/projects"
              onChange={(event) =>
                update({ projectsDirectory: event.target.value })
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Default instance</span>
            <select
              className={FIELD}
              value={draft.defaults.instanceId ?? ""}
              onChange={(event) =>
                update({
                  defaults: {
                    ...draft.defaults,
                    instanceId: event.target.value || undefined,
                  },
                })
              }
            >
              <option value="">None</option>
              {draft.instances.map((instance, index) => (
                <option key={index} value={instance.instanceId}>
                  {instance.displayName || instance.instanceId}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Default agent</span>
            <input
              className={FIELD}
              value={draft.defaults.agent ?? ""}
              onChange={(event) =>
                update({
                  defaults: {
                    ...draft.defaults,
                    agent: event.target.value || undefined,
                  },
                })
              }
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Default mode</span>
            <input
              className={FIELD}
              value={draft.defaults.interactionMode ?? ""}
              onChange={(event) =>
                update({
                  defaults: {
                    ...draft.defaults,
                    interactionMode: event.target.value || undefined,
                  },
                })
              }
            />
          </label>
        </div>
        {showIssues ? (
          <IssueList issues={issuesFor(validation, "defaults")} />
        ) : null}
      </section>

      <div className="flex items-center gap-3">
        <Button type="submit">Save settings</Button>
        {showIssues && validation.issues.length > 0 ? (
          <span className="text-xs text-destructive">
            Fix {validation.issues.length} issue
            {validation.issues.length === 1 ? "" : "s"} before saving.
          </span>
        ) : null}
      </div>
    </form>
  )
}

function transportDefault(type: string): McpServerConfig {
  switch (type) {
    case "http":
      return { type: "http", url: "" }
    case "sse":
      return { type: "sse", url: "" }
    case "aide":
      return { type: "aide", toolset: "" }
    default:
      return { type: "stdio", command: "" }
  }
}
