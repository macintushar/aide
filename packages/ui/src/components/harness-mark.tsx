import { cn } from "@workspace/ui/lib/utils"

/**
 * A harness is identified by its own mark and name, nothing else (DESIGN §4).
 * The mark ships as the vendor published it — never recoloured, tinted, or
 * outlined — so it renders as an image rather than an inline, styleable SVG.
 * Disabled or unconfigured instances drop to 45% opacity; the colour never
 * changes.
 */
export function HarnessMark({
  src,
  name,
  size = 16,
  muted,
  decorative = false,
  className,
  ...props
}: {
  src: string
  name: string
  size?: number
  muted?: boolean
  /** Set when the name is already adjacent, so the mark repeats nothing. */
  decorative?: boolean
} & Omit<React.ComponentProps<"img">, "src" | "alt" | "width" | "height">) {
  return (
    <img
      data-slot="harness-mark"
      src={src}
      alt={decorative ? "" : name}
      aria-hidden={decorative || undefined}
      width={size}
      height={size}
      className={cn(
        "shrink-0 object-contain",
        muted && "opacity-45",
        className
      )}
      {...props}
    />
  )
}
