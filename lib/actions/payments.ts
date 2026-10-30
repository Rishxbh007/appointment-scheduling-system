// Payment server actions — Day 4 Stage A (Razorpay, pay before
// confirmation). Thin wrappers around the payments service: each
// one re-checks the session and resolves the patient id from it,
// so a forged request cannot verify, abandon, or retry another
// patient's payment. Called directly from the checkout component
// (not via forms), so they take plain arguments and return plain
// results — no redirects here; the component decides what to show.

"use server";

import { revalidatePath } from "next/cache";
import { ensureDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getPatientIdByUser } from "@/lib/services/accounts";
import {
  getPaidPaymentByAppointment,
  markPaymentAttempt,
  retryPayment,
  verifyPayment,
} from "@/lib/services/payments";
import { getRefundById, retryRefund } from "@/lib/services/refunds";
import { sendEventEmail } from "@/lib/services/notifications";

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

async function patientIdOrError(): Promise<
  { patientId: number } | { error: string }
> {
  const session = await getSession();
  if (!session || session.role !== "Patient") {
    return { error: "Sign in as a patient to manage payment." };
  }
  const patientId = await getPatientIdByUser(session.userId);
  if (!patientId) return { error: "Patient profile not found." };
  return { patientId };
}

function validPaymentInput(input: {
  orderId: unknown;
  paymentId: unknown;
  signature: unknown;
}): input is { orderId: string; paymentId: string; signature: string } {
  return (
    typeof input.orderId === "string" &&
    input.orderId.length > 0 &&
    typeof input.paymentId === "string" &&
    input.paymentId.length > 0 &&
    typeof input.signature === "string" &&
    input.signature.length > 0
  );
}

/** Checkout.js success → verify signature + amount → confirm. */
export async function verifyPaymentAction(input: {
  orderId: string;
  paymentId: string;
  signature: string;
}): Promise<{ ok: boolean; error?: string }> {
  await ensureDb();
  const who = await patientIdOrError();
  if ("error" in who) return { ok: false, error: who.error };
  if (!validPaymentInput(input)) {
    return { ok: false, error: "Invalid payment details." };
  }
  try {
    const result = await verifyPayment(input, who.patientId);
    // Day 4 Stage C: confirmation + payment mails, but only when
    // this verify actually confirmed the booking. An alreadyPaid
    // result means the webhook (or an earlier verify) won the
    // race and already sent them — a second pair would be spam.
    if (!result.alreadyPaid) {
      await sendEventEmail(result.appointmentId, "booking_created");
      const paid = await getPaidPaymentByAppointment(result.appointmentId);
      await sendEventEmail(result.appointmentId, "payment_succeeded", {
        amountPaise: paid?.amountPaise,
      });
    }
  } catch (err) {
    return { ok: false, error: message(err) };
  }
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Checkout dismissed → mark the attempt Abandoned. Hold stays. */
export async function abandonPaymentAction(input: {
  orderId: string;
}): Promise<{ ok: boolean; error?: string }> {
  await ensureDb();
  const who = await patientIdOrError();
  if ("error" in who) return { ok: false, error: who.error };
  if (typeof input.orderId !== "string" || input.orderId.length === 0) {
    return { ok: false, error: "Invalid payment details." };
  }
  try {
    await markPaymentAttempt(input.orderId, who.patientId, "Abandoned");
  } catch (err) {
    return { ok: false, error: message(err) };
  }
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Checkout reported a failure → mark the attempt Failed. */
export async function failPaymentAction(input: {
  orderId: string;
}): Promise<{ ok: boolean; error?: string }> {
  await ensureDb();
  const who = await patientIdOrError();
  if ("error" in who) return { ok: false, error: who.error };
  if (typeof input.orderId !== "string" || input.orderId.length === 0) {
    return { ok: false, error: "Invalid payment details." };
  }
  try {
    const result = await markPaymentAttempt(
      input.orderId,
      who.patientId,
      "Failed",
    );
    // Day 4 Stage C: one payment_failed mail, only when this
    // call actually transitioned the row. A webhook that already
    // failed it sent the mail already.
    if (result.transitioned) {
      await sendEventEmail(result.appointmentId, "payment_failed", {
        amountPaise: result.amountPaise,
      });
    }
  } catch (err) {
    return { ok: false, error: message(err) };
  }
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Day 4 Stage B: retry one Failed refund, for its own patient
 * only. The refund service claims the row first, so a double
 * click cannot double-pay; the same row is updated in place.
 */
export async function retryRefundAction(refundId: number): Promise<{
  ok: boolean;
  error?: string;
}> {
  await ensureDb();
  const who = await patientIdOrError();
  if ("error" in who) return { ok: false, error: who.error };
  if (!Number.isInteger(refundId) || refundId <= 0) {
    return { ok: false, error: "Invalid refund." };
  }
  try {
    const refund = await retryRefund(refundId, who.patientId);
    // Day 4 Stage C: a retry that succeeds is a fresh initiation.
    await sendEventEmail(refund.appointmentId, "refund_initiated", {
      amountPaise: refund.amountPaise,
    });
  } catch (err) {
    // Day 4 Stage C: a genuine retry failure (row Failed, own
    // patient) gets a refund_failed mail. Rejected requests
    // (not found, not yours, not Failed) send nothing.
    try {
      const found = await getRefundById(refundId);
      if (
        found &&
        found.appointmentPatientId === who.patientId &&
        found.refund.status === "Failed"
      ) {
        await sendEventEmail(found.refund.appointmentId, "refund_failed", {
          amountPaise: found.refund.amountPaise,
          failureReason: found.refund.failureReason,
        });
      }
    } catch (lookupErr) {
      console.error("Refund lookup for retry-failure mail failed:", lookupErr);
    }
    return { ok: false, error: message(err) };
  }
  revalidatePath("/dashboard");
  return { ok: true };
}

/** New payment row + new order + refreshed 15-minute hold. */
export async function retryPaymentAction(appointmentId: number): Promise<{
  ok: boolean;
  orderId?: string;
  amountPaise?: number;
  expiresAtIso?: string;
  error?: string;
}> {
  await ensureDb();
  const who = await patientIdOrError();
  if ("error" in who) return { ok: false, error: who.error };
  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    return { ok: false, error: "Invalid appointment." };
  }
  try {
    const result = await retryPayment(appointmentId, who.patientId);
    revalidatePath("/dashboard");
    return {
      ok: true,
      orderId: result.orderId,
      amountPaise: result.amountPaise,
      expiresAtIso: result.expiresAt.toISOString(),
    };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}
