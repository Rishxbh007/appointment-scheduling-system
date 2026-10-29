// Input validation (Zod). Every server action validates its input
// through these schemas first and rejects bad data before touching
// the database. Form values arrive as strings, so numbers are
// coerced and empty optional fields become undefined.

import { z } from "zod";

// Empty form fields arrive as "" — treat them as "not provided".
const emptyToUndefined = (v: unknown) =>
  v === "" || v === null ? undefined : v;

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters."),
  email: z.string().trim().email("Enter a valid email address."),
  phone: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(20).optional(),
  ),
  password: z.string().min(6, "Password must be at least 6 characters."),
  role: z.enum(["Patient", "Doctor"]),
  // Doctor-only fields (ignored for patients).
  qualification: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(255).optional(),
  ),
  experienceYears: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(80).optional(),
  ),
  consultationFee: z.preprocess(
    emptyToUndefined,
    z.coerce.number().min(0).max(100000).optional(),
  ),
  specialization: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(255).optional(),
  ),
});

export const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

// Role choice after an OAuth sign-in: the profile (email, name,
// provider) comes from the signed pending-OAuth cookie, never from
// the form, so this schema only validates the role + doctor fields.
export const oauthRoleSchema = z.object({
  role: z.enum(["Patient", "Doctor"]),
  qualification: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(255).optional(),
  ),
  experienceYears: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(80).optional(),
  ),
  consultationFee: z.preprocess(
    emptyToUndefined,
    z.coerce.number().min(0).max(100000).optional(),
  ),
  specialization: z.preprocess(
    emptyToUndefined,
    z.string().trim().max(255).optional(),
  ),
});

export const bookingSchema = z.object({
  slotId: z.coerce.number().int().positive("Pick a time slot."),
  reason: z
    .string()
    .trim()
    .min(3, "Tell the doctor briefly why you are visiting.")
    .max(500, "Reason must be under 500 characters."),
});

export const slotSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date."),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a valid start time."),
  endTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a valid end time."),
  maxAppointments: z.coerce.number().int().min(1).max(20),
});

export const appointmentStatusSchema = z.enum([
  "Confirmed",
  "Cancelled",
  "Completed",
]);

export const rescheduleSchema = z.object({
  appointmentId: z.coerce.number().int().positive("Pick an appointment."),
  newSlotId: z.coerce.number().int().positive("Pick a new time slot."),
});

export const favoriteSchema = z.object({
  doctorId: z.coerce.number().int().positive("Pick a doctor."),
});

export type RegisterInput = z.infer<typeof registerSchema>;
