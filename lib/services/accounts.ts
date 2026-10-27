// Small lookups shared by actions and pages: from a signed-in user
// id to their patient/doctor profile row (a user has exactly one).

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  users,
  patients,
  doctors,
  specializations,
  slots,
} from "@/lib/db/schema";
import { defaultScheduleSlots } from "@/lib/services/schedule";

export async function getUserById(userId: number) {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.userId, userId));
  return row ?? null;
}

export async function getPatientIdByUser(userId: number) {
  const [row] = await db
    .select()
    .from(patients)
    .where(eq(patients.userId, userId));
  return row?.patientId ?? null;
}

export async function getDoctorIdByUser(userId: number) {
  const [row] = await db
    .select()
    .from(doctors)
    .where(eq(doctors.userId, userId));
  return row?.doctorId ?? null;
}

export type NewAccountInput = {
  name: string;
  email: string;
  phone?: string;
  passwordHash: string;
  role: "Patient" | "Doctor";
  authProvider: string;
  qualification?: string;
  experienceYears?: number;
  consultationFee?: number;
  specialization?: string;
};

/**
 * Create a user row plus exactly one profile row (patient OR doctor,
 * decided by role — the ER diagram's 1:1 rule). New doctors are
 * auto-approved and get the default Mon–Fri 09:00–13:00 schedule, so
 * they can receive bookings immediately. Shared by email registration
 * and by the OAuth role-choice step so both paths create identical
 * accounts.
 */
export async function createAccountWithProfile(input: NewAccountInput) {
  const [user] = await db
    .insert(users)
    .values({
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      passwordHash: input.passwordHash,
      role: input.role,
      authProvider: input.authProvider,
      isVerified: true,
    })
    .returning();

  if (input.role === "Patient") {
    await db.insert(patients).values({ userId: user.userId });
  } else {
    const [doctor] = await db
      .insert(doctors)
      .values({
        userId: user.userId,
        qualification: input.qualification ?? null,
        experienceYears: input.experienceYears ?? null,
        consultationFee:
          input.consultationFee !== undefined
            ? String(input.consultationFee)
            : null,
        // Demo simplification: approved at once (see register action).
        isApproved: true,
      })
      .returning();
    if (input.specialization) {
      await db.insert(specializations).values({
        doctorId: doctor.doctorId,
        name: input.specialization,
      });
    }
    const schedule = defaultScheduleSlots(doctor.doctorId);
    if (schedule.length > 0) await db.insert(slots).values(schedule);
  }

  return user;
}
