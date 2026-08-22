import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@workspace/ui/lib/utils"

const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-label whitespace-nowrap [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3",
  {
    variants: {
      tone: {
        neutral: "bg-[var(--n2)] text-[var(--n6)]",
        accent: "bg-accent-subtle text-primary",
        ok: "bg-ok/12 text-ok",
        warn: "bg-warn/12 text-warn",
        danger: "bg-danger/12 text-danger",
        outline: "border border-border text-[var(--n6)]",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  }
)

function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ tone, className }))}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
