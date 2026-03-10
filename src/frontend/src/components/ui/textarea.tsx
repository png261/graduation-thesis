import * as React from "react";

import { cn } from "../../lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-md border border-[var(--da-border)] bg-[var(--da-panel)] px-3 py-2 text-sm text-[var(--da-text)] placeholder:text-[var(--da-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--da-accent)]/60 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
