// Notification business logic — Day 4 Stage C (email now,
// SMS/WhatsApp-ready). Plain database functions; callers (server
// actions, the webhook route, the cron route) trigger events, and
// this module owns the audit rows and the sending.
//
// Rules that matter:
//   * Every email attempt is a notifications row — never a silent
//     send. Event mail is attempted at once (scheduled_at NULL);
//     reminders are rows scheduled at booking time.
//   * Sending is best-effort and NEVER breaks the triggering
//     action: sendEventEmail catches everything, records the
//     outcome (Sent/Failed + real reason), and never throws.
//     A booking, cancel, reschedule, payment, or refund succeeds
//     or fails on its own merits, never on the mail.
//   * Exactly-once reminders: the cron flips Pending→Sent under a
//     status guard, and only for appointments still
//     Booked/Confirmed whose slot is still in the future.
//     Cancelled/Completed/past appointments are never reminded —
//     their due reminders are marked Cancelled instead.
//   * No reminder mail for unpaid Pending holds: the cron only
//     sends for Booked/Confirmed appointments, so a hold's
//     reminder waits until the hold is paid (or dies with it).
//   * System cancellations send no mail: the sweep and lazy
//     expiry cancel holds silently (they are abandoned holds, not
//     user cancellations). Only user/doctor-initiated cancels
//     produce a booking_cancelled email.
//   * Doctor recipients: booking_created, booking_cancelled and
//     booking_rescheduled email BOTH the patient and the doctor,
//     one notification row per recipient, so the audit trail stays
//     per-recipient. The doctor's mail carries the patient name,
//     date/time and reason — never refund wording (money is the
//     patient's). Payment and refund events stay patient-only, and
//     reminders stay patient-only; no event ever mails the patient
//     twice.
//   * No backfill: reminders are created only by bookAppointment,
//     i.e. for bookings made after Stage C lands. Event emails,
//     by contrast, fire for events on any booking from now on.

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  appointments,
  doctors,
  notifications,
  patients,
  slots,
  users,
  type Notification,
} from "@/lib/db/schema";
import {
  formatDate,
  formatTime,
  isSlotInFuture,
  toHHMM,
  toISODate,
} from "@/lib/time";
import { sendMail } from "./mailer";
import { formatDoctorName } from "@/lib/format";

/** Integer paise → "₹500" (no invented decimals). */
export function formatRupees(amountPaise: number): string {
  return `₹${(amountPaise / 100).toLocaleString("en-IN")}`;
}

/**
 * The UTC instant of a slot's IST wall-clock start. IST has no
 * daylight saving, so the fixed -5:30 offset is exact.
 */
export function slotStartInstant(slotDate: string, slotStart: string): Date {
  const [y, m, d] = toISODate(slotDate).split("-").map(Number);
  const [hh, mm] = toHHMM(slotStart).split(":").map(Number);
  const utcMs = Date.UTC(y, m - 1, d, hh, mm);
  return new Date(utcMs - 5.5 * 60 * 60 * 1000);
}

/** A reminder fires 24 hours before the appointment starts. */
export function reminderScheduledAt(
  slotDate: string,
  slotStart: string,
): Date {
  return new Date(slotStartInstant(slotDate, slotStart).getTime() - 24 * 60 * 60 * 1000);
}

/** Subject + body for a reminder row, built at booking time. */
export function buildReminderContent(
  doctorDisplayName: string,
  slotDate: string,
  slotStart: string,
  slotEnd: string,
): { subject: string; body: string } {
  const when = `${formatDate(slotDate)}, ${formatTime(slotStart)} – ${formatTime(slotEnd)} (IST)`;
  return {
    subject: `Reminder: your appointment with ${doctorDisplayName} is tomorrow`,
    body: [
      "Hi,",
      "",
      `This is a reminder of your upcoming appointment with ${doctorDisplayName}.`,
      "",
      `When: ${when}`,
      "",
      "If you need to change or cancel it, visit your CareBook dashboard.",
      "",
      "— CareBook",
    ].join("\n"),
  };
}

export type AppointmentMailContext = {
  appointmentId: number;
  status: string;
  patientEmail: string;
  patientName: string;
  doctorDisplayName: string;
  doctorEmail: string;
  slotDate: string;
  slotStart: string;
  slotEnd: string;
  reason: string | null;
};

/** Everything an email about one appointment needs. Null when the
 * appointment (or its patient/doctor/slot) cannot be found. */
export async function getAppointmentMailContext(
  appointmentId: number,
): Promise<AppointmentMailContext | null> {
  const [appt] = await db
    .select()
    .from(appointments)
    .where(eq(appointments.appointmentId, appointmentId));
  if (!appt) return null;
  const [patientUser] = await db
    .select({ email: users.email, name: users.name })
    .from(patients)
    .innerJoin(users, eq(patients.userId, users.userId))
    .where(eq(patients.patientId, appt.patientId));
  const [doctorUser] = await db
    .select({ name: users.name, email: users.email })
    .from(doctors)
    .innerJoin(users, eq(doctors.userId, users.userId))
    .where(eq(doctors.doctorId, appt.doctorId));
  const [slot] = await db
    .select()
    .from(slots)
    .where(eq(slots.slotId, appt.slotId));
  if (!patientUser || !doctorUser || !slot) return null;
  return {
    appointmentId: appt.appointmentId,
    status: appt.status,
    patientEmail: patientUser.email,
    patientName: patientUser.name,
    doctorDisplayName: formatDoctorName(doctorUser.name),
    doctorEmail: doctorUser.email,
    slotDate: toISODate(slot.date),
    slotStart: toHHMM(slot.startTime),
    slotEnd: toHHMM(slot.endTime),
    reason: appt.reason,
  };
}

export type EventExtra = {
  amountPaise?: number;
  failureReason?: string | null;
  /** "date at time" label of the slot before a reschedule. */
  previousLabel?: string;
  refundStatus?: "Initiated" | "Failed" | null;
  refundAmountPaise?: number;
  refundFailureReason?: string | null;
};

function whenLabel(ctx: AppointmentMailContext): string {
  return `${formatDate(ctx.slotDate)}, ${formatTime(ctx.slotStart)} – ${formatTime(ctx.slotEnd)} (IST)`;
}

/** Subject + body for one event email. Real details only. */
export function buildEventContent(
  event: string,
  ctx: AppointmentMailContext,
  extra: EventExtra = {},
): { subject: string; body: string } {
  const when = whenLabel(ctx);
  switch (event) {
    case "booking_created":
      return {
        subject: "Your CareBook appointment is confirmed",
        body: [
          "Hi,",
          "",
          `Your appointment with ${ctx.doctorDisplayName} is confirmed.`,
          "",
          `When: ${when}`,
          ...(ctx.reason ? [`Reason you gave: ${ctx.reason}`] : []),
          "",
          "If you need to change or cancel it, visit your CareBook dashboard.",
          "",
          "— CareBook",
        ].join("\n"),
      };
    case "booking_cancelled": {
      const refundLine =
        extra.refundStatus === "Initiated" && extra.refundAmountPaise !== undefined
          ? `A full refund of ${formatRupees(extra.refundAmountPaise)} has been initiated separately. Refunds are tracked on your dashboard — cancelling the appointment does not by itself mean the refund is complete.`
          : extra.refundStatus === "Failed" && extra.refundAmountPaise !== undefined
            ? `We tried to start your full refund of ${formatRupees(extra.refundAmountPaise)} but it could not be started${extra.refundFailureReason ? ` (${extra.refundFailureReason})` : ""}. You can retry it from your dashboard.`
            : null;
      return {
        subject: "Your CareBook appointment has been cancelled",
        body: [
          "Hi,",
          "",
          `Your appointment with ${ctx.doctorDisplayName} on ${when} has been cancelled.`,
          ...(refundLine ? ["", refundLine] : []),
          "",
          "If you would like to see this doctor again, you would need to make a new booking.",
          "",
          "— CareBook",
        ].join("\n"),
      };
    }
    case "booking_rescheduled":
      return {
        subject: "Your CareBook appointment has moved",
        body: [
          "Hi,",
          "",
          `Your appointment with ${ctx.doctorDisplayName} has been rescheduled.`,
          "",
          ...(extra.previousLabel ? [`Was: ${extra.previousLabel}`, ""] : []),
          `Now: ${when}`,
          "",
          "Only the time has changed — everything else about your booking stays the same.",
          "",
          "— CareBook",
        ].join("\n"),
      };
    case "payment_succeeded":
      return {
        subject: "Payment received — your CareBook appointment is confirmed",
        body: [
          "Hi,",
          "",
          `We received your payment${extra.amountPaise !== undefined ? ` of ${formatRupees(extra.amountPaise)}` : ""} for your appointment with ${ctx.doctorDisplayName} on ${when}.`,
          "",
          "Your booking is confirmed.",
          "",
          "— CareBook",
        ].join("\n"),
      };
    case "payment_failed":
      return {
        subject: "Your CareBook payment did not go through",
        body: [
          "Hi,",
          "",
          `Your payment${extra.amountPaise !== undefined ? ` of ${formatRupees(extra.amountPaise)}` : ""} for your appointment with ${ctx.doctorDisplayName} on ${when} did not go through.`,
          "",
          "Your booking is still awaiting payment — you can retry from your dashboard.",
          "",
          "— CareBook",
        ].join("\n"),
      };
    case "refund_initiated":
      return {
        subject: "Your CareBook refund has been initiated",
        body: [
          "Hi,",
          "",
          `A full refund${extra.amountPaise !== undefined ? ` of ${formatRupees(extra.amountPaise)}` : ""} for your cancelled appointment with ${ctx.doctorDisplayName} on ${when} has been initiated.`,
          "",
          "The refund is tracked separately on your dashboard.",
          "",
          "— CareBook",
        ].join("\n"),
      };
    case "refund_processed":
      return {
        subject: "Your CareBook refund has been processed",
        body: [
          "Hi,",
          "",
          `Your refund${extra.amountPaise !== undefined ? ` of ${formatRupees(extra.amountPaise)}` : ""} for your cancelled appointment with ${ctx.doctorDisplayName} on ${when} has been processed.`,
          "",
          "The amount will be returned to your original payment method.",
          "",
          "— CareBook",
        ].join("\n"),
      };
    case "refund_failed":
      return {
        subject: "Your CareBook refund could not be processed",
        body: [
          "Hi,",
          "",
          `Your refund${extra.amountPaise !== undefined ? ` of ${formatRupees(extra.amountPaise)}` : ""} for your cancelled appointment with ${ctx.doctorDisplayName} on ${when} could not be processed${extra.failureReason ? ` (${extra.failureReason})` : ""}.`,
          "",
          "You can retry it from your dashboard.",
          "",
          "— CareBook",
        ].join("\n"),
      };
    default:
      return {
        subject: "CareBook appointment update",
        body: [
          "Hi,",
          "",
          `There is an update about your appointment with ${ctx.doctorDisplayName} on ${when}.`,
          "",
          "Visit your CareBook dashboard for details.",
          "",
          "— CareBook",
        ].join("\n"),
      };
  }
}

/** Events that email the doctor as well as the patient. Every
 * other event is patient-only: payment and refund mail is the
 * patient's money, and reminders stay patient-only. */
const DOCTOR_RECIPIENT_EVENTS = new Set([
  "booking_created",
  "booking_cancelled",
  "booking_rescheduled",
]);

/** Subject + body for the DOCTOR's copy of an event email. The
 * patient name, date/time and reason are the point of the mail;
 * refund wording is deliberately absent — a refund belongs to
 * the patient's mail, never the doctor's. */
export function buildDoctorEventContent(
  event: string,
  ctx: AppointmentMailContext,
  extra: EventExtra = {},
): { subject: string; body: string } {
  const when = whenLabel(ctx);
  switch (event) {
    case "booking_created":
      return {
        subject: `New appointment booked by ${ctx.patientName}`,
        body: [
          "Hi,",
          "",
          `${ctx.patientName} has booked an appointment with you.`,
          "",
          `When: ${when}`,
          ...(ctx.reason ? [`Reason given: ${ctx.reason}`] : []),
          "",
          "You can confirm or manage it from your CareBook dashboard.",
          "",
          "— CareBook",
        ].join("\n"),
      };
    case "booking_cancelled":
      return {
        subject: `Appointment with ${ctx.patientName} cancelled`,
        body: [
          "Hi,",
          "",
          `The appointment with ${ctx.patientName} on ${when} has been cancelled.`,
          "",
          "The time slot is free again for other patients.",
          "",
          "— CareBook",
        ].join("\n"),
      };
    case "booking_rescheduled":
      return {
        subject: `Appointment with ${ctx.patientName} moved`,
        body: [
          "Hi,",
          "",
          `The appointment with ${ctx.patientName} has been rescheduled.`,
          "",
          ...(extra.previousLabel ? [`Was: ${extra.previousLabel}`, ""] : []),
          `Now: ${when}`,
          "",
          "Only the time has changed — everything else about the booking stays the same.",
          "",
          "— CareBook",
        ].join("\n"),
      };
    default:
      return {
        subject: "CareBook appointment update",
        body: [
          "Hi,",
          "",
          `There is an update about your appointment with ${ctx.patientName} on ${when}.`,
          "",
          "Visit your CareBook dashboard for details.",
          "",
          "— CareBook",
        ].join("\n"),
      };
  }
}

/**
 * Create the audit row for one event email and attempt the send.
 * Best-effort by contract: never throws. A missing mail context,
 * missing SMTP credentials, or a provider failure is recorded
 * (Failed + real reason) or logged — the triggering action is
 * never affected.
 */
/** One recipient's audit row + send attempt. Never throws: a
 * failure is recorded on the row (or logged) and the row is
 * returned, so one recipient's failure never blocks the other. */
async function sendSingleEmail(
  appointmentId: number,
  event: string,
  recipientEmail: string,
  subject: string,
  body: string,
): Promise<Notification | null> {
  let row: Notification;
  try {
    [row] = await db
      .insert(notifications)
      .values({
        appointmentId,
        channel: "email",
        event,
        recipientEmail,
        subject,
        body,
        status: "Pending",
        scheduledAt: null,
      })
      .returning();
  } catch (err) {
    console.error(
      `Notification row insert failed (${event} → ${recipientEmail}):`,
      err,
    );
    return null;
  }
  try {
    await sendMail({ to: recipientEmail, subject, text: body });
    const [sent] = await db
      .update(notifications)
      .set({ status: "Sent", sentAt: new Date() })
      .where(
        and(
          eq(notifications.notificationId, row.notificationId),
          eq(notifications.status, "Pending"),
        ),
      )
      .returning();
    return sent ?? row;
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Send failed.";
    try {
      const [failed] = await db
        .update(notifications)
        .set({ status: "Failed", failureReason: reason })
        .where(
          and(
            eq(notifications.notificationId, row.notificationId),
            eq(notifications.status, "Pending"),
          ),
        )
        .returning();
      return failed ?? row;
    } catch (updateErr) {
      console.error(`Notification status update failed (${event}):`, updateErr);
      return row;
    }
  }
}

export async function sendEventEmail(
  appointmentId: number,
  event: string,
  extra: EventExtra = {},
): Promise<Notification | null> {
  let ctx: AppointmentMailContext | null;
  try {
    ctx = await getAppointmentMailContext(appointmentId);
  } catch (err) {
    console.error(`Notification context load failed (${event}):`, err);
    return null;
  }
  if (!ctx) {
    console.error(
      `Notification skipped (${event}): no mail context for appointment ${appointmentId}.`,
    );
    return null;
  }
  // The patient always gets exactly one mail for the event.
  const { subject, body } = buildEventContent(event, ctx, extra);
  const patientRow = await sendSingleEmail(
    appointmentId,
    event,
    ctx.patientEmail,
    subject,
    body,
  );
  // Booking lifecycle events also mail the doctor — a second row,
  // a second recipient, never a second mail to the patient.
  if (DOCTOR_RECIPIENT_EVENTS.has(event) && ctx.doctorEmail) {
    const doctorContent = buildDoctorEventContent(event, ctx, extra);
    await sendSingleEmail(
      appointmentId,
      event,
      ctx.doctorEmail,
      doctorContent.subject,
      doctorContent.body,
    );
  }
  return patientRow;
}

export type DueReminderCounts = {
  sent: number;
  skipped: number;
  failed: number;
  cancelled: number;
};

/**
 * Send every reminder that is due. Due = scheduled_at reached,
 * still Pending, appointment still Booked/Confirmed, slot still
 * in the future. Anything else due is cleaned up, not sent:
 * Cancelled/Completed/past appointments get their reminder
 * marked Cancelled; unpaid Pending holds are skipped (left
 * Pending — they may still be paid, or die with the hold).
 * The Pending→Sent flip is status-guarded, so a concurrent run
 * cannot double-send the same reminder.
 */
export async function processDueReminders(): Promise<DueReminderCounts> {
  const counts: DueReminderCounts = {
    sent: 0,
    skipped: 0,
    failed: 0,
    cancelled: 0,
  };
  const due = await db
    .select({
      notificationId: notifications.notificationId,
      appointmentId: notifications.appointmentId,
      recipientEmail: notifications.recipientEmail,
      subject: notifications.subject,
      body: notifications.body,
      appointmentStatus: appointments.status,
      slotDate: slots.date,
      slotStart: slots.startTime,
    })
    .from(notifications)
    .innerJoin(
      appointments,
      eq(notifications.appointmentId, appointments.appointmentId),
    )
    .innerJoin(slots, eq(appointments.slotId, slots.slotId))
    .where(
      and(
        eq(notifications.event, "reminder"),
        eq(notifications.status, "Pending"),
        sql`notifications.scheduled_at <= NOW()`,
      ),
    );
  for (const row of due) {
    const appointmentId = row.appointmentId;
    if (appointmentId === null) {
      counts.cancelled += 1;
      continue;
    }
    if (
      row.appointmentStatus === "Cancelled" ||
      row.appointmentStatus === "Completed" ||
      !isSlotInFuture(toISODate(row.slotDate), toHHMM(row.slotStart))
    ) {
      await db
        .update(notifications)
        .set({ status: "Cancelled" })
        .where(
          and(
            eq(notifications.notificationId, row.notificationId),
            eq(notifications.status, "Pending"),
          ),
        );
      counts.cancelled += 1;
      continue;
    }
    if (row.appointmentStatus !== "Booked" && row.appointmentStatus !== "Confirmed") {
      // Unpaid Pending hold: leave the reminder Pending. It fires
      // if the hold is paid in time, and dies with the hold if
      // the sweep cancels it.
      counts.skipped += 1;
      continue;
    }
    try {
      await sendMail({
        to: row.recipientEmail,
        subject: row.subject,
        text: row.body,
      });
      const [sent] = await db
        .update(notifications)
        .set({ status: "Sent", sentAt: new Date() })
        .where(
          and(
            eq(notifications.notificationId, row.notificationId),
            eq(notifications.status, "Pending"),
          ),
        )
        .returning();
      if (sent) counts.sent += 1;
      else counts.skipped += 1; // a concurrent run claimed it
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Send failed.";
      await db
        .update(notifications)
        .set({ status: "Failed", failureReason: reason })
        .where(
          and(
            eq(notifications.notificationId, row.notificationId),
            eq(notifications.status, "Pending"),
          ),
        );
      counts.failed += 1;
    }
  }
  return counts;
}
