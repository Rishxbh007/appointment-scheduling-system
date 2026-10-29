// Doctor read models: listings and profiles.
//
// These are plain database functions (no cookies, no redirects), so
// they are usable from server components, server actions, and the
// test script alike. Only approved doctors appear in public listings.

import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  users,
  doctors,
  specializations,
  slots,
  appointments,
  patientFavoriteDoctors,
} from "@/lib/db/schema";
import { toISODate, toHHMM, isSlotInFuture, todayIST } from "@/lib/time";

export type DoctorListItem = {
  doctorId: number;
  name: string;
  qualification: string | null;
  experienceYears: number | null;
  consultationFee: string | null;
  specializationNames: string[];
};

/**
 * Doctor names always render with a "Dr." prefix. Seed doctors store
 * the prefix in their name, registered doctors do not, so normalize
 * at display time instead of trusting stored data. Already-prefixed
 * names pass through unchanged (no "Dr. Dr."), and names that merely
 * start with those letters (e.g. "Drake") are left alone.
 */
export function formatDoctorName(name: string): string {
  const trimmed = name.trim();
  const withoutPrefix = trimmed.replace(/^dr\.(\s*|$)|^dr(\s+|$)/i, "");
  return `Dr. ${withoutPrefix.trim()}`;
}

/**
 * What a patient sees for one upcoming slot. The state is derived
 * from the existing fields, in this order:
 *   inactive window -> "unavailable"
 *   active but no places left -> "fully-booked"
 *   active with places left but start time already passed (IST) ->
 *     "passed"
 *   otherwise -> "available"
 * `bookable` is true exactly when state is "available" — the same
 * rule the profile page used before, when it filtered to bookable
 * slots only. Past dates (before today IST) never reach this view
 * at all: they are over, not "unavailable".
 */
export type SlotState =
  | "available"
  | "fully-booked"
  | "unavailable"
  | "passed";

export type DoctorSlotView = {
  slotId: number;
  date: string;
  startTime: string;
  endTime: string;
  maxAppointments: number;
  isActive: boolean;
  bookedCount: number;
  remaining: number;
  bookable: boolean;
  state: SlotState;
};

/** Approved doctors, optionally filtered by specialization or name. */
export async function listDoctors(search = ""): Promise<DoctorListItem[]> {
  const q = search.trim();
  const rows = await db
    .select({
      doctorId: doctors.doctorId,
      name: users.name,
      qualification: doctors.qualification,
      experienceYears: doctors.experienceYears,
      consultationFee: doctors.consultationFee,
    })
    .from(doctors)
    .innerJoin(users, eq(doctors.userId, users.userId))
    .where(
      q
        ? and(
            eq(doctors.isApproved, true),
            or(
              ilike(users.name, `%${q}%`),
              sql`EXISTS (SELECT 1 FROM ${specializations} s WHERE s.doctor_id = ${doctors.doctorId} AND s.name ILIKE ${`%${q}%`})`,
            ),
          )
        : eq(doctors.isApproved, true),
    )
    .orderBy(asc(users.name));

  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.doctorId);
  const specs = await db
    .select()
    .from(specializations)
    .where(inArray(specializations.doctorId, ids));
  const byDoctor = new Map<number, string[]>();
  for (const s of specs) {
    const list = byDoctor.get(s.doctorId) ?? [];
    list.push(s.name);
    byDoctor.set(s.doctorId, list);
  }
  return rows.map((r) => ({
    ...r,
    consultationFee: r.consultationFee,
    specializationNames: byDoctor.get(r.doctorId) ?? [],
  }));
}

export type DoctorProfile = DoctorListItem & {
  email: string;
  phone: string | null;
  slots: DoctorSlotView[];
};

/** One doctor with specializations and ALL upcoming slots + states.
 * Upcoming means date >= today IST; past dates are excluded. Slots
 * carry their state (available / fully-booked / unavailable /
 * passed) so callers can show unavailable slots instead of hiding
 * them. Callers that offer a slot for booking or rescheduling must
 * filter on `bookable` — the server revalidates anyway, but the UI
 * must never offer a slot the server would reject. */
export async function getDoctorProfile(
  doctorId: number,
): Promise<DoctorProfile | null> {
  const [row] = await db
    .select({
      doctorId: doctors.doctorId,
      name: users.name,
      email: users.email,
      phone: users.phone,
      qualification: doctors.qualification,
      experienceYears: doctors.experienceYears,
      consultationFee: doctors.consultationFee,
    })
    .from(doctors)
    .innerJoin(users, eq(doctors.userId, users.userId))
    .where(
      and(eq(doctors.doctorId, doctorId), eq(doctors.isApproved, true)),
    );
  if (!row) return null;

  const specs = await db
    .select()
    .from(specializations)
    .where(eq(specializations.doctorId, doctorId));

  // Every upcoming window, active or not: inactive windows are
  // shown as Unavailable rather than silently dropped.
  const today = todayIST();
  const slotRows = await db
    .select()
    .from(slots)
    .where(
      and(
        eq(slots.doctorId, doctorId),
        sql`${slots.date} >= ${today}`,
      ),
    )
    .orderBy(asc(slots.date), asc(slots.startTime));

  // Active bookings per slot, in one query.
  const counts = await db
    .select({
      slotId: appointments.slotId,
      n: sql<number>`count(*)`,
    })
    .from(appointments)
    .where(
      and(
        inArray(
          appointments.slotId,
          slotRows.map((s) => s.slotId),
        ),
        inArray(appointments.status, ["Booked", "Confirmed"]),
      ),
    )
    .groupBy(appointments.slotId);
  const countBySlot = new Map<number, number>();
  for (const c of counts) countBySlot.set(c.slotId, Number(c.n));

  const now = new Date();
  const slotViews: DoctorSlotView[] = slotRows.map((s) => {
    const date = toISODate(s.date);
    const startTime = toHHMM(s.startTime);
    const bookedCount = countBySlot.get(s.slotId) ?? 0;
    const remaining = Math.max(0, s.maxAppointments - bookedCount);
    // Order matters: an inactive window reads Unavailable even if
    // its time has also passed; a full window reads Fully booked
    // even if its start time has also passed.
    const state: SlotState = !s.isActive
      ? "unavailable"
      : remaining <= 0
        ? "fully-booked"
        : !isSlotInFuture(date, startTime, now)
          ? "passed"
          : "available";
    return {
      slotId: s.slotId,
      date,
      startTime,
      endTime: toHHMM(s.endTime),
      maxAppointments: s.maxAppointments,
      isActive: s.isActive,
      bookedCount,
      remaining,
      bookable: state === "available",
      state,
    };
  });

  return {
    ...row,
    specializationNames: specs.map((s) => s.name),
    slots: slotViews,
  };
}

// ---- Favorite doctors (Stage 5) ------------------------------------
// Every function here is scoped to the patientId the caller passes
// in — callers resolve that id from the session, never from client
// input, so one patient can never read or change another's
// favorites. A favorite is only a bookmark: it is not a booking,
// endorsement, or verification of the doctor.

/** The doctor ids one patient has saved. Only that patient's rows. */
export async function getFavoriteDoctorIds(
  patientId: number,
): Promise<number[]> {
  const rows = await db
    .select({ doctorId: patientFavoriteDoctors.doctorId })
    .from(patientFavoriteDoctors)
    .where(eq(patientFavoriteDoctors.patientId, patientId));
  return rows.map((r) => r.doctorId);
}

/**
 * Save a doctor for a patient. Idempotent: saving the same doctor
 * twice is safe, not an error (INSERT ... ON CONFLICT DO NOTHING,
 * backed by the composite primary key). Only approved doctors can
 * be saved; anything else is rejected without saying why, so the
 * existence of unapproved doctors is not leaked.
 */
export async function addFavorite(
  patientId: number,
  doctorId: number,
): Promise<void> {
  const [doctor] = await db
    .select({ doctorId: doctors.doctorId })
    .from(doctors)
    .where(
      and(eq(doctors.doctorId, doctorId), eq(doctors.isApproved, true)),
    );
  if (!doctor) throw new Error("Doctor not found.");
  await db
    .insert(patientFavoriteDoctors)
    .values({ patientId, doctorId })
    .onConflictDoNothing();
}

/** Remove a saved doctor. Idempotent: removing a doctor who was
 * never saved is safe, not an error. */
export async function removeFavorite(
  patientId: number,
  doctorId: number,
): Promise<void> {
  await db
    .delete(patientFavoriteDoctors)
    .where(
      and(
        eq(patientFavoriteDoctors.patientId, patientId),
        eq(patientFavoriteDoctors.doctorId, doctorId),
      ),
    );
}

/**
 * One patient's saved doctors, in the same list-item shape
 * listDoctors uses. Only that patient's favorites, and only
 * approved doctors — a doctor who stopped being approved simply
 * stops appearing, rather than leaking an unapproved profile.
 */
export async function listFavoriteDoctors(
  patientId: number,
): Promise<DoctorListItem[]> {
  const rows = await db
    .select({
      doctorId: doctors.doctorId,
      name: users.name,
      qualification: doctors.qualification,
      experienceYears: doctors.experienceYears,
      consultationFee: doctors.consultationFee,
    })
    .from(patientFavoriteDoctors)
    .innerJoin(doctors, eq(patientFavoriteDoctors.doctorId, doctors.doctorId))
    .innerJoin(users, eq(doctors.userId, users.userId))
    .where(
      and(
        eq(patientFavoriteDoctors.patientId, patientId),
        eq(doctors.isApproved, true),
      ),
    )
    .orderBy(asc(users.name));

  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.doctorId);
  const specs = await db
    .select()
    .from(specializations)
    .where(inArray(specializations.doctorId, ids));
  const byDoctor = new Map<number, string[]>();
  for (const s of specs) {
    const list = byDoctor.get(s.doctorId) ?? [];
    list.push(s.name);
    byDoctor.set(s.doctorId, list);
  }
  return rows.map((r) => ({
    ...r,
    specializationNames: byDoctor.get(r.doctorId) ?? [],
  }));
}
