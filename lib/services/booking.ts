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
//   Pending -> Booked (verified payment) or Cancelled (patient
//   cancel or expiry), then Booked -> Confirmed -> Completed, with
//   cancellation allowed from Booked or Confirmed. Nothing else is
//   a legal transition. Doctors never cancel a Pending booking:
//   the hold belongs to the patient until it is paid or expires.

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  users,
  doctors,
  patients,
  slots,
  appointments,
  payments,
  notifications,
} from "@/lib/db/schema";
import {
  toISODate,
  toHHMM,
  isSlotInFuture,
  todayIST,
} from "@/lib/time";
import {
  buildReminderContent,
  reminderScheduledAt,
} from "./notifications";
import { formatDoctorName } from "@/lib/format";

// A Pending booking holds its slot exactly like Booked/Confirmed
// until it is paid, cancelled, or expired.
export const ACTIVE_STATUSES = ["Booked", "Confirmed", "Pending"] as const;

/**
 * The capacity/duplicate test for a booking. Booked and Confirmed
 * always count; a Pending booking counts only while its payment
 * deadline has not passed — an expired hold is treated as gone
 * (lazy expiry), so a stale hold never blocks a slot or a
 * re-booking. The sweep (lib/services/payments.ts) later cancels
 * expired holds outright; this condition is what keeps the app
 * correct between sweeps.
 */
export function liveBookingCondition() {
  return sql`(${appointments.status} IN ('Booked', 'Confirmed') OR (${appointments.status} = 'Pending' AND ${appointments.expiresAt} > NOW()))`;
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  Pending: ["Cancelled"],
  Booked: ["Confirmed", "Cancelled"],
  Confirmed: ["Cancelled", "Completed"],
  Cancelled: [],
  Completed: [],
};

/**
 * A consultation fee (NUMERIC comes back as a string) in integer
 * paise, or null when there is no usable fee. Math.round guards
 * against binary-float dust (999.99 * 100 is 99998.999...).
 */
export function feeToPaise(
  fee: string | number | null | undefined,
): number | null {
  if (fee === null || fee === undefined) return null;
  const n = typeof fee === "number" ? fee : Number.parseFloat(fee);
  if (!Number.isFinite(n) || n <= 0) return null;
  const paise = Math.round(n * 100);
  return paise > 0 ? paise : null;
}

/** The consultation fee of a slot's doctor, in paise, or null. */
export async function getSlotDoctorFee(
  slotId: number,
): Promise<number | null> {
  const [slot] = await db
    .select()
    .from(slots)
    .where(eq(slots.slotId, slotId));
  if (!slot) return null;
  const [doctor] = await db
    .select()
    .from(doctors)
    .where(eq(doctors.doctorId, slot.doctorId));
  if (!doctor) return null;
  return feeToPaise(doctor.consultationFee);
}

/**
 * Book an appointment. Throws an Error with a user-facing message
 * when the booking cannot be made.
 *
 * Options: status "Pending" creates a payment hold instead of a
 * confirmed booking (Day 4 Stage A, pay before confirmation) — the
 * hold carries expiresAt and, when amountPaise is given, a Pending
 * payment row in the same transaction. Without options the call
 * is exactly today's immediate-Booked flow.
 */
export async function bookAppointment(
  patientId: number,
  slotId: number,
  reason: string,
  options: {
    status?: "Booked" | "Pending";
    expiresAt?: Date;
    amountPaise?: number;
  } = {},
) {
  const status = options.status ?? "Booked";
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

    // Lazy expiry: this patient's own expired holds on this slot
    // are cancelled (with their payment rows) before any check, so
    // the partial unique index can never block a fresh booking on
    // a hold that already lapsed.
    const stale = await tx.execute(
      sql`UPDATE appointments SET status = 'Cancelled'
          WHERE patient_id = ${patientId} AND slot_id = ${slotId}
            AND status = 'Pending' AND expires_at <= NOW()
          RETURNING appointment_id`,
    );
    const staleIds = (stale.rows as Record<string, unknown>[])
      .map((r) => r.appointment_id)
      .filter((id): id is number => typeof id === "number");
    if (staleIds.length > 0) {
      await tx.execute(
        sql`UPDATE payments SET status = 'Expired'
            WHERE status = 'Pending' AND appointment_id IN (${sql.join(
              staleIds.map((id) => sql`${id}`),
              sql`, `,
            )})`,
      );
      // Day 4 Stage C: stale holds take their reminders with
      // them, so no dead hold is ever reminded.
      await tx
        .update(notifications)
        .set({ status: "Cancelled" })
        .where(
          and(
            inArray(notifications.appointmentId, staleIds),
            eq(notifications.event, "reminder"),
            eq(notifications.status, "Pending"),
          ),
        );
    }

    const countRows = await tx
      .select({ n: sql<number>`count(*)` })
      .from(appointments)
      .where(
        and(
          eq(appointments.slotId, slotId),
          liveBookingCondition(),
        ),
      );
    const booked = Number(countRows[0]?.n ?? 0);
    const max = Number(slotRow.max_appointments);
    if (booked >= max) {
      throw new Error("That time slot is fully booked.");
    }

    // Same patient, same slot, already holding a live booking?
    const existing = await tx
      .select({ id: appointments.appointmentId })
      .from(appointments)
      .where(
        and(
          eq(appointments.patientId, patientId),
          eq(appointments.slotId, slotId),
          liveBookingCondition(),
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
          status,
          reason,
          expiresAt: status === "Pending" ? options.expiresAt : undefined,
        })
        .returning();
      if (status === "Pending" && options.amountPaise !== undefined) {
        await tx.insert(payments).values({
          appointmentId: created.appointmentId,
          amountPaise: options.amountPaise,
          currency: "INR",
          status: "Pending",
        });
      }
      // Day 4 Stage C: the reminder row, scheduled 24h before the
      // slot starts. Created for every new booking — free or
      // Pending hold alike. The cron only sends for
      // Booked/Confirmed appointments, so a hold's reminder waits
      // until the hold is paid, and the cancel/sweep paths kill
      // it if the booking dies first. A missing doctor/patient
      // row cannot happen (foreign keys), but if it did, the
      // booking must still succeed — so a skipped reminder is
      // logged, never thrown.
      const [patientUser] = await tx
        .select({ email: users.email })
        .from(patients)
        .innerJoin(users, eq(patients.userId, users.userId))
        .where(eq(patients.patientId, patientId));
      const [doctorUser] = await tx
        .select({ name: users.name })
        .from(doctors)
        .innerJoin(users, eq(doctors.userId, users.userId))
        .where(eq(doctors.doctorId, slot.doctorId));
      if (patientUser && doctorUser) {
        const slotDate = toISODate(slot.date);
        const slotStart = toHHMM(slot.startTime);
        const slotEnd = toHHMM(slot.endTime);
        const content = buildReminderContent(
          formatDoctorName(doctorUser.name),
          slotDate,
          slotStart,
          slotEnd,
        );
        await tx.insert(notifications).values({
          appointmentId: created.appointmentId,
          channel: "email",
          event: "reminder",
          recipientEmail: patientUser.email,
          subject: content.subject,
          body: content.body,
          status: "Pending",
          scheduledAt: reminderScheduledAt(slotDate, slotStart),
        });
      } else {
        console.error(
          `Reminder skipped for appointment ${created.appointmentId}: patient or doctor row missing.`,
        );
      }
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

/**
 * Move a patient's appointment to a different slot of the SAME
 * doctor, in one transaction. The appointment row is updated in
 * place — status, reason and bookedAt never change, and no duplicate
 * appointment is created. Both slot rows are locked one at a time in
 * ascending slotId order, so two concurrent reschedules touching the
 * same slots always lock in the same order and cannot deadlock. The
 * old slot needs no explicit release: capacity is counted from
 * active bookings that reference a slot, so moving the row frees the
 * old slot automatically. Any failed check rolls the whole
 * transaction back and the original appointment is untouched.
 */
export async function rescheduleAppointment(
  patientId: number,
  appointmentId: number,
  newSlotId: number,
) {
  return db.transaction(async (tx) => {
    const [appt] = await tx
      .select()
      .from(appointments)
      .where(eq(appointments.appointmentId, appointmentId));
    if (!appt) throw new Error("Appointment not found.");
    if (appt.patientId !== patientId) {
      throw new Error("This appointment belongs to another patient.");
    }
    if (appt.status !== "Booked" && appt.status !== "Confirmed") {
      throw new Error(
        `A ${appt.status} appointment cannot be rescheduled.`,
      );
    }
    if (appt.slotId === newSlotId) {
      throw new Error("Pick a different time slot.");
    }

    // Lock both slot rows, ascending slotId first, one SELECT each
    // so Postgres takes the locks in a guaranteed order.
    const lockOrder =
      appt.slotId < newSlotId
        ? [appt.slotId, newSlotId]
        : [newSlotId, appt.slotId];
    const lockedRows: Record<string, unknown>[] = [];
    for (const id of lockOrder) {
      const locked = await tx.execute(
        sql`SELECT slot_id, doctor_id, max_appointments, is_active, date, start_time
            FROM slots WHERE slot_id = ${id} FOR UPDATE`,
      );
      const row = (locked.rows as Record<string, unknown>[])[0];
      if (row) lockedRows.push(row);
    }
    // The old slot row may legitimately be gone (its appointment is
    // what we are moving away from); only the new slot must exist.
    const newRow = lockedRows.find((r) => r.slot_id === newSlotId);
    if (!newRow) throw new Error("That time slot no longer exists.");
    if (newRow.doctor_id !== appt.doctorId) {
      throw new Error(
        "You can only reschedule within the same doctor's availability.",
      );
    }
    if (newRow.is_active !== true) {
      throw new Error("That time slot is no longer available.");
    }
    const date = toISODate(newRow.date);
    const startTime = toHHMM(newRow.start_time);
    if (!isSlotInFuture(date, startTime)) {
      throw new Error("That time slot is in the past.");
    }

    // Lazy expiry, as in bookAppointment: the patient's own expired
    // holds on the new slot are cancelled first, so the partial
    // unique index cannot block the move on a lapsed hold.
    const stale = await tx.execute(
      sql`UPDATE appointments SET status = 'Cancelled'
          WHERE patient_id = ${patientId} AND slot_id = ${newSlotId}
            AND status = 'Pending' AND expires_at <= NOW()
          RETURNING appointment_id`,
    );
    const staleIds = (stale.rows as Record<string, unknown>[])
      .map((r) => r.appointment_id)
      .filter((id): id is number => typeof id === "number");
    if (staleIds.length > 0) {
      await tx.execute(
        sql`UPDATE payments SET status = 'Expired'
            WHERE status = 'Pending' AND appointment_id IN (${sql.join(
              staleIds.map((id) => sql`${id}`),
              sql`, `,
            )})`,
      );
      // Day 4 Stage C: stale holds take their reminders with
      // them, so no dead hold is ever reminded.
      await tx
        .update(notifications)
        .set({ status: "Cancelled" })
        .where(
          and(
            inArray(notifications.appointmentId, staleIds),
            eq(notifications.event, "reminder"),
            eq(notifications.status, "Pending"),
          ),
        );
    }

    const countRows = await tx
      .select({ n: sql<number>`count(*)` })
      .from(appointments)
      .where(
        and(
          eq(appointments.slotId, newSlotId),
          liveBookingCondition(),
        ),
      );
    const booked = Number(countRows[0]?.n ?? 0);
    const max = Number(newRow.max_appointments);
    if (booked >= max) {
      throw new Error("That time slot is fully booked.");
    }

    // Same patient, same new slot, already holding a live booking?
    const existing = await tx
      .select({ id: appointments.appointmentId })
      .from(appointments)
      .where(
        and(
          eq(appointments.patientId, patientId),
          eq(appointments.slotId, newSlotId),
          liveBookingCondition(),
        ),
      );
    if (existing.length > 0) {
      throw new Error("You already have an active booking for this slot.");
    }

    try {
      // Re-check the status in the UPDATE itself: if a concurrent
      // cancellation landed after the checks above, this matches no
      // row and the move is refused instead of moving a cancelled
      // appointment to a new slot. Rescheduling stays
      // Booked/Confirmed-only: a Pending hold is never moved, even
      // though Pending counts toward capacity elsewhere.
      const [updated] = await tx
        .update(appointments)
        .set({ slotId: newSlotId })
        .where(
          and(
            eq(appointments.appointmentId, appointmentId),
            inArray(appointments.status, ["Booked", "Confirmed"]),
          ),
        )
        .returning();
      if (!updated) {
        throw new Error("This appointment can no longer be rescheduled.");
      }
      // Day 4 Stage C: the reminder follows the move — new start
      // minus 24h, only while still Pending (a sent reminder is
      // history, and a cancelled one stays cancelled).
      await tx
        .update(notifications)
        .set({ scheduledAt: reminderScheduledAt(date, startTime) })
        .where(
          and(
            eq(notifications.appointmentId, appointmentId),
            eq(notifications.event, "reminder"),
            eq(notifications.status, "Pending"),
          ),
        );
      return updated;
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
  expiresAt: Date | null;
  slotId: number;
  slotDate: string;
  slotStart: string;
  slotEnd: string;
  doctorId: number;
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
      expiresAt: appointments.expiresAt,
      slotId: appointments.slotId,
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
    // Newest booking first: a patient scanning "My bookings"
    // expects the booking they just made on top, not buried in
    // the middle by its appointment date.
    .orderBy(desc(appointments.bookedAt));
  return rows.map((r) => ({
    appointmentId: r.appointmentId,
    status: r.status,
    reason: r.reason,
    bookedAt: r.bookedAt,
    expiresAt: r.expiresAt,
    slotId: r.slotId,
    slotDate: toISODate(r.slotDate),
    slotStart: toHHMM(r.slotStart),
    slotEnd: toHHMM(r.slotEnd),
    doctorId: r.doctorId,
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
      expiresAt: appointments.expiresAt,
      slotId: appointments.slotId,
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
    expiresAt: r.expiresAt,
    slotId: r.slotId,
    slotDate: toISODate(r.slotDate),
    slotStart: toHHMM(r.slotStart),
    slotEnd: toHHMM(r.slotEnd),
    doctorId,
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
  // A Pending hold belongs to the patient until it is paid or
  // expires: a doctor cannot cancel it (the doctor dashboard
  // offers no action on Pending cards either; this guards forged
  // requests). Expiry is handled by the sweep, not by this path.
  if (appt.status === "Pending" && actor.patientId === undefined) {
    throw new Error(
      "Only the patient can cancel a booking that is still awaiting payment.",
    );
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
  if (newStatus === "Cancelled" || newStatus === "Completed") {
    // Day 4 Stage C: a dead appointment is never reminded. The
    // cron's own guard would skip it anyway, but killing the
    // reminder here keeps the audit trail truthful. Best-effort:
    // a failure here must never undo the status change.
    try {
      await db
        .update(notifications)
        .set({ status: "Cancelled" })
        .where(
          and(
            eq(notifications.appointmentId, appointmentId),
            eq(notifications.event, "reminder"),
            eq(notifications.status, "Pending"),
          ),
        );
    } catch (err) {
      console.error("Cancelling reminders failed:", err);
    }
  }
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
        liveBookingCondition(),
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
          liveBookingCondition(),
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
