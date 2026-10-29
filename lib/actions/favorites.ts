// Favorite-doctor server actions: thin wrappers around the service
// layer, following the same pattern as lib/actions/booking.ts.
// Each one re-checks the session and resolves the patient id from
// it — the client only ever supplies a doctor id, never a patient
// id, so a forged request cannot touch another patient's favorites.
// Both actions are safe to call repeatedly: saving twice and
// removing a non-favorite are no-ops, not errors.

"use server";

import { revalidatePath } from "next/cache";
import { ensureDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { favoriteSchema } from "@/lib/validation";
import {
  addFavorite,
  removeFavorite,
} from "@/lib/services/doctors";
import { getPatientIdByUser } from "@/lib/services/accounts";
import type { ActionState } from "./auth";

function formValues(formData: FormData): Record<string, string> {
  return Object.fromEntries(
    [...formData.entries()].map(([k, v]) => [k, String(v)]),
  );
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

/** Resolve the signed-in patient, or return an error state. */
async function patientIdOrError(): Promise<
  { patientId: number } | { error: string }
> {
  const session = await getSession();
  if (!session || session.role !== "Patient") {
    return { error: "Sign in as a patient to save doctors." };
  }
  const patientId = await getPatientIdByUser(session.userId);
  if (!patientId) return { error: "Patient profile not found." };
  return { patientId };
}

function revalidateFavoritePages(doctorId: number) {
  revalidatePath("/dashboard");
  revalidatePath("/doctors");
  revalidatePath(`/doctors/${doctorId}`);
}

/** Patient saves a doctor. Repeated saves are safe no-ops. */
export async function addFavoriteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await ensureDb();
  const resolved = await patientIdOrError();
  if ("error" in resolved) return { error: resolved.error };

  const parsed = favoriteSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await addFavorite(resolved.patientId, parsed.data.doctorId);
  } catch (err) {
    return { error: message(err) };
  }
  revalidateFavoritePages(parsed.data.doctorId);
  return {};
}

/** Patient removes a saved doctor. Removing a non-favorite is safe. */
export async function removeFavoriteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await ensureDb();
  const resolved = await patientIdOrError();
  if ("error" in resolved) return { error: resolved.error };

  const parsed = favoriteSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await removeFavorite(resolved.patientId, parsed.data.doctorId);
  } catch (err) {
    return { error: message(err) };
  }
  revalidateFavoritePages(parsed.data.doctorId);
  return {};
}
