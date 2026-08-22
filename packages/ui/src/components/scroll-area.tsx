import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"

import { cn } from "@workspace/ui/lib/utils"

function ScrollArea({
  className,
  children,
  viewportRef,
  viewportProps,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  viewportRef?: React.Ref<HTMLDivElement>
  viewportProps?: ScrollAreaPrimitive.Viewport.Props
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative min-h-0", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        ref={viewportRef}
        {...viewportProps}
        className={cn(
          "size-full overscroll-contain outline-none focus-visible:ring-0",
          viewportProps?.className
        )}
      >
        <ScrollAreaPrimitive.Content className="min-w-0">
          {children}
        </ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className="m-0.5 flex w-1.5 justify-center opacity-0 transition-opacity delay-300 duration-[var(--dur-base)] data-[hovering]:opacity-100 data-[hovering]:delay-0 data-[scrolling]:opacity-100 data-[scrolling]:delay-0"
      >
        <ScrollAreaPrimitive.Thumb className="w-full rounded-full bg-[var(--n4)]" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

export { ScrollArea }
