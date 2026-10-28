import * as React from "react";
import { cn } from "@/lib/utils";

/* Text input — API unchanged. Task 2 changes: rounded-xl (was rounded-md),
 * token colours, and a keyboard-only focus ring in brand teal (was a
 * slate ring on every focus, including mouse clicks). */
export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "flex h-10 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
