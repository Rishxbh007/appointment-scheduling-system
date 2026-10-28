import * as React from "react";
import { cn } from "@/lib/utils";

/* Appointment-status badge — API unchanged (status string + className).
 * Tones now come from the design-system status tokens; the values match
 * the old literal colours, so dashboards look identical. Unknown
 * statuses keep the neutral fallback. */
const tones: Record<string, string> = {
  Booked: "bg-info-soft text-info-strong",
  Confirmed: "bg-success-soft text-success-strong",
  Cancelled: "bg-danger-soft text-danger-strong",
  Completed: "bg-neutral-soft text-neutral-strong",
};

export function Badge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        tones[status] ?? "bg-neutral-faint text-neutral-strong",
        className,
      )}
    >
      {status}
    </span>
  );
}
