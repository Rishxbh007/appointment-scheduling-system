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
} from "@/lib/db/schema";
import { toISODate, toHHMM, isSlotInFuture } from "@/lib/time";

export type DoctorListItem = {
  doctorId: number;
  name: string;
  qualification: string | null;
  experienceYears: number | null;
  consultationFee: string | null;
  specializationNames: string[];
};

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

/** One doctor with specializations and upcoming slots + capacities. */
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

  const slotRows = await db
    .select()
    .from(slots)
    .where(
      and(eq(slots.doctorId, doctorId), eq(slots.isActive, true)),
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
  const slotViews: DoctorSlotView[] = slotRows
    .map((s) => {
      const date = toISODate(s.date);
      const startTime = toHHMM(s.startTime);
      const bookedCount = countBySlot.get(s.slotId) ?? 0;
      const remaining = Math.max(0, s.maxAppointments - bookedCount);
      return {
        slotId: s.slotId,
        date,
        startTime,
        endTime: toHHMM(s.endTime),
        maxAppointments: s.maxAppointments,
        isActive: s.isActive,
        bookedCount,
        remaining,
        bookable:
          s.isActive &&
          remaining > 0 &&
          isSlotInFuture(date, startTime, now),
      };
    })
    // Profile page shows only slots a patient could still book.
    .filter((s) => s.bookable);

  return {
    ...row,
    specializationNames: specs.map((s) => s.name),
    slots: slotViews,
  };
}
