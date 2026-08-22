import { RiArrowDownSLine, RiSearchLine } from "@remixicon/react"
import type { ExecutionSelection, HarnessModel } from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { HarnessMark } from "@workspace/ui/components/harness-mark"
import { Input } from "@workspace/ui/components/input"
import { Kbd } from "@workspace/ui/components/kbd"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { useId, useMemo, useState, type KeyboardEvent } from "react"

import { harnessMarkFor } from "@/features/instances"

import { findInstance, findModel, type PickableInstance } from "./selection"

type Row = { instance: PickableInstance; model: HarnessModel }

/**
 * Instance and model are distinct concepts (PLAN.md), but a user picks them in
 * one motion: the rail chooses the instance, the list chooses its model. Both
 * come from adapter-reported inventory — nothing here is hardcoded per driver.
 */
export function HarnessPicker({
  instances,
  selection,
  disabled,
  onSelect,
}: {
  instances: PickableInstance[]
  selection?: ExecutionSelection
  disabled?: boolean
  onSelect: (instance: PickableInstance, model: HarnessModel) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [railInstanceId, setRailInstanceId] = useState<string | undefined>(
    selection?.instanceId
  )
  const [highlighted, setHighlighted] = useState(0)
  const listId = useId()

  const selectedInstance = findInstance(instances, selection?.instanceId)
  const selectedModel = findModel(selectedInstance, selection?.model)
  const railInstance =
    findInstance(instances, railInstanceId ?? selection?.instanceId) ??
    instances[0]

  const needle = query.trim().toLowerCase()
  const rows = useMemo<Row[]>(() => {
    const source = needle
      ? instances
      : railInstance
        ? [railInstance]
        : instances
    return source.flatMap((instance) =>
      instance.models
        .filter(
          (model) =>
            !needle ||
            `${model.displayName} ${model.modelId} ${instance.entry.displayName ?? instance.entry.instanceId}`
              .toLowerCase()
              .includes(needle)
        )
        .map((model) => ({ instance, model }))
    )
  }, [instances, needle, railInstance])

  function commit(row: Row | undefined) {
    if (!row || row.instance.blockedReason) return
    onSelect(row.instance, row.model)
    setOpen(false)
    setQuery("")
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setHighlighted((current) => Math.min(current + 1, rows.length - 1))
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      setHighlighted((current) => Math.max(current - 1, 0))
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      commit(rows[highlighted])
      return
    }
    if ((event.metaKey || event.ctrlKey) && /^[1-9]$/.test(event.key)) {
      event.preventDefault()
      commit(rows[Number(event.key) - 1])
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setQuery("")
          setHighlighted(0)
          setRailInstanceId(selection?.instanceId)
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || instances.length === 0}
            className="gap-1.5"
          />
        }
      >
        {selectedInstance ? (
          <HarnessMark
            src={harnessMarkFor(selectedInstance.entry.driver)}
            name={selectedInstance.entry.driver}
            size={14}
            decorative
          />
        ) : null}
        <span className="truncate">
          {selectedModel?.displayName ?? "Choose a model"}
        </span>
        <RiArrowDownSLine
          className="size-3.5 text-[var(--n5)]"
          aria-hidden="true"
        />
      </PopoverTrigger>

      <PopoverContent className="flex h-80 w-[26rem]">
        <div
          role="tablist"
          aria-label="Harness instances"
          aria-orientation="vertical"
          className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-[var(--n1)] py-2"
        >
          {instances.map((instance) => (
            <InstanceTab
              key={instance.entry.instanceId}
              instance={instance}
              active={
                instance.entry.instanceId === railInstance?.entry.instanceId
              }
              onSelect={() => {
                setRailInstanceId(instance.entry.instanceId)
                setQuery("")
                setHighlighted(0)
              }}
            />
          ))}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative border-b border-border p-2">
            <RiSearchLine
              className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-[var(--n5)]"
              aria-hidden="true"
            />
            <Input
              autoFocus
              value={query}
              aria-label="Search models"
              aria-controls={listId}
              aria-activedescendant={
                rows[highlighted] ? rowId(listId, highlighted) : undefined
              }
              placeholder="Search models…"
              className="border-0 bg-transparent pl-7 focus-visible:ring-0"
              onKeyDown={onKeyDown}
              onChange={(event) => {
                setQuery(event.target.value)
                setHighlighted(0)
              }}
            />
          </div>

          <ul
            id={listId}
            role="listbox"
            aria-label="Models"
            className="flex-1 overflow-y-auto p-1"
          >
            {rows.length === 0 ? (
              <li className="px-2 py-6 text-center text-small text-muted-foreground">
                {instances.length === 0
                  ? "No harness has reported an inventory yet."
                  : "No model matches that search."}
              </li>
            ) : (
              rows.map((row, index) => (
                <ModelRow
                  key={`${row.instance.entry.instanceId}:${row.model.providerId ?? ""}:${row.model.modelId}`}
                  id={rowId(listId, index)}
                  row={row}
                  shortcut={index < 9 ? index + 1 : undefined}
                  highlighted={index === highlighted}
                  selected={
                    row.instance.entry.instanceId === selection?.instanceId &&
                    row.model.modelId === selection.model.modelId
                  }
                  showInstance={Boolean(needle)}
                  onHighlight={() => setHighlighted(index)}
                  onSelect={() => commit(row)}
                />
              ))
            )}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function rowId(listId: string, index: number) {
  return `${listId}-row-${index}`
}

function InstanceTab({
  instance,
  active,
  onSelect,
}: {
  instance: PickableInstance
  active: boolean
  onSelect: () => void
}) {
  const name = instance.entry.displayName ?? instance.entry.instanceId

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={name}
            onClick={onSelect}
            className={cn(
              "grid size-8 place-items-center rounded-md transition-colors duration-[var(--dur-fast)] outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
              active ? "bg-accent-subtle" : "hover:bg-[var(--n2)]"
            )}
          />
        }
      >
        <HarnessMark
          src={harnessMarkFor(instance.entry.driver)}
          name={name}
          size={18}
          muted={Boolean(instance.blockedReason)}
          decorative
        />
      </TooltipTrigger>
      <TooltipContent side="right">
        <span className="flex flex-col">
          <span>{name}</span>
          {instance.blockedReason ? (
            <span className="text-[var(--n5)]">{instance.blockedReason}</span>
          ) : null}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

function ModelRow({
  id,
  row,
  shortcut,
  highlighted,
  selected,
  showInstance,
  onHighlight,
  onSelect,
}: {
  id: string
  row: Row
  shortcut?: number
  highlighted: boolean
  selected: boolean
  showInstance: boolean
  onHighlight: () => void
  onSelect: () => void
}) {
  const blocked = Boolean(row.instance.blockedReason)
  const instanceName =
    row.instance.entry.displayName ?? row.instance.entry.instanceId

  return (
    <li id={id} role="option" aria-selected={selected}>
      <button
        type="button"
        disabled={blocked}
        onMouseEnter={onHighlight}
        onClick={onSelect}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none",
          highlighted && !blocked && "bg-[var(--n3)]",
          blocked && "cursor-not-allowed opacity-45"
        )}
      >
        <HarnessMark
          src={harnessMarkFor(row.instance.entry.driver)}
          name={row.instance.entry.driver}
          size={16}
          decorative
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn(
              "truncate text-ui",
              selected ? "text-primary" : "text-foreground"
            )}
          >
            {row.model.displayName}
          </span>
          <span className="truncate text-small text-muted-foreground">
            {showInstance ? instanceName : row.instance.entry.driver}
            {row.instance.blockedReason
              ? ` · ${row.instance.blockedReason}`
              : null}
          </span>
        </span>
        {shortcut ? <Kbd>⌘{shortcut}</Kbd> : null}
      </button>
    </li>
  )
}
