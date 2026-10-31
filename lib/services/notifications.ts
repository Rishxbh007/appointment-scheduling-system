// Notification business logic — Day 4 Stage C (email now,
// SMS/WhatsApp-ready) extended by Day 5 into the full outbox:
// email + SMS channels, dedup, retries, configurable reminders,
// and patient SMS preferences. Plain database functions;
// callers (server actions, the webhook route, the cron route)
// trigger events, and this module owns the audit rows and the
// sending.
//
// Rules that matter:
//   * Every notification attempt is a notifications row — never
//     a silent send. Event mail is attempted at once
//     (scheduled_at NULL); reminders are rows scheduled at
//     booking time, one per configured interval.
//   * Sending is best-effort and NEVER breaks the triggering
//     action: sendEventEmail catches everything, records the
//     outcome (Sent/Failed + real reason), and never throws.
//     A booking, cancel, reschedule, payment, or refund succeeds
//     or fails on its own merits, never on the notification.
//   * Dedup: one row per event + appointment + channel +
//     recipient (and per scheduled instant for reminders). A
//     repeat trigger collides on dedup_key and sends nothing —
//     so a double-fired booking_created (free + paid paths)
//     can never mail the patient twice.
//   * Retries: a failed row is retried by the cron while
//     attempts < max (default 3) and its next attempt is due.
//     A provider failure is recorded with the real reason and
//     never hidden; an exhausted row stays Failed, visible in
//     the audit table and the cron report.
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
//     produce a booking_cancelled notification.
//   * Recipients: booking_created, booking_cancelled and
//     booking_rescheduled email BOTH the patient and the doctor,
//     one notification row per recipient, so the audit trail stays
//     per-recipient. Payment and refund events stay patient-only,
//     and reminders stay patient-only; no event ever mails the
//     patient twice. SMS is patient-only, and only for patients
//     who opted in and have a phone number on file; doctors stay
//     email-only. SMS content is a short version of the event,
//     never the full mail.
//   * Content rule (Day 5): no notification — email or SMS,
//     patient or doctor — ever carries the visit reason or any
//     other medical detail. The reason lives on the appointment
//     record and the dashboard, where it belongs; notifications
//     carry only who, when, and what changed. Refund wording
//     stays patient-only (money is the patient's).
//   * No backfill: reminders are created only by bookAppointment,
//     i.e. for bookings made after Stage C lands. Event emails,
//     by contrast, fire for events on any booking from now on.
//     The same holds for SMS: opting in later does not create
//     SMS reminders for bookings made before the opt-in.

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  appointments,
  doctors,
  notificationPreferences,
  notifications,
  patients,
  slots,
  users,
  type Notification,
  type NotificationPreference,
} from "@/lib/db/schema";
import {
  formatDate,
  formatTime,
  isSlotInFuture,
  toHHMM,
  toISODate,
} from "@/lib/time";
import { sendMail } from "./mailer";
import { sendSms } from "./sms";
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
  return reminderScheduledAtHours(slotDate, slotStart, 24);
}

/** A reminder fires `hoursBefore` hours before the appointment starts. */
export function reminderScheduledAtHours(
  slotDate: string,
  slotStart: string,
  hoursBefore: number,
): Date {
  return new Date(
    slotStartInstant(slotDate, slotStart).getTime() -
      hoursBefore * 60 * 60 * 1000,
  );
}

/**
 * Parse REMINDER_INTERVALS_HOURS ("24,1") into sorted, deduped
 * hour values. Only whole hours from 1 to 168 (a week) count;
 * anything else is ignored, and an empty/invalid value falls
 * back to the 24-hour default. Pure, so it is unit-tested.
 */
export function parseReminderIntervals(
  raw: string | undefined | null,
): number[] {
  const parsed = (raw ?? "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter(
      (n) => Number.isInteger(n) && n >= 1 && n <= 168,
    );
  const unique = [...new Set(parsed)].sort((a, b) => b - a);
  return unique.length > 0 ? unique : [24];
}

/** The configured reminder intervals, latest first. */
export function getReminderIntervals(): number[] {
  return parseReminderIntervals(process.env.REMINDER_INTERVALS_HOURS);
}

/** Subject + body for a reminder row, built at booking time. The
 * subject names the interval honestly: "tomorrow" only for the
 * 24-hour reminder, "in N hours" for every other interval. */
export function buildReminderContent(
  doctorDisplayName: string,
  slotDate: string,
  slotStart: string,
  slotEnd: string,
  hoursBefore: number = 24,
): { subject: string; body: string } {
  const when = `${formatDate(slotDate)}, ${formatTime(slotStart)} – ${formatTime(slotEnd)} (IST)`;
  const timing =
    hoursBefore === 24
      ? "is tomorrow"
      : hoursBefore === 1
        ? "is in 1 hour"
        : `is in ${hoursBefore} hours`;
  return {
    subject: `Reminder: your appointment with ${doctorDisplayName} ${timing}`,
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

/**
 * The SMS version of a reminder: one short line — doctor and
 * when, nothing else. No reason, no medical detail, and no
 * subject is sent (the row's subject is only the audit label).
 */
export function buildSmsReminderContent(
  doctorDisplayName: string,
  slotDate: string,
  slotStart: string,
  slotEnd: string,
): { subject: string; body: string } {
  const when = `${formatDate(slotDate)}, ${formatTime(slotStart)} – ${formatTime(slotEnd)} (IST)`;
  return {
    subject: "CareBook appointment reminder",
    body: `CareBook reminder: appointment with ${doctorDisplayName} on ${when}.`,
  };
}

export type AppointmentMailContext = {
  appointmentId: number;
  status: string;
  patientUserId: number;
  patientEmail: string;
  patientName: string;
  patientPhone: string | null;
  doctorDisplayName: string;
  doctorEmail: string;
  slotDate: string;
  slotStart: string;
  slotEnd: string;
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
    .select({
      userId: patients.userId,
      email: users.email,
      name: users.name,
      phone: users.phone,
    })
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
    patientUserId: patientUser.userId,
    patientEmail: patientUser.email,
    patientName: patientUser.name,
    patientPhone: patientUser.phone,
    doctorDisplayName: formatDoctorName(doctorUser.name),
    doctorEmail: doctorUser.email,
    slotDate: toISODate(slot.date),
    slotStart: toHHMM(slot.startTime),
    slotEnd: toHHMM(slot.endTime),
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
 * patient name and date/time are the point of the mail; the
 * visit reason is deliberately absent — Day 5's content rule
 * keeps medical detail out of notifications — and refund
 * wording is deliberately absent too, because a refund belongs
 * to the patient's mail, never the doctor's. */
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
 * The SMS version of an event: one short line per event — who,
 * when, what changed, and the money line where the event is
 * about money. Never the visit reason, never medical detail,
 * never the full mail. The row's subject is only the audit
 * label; the body is what is actually sent.
 */
export function buildSmsContent(
  event: string,
  ctx: AppointmentMailContext,
  extra: EventExtra = {},
): { subject: string; body: string } {
  const when = whenLabel(ctx);
  const amount =
    extra.amountPaise !== undefined
      ? formatRupees(extra.amountPaise)
      : null;
  switch (event) {
    case "booking_created":
      return {
        subject: "Appointment confirmed",
        body: `CareBook: appointment with ${ctx.doctorDisplayName} confirmed for ${when}.`,
      };
    case "booking_cancelled": {
      const refundLine =
        extra.refundStatus === "Initiated" &&
        extra.refundAmountPaise !== undefined
          ? ` Full refund of ${formatRupees(extra.refundAmountPaise)} initiated.`
          : extra.refundStatus === "Failed" &&
              extra.refundAmountPaise !== undefined
            ? ` Refund could not be started — retry from your dashboard.`
            : "";
      return {
        subject: "Appointment cancelled",
        body: `CareBook: appointment with ${ctx.doctorDisplayName} on ${when} cancelled.${refundLine}`,
      };
    }
    case "booking_rescheduled":
      return {
        subject: "Appointment moved",
        body: `CareBook: appointment with ${ctx.doctorDisplayName} moved to ${when}.`,
      };
    case "payment_succeeded":
      return {
        subject: "Payment received",
        body: `CareBook: payment${amount ? ` of ${amount}` : ""} received — appointment with ${ctx.doctorDisplayName} on ${when} confirmed.`,
      };
    case "payment_failed":
      return {
        subject: "Payment failed",
        body: `CareBook: payment${amount ? ` of ${amount}` : ""} for ${ctx.doctorDisplayName} on ${when} did not go through. Retry from your dashboard.`,
      };
    case "refund_initiated":
      return {
        subject: "Refund initiated",
        body: `CareBook: refund${amount ? ` of ${amount}` : ""} for your cancelled appointment with ${ctx.doctorDisplayName} initiated.`,
      };
    case "refund_processed":
      return {
        subject: "Refund processed",
        body: `CareBook: refund${amount ? ` of ${amount}` : ""} for your cancelled appointment with ${ctx.doctorDisplayName} processed.`,
      };
    case "refund_failed":
      return {
        subject: "Refund failed",
        body: `CareBook: refund${amount ? ` of ${amount}` : ""} for your cancelled appointment with ${ctx.doctorDisplayName} could not be processed. Retry from your dashboard.`,
      };
    default:
      return {
        subject: "CareBook update",
        body: `CareBook: update about your appointment with ${ctx.doctorDisplayName} on ${when}. See your dashboard.`,
      };
  }
}

/**
 * Plain-words label for one event, for the notifications page.
 * Pure, so it is unit-tested.
 */
export function notificationEventLabel(event: string): string {
  switch (event) {
    case "booking_created":
      return "Appointment confirmed";
    case "booking_cancelled":
      return "Appointment cancelled";
    case "booking_rescheduled":
      return "Appointment moved";
    case "payment_succeeded":
      return "Payment received";
    case "payment_failed":
      return "Payment failed";
    case "refund_initiated":
      return "Refund initiated";
    case "refund_processed":
      return "Refund processed";
    case "refund_failed":
      return "Refund failed";
    case "reminder":
      return "Appointment reminder";
    default:
      return "Appointment update";
  }
}

/**
 * What the notifications page shows for one row's status. A
 * log-driver SMS row is NOT "Sent" in any sense the user
 * cares about — no phone received it — so it reads "Logged".
 * Every other row reads its real status. Pure, unit-tested.
 */
export function notificationDisplayStatus(
  channel: string,
  status: string,
  providerRef: string | null,
): string {
  if (
    channel === "sms" &&
    status === "Sent" &&
    providerRef !== null &&
    providerRef.startsWith("log-")
  ) {
    return "Logged";
  }
  return status;
}

/** One row of the notifications page: the real outbox row, newest first. */
export type NotificationHistoryRow = {
  notificationId: number;
  appointmentId: number | null;
  channel: string;
  event: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: Date | null;
  sentAt: Date | null;
  failureReason: string | null;
  providerRef: string | null;
  createdAt: Date;
};

const NOTIFICATION_HISTORY_LIMIT = 50;

const historyColumns = {
  notificationId: notifications.notificationId,
  appointmentId: notifications.appointmentId,
  channel: notifications.channel,
  event: notifications.event,
  subject: notifications.subject,
  body: notifications.body,
  status: notifications.status,
  scheduledAt: notifications.scheduledAt,
  sentAt: notifications.sentAt,
  failureReason: notifications.failureReason,
  providerRef: notifications.providerRef,
  createdAt: notifications.createdAt,
};

/**
 * The patient's own notifications (both channels), newest
 * first. These are the real outbox rows — including past
 * emails from before this page existed — never demo entries.
 */
export async function listNotificationsForPatient(
  patientId: number,
): Promise<NotificationHistoryRow[]> {
  return db
    .select(historyColumns)
    .from(notifications)
    .innerJoin(
      appointments,
      eq(notifications.appointmentId, appointments.appointmentId),
    )
    .where(eq(appointments.patientId, patientId))
    .orderBy(desc(notifications.createdAt))
    .limit(NOTIFICATION_HISTORY_LIMIT);
}

/**
 * The doctor's notifications: only the rows addressed to them
 * (their email), never the patient's rows for the same
 * appointments. Doctors are email-only, so these are all email.
 */
export async function listNotificationsForDoctor(
  doctorId: number,
  doctorEmail: string,
): Promise<NotificationHistoryRow[]> {
  return db
    .select(historyColumns)
    .from(notifications)
    .innerJoin(
      appointments,
      eq(notifications.appointmentId, appointments.appointmentId),
    )
    .where(
      and(
        eq(appointments.doctorId, doctorId),
        eq(notifications.recipientEmail, doctorEmail),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(NOTIFICATION_HISTORY_LIMIT);
}

/**
 * The dedup key for one notification row. Event rows dedup on
 * event + appointment + channel + recipient, so a repeat trigger
 * for the same recipient sends nothing twice — while a
 * different recipient (patient vs doctor) still gets their own
 * row. Reminder rows also carry their scheduled instant, so two
 * intervals for the same appointment are distinct rows and a
 * reschedule (which rewrites the instant) recomputes the key.
 * Pure, so it is unit-tested.
 */
export function dedupKeyFor(args: {
  event: string;
  appointmentId: number;
  channel: string;
  recipient: string;
  scheduledAt?: Date | null;
}): string {
  const base = `${args.event}:${args.appointmentId}:${args.channel}:${args.recipient}`;
  return args.event === "reminder" && args.scheduledAt
    ? `${base}:${args.scheduledAt.toISOString()}`
    : base;
}

/** Max send attempts per row (env NOTIFICATION_MAX_ATTEMPTS, default 3). */
export function getMaxAttempts(): number {
  const parsed = Number(process.env.NOTIFICATION_MAX_ATTEMPTS ?? 3);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 3;
}

/** Base retry delay in minutes (env NOTIFICATION_RETRY_DELAY_MINUTES, default 30). */
export function getRetryDelayMinutes(): number {
  const parsed = Number(process.env.NOTIFICATION_RETRY_DELAY_MINUTES ?? 30);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 30;
}

/**
 * Delay before the Nth attempt's retry: the base delay times the
 * attempt number (30, 60, 90 minutes by default). Linear, not
 * exponential — a provider outage clears in hours, not days.
 */
export function retryDelayMs(
  attempts: number,
  delayMinutes: number = getRetryDelayMinutes(),
): number {
  return delayMinutes * attempts * 60 * 1000;
}

/** True while the row still has attempts left. */
export function shouldRetry(
  attempts: number,
  maxAttempts: number = getMaxAttempts(),
): boolean {
  return attempts < maxAttempts;
}

/** When the next retry of a row is due (now + delay). */
export function nextAttemptAt(
  attempts: number,
  now: Date = new Date(),
): Date {
  return new Date(now.getTime() + retryDelayMs(attempts));
}

/**
 * The patient's preferences row, or null. The lookup itself
 * never throws: null covers both "never set" and "lookup
 * failed". Callers that must tell those apart (the cron's
 * opt-in re-check) use getSmsOptIn instead; the dashboard
 * banner treats both as "ask", which is safe because
 * answering is idempotent and the action is the source of
 * truth.
 */
async function selectPreferencesRow(
  userId: number,
): Promise<NotificationPreference | null> {
  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
  return row ?? null;
}

/**
 * The patient's SMS opt-in. True only when a preferences row
 * says so; false when the row is missing or says no. Null when
 * the lookup itself failed — callers must NOT treat a lookup
 * failure as an opt-out (a DB blip must never cancel reminders).
 */
export async function getSmsOptIn(userId: number): Promise<boolean | null> {
  try {
    const row = await selectPreferencesRow(userId);
    return row?.smsOptIn ?? false;
  } catch (err) {
    console.error(`SMS opt-in lookup failed (user ${userId}):`, err);
    return null;
  }
}

/**
 * The patient's preferences row, or null when they have never
 * set one (or the lookup failed). Null is what drives the
 * first-visit consent banner: no row means the app has never
 * asked, so it asks once, at the top of the dashboard — and
 * never again after any answer.
 */
export async function getNotificationPreferences(
  userId: number,
): Promise<NotificationPreference | null> {
  try {
    return await selectPreferencesRow(userId);
  } catch (err) {
    console.error(
      `Notification preferences lookup failed (user ${userId}):`,
      err,
    );
    return null;
  }
}

/**
 * Set the patient's SMS opt-in. Opting out cancels their
 * Pending SMS reminders at once — an opt-out that still sends
 * is not an opt-out.
 */
export async function setSmsOptIn(
  userId: number,
  optIn: boolean,
): Promise<void> {
  await db
    .insert(notificationPreferences)
    .values({ userId, smsOptIn: optIn })
    .onConflictDoUpdate({
      target: notificationPreferences.userId,
      set: { smsOptIn: optIn, updatedAt: new Date() },
    });
  if (!optIn) {
    await cancelPendingSmsRemindersForUser(userId);
  }
}

/**
 * Cancel every Pending SMS reminder for one user's appointments.
 * Returns how many rows were cancelled. Event rows are never
 * touched (they are attempted at once, not scheduled).
 */
export async function cancelPendingSmsRemindersForUser(
  userId: number,
): Promise<number> {
  const appts = await db
    .select({ appointmentId: appointments.appointmentId })
    .from(appointments)
    .innerJoin(patients, eq(appointments.patientId, patients.patientId))
    .where(eq(patients.userId, userId));
  if (appts.length === 0) return 0;
  const ids = appts.map((a) => a.appointmentId);
  const cancelled = await db
    .update(notifications)
    .set({ status: "Cancelled" })
    .where(
      and(
        inArray(notifications.appointmentId, ids),
        eq(notifications.channel, "sms"),
        eq(notifications.event, "reminder"),
        eq(notifications.status, "Pending"),
      ),
    )
    .returning({ notificationId: notifications.notificationId });
  return cancelled.length;
}

type NewNotificationValues = {
  appointmentId: number;
  channel: "email" | "sms";
  event: string;
  recipientEmail: string | null;
  recipientPhone: string | null;
  subject: string;
  body: string;
  scheduledAt: Date | null;
  intervalHours: number | null;
  dedupKey: string;
};

/**
 * Insert one outbox row. On a dedup-key collision the row
 * already exists, so nothing is inserted and null is returned
 * — the caller must NOT send in that case. Never throws: an
 * insert failure is logged and also returns null, so the
 * triggering action is never affected.
 */
async function insertNotificationRow(
  values: NewNotificationValues,
): Promise<Notification | null> {
  try {
    const [row] = await db
      .insert(notifications)
      .values({ ...values, status: "Pending", attempts: 0 })
      .onConflictDoNothing({ target: notifications.dedupKey })
      .returning();
    if (!row) {
      console.log(
        `Notification dedup skipped (${values.event} → ${values.channel}:${values.recipientEmail ?? values.recipientPhone})`,
      );
      return null;
    }
    return row;
  } catch (err) {
    console.error(`Notification row insert failed (${values.event}):`, err);
    return null;
  }
}

/** The fields a send attempt needs — a full row qualifies. */
type SendableRow = Pick<
  Notification,
  | "notificationId"
  | "channel"
  | "recipientEmail"
  | "recipientPhone"
  | "subject"
  | "body"
  | "attempts"
>;

/** What one send attempt ended as. */
type SendOutcome = "sent" | "failed" | "skipped";

/**
 * Attempt one send for a Pending row, through the provider for
 * the row's channel, and record the honest outcome. The final
 * status flip is guarded on Pending, so a concurrent run that
 * already claimed the row wins and this one reports "skipped"
 * instead of double-sending. Never throws.
 *
 * The one case that must never auto-retry: the provider
 * accepted the message but the DB would not record it. That
 * row is parked as a terminal Failed (no next attempt) with a
 * reason that says exactly that — auto-retrying it would
 * double-send. A provider refusal, by contrast, is always safe
 * to retry: nothing was sent.
 */
async function attemptSend(row: SendableRow): Promise<SendOutcome> {
  const attempts = row.attempts + 1;
  let providerRef: string | null;
  try {
    if (row.channel === "sms") {
      if (!row.recipientPhone) throw new Error("no phone number on file");
      providerRef = await sendSms({ to: row.recipientPhone, text: row.body });
    } else {
      if (!row.recipientEmail) throw new Error("no email address on file");
      providerRef = await sendMail({
        to: row.recipientEmail,
        subject: row.subject,
        text: row.body,
      });
    }
  } catch (err) {
    // The provider refused — nothing was sent, so retrying is safe.
    const reason = err instanceof Error ? err.message : "Send failed.";
    const retryable = shouldRetry(attempts);
    try {
      await db
        .update(notifications)
        .set({
          status: "Failed",
          failureReason: reason,
          attempts,
          nextAttemptAt: retryable ? nextAttemptAt(attempts) : null,
        })
        .where(
          and(
            eq(notifications.notificationId, row.notificationId),
            eq(notifications.status, "Pending"),
          ),
        );
    } catch (updateErr) {
      // The row stays Pending. A due reminder is re-attempted by
      // the next cron run (safe — the send itself failed), while
      // an event row simply stays Pending, never double-sent.
      console.error(
        `Notification failure could not be recorded:`,
        updateErr,
      );
    }
    return "failed";
  }
  // The provider accepted. Record Sent — retry the update once
  // if the DB blips, because a sent-but-unrecorded row must not
  // be auto-retried into a double-send.
  const sentValues = {
    status: "Sent",
    sentAt: new Date(),
    providerRef,
    attempts,
    failureReason: null,
    nextAttemptAt: null,
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const [sent] = await db
        .update(notifications)
        .set(sentValues)
        .where(
          and(
            eq(notifications.notificationId, row.notificationId),
            eq(notifications.status, "Pending"),
          ),
        )
        .returning();
      return sent ? "sent" : "skipped";
    } catch (updateErr) {
      console.error(
        `Notification status update failed (attempt ${attempt + 1}):`,
        updateErr,
      );
    }
  }
  try {
    await db
      .update(notifications)
      .set({
        status: "Failed",
        failureReason:
          "sent but status could not be recorded — check provider logs before resending",
        attempts,
        nextAttemptAt: null,
      })
      .where(
        and(
          eq(notifications.notificationId, row.notificationId),
          eq(notifications.status, "Pending"),
        ),
      );
  } catch {
    // The row stays Pending; the log lines above are the record.
  }
  return "skipped";
}

/**
 * One recipient's email row + send attempt. Best-effort by
 * contract: never throws. A duplicate trigger returns null
 * without sending; a provider failure is recorded on the row.
 */
async function sendSingleEmail(
  appointmentId: number,
  event: string,
  recipientEmail: string,
  subject: string,
  body: string,
): Promise<Notification | null> {
  const row = await insertNotificationRow({
    appointmentId,
    channel: "email",
    event,
    recipientEmail,
    recipientPhone: null,
    subject,
    body,
    scheduledAt: null,
    intervalHours: null,
    dedupKey: dedupKeyFor({
      event,
      appointmentId,
      channel: "email",
      recipient: recipientEmail,
    }),
  });
  if (!row) return null;
  await attemptSend(row);
  return row;
}

/** The SMS twin of sendSingleEmail: one recipient's SMS row + attempt. */
async function sendSingleSms(
  appointmentId: number,
  event: string,
  recipientPhone: string,
  subject: string,
  body: string,
): Promise<Notification | null> {
  const row = await insertNotificationRow({
    appointmentId,
    channel: "sms",
    event,
    recipientEmail: null,
    recipientPhone,
    subject,
    body,
    scheduledAt: null,
    intervalHours: null,
    dedupKey: dedupKeyFor({
      event,
      appointmentId,
      channel: "sms",
      recipient: recipientPhone,
    }),
  });
  if (!row) return null;
  await attemptSend(row);
  return row;
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
  // The patient also gets the event as an SMS when they opted in
  // and have a phone on file. A lookup failure is NOT an opt-out
  // — it just skips the SMS this time.
  if (ctx.patientPhone) {
    try {
      if ((await getSmsOptIn(ctx.patientUserId)) === true) {
        const sms = buildSmsContent(event, ctx, extra);
        await sendSingleSms(
          appointmentId,
          event,
          ctx.patientPhone,
          sms.subject,
          sms.body,
        );
      }
    } catch (err) {
      console.error(`Notification SMS skipped (${event}):`, err);
    }
  }
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
 * cannot double-send the same reminder. Sending is
 * channel-aware (email via the mailer, SMS via the SMS driver),
 * and SMS rows re-check the patient's opt-in at send time: an
 * opt-out cancels the row, a lookup failure only skips it.
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
      channel: notifications.channel,
      recipientEmail: notifications.recipientEmail,
      recipientPhone: notifications.recipientPhone,
      subject: notifications.subject,
      body: notifications.body,
      attempts: notifications.attempts,
      appointmentStatus: appointments.status,
      slotDate: slots.date,
      slotStart: slots.startTime,
      patientUserId: patients.userId,
    })
    .from(notifications)
    .innerJoin(
      appointments,
      eq(notifications.appointmentId, appointments.appointmentId),
    )
    .innerJoin(slots, eq(appointments.slotId, slots.slotId))
    .innerJoin(patients, eq(appointments.patientId, patients.patientId))
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
    // SMS reminders re-check the opt-in at send time: a patient
    // who opted out after booking must not be texted. A lookup
    // failure skips (never cancels); an opt-out cancels.
    if (row.channel === "sms") {
      const optIn = await getSmsOptIn(row.patientUserId);
      if (optIn === null) {
        counts.skipped += 1;
        continue;
      }
      if (optIn === false) {
        await db
          .update(notifications)
          .set({ status: "Cancelled", failureReason: "SMS opt-in off" })
          .where(
            and(
              eq(notifications.notificationId, row.notificationId),
              eq(notifications.status, "Pending"),
            ),
          );
        counts.cancelled += 1;
        continue;
      }
    }
    const outcome = await attemptSend(row);
    if (outcome === "sent") counts.sent += 1;
    else if (outcome === "failed") counts.failed += 1;
    else counts.skipped += 1;
  }
  return counts;
}

export type OutboxRetryCounts = {
  claimed: number;
  sent: number;
  failed: number;
  cancelled: number;
};

/**
 * Retry failed notification rows whose next attempt is due.
 * Failed rows are claimed (Failed→Pending, guarded) and then
 * sent through the same attempt path as first sends. Reminder
 * rows get the same eligibility guard as due reminders: a
 * reminder for a dead or past appointment is cancelled, never
 * retried into a dead booking. Rows with no next attempt
 * (exhausted, or parked as sent-but-unrecorded) are never
 * claimed. Event rows have no eligibility guard — retrying a
 * mail about a past event is always fine.
 */
export async function processOutboxRetries(): Promise<OutboxRetryCounts> {
  const counts: OutboxRetryCounts = {
    claimed: 0,
    sent: 0,
    failed: 0,
    cancelled: 0,
  };
  const max = getMaxAttempts();
  const retryable = await db
    .select({
      notificationId: notifications.notificationId,
      event: notifications.event,
      channel: notifications.channel,
      recipientEmail: notifications.recipientEmail,
      recipientPhone: notifications.recipientPhone,
      subject: notifications.subject,
      body: notifications.body,
      attempts: notifications.attempts,
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
        eq(notifications.status, "Failed"),
        sql`notifications.attempts < ${max}`,
        sql`notifications.next_attempt_at IS NOT NULL AND notifications.next_attempt_at <= NOW()`,
      ),
    );
  for (const row of retryable) {
    // Claim first: only the run that flips Failed→Pending owns it.
    const [claimed] = await db
      .update(notifications)
      .set({ status: "Pending" })
      .where(
        and(
          eq(notifications.notificationId, row.notificationId),
          eq(notifications.status, "Failed"),
        ),
      )
      .returning({ notificationId: notifications.notificationId });
    if (!claimed) continue; // another run claimed it
    counts.claimed += 1;
    if (
      row.event === "reminder" &&
      (row.appointmentStatus === "Cancelled" ||
        row.appointmentStatus === "Completed" ||
        !isSlotInFuture(toISODate(row.slotDate), toHHMM(row.slotStart)))
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
    const outcome = await attemptSend(row);
    if (outcome === "sent") counts.sent += 1;
    else if (outcome === "failed") counts.failed += 1;
    // "skipped" (a concurrent claim) counts as neither.
  }
  return counts;
}
