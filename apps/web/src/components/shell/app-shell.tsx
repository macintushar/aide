import { cn } from "@workspace/ui/lib/utils"

/**
 * Three panes on one canvas: navigation on the outer frame, then the session
 * and its contextual surface on an inset work surface. Both side panes
 * collapse to zero width; below `md` they float over the surface instead and
 * a tap on the backdrop dismisses them.
 */
export function AppShell({
  sidebar,
  sidebarOpen,
  panel,
  panelOpen,
  onDismissSidebar,
  onDismissPanel,
  children,
}: {
  sidebar: React.ReactNode
  sidebarOpen: boolean
  panel: React.ReactNode
  panelOpen: boolean
  onDismissSidebar?: () => void
  onDismissPanel?: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex h-svh w-full overflow-hidden bg-frame text-foreground">
      {sidebarOpen && onDismissSidebar ? (
        <Backdrop onDismiss={onDismissSidebar} />
      ) : null}
      <Pane side="start" open={sidebarOpen} width="w-66" label="Navigation">
        {sidebar}
      </Pane>

      <div
        className={cn(
          "flex min-w-0 flex-1 py-2 pr-2 transition-[padding] duration-[var(--dur-slow)] ease-[var(--ease)] max-md:p-0",
          sidebarOpen ? "md:pl-0" : "pl-2"
        )}
      >
        <div className="flex min-w-0 flex-1 overflow-hidden rounded-xl border border-[var(--line)] bg-background shadow-card max-md:rounded-none max-md:border-0">
          <div className="flex min-w-0 flex-1 flex-col">{children}</div>

          {panelOpen && onDismissPanel ? (
            <Backdrop onDismiss={onDismissPanel} />
          ) : null}
          <Pane
            side="end"
            open={panelOpen}
            width="w-92"
            label="Workspace surface"
          >
            {panel}
          </Pane>
        </div>
      </div>
    </div>
  )
}

function Backdrop({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      aria-hidden="true"
      onClick={onDismiss}
      className="fixed inset-0 z-30 animate-in bg-black/50 fade-in md:hidden"
    />
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
        "shrink-0 overflow-hidden transition-[width] duration-[var(--dur-slow)] ease-[var(--ease)] data-[state=closed]:w-0 max-md:fixed max-md:inset-y-0 max-md:z-40 max-md:shadow-pop",
        side === "start"
          ? "bg-sidebar max-md:left-0 max-md:border-r max-md:border-[var(--line)]"
          : "border-l border-[var(--line)] bg-[var(--n1)] max-md:right-0",
        width
      )}
    >
      {/* Fixed inner width keeps the contents from reflowing while the pane animates. */}
      <div className={cn("flex h-full flex-col", width)}>{children}</div>
    </aside>
  )
}
