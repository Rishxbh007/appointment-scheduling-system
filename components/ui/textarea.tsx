import * as React from "react";
import { cn } from "@/lib/utils";

/* Textarea — API unchanged. Same Task 2 treatment as Input: rounded-xl,
 * token colours, keyboard-only brand-teal focus ring. */
export type TextareaProps =
  React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
