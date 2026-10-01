import { cn } from "@workspace/ui/lib/utils"

/** Keyboard hint. Sans, not mono — §3.4 keeps mono for machine-issued text. */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-[var(--line-strong)] bg-[var(--n2)] px-1 font-sans text-[0.6875rem] font-medium tracking-normal text-[var(--n6)] shadow-[inset_0_-1px_0_0_var(--line-strong)]",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
