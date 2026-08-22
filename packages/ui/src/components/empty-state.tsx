import { cn } from "@workspace/ui/lib/utils"

function EmptyState({
  title,
  description,
  icon,
  className,
  children,
  ...props
}: {
  title: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
} & Omit<React.ComponentProps<"div">, "title">) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-10 text-center",
        className
      )}
      {...props}
    >
      {icon ? (
        <span className="mb-1 text-[var(--n4)] [&_svg:not([class*='size-'])]:size-6">
          {icon}
        </span>
      ) : null}
      <p className="text-ui font-medium text-foreground">{title}</p>
      {description ? (
        <p className="max-w-xs text-small text-muted-foreground">
          {description}
        </p>
      ) : null}
      {children}
    </div>
  )
}

export { EmptyState }
