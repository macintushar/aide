import { RiCornerDownLeftLine, RiSearchLine } from "@remixicon/react"
import { Kbd } from "@workspace/ui/components/kbd"
import { cn } from "@workspace/ui/lib/utils"
import { useEffect, useId, useMemo, useRef, useState } from "react"

export type PaletteItem = {
  id: string
  group: string
  label: string
  /** Secondary text matched alongside the label. */
  detail?: string
  icon?: React.ReactNode
  /** Right-aligned hint, such as a status or shortcut. */
  hint?: React.ReactNode
  run: () => void
}

/** Every query word must appear somewhere in the label or detail. */
export function matchesQuery(item: PaletteItem, query: string): boolean {
  const haystack =
    `${item.label} ${item.detail ?? ""} ${item.group}`.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}

/**
 * ⌘K: jump to any session or run any app action from the keyboard. The input
 * keeps focus; arrows move the highlight and Enter runs it.
 */
export function CommandPalette({
  items,
  onClose,
  openById,
}: {
  items: PaletteItem[]
  onClose: () => void
  /** Builds an "open this id" entry when the query looks like a session id. */
  openById?: (id: string) => PaletteItem
}) {
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()

  const results = useMemo(() => {
    const trimmed = query.trim()
    if (!trimmed) return items
    const matches = items.filter((item) => matchesQuery(item, trimmed))
    const exact = items.some((item) => item.id === trimmed)
    return openById && /^session_\S+$/.test(trimmed) && !exact
      ? [openById(trimmed), ...matches]
      : matches
  }, [items, openById, query])
  const activeIndex = Math.min(active, Math.max(results.length - 1, 0))

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    input.current?.focus()
    return () => previous?.focus?.()
  }, [])

  useEffect(() => {
    document
      .getElementById(`${listId}-${activeIndex}`)
      ?.scrollIntoView?.({ block: "nearest" })
  }, [activeIndex, listId])

  function run(item: PaletteItem | undefined) {
    if (!item) return
    onClose()
    item.run()
  }

  let lastGroup: string | undefined

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="flex max-h-[min(32rem,70vh)] w-full max-w-xl animate-rise flex-col overflow-hidden rounded-2xl border border-[var(--line-strong)] bg-[var(--n2)] shadow-pop"
      >
        <div className="flex items-center gap-3 border-b border-[var(--line)] px-4">
          <RiSearchLine
            className="size-4 shrink-0 text-[var(--n5)]"
            aria-hidden="true"
          />
          <input
            ref={input}
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={
              results.length > 0 ? `${listId}-${activeIndex}` : undefined
            }
            aria-label="Search sessions and actions"
            placeholder="Search sessions and actions…"
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault()
                setActive((activeIndex + 1) % Math.max(results.length, 1))
              } else if (event.key === "ArrowUp") {
                event.preventDefault()
                setActive(
                  (activeIndex - 1 + results.length) %
                    Math.max(results.length, 1)
                )
              } else if (event.key === "Enter") {
                event.preventDefault()
                run(results[activeIndex])
              } else if (event.key === "Escape") {
                event.preventDefault()
                onClose()
              }
            }}
            className="h-13 min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-[var(--n5)]"
          />
          <Kbd>esc</Kbd>
        </div>
        <ul
          id={listId}
          role="listbox"
          aria-label="Results"
          className="min-h-0 flex-1 overflow-auto p-1.5"
        >
          {results.length === 0 ? (
            <li className="px-3 py-8 text-center text-ui text-[var(--n5)]">
              Nothing matches “{query}”.
            </li>
          ) : (
            results.map((item, index) => {
              const header = item.group !== lastGroup ? item.group : undefined
              lastGroup = item.group
              return (
                <li key={item.id} role="presentation">
                  {header ? (
                    <p
                      role="presentation"
                      className="px-2.5 pt-2.5 pb-1 text-label text-[var(--n5)] uppercase"
                    >
                      {header}
                    </p>
                  ) : null}
                  <div
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseMove={() => setActive(index)}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      run(item)
                    }}
                    className={cn(
                      "flex h-10 cursor-pointer items-center gap-3 rounded-lg px-2.5 text-ui",
                      index === activeIndex
                        ? "bg-[var(--n3)] text-foreground"
                        : "text-[var(--n7)]"
                    )}
                  >
                    <span className="flex size-4 shrink-0 items-center justify-center text-[var(--n6)]">
                      {item.icon}
                    </span>
                    <span className="min-w-0 truncate">{item.label}</span>
                    {item.detail ? (
                      <span className="min-w-0 flex-1 truncate text-small text-[var(--n5)]">
                        {item.detail}
                      </span>
                    ) : (
                      <span className="flex-1" />
                    )}
                    {item.hint ? (
                      <span className="shrink-0 text-small text-[var(--n5)]">
                        {item.hint}
                      </span>
                    ) : null}
                    {index === activeIndex ? (
                      <RiCornerDownLeftLine
                        className="size-3.5 shrink-0 text-[var(--n5)]"
                        aria-hidden="true"
                      />
                    ) : null}
                  </div>
                </li>
              )
            })
          )}
        </ul>
      </div>
    </div>
  )
}
