// Appointment business logic — plain database functions.
//
// Booking is the heart of the app, so its rules live here in one
// place, guarded twice:
//   1. Application level: the booking transaction locks the slot row
//      (SELECT ... FOR UPDATE), then checks capacity and the
//      patient-double-booking rule before inserting.
//   2. Database level: a partial unique index on
//      (patient_id, slot_id) for active statuses (see lib/db/index.ts)
//      makes a double booking impossible even under a race.
// Status changes are ownership-checked and follow one allowed path:
//   Booked -> Confirmed -> Completed, with cancellation allowed from
//   Booked or Confirmed. Nothing else is a legal transition.

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  users,
  doctors,
  patients,
  slots,
  appointments,
} from "@/lib/db/schema";
import {
  toISODate,
  toHHMM,
  isSlotInFuture,
  todayIST,
} from "@/lib/time";

export const ACTIVE_STATUSES = ["Booked", "Confirmed"] as const;

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  Booked: ["Confirmed", "Cancelled"],
  Confirmed: ["Cancelled", "Completed"],
  Cancelled: [],
  Completed: [],
};

/**
 * Book an appointment. Throws an Error with a user-facing message
 * when the booking cannot be made.
 */
export async function bookAppointment(
  patientId: number,
  slotId: number,
  reason: string,
) {
  return db.transaction(async (tx) => {
    // Lock the slot row so two concurrent bookings cannot both pass
    // the capacity check.
    const locked = await tx.execute(
      sql`SELECT slot_id, max_appointments, is_active, date, start_time
          FROM slots WHERE slot_id = ${slotId} FOR UPDATE`,
    );
    const slotRow = (locked.rows as Record<string, unknown>[])[0];
    if (!slotRow) throw new Error("That time slot no longer exists.");
    if (slotRow.is_active !== true)
      throw new Error("That time slot is no longer available.");

    const date = toISODate(slotRow.date);
    const startTime = toHHMM(slotRow.start_time);
    if (!isSlotInFuture(date, startTime)) {
      throw new Error("That time slot is in the past.");
    }

    const countRows = await tx
      .select({ n: sql<number>`count(*)` })
      .from(appointments)
      .where(
        and(
          eq(appointments.slotId, slotId),
          inArray(appointments.status, [...ACTIVE_STATUSES]),
        ),
      );
    const booked = Number(countRows[0]?.n ?? 0);
    const max = Number(slotRow.max_appointments);
    if (booked >= max) {
      throw new Error("That time slot is fully booked.");
    }

    // Same patient, same slot, already holding an active booking?
    const existing = await tx
      .select({ id: appointments.appointmentId })
      .from(appointments)
      .where(
        and(
          eq(appointments.patientId, patientId),
          eq(appointments.slotId, slotId),
          inArray(appointments.status, [...ACTIVE_STATUSES]),
        ),
      );
    if (existing.length > 0) {
      throw new Error("You already have an active booking for this slot.");
    }

    const [slot] = await tx
      .select()
      .from(slots)
      .where(eq(slots.slotId, slotId));
    if (!slot) throw new Error("That time slot no longer exists.");

    try {
      const [created] = await tx
        .insert(appointments)
        .values({
          patientId,
          doctorId: slot.doctorId,
          slotId,
          status: "Booked",
          reason,
        })
        .returning();
      return created;
    } catch (err) {
      // The partial unique index fired (race that slipped past the
      // checks above) — report it as a double booking, not a crash.
      if (
        err instanceof Error &&
        err.message.includes("appointments_active_patient_slot_uidx")
      ) {
        throw new Error("You already have an active booking for this slot.");
      }
      throw err;
    }
  });
}

export type BookingView = {
  appointmentId: number;
  status: string;
  reason: string | null;
  bookedAt: Date;
  slotDate: string;
  slotStart: string;
  slotEnd: string;
  doctorName: string;
  patientName: string;
};

/** A patient's own bookings, soonest slot first. */
export async function getPatientBookings(
  patientId: number,
): Promise<BookingView[]> {
  const rows = await db
    .select({
      appointmentId: appointments.appointmentId,
      status: appointments.status,
      reason: appointments.reason,
      bookedAt: appointments.bookedAt,
      slotDate: slots.date,
      slotStart: slots.startTime,
      slotEnd: slots.endTime,
      doctorName: users.name,
      doctorId: appointments.doctorId,
    })
    .from(appointments)
    .innerJoin(slots, eq(appointments.slotId, slots.slotId))
    .innerJoin(doctors, eq(appointments.doctorId, doctors.doctorId))
    .innerJoin(users, eq(doctors.userId, users.userId))
    .where(eq(appointments.patientId, patientId))
    .orderBy(asc(slots.date), asc(slots.startTime));
  return rows.map((r) => ({
    appointmentId: r.appointmentId,
    status: r.status,
    reason: r.reason,
    bookedAt: r.bookedAt,
    slotDate: toISODate(r.slotDate),
    slotStart: toHHMM(r.slotStart),
    slotEnd: toHHMM(r.slotEnd),
    doctorName: r.doctorName,
    patientName: "",
  }));
}

/** A doctor's appointments, with patient names. */
export async function getDoctorBookings(
  doctorId: number,
): Promise<BookingView[]> {
  const rows = await db
    .select({
      appointmentId: appointments.appointmentId,
      status: appointments.status,
      reason: appointments.reason,
      bookedAt: appointments.bookedAt,
      slotDate: slots.date,
      slotStart: slots.startTime,
      slotEnd: slots.endTime,
      patientName: users.name,
    })
    .from(appointments)
    .innerJoin(slots, eq(appointments.slotId, slots.slotId))
    .innerJoin(patients, eq(appointments.patientId, patients.patientId))
    .innerJoin(users, eq(patients.userId, users.userId))
    .where(eq(appointments.doctorId, doctorId))
    .orderBy(asc(slots.date), asc(slots.startTime));
  return rows.map((r) => ({
    appointmentId: r.appointmentId,
    status: r.status,
    reason: r.reason,
    bookedAt: r.bookedAt,
    slotDate: toISODate(r.slotDate),
    slotStart: toHHMM(r.slotStart),
    slotEnd: toHHMM(r.slotEnd),
    doctorName: "",
    patientName: r.patientName,
  }));
}

/**
 * Change an appointment's status with ownership + transition checks.
 * Pass the caller's doctorId for doctor actions, or patientId for a
 * patient cancelling their own booking.
 */
export async function changeAppointmentStatus(
  appointmentId: number,
  newStatus: string,
  actor: { doctorId?: number; patientId?: number },
) {
  const [appt] = await db
    .select()
    .from(appointments)
    .where(eq(appointments.appointmentId, appointmentId));
  if (!appt) throw new Error("Appointment not found.");

  if (actor.doctorId !== undefined && appt.doctorId !== actor.doctorId) {
    throw new Error("This appointment belongs to another doctor.");
  }
  if (actor.patientId !== undefined && appt.patientId !== actor.patientId) {
    throw new Error("This appointment belongs to another patient.");
  }
  // Patients may only cancel, never confirm or complete.
  if (
    actor.patientId !== undefined &&
    actor.doctorId === undefined &&
    newStatus !== "Cancelled"
  ) {
    throw new Error("Patients can only cancel their own bookings.");
  }

  const allowed = ALLOWED_TRANSITIONS[appt.status] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Cannot move an appointment from ${appt.status} to ${newStatus}.`,
    );
  }

  const [updated] = await db
    .update(appointments)
    .set({ status: newStatus })
    .where(eq(appointments.appointmentId, appointmentId))
    .returning();
  return updated;
}

export type DoctorSlotManageView = {
  slotId: number;
  date: string;
  startTime: string;
  endTime: string;
  maxAppointments: number;
  isActive: boolean;
  activeBookings: number;
};

/** A doctor's own slots with live active-booking counts. */
export async function getDoctorSlotsForManage(
  doctorId: number,
): Promise<DoctorSlotManageView[]> {
  const slotRows = await db
    .select()
    .from(slots)
    .where(eq(slots.doctorId, doctorId))
    .orderBy(asc(slots.date), asc(slots.startTime));
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
        inArray(appointments.status, [...ACTIVE_STATUSES]),
      ),
    )
    .groupBy(appointments.slotId);
  const bySlot = new Map<number, number>();
  for (const c of counts) bySlot.set(c.slotId, Number(c.n));
  return slotRows.map((s) => ({
    slotId: s.slotId,
    date: toISODate(s.date),
    startTime: toHHMM(s.startTime),
    endTime: toHHMM(s.endTime),
    maxAppointments: s.maxAppointments,
    isActive: s.isActive,
    activeBookings: bySlot.get(s.slotId) ?? 0,
  }));
}

/** Doctor creates one of their own slots. */
export async function createSlot(
  doctorId: number,
  input: {
    date: string;
    startTime: string;
    endTime: string;
    maxAppointments: number;
  },
) {
  if (input.date < todayIST()) {
    throw new Error("Cannot create a slot in the past.");
  }
  if (input.endTime <= input.startTime) {
    throw new Error("End time must be after start time.");
  }
  const [created] = await db
    .insert(slots)
    .values({
      doctorId,
      date: input.date,
      startTime: `${input.startTime}:00`,
      endTime: `${input.endTime}:00`,
      maxAppointments: input.maxAppointments,
      isActive: true,
    })
    .returning();
  return created;
}

/**
 * Activate/deactivate a doctor's own slot. Deactivation is blocked
 * when the slot still has upcoming active bookings — removing it
 * would strand those patients.
 */
export async function setSlotActive(
  doctorId: number,
  slotId: number,
  isActive: boolean,
) {
  const [slot] = await db
    .select()
    .from(slots)
    .where(and(eq(slots.slotId, slotId), eq(slots.doctorId, doctorId)));
  if (!slot) throw new Error("Slot not found.");

  if (!isActive) {
    const upcoming = await db
      .select({ id: appointments.appointmentId })
      .from(appointments)
      .innerJoin(slots, eq(appointments.slotId, slots.slotId))
      .where(
        and(
          eq(appointments.slotId, slotId),
          inArray(appointments.status, [...ACTIVE_STATUSES]),
          sql`${slots.date} >= ${todayIST()}`,
        ),
      );
    if (upcoming.length > 0) {
      throw new Error(
        "Cannot remove this window: it still has upcoming bookings. " +
          "Cancel or complete those appointments first.",
      );
    }
  }

  const [updated] = await db
    .update(slots)
    .set({ isActive })
    .where(eq(slots.slotId, slotId))
    .returning();
  return updated;
}
