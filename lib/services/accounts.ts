// Small lookups shared by actions and pages: from a signed-in user
// id to their patient/doctor profile row (a user has exactly one).

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, patients, doctors } from "@/lib/db/schema";

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
