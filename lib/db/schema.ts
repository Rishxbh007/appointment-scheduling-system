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

import {
  pgTable,
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
  // 'Email' / 'Phone' / 'Google' — this app implements Email.
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
  // 'Booked' / 'Confirmed' / 'Cancelled' / 'Completed'
  status: varchar("status", { length: 20 }).notNull().default("Booked"),
  // Reason the patient gave while booking (see note at top of file).
  reason: text("reason"),
  bookedAt: timestamp("booked_at").notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Patient = typeof patients.$inferSelect;
export type Doctor = typeof doctors.$inferSelect;
export type Specialization = typeof specializations.$inferSelect;
export type Slot = typeof slots.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
