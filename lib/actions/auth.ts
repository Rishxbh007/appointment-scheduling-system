// Auth server actions: register, sign in, sign out.
//
// Registration creates the user row plus exactly one profile row
// (patient OR doctor, decided by role — the ER diagram's 1:1 rule).
// New doctors are auto-approved and get the default Mon–Fri
// 09:00–13:00 schedule at sign-up, so they can receive bookings
// immediately in the demo (a real deployment would route approvals
// through an admin review instead).

"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/lib/db";
import {
  users,
  patients,
  doctors,
  specializations,
  slots,
} from "@/lib/db/schema";
import {
  hashPassword,
  comparePassword,
  signSession,
  setSessionCookie,
  clearSessionCookie,
} from "@/lib/auth";
import { registerSchema, loginSchema } from "@/lib/validation";
import { defaultScheduleSlots } from "@/lib/services/schedule";

export type ActionState = { error?: string };

function formValues(formData: FormData): Record<string, string> {
  return Object.fromEntries(
    [...formData.entries()].map(([k, v]) => [k, String(v)]),
  );
}

export async function registerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await ensureDb();
  const parsed = registerSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;
  if (data.role === "Doctor" && !data.specialization) {
    return { error: "Doctors must add their specialization." };
  }

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, data.email));
  if (existing) {
    return { error: "An account with this email already exists." };
  }

  const passwordHash = await hashPassword(data.password);
  const [user] = await db
    .insert(users)
    .values({
      name: data.name,
      email: data.email,
      phone: data.phone,
      passwordHash,
      role: data.role,
      authProvider: "Email",
      isVerified: true,
    })
    .returning();

  if (data.role === "Patient") {
    await db.insert(patients).values({ userId: user.userId });
  } else {
    const [doctor] = await db
      .insert(doctors)
      .values({
        userId: user.userId,
        qualification: data.qualification ?? null,
        experienceYears: data.experienceYears ?? null,
        consultationFee:
          data.consultationFee !== undefined
            ? String(data.consultationFee)
            : null,
        // Demo simplification (see file header): approved at once.
        isApproved: true,
      })
      .returning();
    if (data.specialization) {
      await db.insert(specializations).values({
        doctorId: doctor.doctorId,
        name: data.specialization,
      });
    }
    const schedule = defaultScheduleSlots(doctor.doctorId);
    if (schedule.length > 0) await db.insert(slots).values(schedule);
  }

  await setSessionCookie(signSession(user.userId, data.role));
  redirect("/dashboard");
}

export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await ensureDb();
  const parsed = loginSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, parsed.data.email));
  if (!user) return { error: "Invalid email or password." };
  const ok = await comparePassword(parsed.data.password, user.passwordHash);
  if (!ok) return { error: "Invalid email or password." };

  await setSessionCookie(
    signSession(user.userId, user.role as "Patient" | "Doctor"),
  );
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/");
}
