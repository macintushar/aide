import { useId } from "react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * The Caret-A mark (DESIGN.md §8). Stroke thickens as the mark shrinks and the
 * legs pull inward to hold the counter open — optical compensation, not
 * scaling, so each size is a discrete drawing.
 */
const MARK_GEOMETRY = {
  16: { legs: "M6.5 26 L16 6.5 L25.5 26", bar: "M11.5 19 H20.5", stroke: 4.2 },
  20: { legs: "M6 26 L16 6 L26 26", bar: "M11 19 H21", stroke: 3.6 },
  32: { legs: "M6 26 L16 6 L26 26", bar: "M11 19 H21", stroke: 3.2 },
} as const

export type MarkSize = keyof typeof MARK_GEOMETRY

function opticalSize(size: number): MarkSize {
  if (size < 18) return 16
  if (size < 26) return 20
  return 32
}

export function AideMark({
  size = 32,
  className,
  ...props
}: { size?: number } & React.ComponentProps<"svg">) {
  const geometry = MARK_GEOMETRY[opticalSize(size)]

  return (
    <svg
      data-slot="aide-mark"
      viewBox="0 0 32 32"
      fill="none"
      width={size}
      height={size}
      role="img"
      aria-label="aide"
      className={cn("shrink-0", className)}
      {...props}
    >
      <path
        d={geometry.legs}
        className="stroke-[var(--n8)]"
        strokeWidth={geometry.stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={geometry.bar}
        className="stroke-[var(--accent-base)] light:stroke-[var(--accent-dim)]"
        strokeWidth={geometry.stroke}
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Caret-A knocked out of an accent gradient — dock, favicon, avatar slots. */
export function AideTile({
  size = 32,
  className,
  ...props
}: { size?: number } & React.ComponentProps<"svg">) {
  const gradientId = useId()

  return (
    <svg
      data-slot="aide-tile"
      viewBox="0 0 64 64"
      fill="none"
      width={size}
      height={size}
      role="img"
      aria-label="aide"
      className={cn("shrink-0", className)}
      {...props}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="64" y2="64">
          <stop offset="0" stopColor="oklch(0.8 0.13 200)" />
          <stop offset="1" stopColor="oklch(0.6 0.13 210)" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${gradientId})`} />
      <path
        d="M12 52 L32 12 L52 52"
        className="stroke-[var(--accent-fg)]"
        strokeWidth="6.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M22 38 H42"
        className="stroke-[var(--accent-fg)]"
        strokeWidth="6.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Lowercase always, in every context (§1). */
export function AideWordmark({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="aide-wordmark"
      className={cn(
        "font-semibold tracking-[-0.035em] text-[var(--n8)]",
        className
      )}
      {...props}
    >
      aide
    </span>
  )
}

/** Mark + wordmark. Gap is the mark's stroke width × 3 (§8.5). */
export function AideLockup({
  size = 20,
  className,
  ...props
}: { size?: number } & React.ComponentProps<"div">) {
  const gap = MARK_GEOMETRY[opticalSize(size)].stroke * 3

  return (
    <div
      data-slot="aide-lockup"
      className={cn("flex items-center", className)}
      style={{ gap: `${gap}px` }}
      {...props}
    >
      <AideMark size={size} aria-hidden="true" />
      <AideWordmark style={{ fontSize: `${size * 0.9}px` }} />
    </div>
  )
}
