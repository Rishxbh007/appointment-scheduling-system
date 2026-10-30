// Booking server actions: thin wrappers around the service layer.
// Each one re-checks the session and ownership — the service layer
// enforces the same rules, so a forged request cannot bypass them.

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ensureDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  bookingSchema,
  slotSchema,
  appointmentStatusSchema,
  rescheduleSchema,
} from "@/lib/validation";
import {
  bookAppointment,
  changeAppointmentStatus,
  createSlot,
  getSlotDoctorFee,
  rescheduleAppointment,
  setSlotActive,
} from "@/lib/services/booking";
import {
  cancelPendingPayments,
  createPendingBookingWithOrder,
  getPaidPaymentByAppointment,
} from "@/lib/services/payments";
import {
  getRefundForAppointment,
  initiateRefundForCancellation,
} from "@/lib/services/refunds";
import { isRazorpayConfigured } from "@/lib/services/razorpay";
import {
  getAppointmentMailContext,
  sendEventEmail,
} from "@/lib/services/notifications";
import { formatDate, formatTime } from "@/lib/time";
import {
  getPatientIdByUser,
  getDoctorIdByUser,
} from "@/lib/services/accounts";
import type { ActionState } from "./auth";

function formValues(formData: FormData): Record<string, string> {
  return Object.fromEntries(
    [...formData.entries()].map(([k, v]) => [k, String(v)]),
  );
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

/**
 * Day 4 Stage B: after a cancel succeeds, a Paid booking's full
 * refund starts automatically. Best-effort by design — the cancel
 * already succeeded and must never be undone because a refund
 * call failed. A failed initiation is recorded as a Failed refund
 * row (with its reason) by the refund service itself, so the
 * patient can retry from the dashboard; only a database failure
 * here leaves no row, and that is logged, not thrown. Pending
 * bookings have no Paid row, so nothing is refunded for them.
 *
 * Day 4 Stage C: when this is the first initiation for the
 * payment, one refund mail follows — initiated, or failed with
 * its reason. A pre-existing row means the mail already went
 * out when the row was first created, so no second mail.
 */
async function startRefundAfterCancel(
  appointmentId: number,
  reason: string,
): Promise<void> {
  try {
    const payment = await getPaidPaymentByAppointment(appointmentId);
    if (!payment) return;
    const existing = await getRefundForAppointment(appointmentId);
    const refund = await initiateRefundForCancellation(payment, reason);
    if (!existing) {
      await sendEventEmail(
        appointmentId,
        refund.status === "Initiated" ? "refund_initiated" : "refund_failed",
        {
          amountPaise: refund.amountPaise,
          failureReason: refund.failureReason,
        },
      );
    }
  } catch (err) {
    console.error("Refund initiation after cancel failed:", err);
  }
}

/**
 * Day 4 Stage C: the refund line for a cancellation mail, read
 * from the refund row when one exists. Processed counts as
 * initiated for the wording (the money is on its way either
 * way); only a Failed row gets the failure wording.
 */
async function cancelRefundExtra(appointmentId: number): Promise<{
  refundStatus?: "Initiated" | "Failed";
  refundAmountPaise?: number;
  refundFailureReason?: string | null;
}> {
  try {
    const refund = await getRefundForAppointment(appointmentId);
    if (!refund) return {};
    return {
      refundStatus: refund.status === "Failed" ? "Failed" : "Initiated",
      refundAmountPaise: refund.amountPaise,
      refundFailureReason: refund.failureReason,
    };
  } catch (err) {
    console.error("Refund row lookup for cancel mail failed:", err);
    return {};
  }
}

/** Patient books one slot.
 *
 * Free booking (no consultation fee, or a zero fee): exactly
 * today's immediate-Booked flow, ending in a dashboard redirect.
 *
 * Paid booking (Day 4 Stage A, pay before confirmation): no
 * redirect. The booking is created Pending with a 15-minute hold
 * and a Razorpay order, and the checkout details come back in
 * state so the booking form can open Razorpay Checkout. Without
 * Razorpay keys the booking is blocked outright (fail closed) —
 * a paid booking is never fake-confirmed. */
export async function bookAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await ensureDb();
  const session = await getSession();
  if (!session || session.role !== "Patient") {
    return { error: "Sign in as a patient to book an appointment." };
  }
  const patientId = await getPatientIdByUser(session.userId);
  if (!patientId) return { error: "Patient profile not found." };

  const parsed = bookingSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const feePaise = await getSlotDoctorFee(parsed.data.slotId);
  if (feePaise === null) {
    let created;
    try {
      created = await bookAppointment(
        patientId,
        parsed.data.slotId,
        parsed.data.reason,
      );
    } catch (err) {
      return { error: message(err) };
    }
    // Day 4 Stage C: confirmation mail, best-effort — it never
    // blocks the booking, and it goes out before the redirect
    // (code after redirect() never runs).
    await sendEventEmail(created.appointmentId, "booking_created");
    revalidatePath("/dashboard");
    revalidatePath("/doctors");
    redirect("/dashboard");
  }
  if (!isRazorpayConfigured()) {
    return {
      error:
        "Online payment is not set up for this clinic yet, so this booking cannot be completed. Please try again later.",
    };
  }
  try {
    const result = await createPendingBookingWithOrder(
      patientId,
      parsed.data.slotId,
      parsed.data.reason,
    );
    revalidatePath("/dashboard");
    revalidatePath("/doctors");
    return {
      payment: {
        appointmentId: result.appointment.appointmentId,
        orderId: result.orderId,
        amountPaise: result.amountPaise,
        expiresAtIso: result.expiresAt.toISOString(),
      },
    };
  } catch (err) {
    return { error: message(err) };
  }
}

/** Doctor confirms / cancels / completes one of their appointments. */
export async function doctorStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await ensureDb();
  const session = await getSession();
  if (!session || session.role !== "Doctor") {
    return { error: "Only doctors can update appointments." };
  }
  const doctorId = await getDoctorIdByUser(session.userId);
  if (!doctorId) return { error: "Doctor profile not found." };

  const values = formValues(formData);
  const appointmentId = Number(values.appointmentId);
  const status = appointmentStatusSchema.safeParse(values.status);
  if (!appointmentId || !status.success) {
    return { error: "Invalid appointment update." };
  }
  try {
    await changeAppointmentStatus(appointmentId, status.data, { doctorId });
  } catch (err) {
    return { error: message(err) };
  }
  // Day 4 Stage B: a doctor cancelling a Paid booking starts its
  // full refund automatically. Best-effort — the cancel already
  // succeeded and is never undone by a refund failure.
  if (status.data === "Cancelled") {
    await startRefundAfterCancel(
      appointmentId,
      "Appointment cancelled by doctor",
    );
    // Day 4 Stage C: cancellation mail, with the refund line
    // when a refund row exists.
    await sendEventEmail(
      appointmentId,
      "booking_cancelled",
      await cancelRefundExtra(appointmentId),
    );
  }
  revalidatePath("/dashboard");
  return {};
}

/** Patient cancels their own booking. */
export async function patientCancelAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await ensureDb();
  const session = await getSession();
  if (!session || session.role !== "Patient") {
    return { error: "Only patients can cancel bookings." };
  }
  const patientId = await getPatientIdByUser(session.userId);
  if (!patientId) return { error: "Patient profile not found." };

  const appointmentId = Number(formValues(formData).appointmentId);
  if (!appointmentId) return { error: "Invalid appointment." };
  try {
    await changeAppointmentStatus(appointmentId, "Cancelled", { patientId });
  } catch (err) {
    return { error: message(err) };
  }
  // A cancelled Pending hold takes its payment attempts with it.
  // Best-effort: the cancel already succeeded, and the
  // verify/webhook guards still prevent a stray payment from
  // confirming a cancelled booking if this fails.
  try {
    await cancelPendingPayments(appointmentId);
  } catch (err) {
    console.error("Cancelling pending payments failed:", err);
  }
  // Day 4 Stage B: a patient cancelling a Paid booking starts its
  // full refund automatically. Best-effort — the cancel already
  // succeeded and is never undone by a refund failure.
  await startRefundAfterCancel(
    appointmentId,
    "Appointment cancelled by patient",
  );
  // Day 4 Stage C: cancellation mail, with the refund line when
  // a refund row exists (none for an unpaid hold).
  await sendEventEmail(
    appointmentId,
    "booking_cancelled",
    await cancelRefundExtra(appointmentId),
  );
  revalidatePath("/dashboard");
  return {};
}

/** Patient moves their own booking to another slot of the same
 * doctor. No redirect: the dashboard card revalidates and the UI
 * shows the success inline. */
export async function patientRescheduleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await ensureDb();
  const session = await getSession();
  if (!session || session.role !== "Patient") {
    return { error: "Only patients can reschedule bookings." };
  }
  const patientId = await getPatientIdByUser(session.userId);
  if (!patientId) return { error: "Patient profile not found." };

  const parsed = rescheduleSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  // Day 4 Stage C: capture the old slot label before the move,
  // so the reschedule mail can show old vs new. Loaded before
  // the move, but only used if the move succeeds (which proves
  // ownership) — a failed move sends nothing.
  const before = await getAppointmentMailContext(parsed.data.appointmentId);
  const previousLabel = before
    ? `${formatDate(before.slotDate)}, ${formatTime(before.slotStart)} – ${formatTime(before.slotEnd)} (IST)`
    : undefined;
  try {
    await rescheduleAppointment(
      patientId,
      parsed.data.appointmentId,
      parsed.data.newSlotId,
    );
  } catch (err) {
    return { error: message(err) };
  }
  await sendEventEmail(parsed.data.appointmentId, "booking_rescheduled", {
    previousLabel,
  });
  revalidatePath("/dashboard");
  return { success: true };
}

/** Doctor adds one availability window. */
export async function createSlotAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await ensureDb();
  const session = await getSession();
  if (!session || session.role !== "Doctor") {
    return { error: "Only doctors can manage availability." };
  }
  const doctorId = await getDoctorIdByUser(session.userId);
  if (!doctorId) return { error: "Doctor profile not found." };

  const parsed = slotSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    await createSlot(doctorId, parsed.data);
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath("/dashboard");
  return {};
}

/** Doctor activates / deactivates one of their own windows. */
export async function toggleSlotAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await ensureDb();
  const session = await getSession();
  if (!session || session.role !== "Doctor") {
    return { error: "Only doctors can manage availability." };
  }
  const doctorId = await getDoctorIdByUser(session.userId);
  if (!doctorId) return { error: "Doctor profile not found." };

  const values = formValues(formData);
  const slotId = Number(values.slotId);
  const isActive = values.isActive === "true";
  if (!slotId) return { error: "Invalid slot." };
  try {
    await setSlotActive(doctorId, slotId, isActive);
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath("/dashboard");
  return {};
}
