import { RiLayoutLeftLine, RiLayoutRightLine } from "@remixicon/react"
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
  actions,
}: {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  panelOpen: boolean
  onTogglePanel: () => void
  title: React.ReactNode
  meta?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2">
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

      <div className="flex min-w-0 flex-1 items-center gap-2">
        {meta}
        {title}
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
      className={cn("truncate text-ui font-medium text-foreground", className)}
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
    <span className="flex max-w-48 min-w-0 items-center gap-1.5 text-ui text-muted-foreground">
      {icon}
      <span className="truncate">{children}</span>
      <span className="shrink-0" aria-hidden="true">
        /
      </span>
    </span>
  )
}
