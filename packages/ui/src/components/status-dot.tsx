import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@workspace/ui/lib/utils"

const statusDotVariants = cva("inline-block size-2 shrink-0 rounded-full", {
  variants: {
    tone: {
      idle: "bg-[var(--n4)]",
      quiet: "bg-[var(--n5)]",
      accent: "bg-primary",
      ok: "bg-ok",
      warn: "bg-warn",
      danger: "bg-danger",
    },
    /**
     * The only looping animation in the app (§7). Reduced motion drops it to a
     * static fill rather than removing the signal.
     */
    pulse: {
      true: "animate-pulse-dot motion-reduce:animate-none",
      false: "",
    },
  },
  defaultVariants: {
    tone: "idle",
    pulse: false,
  },
})

function StatusDot({
  className,
  tone,
  pulse,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof statusDotVariants>) {
  return (
    <span
      data-slot="status-dot"
      aria-hidden="true"
      className={cn(statusDotVariants({ tone, pulse, className }))}
      {...props}
    />
  )
}

export { StatusDot, statusDotVariants }
