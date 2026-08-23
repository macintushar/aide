import { cn } from "@workspace/ui/lib/utils"

import { inputClassName } from "@workspace/ui/components/input"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        inputClassName,
        "field-sizing-content h-auto resize-none py-2 leading-[1.55]",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
