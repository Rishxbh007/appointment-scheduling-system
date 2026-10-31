// Notification preference server actions — Day 5. Thin wrappers
// around the notifications service: each one re-checks the
// session, so a forged request cannot change another patient's
// preferences or phone number. Called directly from the
// preferences form, so they take plain arguments and return
// plain results — no redirects here; the component decides
// what to show.

"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSession } from "@/lib/auth";
import { setSmsOptIn } from "@/lib/services/notifications";

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

/** Digits with an optional leading +, 8–15 characters. Loose on
 * purpose: international numbers vary, and the SMS driver (not
 * this check) is what enforces deliverability. */
function validPhone(phone: string): boolean {
  return /^[+]?[0-9][0-9 ]{7,14}$/.test(phone);
}

/**
 * Save the patient's phone number + SMS opt-in. Turning SMS on
 * requires a phone number (there is nothing to text otherwise);
 * turning it off cancels the patient's Pending SMS reminders at
 * once via setSmsOptIn. Turning it on does NOT backfill SMS
 * reminders for bookings made before the opt-in.
 */
export async function updateNotificationPreferencesAction(input: {
  phone: string;
  smsOptIn: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session || session.role !== "Patient") {
    return {
      ok: false,
      error: "Sign in as a patient to change notification preferences.",
    };
  }
  const phone = input.phone.trim();
  if (phone !== "" && !validPhone(phone)) {
    return {
      ok: false,
      error:
        "Enter a valid phone number (digits, optional leading +, 8–15 characters) or leave it blank.",
    };
  }
  if (input.smsOptIn && phone === "") {
    return {
      ok: false,
      error: "Add a phone number to receive SMS notifications.",
    };
  }
  try {
    await ensureDb();
    await db
      .update(users)
      .set({ phone: phone === "" ? null : phone })
      .where(eq(users.userId, session.userId));
    await setSmsOptIn(session.userId, input.smsOptIn);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}
