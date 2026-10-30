// Shared day-chip + time-chip picker for booking and reschedule.
//
// Design reference (adapted, not copied): the ReUI Schedule-10
// due-date picker pattern — quick day shortcuts above a time-slot
// column — rebuilt here as a horizontal day strip plus colourful
// time chips, in CareBook's teal brand with a warm amber accent
// on the selected time. ReUI's block is Pro-licensed, so no
// registry code was installed or copied; this is a local build.
//
// Display rules (the picker is display only, never the guard):
//   - ONLY bookable slots appear. Empty days are skipped silently
//     — they never render as dead chips — and no slot ever shows
//     a seat count or a state word ("Fully booked", "Passed",
//     "Unavailable", "3 seats left"). The server revalidates the
//     chosen slot at submit time, so a stale chip is rejected.
//   - The selected day is a filled teal chip; the selected time
//     is a filled teal chip with an amber ring — unmistakable at
//     a glance, including on a narrow phone screen.
"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { addDays, formatTime, todayIST } from "@/lib/time";
import type { DoctorSlotView } from "@/lib/services/doctors";

export type SlotChoice = Pick<
  DoctorSlotView,
  "slotId" | "date" | "startTime" | "endTime" | "remaining" | "bookable" | "state"
>;

export type BookableDay = { date: string; slots: SlotChoice[] };

/** Bookable slots only, grouped by day in date order. */
export function groupBookableSlots(
  slots: SlotChoice[],
  excludeSlotId?: number,
): BookableDay[] {
  const byDate = new Map<string, SlotChoice[]>();
  for (const s of slots) {
    if (!s.bookable) continue;
    if (excludeSlotId !== undefined && s.slotId === excludeSlotId) continue;
    const list = byDate.get(s.date) ?? [];
    list.push(s);
    byDate.set(s.date, list);
  }
  return [...byDate.entries()]
    .map(([date, daySlots]) => ({ date, slots: daySlots }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function dayParts(dateStr: string): { weekday: string; dayMonth: string } {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return {
    weekday: WEEKDAYS[dt.getUTCDay()],
    dayMonth: `${d} ${MONTHS[m - 1]}`,
  };
}

/** "Today" / "Tomorrow" when the day is one of those, else weekday. */
export function dayChipTop(dateStr: string, today = todayIST()): string {
  if (dateStr === today) return "Today";
  if (dateStr === addDays(today, 1)) return "Tomorrow";
  return dayParts(dateStr).weekday;
}

export function dayChipBottom(dateStr: string): string {
  return dayParts(dateStr).dayMonth;
}

export function SlotPicker({
  slots,
  selectedSlotId,
  onSelect,
  onDaySelect,
  excludeSlotId,
}: {
  slots: SlotChoice[];
  selectedSlotId: number | null;
  onSelect: (slot: SlotChoice) => void;
  /** Fired when the user switches to a different day, so the
   * parent can drop the picked time — otherwise the strip
   * follows the picked time's day forever and other days
   * look dead (the day chips stop responding). */
  onDaySelect?: () => void;
  /** E.g. the current slot in a reschedule — never offered again. */
  excludeSlotId?: number;
}) {
  const days = groupBookableSlots(slots, excludeSlotId);
  const selected = days
    .flatMap((d) => d.slots)
    .find((s) => s.slotId === selectedSlotId);
  const [dayOverride, setDayOverride] = useState<string | null>(null);
  // The strip follows the selected slot's day once a time is
  // picked; before that it follows the day the user tapped.
  const activeDay =
    (selected
      ? days.find((d) => d.date === selected.date)
      : days.find((d) => d.date === dayOverride)) ?? days[0];

  if (days.length === 0) {
    return (
      <p className="text-sm text-ink-soft">
        No times available right now. Check back later, or keep your
        current appointment.
      </p>
    );
  }


  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <p className="mb-2 text-sm font-semibold text-ink">Pick a day</p>
        <div
          role="tablist"
          aria-label="Available days"
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
        >
          {days.map((d) => {
            const isActive = d.date === activeDay.date;
            return (
              <button
                key={d.date}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => {
                  setDayOverride(d.date);
                  // Switching days must drop the picked time:
                  // the strip follows the picked time's day, so
                  // without this, other days look unclickable
                  // once any time is picked.
                  if (selected && selected.date !== d.date) {
                    onDaySelect?.();
                  }
                }}
                className={cn(
                  "min-w-[78px] shrink-0 rounded-2xl border px-3 py-2.5 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2",
                  isActive
                    ? "border-brand-700 bg-brand-700 text-white shadow-md"
                    : "border-border bg-surface text-ink hover:border-brand-200 hover:bg-brand-50",
                )}
              >
                <span className="block text-sm font-bold">
                  {dayChipTop(d.date)}
                </span>
                <span
                  className={cn(
                    "block text-xs",
                    isActive ? "text-brand-100" : "text-ink-faint",
                  )}
                >
                  {dayChipBottom(d.date)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-ink">
          Pick a time <span className="font-normal text-ink-faint">(IST)</span>
        </p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {activeDay.slots.map((s) => {
            const isSelected = s.slotId === selectedSlotId;
            return (
              <button
                key={s.slotId}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelect(s)}
                className={cn(
                  "rounded-xl border px-2 py-3 text-sm font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2",
                  isSelected
                    ? "border-brand-700 bg-brand-700 text-white shadow-md ring-2 ring-amber-400 ring-offset-2"
                    : "border-border bg-surface text-brand-800 hover:border-brand-200 hover:bg-brand-50",
                )}
              >
                {formatTime(s.startTime)}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-ink-faint">
          Each time is a full appointment window — the end time shows
          on the review step.
        </p>
      </div>
    </div>
  );
}

/** Doctor profile's "Available times" section: same day grouping
 * and chip look, but each pill is a link that opens the booking
 * card above with that exact time preselected (?slot=). Bookable
 * times only, no counts, no state words. */
export function AvailableTimes({
  slots,
  doctorId,
}: {
  slots: SlotChoice[];
  doctorId: number;
}) {
  const days = groupBookableSlots(slots);
  if (days.length === 0) {
    return (
      <p className="mt-2 text-slate-600">
        No upcoming times right now. Check back later.
      </p>
    );
  }
  return (
    <div className="mt-4 flex flex-col gap-5">
      {days.map((d) => (
        <div key={d.date}>
          <p className="mb-2 text-sm font-bold text-ink">
            {dayChipTop(d.date)} · {dayChipBottom(d.date)}
          </p>
          <div className="flex flex-wrap gap-2">
            {d.slots.map((s) => (
              <Link
                key={s.slotId}
                href={`/doctors/${doctorId}?slot=${s.slotId}#book`}
                className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-semibold text-brand-800 transition hover:border-brand-400 hover:bg-brand-100"
              >
                {formatTime(s.startTime)} – {formatTime(s.endTime)}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
