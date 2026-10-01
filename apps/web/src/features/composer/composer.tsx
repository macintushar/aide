import {
  RiArrowDownSLine,
  RiArrowUpLine,
  RiCornerDownRightLine,
} from "@remixicon/react"
import type {
  ExecutionSelection,
  FileMatch,
  FileSearchResult,
  HarnessInventory,
  Invocation,
} from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { HarnessMark } from "@workspace/ui/components/harness-mark"
import { Kbd } from "@workspace/ui/components/kbd"
import { cn } from "@workspace/ui/lib/utils"

import { harnessMarkFor } from "@/features/instances/harness-marks"
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
  /** Overrides the prompt shown in the empty message field. */
  placeholder?: string
  autoFocus?: boolean
  className?: string
  /** Extra controls rendered at the start of the toolbar. */
  toolbarStart?: React.ReactNode
}

const SEARCH_DEBOUNCE_MS = 120

/**
 * One adapter-described control as a compact pill. It stays a native select
 * underneath: keyboard, screen readers and the OS picker all work for free.
 */
function ControlSelect({
  control,
  disabled,
  leading,
  onChange,
}: {
  control: ComposerControl
  disabled: boolean
  leading?: React.ReactNode
  onChange: (value: string) => void
}) {
  const id = useId()
  const current = control.options.find((option) => option.id === control.value)

  return (
    <label
      htmlFor={id}
      title={control.label}
      className={cn(
        "group/control relative inline-flex h-7 max-w-[14rem] min-w-0 items-center gap-1.5 rounded-lg pr-6 pl-2 text-ui text-[var(--n7)] transition-colors duration-[var(--dur-fast)] focus-within:ring-3 focus-within:ring-[var(--accent-glow)] hover:bg-[var(--n3)] hover:text-foreground",
        (disabled || control.options.length === 0) && "opacity-60"
      )}
    >
      <span className="sr-only">{control.label}</span>
      {leading}
      <span aria-hidden="true" className="min-w-0 truncate">
        {current?.label ?? "—"}
      </span>
      <select
        id={id}
        data-control-id={control.id}
        value={control.value ?? ""}
        disabled={disabled || control.options.length === 0}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
      >
        {control.value === undefined ? <option value="">—</option> : null}
        {control.options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <RiArrowDownSLine
        aria-hidden="true"
        className="pointer-events-none absolute right-1.5 size-3.5 text-[var(--n5)] group-hover/control:text-[var(--n6)]"
      />
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
  useEffect(() => {
    document
      .getElementById(`${id}-${active}`)
      ?.scrollIntoView?.({ block: "nearest" })
  }, [id, active])

  return (
    <div
      className="absolute inset-x-0 bottom-full z-20 mb-2 max-h-72 animate-rise overflow-auto rounded-xl border border-[var(--line-strong)] bg-popover p-1 shadow-pop"
      data-testid={`${label}-picker`}
    >
      {items.length === 0 ? (
        <p className="px-3 py-2 text-ui text-muted-foreground">{empty}</p>
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
              className={cn(
                "flex cursor-pointer items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-ui",
                index === active
                  ? "bg-accent-subtle text-foreground"
                  : "text-[var(--n7)]"
              )}
            >
              <span className="max-w-[16rem] shrink-0 truncate font-mono text-[0.8125rem] font-medium">
                {item.label}
              </span>
              {item.badge ? (
                <span className="shrink-0 rounded-full bg-[var(--n3)] px-1.5 text-[0.6875rem] text-muted-foreground">
                  {item.badge}
                </span>
              ) : null}
              {item.detail ? (
                <span className="min-w-0 truncate text-small text-muted-foreground">
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
  placeholder,
  autoFocus,
  className,
  toolbarStart,
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
    if (event.nativeEvent.isComposing) return
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
    } else if (
      (event.key === "Enter" && !event.shiftKey) ||
      event.key === "Tab"
    ) {
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

  const harness = view.instance

  return (
    <form className={cn("flex flex-col gap-2", className)} onSubmit={submit}>
      {view.blockedReason ? (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-warn/25 bg-warn/8 px-3 py-2 text-ui text-warn"
        >
          {view.blockedReason}
        </p>
      ) : null}

      <div className="relative rounded-2xl border border-[var(--line-strong)] bg-[var(--n2)] shadow-card transition-[border-color,box-shadow] duration-[var(--dur-base)] focus-within:border-[var(--accent-dim)] focus-within:shadow-[0_0_0_4px_var(--accent-glow)]">
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
        <label htmlFor={messageId} className="sr-only">
          Message
        </label>
        <textarea
          ref={textareaRef}
          id={messageId}
          rows={2}
          value={content}
          autoFocus={autoFocus}
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
              ? (placeholder ??
                "Ask for a change, a fix, or a plan… / for commands, @ for files")
              : "Pick a ready harness and model to start typing."
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
          onKeyDown={(event) => {
            onKeyDown(event)
            if (event.defaultPrevented || event.nativeEvent.isComposing) return
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
          className="block field-sizing-content max-h-[40vh] min-h-16 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-body leading-relaxed text-foreground outline-none placeholder:text-[var(--n5)] disabled:cursor-not-allowed disabled:opacity-60"
        />
        <div className="flex flex-wrap items-center gap-1 px-2 pt-1 pb-2">
          {toolbarStart}
          {view.controls.map((control) => (
            <ControlSelect
              key={control.id}
              control={control}
              disabled={disabled}
              leading={
                control.id === "instance" && harness ? (
                  <HarnessMark
                    src={harnessMarkFor(harness.driver)}
                    name={harness.displayName ?? harness.instanceId}
                    size={14}
                    decorative
                  />
                ) : undefined
              }
              onChange={(value) =>
                setDraft((current) =>
                  applyComposerChange(current, control.id, value)
                )
              }
            />
          ))}
          <div className="ml-auto flex items-center gap-1.5 pl-2">
            <span className="hidden items-center gap-1 text-small text-[var(--n5)] lg:flex">
              <Kbd>⌘</Kbd>
              <Kbd>↵</Kbd>
            </span>
            {onSteer ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!canSteer}
                title="Send queues a new turn; steer adds this to the one running now."
                onClick={steer}
              >
                <RiCornerDownRightLine
                  data-icon="inline-start"
                  aria-hidden="true"
                />
                Steer current turn
              </Button>
            ) : null}
            <Button
              type="submit"
              size="icon"
              aria-label="Send"
              disabled={!canSend}
              className="rounded-full"
            >
              <RiArrowUpLine aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
      {parsed.invocation ? (
        <p
          className="px-2 text-small text-muted-foreground"
          data-testid="invocation-hint"
        >
          Runs the {parsed.invocation.kind}{" "}
          <span className="font-mono text-accent-ink">
            /{parsed.invocation.name}
          </span>
          {parsed.content ? " with the rest as its arguments" : ""}.
        </p>
      ) : null}
    </form>
  )
}
