import * as React from "react";
import { cn } from "@/lib/utils";

const tones: Record<string, string> = {
  Booked: "bg-blue-100 text-blue-800",
  Confirmed: "bg-green-100 text-green-800",
  Cancelled: "bg-red-100 text-red-800",
  Completed: "bg-slate-200 text-slate-800",
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
        tones[status] ?? "bg-slate-100 text-slate-800",
        className,
      )}
    >
      {status}
    </span>
  );
}
