import type { DriverId } from "@workspace/contracts"
import { useId, useState } from "react"

/**
 * The driver-specific `config` object of an instance. The server validates it
 * against each adapter's own strict schema; these descriptors mirror those
 * schemas so the common fields need no hand-written JSON.
 */
type FieldKind = "text" | "boolean" | "number" | "env"

type FieldSpec = {
  key: string
  label: string
  kind: FieldKind
  hint?: string
  placeholder?: string
}

export const DRIVER_CONFIG_FIELDS: Record<DriverId, FieldSpec[]> = {
  opencode: [
    {
      key: "baseUrl",
      label: "Server URL",
      kind: "text",
      placeholder: "http://127.0.0.1:4096",
      hint: "Connect to an OpenCode server you run. Leave blank for Aide to host one.",
    },
    {
      key: "databasePath",
      label: "Database path",
      kind: "text",
      hint: "Where the hosted OpenCode keeps sessions. Not used with a server URL.",
    },
    {
      key: "directory",
      label: "Fallback directory",
      kind: "text",
      hint: "Working directory when a send has no project.",
    },
    {
      key: "allowVersionMismatch",
      label: "Allow version mismatch",
      kind: "boolean",
    },
  ],
  claudeAgent: [
    {
      key: "model",
      label: "Default model",
      kind: "text",
      placeholder: "claude-sonnet-5-5",
    },
    {
      key: "cwd",
      label: "Fallback directory",
      kind: "text",
      hint: "Working directory when a send has no project.",
    },
    {
      key: "executable",
      label: "Claude Code executable",
      kind: "text",
      hint: "A pinned or side-by-side install. Blank uses the bundled one.",
    },
    {
      key: "startupTimeoutMs",
      label: "Startup timeout (ms)",
      kind: "number",
      placeholder: "30000",
    },
    {
      key: "env",
      label: "Environment",
      kind: "env",
      placeholder: "CLAUDE_CONFIG_DIR=/path/to/account",
      hint: "One KEY=value per line. How a second account is selected.",
    },
    {
      key: "allowVersionMismatch",
      label: "Allow version mismatch",
      kind: "boolean",
    },
  ],
}

const FIELD =
  "field h-9 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--n0)] px-3 text-ui text-foreground outline-none transition-colors placeholder:text-[var(--n5)] focus-visible:border-[var(--accent-dim)] focus-visible:ring-3 focus-visible:ring-[var(--accent-glow)] aria-invalid:border-danger/60"
const LABEL = "text-small font-medium text-[var(--n6)]"

export function DriverConfigFields({
  driver,
  config,
  onChange,
}: {
  driver: DriverId
  config: unknown
  onChange: (config: Record<string, unknown>) => void
}) {
  const values = isRecord(config) ? config : {}
  const fields = DRIVER_CONFIG_FIELDS[driver] ?? []
  const idPrefix = useId()
  const hintId = (field: FieldSpec) => `${idPrefix}-${field.key}-hint`

  function set(key: string, value: unknown) {
    const next = { ...values }
    if (value === undefined) delete next[key]
    else next[key] = value
    onChange(next)
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="driver-config">
      {fields.map((field) =>
        field.kind === "boolean" ? (
          <label
            key={field.key}
            className="flex items-center gap-2 text-ui sm:col-span-2"
          >
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={values[field.key] === true}
              onChange={(event) =>
                set(field.key, event.target.checked ? true : undefined)
              }
            />
            {field.label}
          </label>
        ) : field.kind === "env" ? (
          <EnvField
            key={field.key}
            field={field}
            hintId={hintId(field)}
            value={values[field.key]}
            onChange={(env) => set(field.key, env)}
          />
        ) : (
          <div key={field.key} className="flex flex-col gap-1">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>{field.label}</span>
              <input
                className={FIELD}
                aria-describedby={field.hint ? hintId(field) : undefined}
                inputMode={field.kind === "number" ? "numeric" : undefined}
                placeholder={field.placeholder}
                value={
                  typeof values[field.key] === "string" ||
                  typeof values[field.key] === "number"
                    ? String(values[field.key])
                    : ""
                }
                onChange={(event) => {
                  const raw = event.target.value.trim()
                  if (!raw) return set(field.key, undefined)
                  if (field.kind === "number") {
                    const parsed = Number(raw)
                    // Keep the raw text while it isn't a number yet, so the
                    // server's validation names the problem.
                    return set(
                      field.key,
                      Number.isFinite(parsed) ? parsed : event.target.value
                    )
                  }
                  set(field.key, event.target.value)
                }}
              />
            </label>
            {field.hint ? (
              <span
                id={hintId(field)}
                className="text-small text-muted-foreground"
              >
                {field.hint}
              </span>
            ) : null}
          </div>
        )
      )}
    </div>
  )
}

function EnvField({
  field,
  hintId,
  value,
  onChange,
}: {
  field: FieldSpec
  hintId: string
  value: unknown
  onChange: (env: Record<string, string> | undefined) => void
}) {
  // The text is the source of truth while typing; a half-typed line must not
  // be dropped and rewritten under the cursor.
  const [text, setText] = useState(() => formatEnv(value))
  return (
    <div className="flex flex-col gap-1 sm:col-span-2">
      <label className="flex flex-col gap-1">
        <span className={LABEL}>{field.label}</span>
        <textarea
          rows={3}
          aria-describedby={field.hint ? hintId : undefined}
          className="field w-full rounded-lg border border-[var(--line-strong)] bg-[var(--n0)] px-3 py-2 font-mono text-small outline-none focus-visible:border-[var(--accent-dim)] focus-visible:ring-3 focus-visible:ring-[var(--accent-glow)]"
          placeholder={field.placeholder}
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            onChange(parseEnv(event.target.value))
          }}
        />
      </label>
      {field.hint ? (
        <span id={hintId} className="text-small text-muted-foreground">
          {field.hint}
        </span>
      ) : null}
    </div>
  )
}

export function parseEnv(text: string): Record<string, string> | undefined {
  const env: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const index = trimmed.indexOf("=")
    if (index <= 0) continue
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1)
  }
  return Object.keys(env).length > 0 ? env : undefined
}

export function formatEnv(value: unknown): string {
  if (!isRecord(value)) return ""
  return Object.entries(value)
    .map(([key, entry]) => `${key}=${String(entry)}`)
    .join("\n")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
