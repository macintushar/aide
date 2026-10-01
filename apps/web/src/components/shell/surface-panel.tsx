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
      <header className="flex h-13 shrink-0 items-center justify-between gap-2 border-b border-[var(--line)] pr-2.5 pl-4">
        {active ? (
          <>
            <div className="flex min-w-0 items-center gap-2">
              <active.icon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="truncate text-ui font-semibold">
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
            <span className="text-ui font-semibold">Panel</span>
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
          <div className="p-4">{children}</div>
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
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div>
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
      className="group rounded-xl border border-[var(--line)] bg-[var(--n2)] p-3.5 text-left shadow-card transition-colors duration-[var(--dur-fast)] outline-none hover:border-[var(--line-strong)] hover:bg-[var(--n3)] focus-visible:ring-3 focus-visible:ring-[var(--accent-glow)] disabled:pointer-events-none disabled:opacity-45"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-2 text-ui font-medium">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--n3)] text-[var(--n6)] group-hover:text-accent-ink">
            <surface.icon className="size-4" aria-hidden="true" />
          </span>
          <span className="flex flex-col gap-1">
            <span>{surface.label}</span>
            <span className="text-small font-normal text-muted-foreground">
              {surface.available
                ? surface.description
                : (surface.unavailableReason ?? surface.description)}
            </span>
          </span>
        </span>
        {surface.available ? <Kbd>{surface.shortcut.toUpperCase()}</Kbd> : null}
      </div>
    </button>
  )
}
