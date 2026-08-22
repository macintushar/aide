import { cn } from "@workspace/ui/lib/utils"

/**
 * A streaming turn signals at the message end — three dots on the shared
 * pulse, staggered. The header stays quiet (§5: streaming is the only state
 * that animates).
 */
export function TypingIndicator({ className }: { className?: string }) {
  return (
    <p
      role="status"
      aria-label="Assistant is typing"
      className={cn("flex items-center gap-1.5 py-1", className)}
    >
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          aria-hidden="true"
          className="size-1.5 animate-pulse-dot rounded-full bg-[var(--n5)] motion-reduce:animate-none"
          style={{ animationDelay: `${dot * 180}ms` }}
        />
      ))}
    </p>
  )
}
