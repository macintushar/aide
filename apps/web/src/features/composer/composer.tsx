import type { ExecutionSelection } from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import { useId, useState, type FormEvent } from "react"

import {
  applyComposerChange,
  resolveComposer,
  type ComposerControl,
  type ComposerDraft,
  type ComposerSources,
} from "./composer-state"

/**
 * The composer renders whatever the adapter described and nothing else.
 *
 * It iterates `view.controls` — it never names a control id, so a harness that
 * starts reporting a new option gets a working select here without a change to
 * this file.
 */

export type ComposerProps = {
  sources: ComposerSources
  disabled?: boolean
  onSend: (input: { content: string; execution: ExecutionSelection }) => void
}

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

export function Composer({ sources, disabled = false, onSend }: ComposerProps) {
  const [draft, setDraft] = useState<ComposerDraft>({})
  const [content, setContent] = useState("")
  const messageId = useId()

  const view = resolveComposer(sources, draft)
  const canSend =
    !disabled && view.selection !== undefined && content.trim().length > 0

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = content.trim()
    if (!trimmed || !view.selection) return
    setContent("")
    // The selection is captured here and travels with the message. Whatever the
    // composer shows afterwards has no bearing on what was already sent.
    onSend({ content: trimmed, execution: view.selection })
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
      <textarea
        id={messageId}
        rows={3}
        value={content}
        disabled={disabled || view.selection === undefined}
        placeholder={
          view.selection
            ? "Continue this session…"
            : "Send becomes available once an instance and model are selected."
        }
        onChange={(event) => setContent(event.target.value)}
        className="mt-2 w-full resize-y rounded-2xl border border-input bg-background px-4 py-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/30 disabled:opacity-60"
      />
      <Button type="submit" className="mt-3" disabled={!canSend}>
        Send
      </Button>
    </form>
  )
}
