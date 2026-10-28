import * as React from "react";
import { cn } from "@/lib/utils";

/* Form label — API unchanged, colour now from the text token. */
export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

export function Label({ className, ...props }: LabelProps) {
  return (
    <label
      className={cn("text-sm font-medium text-ink", className)}
      {...props}
    />
  );
}
