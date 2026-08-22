import { cn } from "@workspace/ui/lib/utils"

/**
 * Three panes on one canvas: navigation, the session, and a contextual
 * surface. Both side panes collapse to zero width; the session column is the
 * only thing that must always be present.
 */
export function AppShell({
  sidebar,
  sidebarOpen,
  panel,
  panelOpen,
  children,
}: {
  sidebar: React.ReactNode
  sidebarOpen: boolean
  panel: React.ReactNode
  panelOpen: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex h-svh w-full overflow-hidden bg-background text-foreground">
      <Pane side="start" open={sidebarOpen} width="w-68" label="Navigation">
        {sidebar}
      </Pane>

      <div className="flex min-w-0 flex-1 flex-col">{children}</div>

      <Pane side="end" open={panelOpen} width="w-90" label="Workspace surface">
        {panel}
      </Pane>
    </div>
  )
}

function Pane({
  side,
  open,
  width,
  label,
  children,
}: {
  side: "start" | "end"
  open: boolean
  width: string
  label: string
  children: React.ReactNode
}) {
  return (
    <aside
      aria-label={label}
      // Collapsed panes keep their box for the width transition, so they must
      // also leave the tab order and the accessibility tree.
      inert={!open}
      data-state={open ? "open" : "closed"}
      className={cn(
        "shrink-0 overflow-hidden bg-sidebar transition-[width] duration-[var(--dur-slow)] ease-[var(--ease)] data-[state=closed]:w-0",
        side === "start" ? "border-r border-border" : "border-l border-border",
        width
      )}
    >
      {/* Fixed inner width keeps the contents from reflowing while the pane animates. */}
      <div className={cn("flex h-full flex-col", width)}>{children}</div>
    </aside>
  )
}
