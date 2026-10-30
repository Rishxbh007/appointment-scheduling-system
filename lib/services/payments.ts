// Payment business logic — Day 4 Stage A (Razorpay, pay before
// confirmation). Plain database functions; callers (server actions,
// the webhook route) resolve the session or the signature first.
//
// Money rules that matter:
//   * A booking is Pending, never Booked, until a payment verifies.
//     The 15-minute hold (expires_at) is the only thing standing
//     between a Pending booking and a freed slot.
//   * One payment row per attempt. Retry never reuses a row: the old
//     Pending rows are superseded (Expired) so an old order can
//     never confirm a booking after a retry.
//   * Verify and the webhook both confirm through Pending-guarded
//     updates, so whichever lands first wins and the second is a
//     harmless no-op — a double delivery can never double-confirm.
//   * Abandon/failure never touch the appointment: the hold stays
//     Pending until it is paid, cancelled, or expired.
//   * Fail-closed: without Razorpay keys nothing is created at all.
//     A paid booking is never fake-confirmed.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  appointments,
  doctors,
  notifications,
  payments,
  type Payment,
} from "@/lib/db/schema";
import {
  bookAppointment,
  feeToPaise,
  getSlotDoctorFee,
  liveBookingCondition,
} from "./booking";
import {
  createRazorpayOrder,
  isRazorpayConfigured,
  verifyRazorpaySignature,
} from "./razorpay";
import { toHHMM, toISODate, isSlotInFuture } from "@/lib/time";

/** Pending hold length for a new paid booking. */
export const PENDING_HOLD_MS = 15 * 60 * 1000;

export type PendingPaymentInfo = {
  paymentId: number;
  appointmentId: number;
  orderId: string | null;
  status: string;
  amountPaise: number;
};

/**
 * Create a Pending booking and its Razorpay order. Keys are checked
 * before any database write (fail closed, create nothing). The
 * appointment and its first payment row are created together by
 * bookAppointment; the order id is stored after Razorpay answers.
 * If order creation fails, the hold is released and the payment
 * row is marked Failed, so no unpaid hold lingers.
 */
export async function createPendingBookingWithOrder(
  patientId: number,
  slotId: number,
  reason: string,
) {
  if (!isRazorpayConfigured()) {
    throw new Error("Payments are not set up yet.");
  }
  const amountPaise = await getSlotDoctorFee(slotId);
  if (amountPaise === null) {
    throw new Error("This doctor does not have a consultation fee set.");
  }
  const expiresAt = new Date(Date.now() + PENDING_HOLD_MS);
  const appointment = await bookAppointment(patientId, slotId, reason, {
    status: "Pending",
    expiresAt,
    amountPaise,
  });
  const [payment] = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.appointmentId, appointment.appointmentId),
        eq(payments.status, "Pending"),
      ),
    )
    .orderBy(desc(payments.createdAt))
    .limit(1);
  if (!payment) {
    // Cannot happen unless the insert above was lost: release the
    // hold rather than leave a Pending booking with no payment.
    await db
      .update(appointments)
      .set({ status: "Cancelled" })
      .where(eq(appointments.appointmentId, appointment.appointmentId));
    throw new Error("Could not start the payment. Please try again.");
  }
  try {
    const orderId = await createRazorpayOrder({
      amountPaise,
      receipt: String(appointment.appointmentId),
    });
    await db
      .update(payments)
      .set({ razorpayOrderId: orderId })
      .where(eq(payments.paymentId, payment.paymentId));
    return { appointment, payment, orderId, amountPaise, expiresAt };
  } catch (err) {
    // Compensate: release the hold and fail the payment row. If
    // compensation itself fails it is logged, not thrown — the
    // caller already reports the order failure.
    try {
      await db
        .update(appointments)
        .set({ status: "Cancelled" })
        .where(eq(appointments.appointmentId, appointment.appointmentId));
      await db
        .update(payments)
        .set({ status: "Failed" })
        .where(eq(payments.paymentId, payment.paymentId));
    } catch (compErr) {
      console.error("Payment compensation failed:", compErr);
    }
    throw err;
  }
}

/**
 * Verify a Checkout.js success payload and confirm the booking.
 * Checks, in order: signature (fail fast, no database trust),
 * payment row exists, appointment belongs to this patient, amount
 * matches the doctor's current DB fee. The confirm itself runs in
 * one transaction with row locks and Pending guards: a payment
 * already marked Paid (webhook won the race) reports success
 * instead of erroring, so a double confirmation is impossible.
 */
export async function verifyPayment(
  input: { orderId: string; paymentId: string; signature: string },
  patientId: number,
) {
  if (!isRazorpayConfigured()) {
    throw new Error("Payments are not set up yet.");
  }
  if (
    !verifyRazorpaySignature(input.orderId, input.paymentId, input.signature)
  ) {
    throw new Error(
      "Payment verification failed. If you were charged, your booking usually confirms within moments — check your dashboard.",
    );
  }
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.razorpayOrderId, input.orderId));
  if (!payment) throw new Error("Payment record not found.");
  const [appt] = await db
    .select()
    .from(appointments)
    .where(eq(appointments.appointmentId, payment.appointmentId));
  if (!appt) throw new Error("Appointment not found.");
  if (appt.patientId !== patientId) {
    throw new Error("This payment belongs to another patient.");
  }
  const [doctor] = await db
    .select()
    .from(doctors)
    .where(eq(doctors.doctorId, appt.doctorId));
  const expected = doctor ? feeToPaise(doctor.consultationFee) : null;
  if (expected === null || payment.amountPaise !== expected) {
    throw new Error(
      "Payment amount does not match the consultation fee.",
    );
  }

  return db.transaction(async (tx) => {
    const lockedPay = await tx.execute(
      sql`SELECT payment_id, status FROM payments WHERE payment_id = ${payment.paymentId} FOR UPDATE`,
    );
    const payRow = (lockedPay.rows as Record<string, unknown>[])[0];
    if (!payRow) throw new Error("Payment record not found.");
    if (payRow.status === "Paid") {
      return { alreadyPaid: true, appointmentId: appt.appointmentId };
    }
    if (payRow.status !== "Pending") {
      throw new Error("This payment is no longer valid.");
    }
    const lockedAppt = await tx.execute(
      sql`SELECT appointment_id, status FROM appointments WHERE appointment_id = ${appt.appointmentId} FOR UPDATE`,
    );
    const apptRow = (lockedAppt.rows as Record<string, unknown>[])[0];
    if (!apptRow) throw new Error("Appointment not found.");
    if (apptRow.status !== "Pending") {
      throw new Error("This booking is no longer awaiting payment.");
    }
    await tx
      .update(payments)
      .set({ status: "Paid", razorpayPaymentId: input.paymentId })
      .where(eq(payments.paymentId, payment.paymentId));
    await tx
      .update(appointments)
      .set({ status: "Booked", expiresAt: null })
      .where(eq(appointments.appointmentId, appt.appointmentId));
    return { alreadyPaid: false, appointmentId: appt.appointmentId };
  });
}

/**
 * Mark one payment attempt Abandoned (checkout dismissed) or Failed
 * (checkout reported a failure). Guarded to Pending rows only, so a
 * payment that already verified is never overwritten. The
 * appointment deliberately stays Pending: the hold, the dashboard
 * Pay/Retry control, and the sweep still own its fate.
 * Returns whether a row actually transitioned (Day 4 Stage C:
 * the payment_failed email fires only on a real transition, so a
 * webhook that already failed the row does not produce a second
 * mail), plus the appointment and amount for that mail.
 */
export async function markPaymentAttempt(
  orderId: string,
  patientId: number,
  status: "Abandoned" | "Failed",
) {
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.razorpayOrderId, orderId));
  if (!payment) throw new Error("Payment record not found.");
  const [appt] = await db
    .select()
    .from(appointments)
    .where(eq(appointments.appointmentId, payment.appointmentId));
  if (!appt) throw new Error("Appointment not found.");
  if (appt.patientId !== patientId) {
    throw new Error("This payment belongs to another patient.");
  }
  const [changed] = await db
    .update(payments)
    .set({ status })
    .where(
      and(
        eq(payments.paymentId, payment.paymentId),
        eq(payments.status, "Pending"),
      ),
    )
    .returning();
  return {
    ok: true,
    transitioned: changed !== undefined,
    appointmentId: payment.appointmentId,
    amountPaise: payment.amountPaise,
  };
}

/**
 * Retry payment on a Pending booking: a NEW payment row and a NEW
 * Razorpay order, and the hold deadline refreshes to 15 minutes
 * from now. The order is created first so a provider failure leaves
 * the booking untouched; then one transaction supersedes the old
 * Pending payment rows (Expired — an old order can never confirm
 * afterwards), inserts the new row, and refreshes expires_at.
 * Capacity is re-checked inside that transaction, excluding this
 * booking's own hold, so a retry cannot overbook a slot that
 * filled up while the hold was open. A hold whose slot time has
 * passed cannot be retried.
 */
export async function retryPayment(
  appointmentId: number,
  patientId: number,
) {
  if (!isRazorpayConfigured()) {
    throw new Error("Payments are not set up yet.");
  }
  const [appt] = await db
    .select()
    .from(appointments)
    .where(eq(appointments.appointmentId, appointmentId));
  if (!appt) throw new Error("Appointment not found.");
  if (appt.patientId !== patientId) {
    throw new Error("This payment belongs to another patient.");
  }
  if (appt.status !== "Pending") {
    throw new Error("Only bookings awaiting payment can be retried.");
  }
  const [latest] = await db
    .select()
    .from(payments)
    .where(eq(payments.appointmentId, appointmentId))
    .orderBy(desc(payments.createdAt))
    .limit(1);
  const amountPaise =
    latest?.amountPaise ?? (await getSlotDoctorFee(appt.slotId));
  if (amountPaise === null) {
    throw new Error("The consultation fee could not be determined.");
  }
  const orderId = await createRazorpayOrder({
    amountPaise,
    receipt: String(appointmentId),
  });
  const expiresAt = new Date(Date.now() + PENDING_HOLD_MS);
  await db.transaction(async (tx) => {
    const locked = await tx.execute(
      sql`SELECT slot_id, max_appointments, date, start_time
          FROM slots WHERE slot_id = ${appt.slotId} FOR UPDATE`,
    );
    const slotRow = (locked.rows as Record<string, unknown>[])[0];
    if (!slotRow) throw new Error("That time slot no longer exists.");
    if (
      !isSlotInFuture(
        toISODate(slotRow.date),
        toHHMM(slotRow.start_time),
      )
    ) {
      throw new Error("That time slot has passed.");
    }
    const countRows = await tx
      .select({ n: sql<number>`count(*)` })
      .from(appointments)
      .where(
        and(
          eq(appointments.slotId, appt.slotId),
          liveBookingCondition(),
          sql`${appointments.appointmentId} != ${appointmentId}`,
        ),
      );
    const booked = Number(countRows[0]?.n ?? 0);
    if (booked >= Number(slotRow.max_appointments)) {
      throw new Error("That time slot is fully booked.");
    }
    // The appointment must still be Pending: a concurrent
    // cancellation, confirmation, or sweep between the checks
    // above and this update must not be revived by a retry.
    const [updated] = await tx
      .update(appointments)
      .set({ expiresAt })
      .where(
        and(
          eq(appointments.appointmentId, appointmentId),
          eq(appointments.status, "Pending"),
        ),
      )
      .returning();
    if (!updated) {
      throw new Error("This booking is no longer awaiting payment.");
    }
    await tx
      .update(payments)
      .set({ status: "Expired" })
      .where(
        and(
          eq(payments.appointmentId, appointmentId),
          eq(payments.status, "Pending"),
        ),
      );
    await tx.insert(payments).values({
      appointmentId,
      razorpayOrderId: orderId,
      amountPaise,
      currency: "INR",
      status: "Pending",
    });
  });
  return { orderId, amountPaise, expiresAt };
}

/**
 * When a patient cancels a Pending booking, its payment attempts
 * die with it (Expired). Only Pending rows are touched: a Paid
 * row is never rewritten here (refunds are Stage B). Called
 * best-effort after a successful cancel — a failure here must not
 * undo the cancel, and the verify/webhook guards still prevent a
 * stray payment from confirming a cancelled booking.
 */
export async function cancelPendingPayments(
  appointmentId: number,
): Promise<void> {
  await db
    .update(payments)
    .set({ status: "Expired" })
    .where(
      and(
        eq(payments.appointmentId, appointmentId),
        eq(payments.status, "Pending"),
      ),
    );
}

/** Latest payment attempt per Pending booking of one patient. */export async function getPendingPaymentsForPatient(
  patientId: number,
): Promise<Map<number, PendingPaymentInfo>> {
  const rows = await db
    .select({
      paymentId: payments.paymentId,
      appointmentId: payments.appointmentId,
      orderId: payments.razorpayOrderId,
      status: payments.status,
      amountPaise: payments.amountPaise,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .innerJoin(
      appointments,
      eq(payments.appointmentId, appointments.appointmentId),
    )
    .where(
      and(
        eq(appointments.patientId, patientId),
        eq(appointments.status, "Pending"),
      ),
    )
    .orderBy(desc(payments.createdAt));
  const byAppointment = new Map<number, PendingPaymentInfo>();
  for (const r of rows) {
    if (!byAppointment.has(r.appointmentId)) {
      byAppointment.set(r.appointmentId, {
        paymentId: r.paymentId,
        appointmentId: r.appointmentId,
        orderId: r.orderId,
        status: r.status,
        amountPaise: r.amountPaise,
      });
    }
  }
  return byAppointment;
}

/**
 * Cancel every Pending booking whose payment deadline has passed,
 * and expire its still-Pending payment rows. Day 4 Stage C's cron
 * calls this each run; between runs, lazy expiry in the booking
 * queries keeps the app correct. Swept bookings also lose their
 * Pending reminders (a dead appointment is never reminded).
 * Returns what was swept.
 */
export async function sweepExpiredPendings(): Promise<{
  appointments: number;
  payments: number;
}> {
  const expired = await db.execute(
    sql`UPDATE appointments SET status = 'Cancelled'
        WHERE status = 'Pending' AND expires_at IS NOT NULL
          AND expires_at <= NOW()
        RETURNING appointment_id`,
  );
  const ids = (expired.rows as Record<string, unknown>[])
    .map((r) => r.appointment_id)
    .filter((id): id is number => typeof id === "number");
  if (ids.length === 0) return { appointments: 0, payments: 0 };
  const swept = await db.execute(
    sql`UPDATE payments SET status = 'Expired'
        WHERE status = 'Pending' AND appointment_id IN (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})
        RETURNING payment_id`,
  );
  // Day 4 Stage C: swept holds take their reminders with them.
  await db
    .update(notifications)
    .set({ status: "Cancelled" })
    .where(
      and(
        inArray(notifications.appointmentId, ids),
        eq(notifications.event, "reminder"),
        eq(notifications.status, "Pending"),
      ),
    );
  return { appointments: ids.length, payments: swept.rows.length };
}

/**
 * Day 4 Stage B helper: the Paid payment (if any) for one
 * appointment, as a full row for the refund service. At most one
 * Paid row exists per appointment — confirmation is
 * Pending-guarded on both the verify and webhook paths.
 */
export async function getPaidPaymentByAppointment(
  appointmentId: number,
): Promise<Payment | null> {
  const [row] = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.appointmentId, appointmentId),
        eq(payments.status, "Paid"),
      ),
    )
    .orderBy(desc(payments.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Day 4 Stage B helper: the Paid payment (if any) for each of the
 * given appointments. At most one Paid row exists per appointment
 * — confirmation is Pending-guarded on both the verify and
 * webhook paths — so the map holds at most one entry per id.
 * Used by the doctor dashboard (cancel dialogs that must state
 * the refund).
 */
export async function getPaidPaymentsForAppointments(
  appointmentIds: number[],
): Promise<Map<number, { paymentId: number; amountPaise: number }>> {
  const byAppointment = new Map<
    number,
    { paymentId: number; amountPaise: number }
  >();
  if (appointmentIds.length === 0) return byAppointment;
  const rows = await db
    .select({
      paymentId: payments.paymentId,
      appointmentId: payments.appointmentId,
      amountPaise: payments.amountPaise,
    })
    .from(payments)
    .where(
      and(
        eq(payments.status, "Paid"),
        sql`${payments.appointmentId} IN (${sql.join(
          appointmentIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      ),
    )
    .orderBy(desc(payments.createdAt));
  for (const r of rows) {
    if (!byAppointment.has(r.appointmentId)) {
      byAppointment.set(r.appointmentId, {
        paymentId: r.paymentId,
        amountPaise: r.amountPaise,
      });
    }
  }
  return byAppointment;
}
