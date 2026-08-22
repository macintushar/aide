import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

import { cn } from "@workspace/ui/lib/utils"

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex min-h-0 flex-col", className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("flex items-center gap-1", className)}
      {...props}
    />
  )
}

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-ui text-muted-foreground transition-colors duration-[var(--dur-fast)] outline-none select-none hover:bg-[var(--n2)] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 data-[selected]:bg-[var(--n3)] data-[selected]:text-foreground data-[selected]:shadow-[inset_0_0_0_1px_var(--line-strong)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      className={cn("min-h-0 flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsPanel, TabsTab }
