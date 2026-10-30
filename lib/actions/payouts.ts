// Doctor payout-details actions: thin wrappers around the payout
// service. The doctorId always comes from the session — the form
// never submits one, so a forged request cannot touch another
// doctor's details, and a patient cannot reach this action at all.

"use server";

import { revalidatePath } from "next/cache";
import { ensureDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getDoctorIdByUser } from "@/lib/services/accounts";
import {
  savePayoutDetails,
  type PayoutFieldErrors,
} from "@/lib/services/payouts";

export type PayoutActionState = {
  error?: string;
  fieldErrors?: PayoutFieldErrors;
  success?: boolean;
};

/** Doctor saves their own payout details (UPI and/or bank). */
export async function savePayoutDetailsAction(
  _prev: PayoutActionState,
  formData: FormData,
): Promise<PayoutActionState> {
  await ensureDb();
  const session = await getSession();
  if (!session || session.role !== "Doctor") {
    return { error: "Only doctors can save payout details." };
  }
  const doctorId = await getDoctorIdByUser(session.userId);
  if (!doctorId) return { error: "Doctor profile not found." };

  const values = Object.fromEntries(
    [...formData.entries()].map(([k, v]) => [k, String(v)]),
  );
  try {
    const result = await savePayoutDetails(doctorId, {
      upiId: values.upiId ?? "",
      accountNumber: values.accountNumber ?? "",
      ifsc: values.ifsc ?? "",
      accountHolder: values.accountHolder ?? "",
    });
    if ("fieldErrors" in result) {
      return { fieldErrors: result.fieldErrors };
    }
    if ("error" in result) return { error: result.error };
    revalidatePath("/dashboard");
    return { success: true };
  } catch {
    // Deliberately generic: error text must never echo a payout
    // value the doctor typed.
    return { error: "Could not save payout details. Please try again." };
  }
}
