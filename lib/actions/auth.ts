// Auth server actions: register, sign in, sign out, OAuth role choice.
//
// Registration creates the user row plus exactly one profile row
// (patient OR doctor, decided by role — the ER diagram's 1:1 rule).
// New doctors are auto-approved and get the default Mon–Fri
// 09:00–13:00 schedule at sign-up, so they can receive bookings
// immediately in the demo (a real deployment would route approvals
// through an admin review instead).

"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  hashPassword,
  comparePassword,
  signSession,
  setSessionCookie,
  clearSessionCookie,
} from "@/lib/auth";
import {
  registerSchema,
  loginSchema,
  oauthRoleSchema,
} from "@/lib/validation";
import { createAccountWithProfile } from "@/lib/services/accounts";
import {
  verifyPendingOAuth,
  providerLabel,
  randomUnusablePasswordHash,
} from "@/lib/oauth";

export type ActionState = {
  error?: string;
  success?: boolean;
  // Day 4 Stage A: a paid booking returns the checkout details
  // instead of redirecting, so the booking form can open Razorpay
  // Checkout. Only ever set by bookAction's paid path.
  payment?: {
    appointmentId: number;
    orderId: string;
    amountPaise: number;
    expiresAtIso: string;
  };
};

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
  const user = await createAccountWithProfile({
    name: data.name,
    email: data.email,
    phone: data.phone,
    passwordHash,
    role: data.role,
    authProvider: "Email",
    qualification: data.qualification,
    experienceYears: data.experienceYears,
    consultationFee: data.consultationFee,
    specialization: data.specialization,
  });

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
  // OAuth accounts have no usable password (see lib/oauth.ts). Tell
  // the person which sign-in to use instead of a generic failure.
  if (user.authProvider !== "Email") {
    return {
      error: `This account was created with ${user.authProvider}. Please sign in with ${user.authProvider} instead.`,
    };
  }
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

/**
 * Finish an OAuth sign-in: the pending profile comes from the signed
 * cookie set by the callback route, never from form input. Creates
 * the user + matching profile, signs the person in, clears the
 * pending cookie, and sends them to the dashboard.
 */
export async function completeOAuthSignupAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await ensureDb();
  const store = await cookies();
  const pending = verifyPendingOAuth(store.get("oauth_pending")?.value);
  if (!pending) {
    return {
      error: "Your sign-in session expired. Please try signing in again.",
    };
  }
  const parsed = oauthRoleSchema.safeParse(formValues(formData));
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
    .where(eq(users.email, pending.email));
  if (existing) {
    // Someone created an account with this email in the meantime.
    // Never link or take it over.
    return {
      error:
        existing.authProvider === "Email"
          ? "An account with this email already exists. Please sign in with email and password instead."
          : `An account with this email already exists. Please sign in with ${existing.authProvider} instead.`,
    };
  }

  const passwordHash = await randomUnusablePasswordHash();
  const user = await createAccountWithProfile({
    name: pending.name,
    email: pending.email,
    passwordHash,
    role: data.role,
    authProvider: providerLabel(pending.provider),
    qualification: data.qualification,
    experienceYears: data.experienceYears,
    consultationFee: data.consultationFee,
    specialization: data.specialization,
  });

  store.delete("oauth_pending");
  await setSessionCookie(signSession(user.userId, data.role));
  redirect("/dashboard");
}
