// Rolling availability for DEMO doctors only.
//
// Problem: the demo seed covers a fixed 7-day window from seeding
// time, so a few days later the demo doctors show nothing
// bookable. Fix: the daily cron tops their windows back up to a
// rolling 7-day horizon (the same windows seedScheduleSlots
// generates), so the demo always has upcoming slots.
//
// Hard safety rules, all enforced here, not left to the caller:
//   - ONLY demo/seed doctors: matched by the exact email list in
//     lib/db/seed.ts (SEED_DOCTOR_EMAILS). No domain pattern, no
//     name match — a real registered doctor can never qualify,
//     even if they registered with a similar name.
//   - ONLY ADDS rows: existing slots, bookings and appointments
//     are never updated or deleted. A doctor's deactivated
//     window stays deactivated — its row already exists, so it
//     is never re-inserted as active.
//   - IDEMPOTENT: before inserting, every desired window is
//     checked against that doctor's existing slot rows by
//     doctor + date + start + end time. Re-running the top-up
//     (same day, or a retried cron) inserts nothing new. The
//     slots table has no unique constraint on that key, so this
//     check-then-insert is the dedup guard; the cron runs at
//     most once a day, so a concurrent double-run is not a
//     realistic race here.
//   - FUTURE ONLY: desired windows come from seedScheduleSlots,
//     which already skips today's already-started windows, and
//     the horizon is 7 days from today (IST) — never past rows.

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, doctors, slots } from "@/lib/db/schema";
import { SEED_DOCTOR_EMAILS } from "@/lib/db/seed";
import { seedScheduleSlots } from "./schedule";
import { toHHMM, toISODate, todayIST } from "@/lib/time";

export type DemoSlotTopUpResult = {
  doctorsChecked: number;
  slotsAdded: number;
};

export async function topUpDemoDoctorSlots(): Promise<DemoSlotTopUpResult> {
  // Demo doctors only: inner join on users + the exact seed
  // email list. A doctor whose user row is missing, or whose
  // email is not one of the four seed emails, is not returned.
  const demoDoctors = await db
    .select({ doctorId: doctors.doctorId })
    .from(doctors)
    .innerJoin(users, eq(doctors.userId, users.userId))
    .where(inArray(users.email, SEED_DOCTOR_EMAILS));

  let slotsAdded = 0;
  const today = todayIST();
  for (const { doctorId } of demoDoctors) {
    const existing = await db
      .select({
        date: slots.date,
        startTime: slots.startTime,
        endTime: slots.endTime,
      })
      .from(slots)
      .where(
        and(
          eq(slots.doctorId, doctorId),
          sql`${slots.date} >= ${today}`,
        ),
      );
    const existingKeys = new Set(
      existing.map(
        (s) =>
          `${toISODate(s.date)}|${toHHMM(s.startTime)}|${toHHMM(s.endTime)}`,
      ),
    );
    // Desired = the seed's own 7-day window set, recomputed for
    // today. Windows that already exist (in any active state)
    // are skipped; only genuinely missing future windows are
    // inserted, with the seed's capacity (3) and active flag.
    const missing = seedScheduleSlots(doctorId).filter(
      (w) =>
        !existingKeys.has(
          `${w.date}|${toHHMM(w.startTime)}|${toHHMM(w.endTime)}`,
        ),
    );
    // Note: seedScheduleSlots already returns dates >= today
    // with today's passed windows skipped, but guard the date
    // explicitly so a future change to that helper can never
    // backfill a past window through this path.
    const futureMissing = missing.filter((w) => w.date >= today);
    if (futureMissing.length > 0) {
      // Bounded horizon: seedScheduleSlots covers at most 7
      // days, so one run inserts at most 28 rows per doctor —
      // in practice 4, the single newly-rolled day.
      await db.insert(slots).values(futureMissing);
      slotsAdded += futureMissing.length;
    }
  }
  return { doctorsChecked: demoDoctors.length, slotsAdded };
}

// Re-exported for callers that need the marker without importing
// the seed module directly.
export { SEED_DOCTOR_EMAILS };
