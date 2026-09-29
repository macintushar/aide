import { RiCloseLine } from "@remixicon/react"
import { IconButton } from "@workspace/ui/components/button"
import { useEffect, useId, useRef } from "react"

/**
 * A plain modal dialog: an overlay, a titled panel, Escape and the close
 * button dismiss it, and focus moves into it when it opens.
 */
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      previous?.focus?.()
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex max-h-[85vh] w-full flex-col rounded-2xl border border-border bg-background shadow-xl outline-none ${
          wide ? "max-w-4xl" : "max-w-md"
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <h2 id={titleId} className="truncate text-ui font-medium">
            {title}
          </h2>
          <IconButton
            type="button"
            variant="ghost"
            size="icon-sm"
            label="Close"
            onClick={onClose}
          >
            <RiCloseLine aria-hidden="true" />
          </IconButton>
        </div>
        <div className="min-h-0 overflow-auto p-4">{children}</div>
      </div>
    </div>
  )
}
