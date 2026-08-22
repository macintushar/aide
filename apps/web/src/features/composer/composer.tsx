import { RiSendPlaneFill } from "@remixicon/react"
import type {
  ConfigDefaults,
  ExecutionSelection,
  ResolvedExecution,
} from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { Kbd } from "@workspace/ui/components/kbd"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Textarea } from "@workspace/ui/components/textarea"
import { useMemo, useState, type KeyboardEvent } from "react"

import { useInstances } from "@/features/instances"

import { HarnessPicker } from "./harness-picker"
import {
  agentsFor,
  findInstance,
  findModel,
  interactionModesFor,
  pickableInstances,
  resolveInitialSelection,
  selectAgent,
  selectInteractionMode,
  selectModel,
  selectOption,
} from "./selection"

/**
 * The composer's controls are capability-driven: the adapter reports which
 * controls exist and what values they take, and this renders exactly those.
 * Adding an option to a harness needs no change here.
 */
export function Composer({
  execution,
  pending,
  projectDefaults,
  userDefaults,
  onSend,
}: {
  execution?: ResolvedExecution
  pending: boolean
  /** Precedence levels 3 and 4; absent until config is read into the shell. */
  projectDefaults?: ConfigDefaults
  userDefaults?: ConfigDefaults
  onSend: (content: string, selection: ExecutionSelection) => void
}) {
  const { state } = useInstances()
  const [content, setContent] = useState("")
  const [draft, setDraft] = useState<ExecutionSelection>()

  const instances = useMemo(
    () => pickableInstances(state.instances),
    [state.instances]
  )

  const resolved = useMemo(
    () =>
      resolveInitialSelection({
        instances,
        lastSent: execution?.selection,
        projectDefaults,
        userDefaults,
      }),
    [execution?.selection, instances, projectDefaults, userDefaults]
  )

  // Level 1 of the precedence list: whatever the user last picked here wins,
  // and it never rewrites a message already sent.
  const selection = draft ?? resolved
  const instance = findInstance(instances, selection?.instanceId)
  const model = findModel(instance, selection?.model)
  const blockedReason = instance?.blockedReason
  const ready = Boolean(selection) && !blockedReason && !pending
  const canSend = ready && content.trim().length > 0

  function submit() {
    if (!canSend || !selection) return
    onSend(content.trim(), selection)
    setContent("")
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return
    event.preventDefault()
    submit()
  }

  const agents = instance && model ? agentsFor(instance, model) : []
  const modes = instance ? interactionModesFor(instance) : []

  return (
    <form
      className="shrink-0 px-4 pt-2 pb-4"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-2 rounded-xl border border-border bg-card p-2 focus-within:border-[var(--line-strong)]">
        <label htmlFor="composer-input" className="sr-only">
          Message
        </label>
        <Textarea
          id="composer-input"
          rows={2}
          value={content}
          disabled={!ready}
          placeholder={
            selection
              ? "Continue this session…"
              : "Configure a harness instance to start sending."
          }
          className="max-h-64 min-h-16 border-0 bg-transparent px-2 text-body focus-visible:ring-0"
          onKeyDown={onKeyDown}
          onChange={(event) => setContent(event.target.value)}
        />

        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex min-w-0 flex-wrap items-center gap-0.5">
            <HarnessPicker
              instances={instances}
              selection={selection}
              disabled={pending}
              onSelect={(nextInstance, nextModel) =>
                setDraft(selectModel(selection, nextInstance, nextModel))
              }
            />

            {selection &&
            instance?.inventory.capabilities.agentSelection &&
            agents.length > 0 ? (
              <ControlSelect
                label="Agent"
                value={selection.agent}
                options={agents}
                disabled={pending}
                onChange={(value) => setDraft(selectAgent(selection, value))}
              />
            ) : null}

            {selection && modes.length > 0 ? (
              <ControlSelect
                label="Mode"
                value={selection.interactionMode}
                options={modes}
                disabled={pending}
                onChange={(value) =>
                  setDraft(selectInteractionMode(selection, value))
                }
              />
            ) : null}

            {selection && model
              ? model.optionDescriptors.map((descriptor) => (
                  <ControlSelect
                    key={descriptor.id}
                    label={descriptor.label}
                    value={selection.options[descriptor.id]}
                    options={descriptor.options}
                    disabled={pending}
                    onChange={(value) =>
                      setDraft(selectOption(selection, descriptor.id, value))
                    }
                  />
                ))
              : null}
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1 text-small text-muted-foreground sm:flex">
              <Kbd>↵</Kbd> to send
            </span>
            <Button
              type="submit"
              size="icon-sm"
              aria-label="Send message"
              disabled={!canSend}
            >
              <RiSendPlaneFill aria-hidden="true" />
            </Button>
          </div>
        </div>

        {blockedReason ? (
          <p role="status" className="px-1 text-small text-warn">
            {blockedReason}
          </p>
        ) : null}
      </div>
    </form>
  )
}

function ControlSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string
  value?: string
  options: { id: string; label: string }[]
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <Select
      value={value ?? null}
      disabled={disabled}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next)
      }}
    >
      <SelectTrigger aria-label={label} className="text-muted-foreground">
        <SelectValue placeholder={label}>
          {(current) =>
            options.find((option) => option.id === current)?.label ?? label
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
