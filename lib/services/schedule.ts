// Slot-window generation.
//
// Two flavours, kept separate on purpose:
//   - defaultScheduleSlots: the Mon–Fri 09:00–13:00 default given to a
//     newly registered doctor, so they are bookable the moment they
//     sign up. Covers the next 10 days so there are always upcoming
//     weekday windows no matter which day registration happens.
//   - seedScheduleSlots: the demo seed, all 7 days, so the demo always
//     has bookable slots even on a weekend.
// Both skip windows whose start time has already passed today (IST).

import { addDays, todayIST, nowISTTime, toHHMM } from "@/lib/time";

export const SLOT_WINDOWS: Array<[string, string]> = [
  ["09:00", "10:00"],
  ["10:00", "11:00"],
  ["11:00", "12:00"],
  ["12:00", "13:00"],
];

export type NewSlot = {
  doctorId: number;
  date: string;
  startTime: string;
  endTime: string;
  maxAppointments: number;
  isActive: boolean;
};

function isWeekday(dateStr: string): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day >= 1 && day <= 5; // Mon..Fri
}

function windowsFor(
  doctorId: number,
  maxAppointments: number,
  days: number,
  weekdaysOnly: boolean,
): NewSlot[] {
  const today = todayIST();
  const now = nowISTTime();
  const out: NewSlot[] = [];
  for (let offset = 0; offset < days; offset++) {
    const date = addDays(today, offset);
    if (weekdaysOnly && !isWeekday(date)) continue;
    for (const [start, end] of SLOT_WINDOWS) {
      // Skip windows that already started today.
      if (offset === 0 && toHHMM(start) <= now) continue;
      out.push({
        doctorId,
        date,
        startTime: `${start}:00`,
        endTime: `${end}:00`,
        maxAppointments,
        isActive: true,
      });
    }
  }
  return out;
}

/** Default Mon–Fri 09:00–13:00 schedule for a new doctor. */
export function defaultScheduleSlots(doctorId: number): NewSlot[] {
  return windowsFor(doctorId, 3, 10, true);
}

/** Demo seed schedule: every day for a week, so demos always work. */
export function seedScheduleSlots(doctorId: number): NewSlot[] {
  return windowsFor(doctorId, 3, 7, false);
}
