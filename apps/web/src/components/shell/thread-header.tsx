import {
  RiArrowRightSLine,
  RiLayoutLeftLine,
  RiLayoutRightLine,
} from "@remixicon/react"
import { IconButton } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

/**
 * The project and editable session title form a breadcrumb; actions stay at
 * the far end.
 */
export function ThreadHeader({
  sidebarOpen,
  onToggleSidebar,
  panelOpen,
  onTogglePanel,
  title,
  meta,
  status,
  actions,
}: {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  panelOpen: boolean
  onTogglePanel: () => void
  title: React.ReactNode
  meta?: React.ReactNode
  /** Live state of what the header names, shown beside the title. */
  status?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <header className="flex h-13 shrink-0 items-center gap-2 border-b border-[var(--line)] px-2.5">
      <IconButton
        type="button"
        variant="ghost"
        size="icon-sm"
        label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        aria-pressed={sidebarOpen}
        onClick={onToggleSidebar}
      >
        <RiLayoutLeftLine aria-hidden="true" />
      </IconButton>

      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {meta}
        {title}
        {status ? (
          <div className="ml-1.5 shrink-0 max-sm:hidden">{status}</div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {actions}
        <IconButton
          type="button"
          variant="ghost"
          size="icon-sm"
          label={panelOpen ? "Hide panel" : "Show panel"}
          aria-pressed={panelOpen}
          onClick={onTogglePanel}
        >
          <RiLayoutRightLine aria-hidden="true" />
        </IconButton>
      </div>
    </header>
  )
}

export function ThreadTitle({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <h1
      className={cn(
        "truncate text-ui font-semibold tracking-[-0.005em] text-foreground",
        className
      )}
    >
      {children}
    </h1>
  )
}

/** The project segment of the header breadcrumb. */
export function ThreadMeta({
  icon,
  children,
}: {
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <span className="flex max-w-48 min-w-0 items-center gap-1.5 text-ui text-[var(--n5)] max-sm:hidden">
      {icon}
      <span className="truncate">{children}</span>
      <RiArrowRightSLine
        className="size-3.5 shrink-0 text-[var(--n4)]"
        aria-hidden="true"
      />
    </span>
  )
}
