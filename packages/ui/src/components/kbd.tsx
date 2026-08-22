import { cn } from "@workspace/ui/lib/utils"

/** Keyboard hint. Sans, not mono — §3.4 keeps mono for machine-issued text. */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-sm border border-border bg-[var(--n2)] px-1 text-label font-medium tracking-normal text-[var(--n5)]",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
