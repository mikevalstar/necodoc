import { cn } from "cn";
import * as React from "react";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-surface px-3 py-2.5 text-base transition-colors outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:bg-tint disabled:opacity-50 aria-invalid:border-bad aria-invalid:ring-2 aria-invalid:ring-bad/25 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
