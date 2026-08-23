import { RiCloseLine, RiLayoutRightLine } from "@remixicon/react"
import { IconButton } from "@workspace/ui/components/button"
import { Kbd } from "@workspace/ui/components/kbd"
import { ScrollArea } from "@workspace/ui/components/scroll-area"

import {
  SURFACES,
  findSurface,
  type SurfaceDefinition,
  type SurfaceId,
} from "@/components/shell/surfaces"

export function SurfacePanel({
  surface,
  onOpenSurface,
  onCloseSurface,
  onClosePanel,
  children,
}: {
  surface: SurfaceId | null
  onOpenSurface: (surface: SurfaceId) => void
  onCloseSurface: () => void
  onClosePanel: () => void
  children?: React.ReactNode
}) {
  const active = surface ? findSurface(surface) : undefined

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border pr-2 pl-3">
        {active ? (
          <>
            <div className="flex min-w-0 items-center gap-2">
              <active.icon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="truncate text-ui font-medium">
                {active.label}
              </span>
            </div>
            <IconButton
              type="button"
              variant="ghost"
              size="icon-sm"
              label="Close surface"
              onClick={onCloseSurface}
            >
              <RiCloseLine aria-hidden="true" />
            </IconButton>
          </>
        ) : (
          <>
            <span className="text-label text-muted-foreground uppercase">
              Panel
            </span>
            <IconButton
              type="button"
              variant="ghost"
              size="icon-sm"
              label="Hide panel"
              onClick={onClosePanel}
            >
              <RiLayoutRightLine aria-hidden="true" />
            </IconButton>
          </>
        )}
      </header>

      {active ? (
        <ScrollArea className="flex-1">
          <div className="p-3">{children}</div>
        </ScrollArea>
      ) : (
        <SurfaceChooser onOpenSurface={onOpenSurface} />
      )}
    </div>
  )
}

function SurfaceChooser({
  onOpenSurface,
}: {
  onOpenSurface: (surface: SurfaceId) => void
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 p-4">
      <div className="text-center">
        <p className="text-ui font-medium">Open a surface</p>
        <p className="mt-1 text-small text-muted-foreground">
          Choose what to show beside the session.
        </p>
      </div>
      <div className="grid gap-2">
        {SURFACES.map((surface) => (
          <SurfaceTile
            key={surface.id}
            surface={surface}
            onSelect={() => onOpenSurface(surface.id)}
          />
        ))}
      </div>
    </div>
  )
}

function SurfaceTile({
  surface,
  onSelect,
}: {
  surface: SurfaceDefinition
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      disabled={!surface.available}
      onClick={onSelect}
      className="group rounded-lg border border-border bg-card p-3 text-left transition-colors duration-[var(--dur-fast)] outline-none hover:bg-[var(--n2)] focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-45"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-ui font-medium">
          <surface.icon
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          {surface.label}
        </span>
        {surface.available ? <Kbd>{surface.shortcut.toUpperCase()}</Kbd> : null}
      </div>
      <p className="mt-1 text-small text-muted-foreground">
        {surface.available
          ? surface.description
          : (surface.unavailableReason ?? surface.description)}
      </p>
    </button>
  )
}
