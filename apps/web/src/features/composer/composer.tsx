import type {
  ExecutionSelection,
  FileMatch,
  FileSearchResult,
  HarnessInventory,
  Invocation,
} from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react"

import {
  applyComposerChange,
  resolveComposer,
  type ComposerControl,
  type ComposerDraft,
  type ComposerSources,
} from "./composer-state"
import {
  filterSlashEntries,
  insertFileLink,
  mentionAt,
  parseSend,
  slashEntries,
  slashQuery,
  type MentionToken,
  type SlashEntry,
} from "./composer-text"

/**
 * The composer renders whatever the adapter described and nothing else.
 *
 * It iterates `view.controls` — it never names a control id, so a harness that
 * starts reporting a new option gets a working select here without a change to
 * this file. The same holds for commands and skills: the `/` picker lists
 * whatever the selected instance's inventory reports.
 */

export type ComposerSendInput = {
  content: string
  execution: ExecutionSelection
  invocation?: Invocation
}

export type ComposerProps = {
  sources: ComposerSources
  disabled?: boolean
  onSend: (input: ComposerSendInput) => void
  /** Searches the session's files for `@` links. Omit to turn `@` off. */
  searchFiles?: (query: string) => Promise<FileSearchResult>
  /**
   * Set while a turn is running on an instance that can steer: the message
   * can then go into that turn instead of queueing behind it.
   */
  onSteer?: (content: string) => void
  /**
   * Inventory for the session's own project directory. Commands and skills a
   * project defines itself only appear there, so the `/` picker prefers it.
   */
  sessionInventory?: (instanceId: string) => Promise<HarnessInventory>
}

const SEARCH_DEBOUNCE_MS = 120

function ControlSelect({
  control,
  disabled,
  onChange,
}: {
  control: ComposerControl
  disabled: boolean
  onChange: (value: string) => void
}) {
  const id = useId()

  return (
    <label className="flex min-w-0 flex-col gap-1" htmlFor={id}>
      <span className="text-[0.68rem] font-medium tracking-[0.12em] text-muted-foreground uppercase">
        {control.label}
      </span>
      <select
        id={id}
        data-control-id={control.id}
        value={control.value ?? ""}
        disabled={disabled || control.options.length === 0}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 min-w-0 rounded-xl border border-input bg-background px-2 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/30 disabled:opacity-60"
      >
        {control.value === undefined ? <option value="">—</option> : null}
        {control.options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

type PickerItem = {
  key: string
  label: string
  detail?: string
  badge?: string
}

/** A listbox above the textarea; the textarea keeps focus and drives it. */
function Picker({
  id,
  label,
  items,
  active,
  onPick,
  empty,
}: {
  id: string
  label: string
  items: PickerItem[]
  active: number
  onPick: (index: number) => void
  empty?: string
}) {
  return (
    <div
      className="absolute inset-x-0 bottom-full z-10 mb-2 max-h-64 overflow-auto rounded-2xl border border-border bg-popover p-1 shadow-lg"
      data-testid={`${label}-picker`}
    >
      {items.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul id={id} role="listbox" aria-label={label}>
          {items.map((item, index) => (
            <li
              key={item.key}
              id={`${id}-${index}`}
              role="option"
              aria-selected={index === active}
              // Mouse down, not click: the textarea must not lose focus first.
              onMouseDown={(event) => {
                event.preventDefault()
                onPick(index)
              }}
              className={`flex cursor-pointer items-baseline gap-2 rounded-xl px-3 py-1.5 text-sm ${
                index === active ? "bg-muted" : ""
              }`}
            >
              <span className="max-w-[16rem] shrink-0 truncate font-medium">
                {item.label}
              </span>
              {item.badge ? (
                <span className="shrink-0 rounded-full bg-muted px-1.5 text-[0.68rem] text-muted-foreground">
                  {item.badge}
                </span>
              ) : null}
              {item.detail ? (
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {item.detail}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Composer({
  sources,
  disabled = false,
  onSend,
  searchFiles,
  onSteer,
  sessionInventory,
}: ComposerProps) {
  const [draft, setDraft] = useState<ComposerDraft>({})
  const [content, setContent] = useState("")
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState<string>()
  const [files, setFiles] = useState<{ query: string; matches: FileMatch[] }>()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messageId = useId()
  const pickerId = useId()

  const view = resolveComposer(sources, draft)
  const instanceId = view.instance?.instanceId
  const [projectInventory, setProjectInventory] = useState<{
    instanceId: string
    inventory: HarnessInventory
  }>()
  useEffect(() => {
    if (!instanceId || !sessionInventory) return
    let current = true
    sessionInventory(instanceId)
      .then((inventory) => {
        if (current) setProjectInventory({ instanceId, inventory })
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [instanceId, sessionInventory])
  const inventory =
    projectInventory && projectInventory.instanceId === instanceId
      ? projectInventory.inventory
      : view.instance?.inventory
  const entries = useMemo(
    () => slashEntries(inventory?.commands, inventory?.skills),
    [inventory?.commands, inventory?.skills]
  )

  const slash = slashQuery(content)
  const mention: MentionToken | undefined = searchFiles
    ? mentionAt(content, caret)
    : undefined
  const pickerKey =
    slash !== undefined
      ? `/${slash}`
      : mention
        ? `@${mention.start}`
        : undefined
  const pickerOpen = pickerKey !== undefined && pickerKey !== dismissed

  const slashMatches: SlashEntry[] =
    slash !== undefined ? filterSlashEntries(entries, slash) : []

  // File matches follow the typed query, debounced; a stale reply is ignored.
  const mentionQuery = mention?.query
  useEffect(() => {
    if (mentionQuery === undefined || !searchFiles) return
    let current = true
    const timer = setTimeout(() => {
      void searchFiles(mentionQuery)
        .then((result) => {
          if (current) setFiles({ query: mentionQuery, matches: result.files })
        })
        .catch(() => {
          if (current) setFiles({ query: mentionQuery, matches: [] })
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [mentionQuery, searchFiles])
  const fileMatches =
    mention && files?.query === mention.query ? files.matches : []

  const items: PickerItem[] =
    slash !== undefined
      ? slashMatches.map((entry) => ({
          key: `${entry.kind}:${entry.name}`,
          label: `/${entry.name}`,
          badge: entry.kind,
          ...(entry.description || entry.argumentHint
            ? {
                detail: [entry.argumentHint, entry.description]
                  .filter(Boolean)
                  .join(" · "),
              }
            : {}),
        }))
      : fileMatches.map((file) => ({
          key: file.path,
          label: file.name,
          ...(file.path !== file.name ? { detail: file.path } : {}),
        }))
  const activeIndex = Math.min(active, Math.max(items.length - 1, 0))

  const trimmed = content.trim()
  const canSend =
    !disabled && view.selection !== undefined && trimmed.length > 0
  const parsed = parseSend(content, entries)
  // Steering adds words to a running turn; a command cannot ride along.
  const canSteer = canSend && onSteer !== undefined && !parsed.invocation

  function edit(value: string, nextCaret = value.length) {
    setContent(value)
    setCaret(nextCaret)
    setActive(0)
  }

  function pick(index: number) {
    if (slash !== undefined) {
      const entry = slashMatches[index]
      if (!entry) return
      edit(`/${entry.name} `)
      return
    }
    const file = fileMatches[index]
    if (!file || !mention) return
    const next = insertFileLink(content, mention, file)
    edit(next.text, next.caret)
    requestAnimationFrame(() => {
      textareaRef.current?.setSelectionRange(next.caret, next.caret)
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!pickerOpen || items.length === 0) {
      if (pickerOpen && event.key === "Escape") setDismissed(pickerKey)
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((activeIndex + 1) % items.length)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((activeIndex - 1 + items.length) % items.length)
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault()
      pick(activeIndex)
    } else if (event.key === "Escape") {
      event.preventDefault()
      setDismissed(pickerKey)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSend || !view.selection) return
    edit("")
    // The selection is captured here and travels with the message. Whatever the
    // composer shows afterwards has no bearing on what was already sent.
    onSend({
      content: parsed.content,
      execution: view.selection,
      ...(parsed.invocation ? { invocation: parsed.invocation } : {}),
    })
  }

  function steer() {
    if (!canSteer || !onSteer) return
    edit("")
    onSteer(trimmed)
  }

  return (
    <form className="border-t border-border pt-5" onSubmit={submit}>
      <div className="flex flex-wrap gap-3">
        {view.controls.map((control) => (
          <ControlSelect
            key={control.id}
            control={control}
            disabled={disabled}
            onChange={(value) =>
              setDraft((current) =>
                applyComposerChange(current, control.id, value)
              )
            }
          />
        ))}
      </div>

      {view.blockedReason ? (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
        >
          {view.blockedReason}
        </p>
      ) : null}

      <label htmlFor={messageId} className="mt-4 block text-sm font-medium">
        Message
      </label>
      <div className="relative mt-2">
        {pickerOpen && (slash !== undefined || mention) ? (
          <Picker
            id={pickerId}
            label={slash !== undefined ? "Commands" : "Files"}
            items={items}
            active={activeIndex}
            onPick={pick}
            empty={
              slash !== undefined
                ? "This instance reports no matching commands or skills."
                : files?.query === mention?.query
                  ? "No matching files."
                  : "Searching…"
            }
          />
        ) : null}
        <textarea
          ref={textareaRef}
          id={messageId}
          rows={3}
          value={content}
          disabled={disabled || view.selection === undefined}
          role="combobox"
          aria-expanded={pickerOpen}
          aria-controls={pickerOpen ? pickerId : undefined}
          aria-activedescendant={
            pickerOpen && items.length > 0
              ? `${pickerId}-${activeIndex}`
              : undefined
          }
          aria-autocomplete="list"
          placeholder={
            view.selection
              ? "Continue this session… Type / for commands and skills, @ to link a file."
              : "Send becomes available once an instance and model are selected."
          }
          onChange={(event) =>
            edit(
              event.target.value,
              event.target.selectionStart ?? event.target.value.length
            )
          }
          onSelect={(event) =>
            setCaret(event.currentTarget.selectionStart ?? content.length)
          }
          onKeyDown={onKeyDown}
          className="w-full resize-y rounded-2xl border border-input bg-background px-4 py-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/30 disabled:opacity-60"
        />
      </div>
      {parsed.invocation ? (
        <p
          className="mt-1 text-xs text-muted-foreground"
          data-testid="invocation-hint"
        >
          Runs the {parsed.invocation.kind}{" "}
          <span className="font-mono">/{parsed.invocation.name}</span>
          {parsed.content ? " with the rest as its arguments" : ""}.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!canSend}>
          Send
        </Button>
        {onSteer ? (
          <Button
            type="button"
            variant="outline"
            disabled={!canSteer}
            onClick={steer}
          >
            Steer current turn
          </Button>
        ) : null}
        {onSteer ? (
          <span className="text-xs text-muted-foreground">
            Send queues a new turn; steer adds this to the one running now.
          </span>
        ) : null}
      </div>
    </form>
  )
}
