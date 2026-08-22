import { cn } from "@workspace/ui/lib/utils"

export function Section({
  id,
  title,
  note,
  children,
}: {
  id: string
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-16 border-t border-border pt-8">
      <h2 className="text-h3">{title}</h2>
      {note ? (
        <p className="mt-1 max-w-2xl text-ui text-muted-foreground">{note}</p>
      ) : null}
      <div className="mt-5 flex flex-col gap-6">{children}</div>
    </section>
  )
}

export function Row({
  label,
  className,
  children,
}: {
  label?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      {label ? (
        <p className="text-label text-muted-foreground uppercase">{label}</p>
      ) : null}
      <div className={cn("flex flex-wrap items-center gap-3", className)}>
        {children}
      </div>
    </div>
  )
}

export function Frame({
  label,
  className,
  children,
}: {
  label?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      {label ? (
        <p className="text-label text-muted-foreground uppercase">{label}</p>
      ) : null}
      <div
        className={cn(
          "overflow-hidden rounded-xl border border-border bg-background",
          className
        )}
      >
        {children}
      </div>
    </div>
  )
}

export function Swatch({
  name,
  value,
  className,
}: {
  name: string
  value: string
  className?: string
}) {
  return (
    <div className="flex w-28 flex-col gap-1.5">
      <div
        className={cn("h-12 rounded-md border border-border", className)}
        style={{ background: `var(${value})` }}
      />
      <div className="flex flex-col">
        <span className="text-small font-medium">{name}</span>
        <span className="font-mono text-mono text-muted-foreground">
          {value}
        </span>
      </div>
    </div>
  )
}
