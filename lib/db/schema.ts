// Database schema — matches the day-1 ER diagram for the Schedule Project
// Module exactly, table for table, column for column.
//
// Tables (ER diagram names in brackets):
//   users, verification_tokens, patients, doctors, specializations,
//   slots, appointments
//
// Relationships:
//   User 1:1 Patient OR 1:1 Doctor (decided by role, never both —
//   enforced by UNIQUE on patients.user_id and doctors.user_id).
//   Doctor 1:many Specialization, Doctor 1:many Slot,
//   Slot 1:many Appointment, Patient 1:many Appointment,
//   Doctor 1:many Appointment.
//
// ONE documented deviation from the diagram: appointments carries a
// `reason` column. The diagram has no place to store why a patient
// booked, but the task requires the reason to be saved and shown on
// the doctor's dashboard, so it lives here as plain text. Everything
// else is exactly the diagram. RescheduleHistory and Notifications are
// intentionally absent (they belong to weeks 3-4).
//
// SECOND documented deviation (Stage 5, favorite doctors): the
// patient_favorite_doctors table below. The diagram has no place to
// store a patient's saved doctors, and no existing table can hold
// that relationship, so this one additive table exists. A favorite
// is only a bookmark: it is not a booking, endorsement, or
// verification of the doctor.
//
// THIRD documented deviation (Day 4 Stage A, Razorpay payments):
// the payments and webhook_events tables below, plus one nullable
// appointments.expires_at column. The diagram has no payment
// concept, but pay-before-confirmation needs a place to record
// orders, their outcomes, and the pending-booking deadline, plus a
// dedup table so a retried webhook can never apply twice.
//
// FOURTH documented deviation (Day 4 Stage B, refunds): the
// refunds table below. Cancelling a paid appointment starts a
// full refund, but the appointment's Cancelled status must never
// be read as "refund done" — the refund has its own tracked
// status, from initiation through the gateway's confirmation.
//
// FIFTH documented deviation (Day 4 Stage C, notifications):
// the notifications table below. Every email the app attempts
// is a row here — never a silent send — and reminders are rows
// too, scheduled at booking time and cancelled when the
// appointment is cancelled or completed, so a dead appointment
// can never be reminded.

import {
  pgTable,
  primaryKey,
  serial,
  varchar,
  boolean,
  timestamp,
  date,
  time,
  integer,
  numeric,
  text,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  userId: serial("user_id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  phone: varchar("phone", { length: 20 }),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  // 'Patient' or 'Doctor' (ER diagram note: 'Doctor / Patient')
  role: varchar("role", { length: 20 }).notNull(),
  // 'Email' / 'Phone' / 'Google' / 'GitHub' — this
  // app implements Email, Google and GitHub. (Comment
  // only; the column itself is unchanged.)
  authProvider: varchar("auth_provider", { length: 20 })
    .notNull()
    .default("Email"),
  isVerified: boolean("is_verified").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const verificationTokens = pgTable("verification_tokens", {
  tokenId: serial("token_id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.userId, { onDelete: "cascade" }),
  token: varchar("token", { length: 255 }).notNull(),
  // 'OTP' / 'Email'
  type: varchar("type", { length: 20 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  isUsed: boolean("is_used").notNull().default(false),
});

export const patients = pgTable("patients", {
  patientId: serial("patient_id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .unique()
    .references(() => users.userId, { onDelete: "cascade" }),
  dateOfBirth: date("date_of_birth"),
  gender: varchar("gender", { length: 20 }),
  address: varchar("address", { length: 500 }),
  emergencyContact: varchar("emergency_contact", { length: 20 }),
});

export const doctors = pgTable("doctors", {
  doctorId: serial("doctor_id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .unique()
    .references(() => users.userId, { onDelete: "cascade" }),
  qualification: varchar("qualification", { length: 255 }),
  experienceYears: integer("experience_years"),
  consultationFee: numeric("consultation_fee", { precision: 10, scale: 2 }),
  isApproved: boolean("is_approved").notNull().default(false),
});

export const specializations = pgTable("specializations", {
  specializationId: serial("specialization_id").primaryKey(),
  doctorId: integer("doctor_id")
    .notNull()
    .references(() => doctors.doctorId, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
});

export const slots = pgTable("slots", {
  slotId: serial("slot_id").primaryKey(),
  doctorId: integer("doctor_id")
    .notNull()
    .references(() => doctors.doctorId, { onDelete: "cascade" }),
  date: date("date").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  maxAppointments: integer("max_appointments").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
});

export const appointments = pgTable("appointments", {
  appointmentId: serial("appointment_id").primaryKey(),
  patientId: integer("patient_id")
    .notNull()
    .references(() => patients.patientId, { onDelete: "cascade" }),
  doctorId: integer("doctor_id")
    .notNull()
    .references(() => doctors.doctorId, { onDelete: "cascade" }),
  slotId: integer("slot_id")
    .notNull()
    .references(() => slots.slotId, { onDelete: "cascade" }),
  // 'Pending' / 'Booked' / 'Confirmed' / 'Cancelled' / 'Completed'.
  // Pending means the booking is on hold awaiting payment (Day 4
  // Stage A, pay before confirmation); it holds its slot exactly
  // like Booked/Confirmed until it is paid, cancelled, or expired.
  status: varchar("status", { length: 20 }).notNull().default("Booked"),
  // Reason the patient gave while booking (see note at top of file).
  reason: text("reason"),
  bookedAt: timestamp("booked_at").notNull().defaultNow(),
  // Deadline for a Pending booking's payment. Only meaningful while
  // status is Pending; cleared to NULL when the booking is paid
  // (→ Booked), cancelled, or expired.
  expiresAt: timestamp("expires_at"),
});

// A patient's saved doctors (Stage 5). The composite primary key is
// the database-level duplicate guard: the same patient cannot save
// the same doctor twice. Both foreign keys cascade, so deleting a
// patient or a doctor removes their favorites with them. A favorite
// says nothing about the doctor — it is only that patient's
// bookmark, and it never implies a booking or endorsement.
export const patientFavoriteDoctors = pgTable(
  "patient_favorite_doctors",
  {
    patientId: integer("patient_id")
      .notNull()
      .references(() => patients.patientId, { onDelete: "cascade" }),
    doctorId: integer("doctor_id")
      .notNull()
      .references(() => doctors.doctorId, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.patientId, t.doctorId] })],
);

// Day 4 Stage A (Razorpay payments). One row per payment attempt:
// retrying creates a NEW row, never reuses one, so a superseded
// order can never confirm a booking after a retry. The Razorpay
// ids start NULL (the row is created before the Razorpay order)
// and are filled in once Razorpay answers; UNIQUE still holds for
// all non-NULL values, and Postgres allows several NULLs.
export const payments = pgTable("payments", {
  paymentId: serial("payment_id").primaryKey(),
  appointmentId: integer("appointment_id")
    .notNull()
    .references(() => appointments.appointmentId, { onDelete: "cascade" }),
  razorpayOrderId: varchar("razorpay_order_id", { length: 255 }).unique(),
  razorpayPaymentId: varchar("razorpay_payment_id", {
    length: 255,
  }).unique(),
  amountPaise: integer("amount_paise").notNull(),
  currency: varchar("currency", { length: 10 }).notNull().default("INR"),
  // 'Pending' / 'Paid' / 'Failed' / 'Abandoned' / 'Expired'.
  status: varchar("status", { length: 20 }).notNull().default("Pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Day 4 Stage A webhook dedup: one row per delivered Razorpay
// event, so a retried webhook can never apply twice. event_id is
// Razorpay's event id when present, else a per-event key derived
// from the payload (see the webhook route).
export const webhookEvents = pgTable("webhook_events", {
  eventId: varchar("event_id", { length: 255 }).primaryKey(),
  type: varchar("type", { length: 100 }).notNull(),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
});

// Day 4 Stage B (refunds). One row per payment, enforced by the
// UNIQUE on payment_id — a payment can never be refunded twice,
// even if cancellation or retry is submitted twice. The row is
// created when initiation is attempted: Initiated means Razorpay
// accepted the refund (or an existing gateway refund was adopted),
// Processed only when Razorpay confirms (refund.processed
// webhook), Failed means the initiation failed or Razorpay
// reported failure, with the real reason kept in failure_reason.
// A refund row existing never implies money has arrived — only
// Processed says the gateway completed it. amount_paise is always
// the full payment amount: this clinic refunds in full, never in
// part.
export const refunds = pgTable("refunds", {
  refundId: serial("refund_id").primaryKey(),
  paymentId: integer("payment_id")
    .notNull()
    .unique()
    .references(() => payments.paymentId, { onDelete: "cascade" }),
  appointmentId: integer("appointment_id")
    .notNull()
    .references(() => appointments.appointmentId, { onDelete: "cascade" }),
  amountPaise: integer("amount_paise").notNull(),
  reason: text("reason"),
  // 'Initiated' / 'Processed' / 'Failed'.
  status: varchar("status", { length: 20 }).notNull().default("Initiated"),
  gatewayRefundId: varchar("gateway_refund_id", {
    length: 255,
  }).unique(),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Day 4 Stage C (notifications + reminders). One row per email
// the app attempts — the audit trail, never a silent send.
// channel is 'email' today; 'sms'/'whatsapp' are future values
// (see lib/services/mailer.ts for the extension point, no code
// for them yet). event names the trigger: booking_created,
// booking_cancelled, booking_rescheduled, payment_succeeded,
// payment_failed, refund_initiated, refund_processed,
// refund_failed, or reminder. scheduled_at is set only for
// reminders (appointment start minus 24h); event mail has NULL
// and is attempted at once. status is 'Pending' (reminder
// waiting, or an event row mid-attempt), 'Sent', 'Failed'
// (with failure_reason), or 'Cancelled' (reminder killed by a
// cancel/complete, so it can never send).
export const notifications = pgTable("notifications", {
  notificationId: serial("notification_id").primaryKey(),
  appointmentId: integer("appointment_id").references(
    () => appointments.appointmentId,
    { onDelete: "cascade" },
  ),
  channel: varchar("channel", { length: 20 }).notNull().default("email"),
  event: varchar("event", { length: 50 }).notNull(),
  recipientEmail: varchar("recipient_email", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  body: text("body").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("Pending"),
  scheduledAt: timestamp("scheduled_at"),
  sentAt: timestamp("sent_at"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Patient = typeof patients.$inferSelect;
export type Doctor = typeof doctors.$inferSelect;
export type Specialization = typeof specializations.$inferSelect;
export type Slot = typeof slots.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type PatientFavoriteDoctor =
  typeof patientFavoriteDoctors.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type Refund = typeof refunds.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
