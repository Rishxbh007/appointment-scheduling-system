// Refund business logic — Day 4 Stage B (full refunds on
// cancellation). Plain database functions; callers (server
// actions, the webhook route) resolve the session, ownership, or
// signature first.
//
// Rules that matter:
//   * FULL refund only, always the payment's whole amount. This
//     clinic never refunds in part, so there is no partial-refund
//     path to misuse.
//   * One refund row per payment, enforced by the UNIQUE on
//     refunds.payment_id. An existing row is always returned
//     instead of calling Razorpay again — a payment can never be
//     refunded twice, even if cancellation or retry is submitted
//     twice. Before creating, a pre-flight lists the refunds
//     Razorpay already holds for the payment, so a call whose
//     result was lost (crash between provider and database) is
//     adopted, not duplicated.
//   * Cancel is never undone by a refund failure. The refund
//     initiation is best-effort after a successful cancel: a
//     failed initiation is recorded as Failed with the real
//     reason, and the appointment stays Cancelled. The patient
//     retries from the dashboard; retry updates the same row in
//     place, never inserts a second one.
//   * Status honesty: Initiated means Razorpay accepted the
//     refund (or an existing gateway refund was adopted) — not
//     that money arrived. Only Processed (refund.processed
//     webhook) says the gateway completed it. Cancelled on the
//     appointment never implies refunded.
//   * Fail-closed: without Razorpay keys the refund row is still
//     recorded, as Failed with reason "payments not configured"
//     — never fake-processed.

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  appointments,
  payments,
  refunds,
  users,
  doctors,
  type Payment,
  type Refund,
} from "@/lib/db/schema";
import {
  createRazorpayRefund,
  fetchPaymentsByOrder,
  findExistingGatewayRefund,
  isRazorpayConfigured,
} from "./razorpay";

const NOT_CONFIGURED_REASON = "payments not configured";

/** True when the error is a Postgres unique-violation (23505). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "23505"
  );
}

async function findRefundByPayment(
  paymentId: number,
): Promise<Refund | null> {
  const [row] = await db
    .select()
    .from(refunds)
    .where(eq(refunds.paymentId, paymentId));
  return row ?? null;
}

/**
 * Bounded self-heal for a 404 refund failure: when Razorpay does
 * not recognise the stored payment reference, but the order holds
 * exactly one captured payment under a DIFFERENT id, the stored
 * reference is stale — re-sync it to the captured id and let the
 * caller retry the refund exactly once. Returns the healed id, or
 * null when no heal applies. Never throws: any lookup failure
 * returns null. Server logs carry row ids only, never gateway ids
 * (this helper logs nothing at all).
 *
 * Exactly-one matters: with zero captured payments there is
 * nothing to refund against; with several, picking one would be a
 * guess. A differing id matters: re-syncing to the same id would
 * just repeat the 404.
 */
async function healStalePaymentReference(input: {
  paymentRowId: number;
  storedPaymentId: string | null;
  orderId: string | null;
}): Promise<string | null> {
  if (!input.orderId || !input.storedPaymentId) return null;
  const captured = await fetchPaymentsByOrder(input.orderId);
  if (captured === null || captured.length !== 1) return null;
  const healed = captured[0];
  if (healed === input.storedPaymentId) return null;
  await db
    .update(payments)
    .set({ razorpayPaymentId: healed })
    .where(eq(payments.paymentId, input.paymentRowId));
  return healed;
}

/**
 * Start the full refund for one Paid payment, after its booking
 * was cancelled. Idempotent: an existing refund row for the
 * payment is returned untouched, whatever its status, so Razorpay
 * is never called twice for the same payment. A row is always
 * recorded — Initiated on provider acceptance, Failed with the
 * real reason on failure or when keys are absent — so the
 * dashboard can always show the refund's true state. Only a
 * database failure itself throws; callers treat that as
 * best-effort and log it.
 */
export async function initiateRefundForCancellation(
  payment: Payment,
  reason: string,
): Promise<Refund> {
  if (payment.status !== "Paid") {
    throw new Error("Only a paid payment can be refunded.");
  }
  const existing = await findRefundByPayment(payment.paymentId);
  if (existing) return existing;

  const base = {
    paymentId: payment.paymentId,
    appointmentId: payment.appointmentId,
    amountPaise: payment.amountPaise,
    reason,
  };
  const insert = async (values: {
    status: "Initiated" | "Failed";
    gatewayRefundId?: string | null;
    failureReason?: string | null;
  }): Promise<Refund> => {
    try {
      const [row] = await db
        .insert(refunds)
        .values({
          ...base,
          status: values.status,
          gatewayRefundId: values.gatewayRefundId ?? null,
          failureReason: values.failureReason ?? null,
        })
        .returning();
      return row;
    } catch (err) {
      // A concurrent initiation won the race: its row is the
      // truth, and its gateway refund (if any) is the only one.
      if (isUniqueViolation(err)) {
        const winner = await findRefundByPayment(payment.paymentId);
        if (winner) return winner;
      }
      throw err;
    }
  };

  if (!isRazorpayConfigured()) {
    return insert({
      status: "Failed",
      failureReason: NOT_CONFIGURED_REASON,
    });
  }
  if (!payment.razorpayPaymentId) {
    return insert({
      status: "Failed",
      failureReason:
        "No payment reference was recorded for this payment.",
    });
  }
  const adopted = await findExistingGatewayRefund(
    payment.razorpayPaymentId,
  );
  if (adopted) {
    return insert({ status: "Initiated", gatewayRefundId: adopted });
  }
  try {
    const gatewayRefundId = await createRazorpayRefund({
      razorpayPaymentId: payment.razorpayPaymentId,
      amountPaise: payment.amountPaise,
    });
    return insert({ status: "Initiated", gatewayRefundId });
  } catch (err) {
    // Server log carries the payment ROW id only — never the
    // gateway payment id, which must not leak into logs or UI.
    console.error(
      `Refund initiation failed for payment row ${payment.paymentId}:`,
      err,
    );
    const reason =
      err instanceof Error ? err.message : "Refund failed.";
    // Bounded self-heal, 404-only: a 404 means Razorpay does not
    // recognise the stored reference, not that the payment is
    // unrefundable. If the order holds exactly one captured
    // payment under a different id, re-sync to it and retry the
    // refund exactly once (adopting an existing gateway refund
    // first, so a healed retry can never double-pay). Any other
    // outcome keeps the original failure below.
    if (/\(status 404\)/.test(reason)) {
      const healed = await healStalePaymentReference({
        paymentRowId: payment.paymentId,
        storedPaymentId: payment.razorpayPaymentId,
        orderId: payment.razorpayOrderId,
      });
      if (healed) {
        const adopted = await findExistingGatewayRefund(healed);
        if (adopted) {
          return insert({ status: "Initiated", gatewayRefundId: adopted });
        }
        try {
          const gatewayRefundId = await createRazorpayRefund({
            razorpayPaymentId: healed,
            amountPaise: payment.amountPaise,
          });
          return insert({ status: "Initiated", gatewayRefundId });
        } catch {
          // Fall through: the original failure stands.
        }
      }
    }
    return insert({
      status: "Failed",
      failureReason: reason,
    });
  }
}

/**
 * Retry one Failed refund, for its own patient only. The row is
 * claimed first (Failed → Initiated, guarded): only the claim
 * winner calls Razorpay, so a double-click cannot double-pay.
 * The same row is updated in place throughout — a retry never
 * inserts a second refund row. On provider failure the row goes
 * back to Failed with the real reason and the error is thrown,
 * so the patient sees it and can retry again.
 */
export async function retryRefund(
  refundId: number,
  patientId: number,
): Promise<Refund> {
  const [found] = await db
    .select({
      refund: refunds,
      appointmentPatientId: appointments.patientId,
      razorpayPaymentId: payments.razorpayPaymentId,
      razorpayOrderId: payments.razorpayOrderId,
      amountPaise: payments.amountPaise,
    })
    .from(refunds)
    .innerJoin(payments, eq(refunds.paymentId, payments.paymentId))
    .innerJoin(
      appointments,
      eq(refunds.appointmentId, appointments.appointmentId),
    )
    .where(eq(refunds.refundId, refundId));
  if (!found) throw new Error("Refund not found.");
  if (found.appointmentPatientId !== patientId) {
    throw new Error("This refund belongs to another patient.");
  }
  if (found.refund.status !== "Failed") {
    throw new Error("Only a failed refund can be retried.");
  }
  // Claim the row: exactly one concurrent retry proceeds.
  const [claimed] = await db
    .update(refunds)
    .set({ status: "Initiated", failureReason: null, updatedAt: new Date() })
    .where(
      and(
        eq(refunds.refundId, refundId),
        eq(refunds.status, "Failed"),
      ),
    )
    .returning();
  if (!claimed) {
    throw new Error("This refund is no longer awaiting retry.");
  }
  const failBack = async (reason: string): Promise<never> => {
    // Server log carries row ids only — never the gateway
    // payment id, which must not leak into logs or UI.
    console.error(
      `Refund retry failed for refund row ${refundId} (payment row ${found.refund.paymentId}): ${reason}`,
    );
    await db
      .update(refunds)
      .set({
        status: "Failed",
        failureReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(refunds.refundId, refundId));
    throw new Error(reason);
  };
  if (!isRazorpayConfigured()) {
    return failBack(NOT_CONFIGURED_REASON);
  }
  if (!found.razorpayPaymentId) {
    return failBack("No payment reference was recorded for this payment.");
  }
  const adopted = await findExistingGatewayRefund(
    found.razorpayPaymentId,
  );
  if (adopted) {
    const [row] = await db
      .update(refunds)
      .set({ gatewayRefundId: adopted, updatedAt: new Date() })
      .where(eq(refunds.refundId, refundId))
      .returning();
    return row;
  }
  try {
    const gatewayRefundId = await createRazorpayRefund({
      razorpayPaymentId: found.razorpayPaymentId,
      amountPaise: found.amountPaise,
    });
    const [row] = await db
      .update(refunds)
      .set({ gatewayRefundId, updatedAt: new Date() })
      .where(eq(refunds.refundId, refundId))
      .returning();
    return row;
  } catch (err) {
    const reason =
      err instanceof Error ? err.message : "Refund failed.";
    // Bounded self-heal, 404-only — same rule as initiation: if
    // the order holds exactly one captured payment under a
    // different id, re-sync to it and retry the refund exactly
    // once (adopting an existing gateway refund first, so a
    // healed retry can never double-pay). Any other outcome
    // keeps the original failure via failBack below.
    if (/\(status 404\)/.test(reason)) {
      const healed = await healStalePaymentReference({
        paymentRowId: found.refund.paymentId,
        storedPaymentId: found.razorpayPaymentId,
        orderId: found.razorpayOrderId,
      });
      if (healed) {
        const adopted = await findExistingGatewayRefund(healed);
        if (adopted) {
          const [row] = await db
            .update(refunds)
            .set({ gatewayRefundId: adopted, updatedAt: new Date() })
            .where(eq(refunds.refundId, refundId))
            .returning();
          return row;
        }
        try {
          const gatewayRefundId = await createRazorpayRefund({
            razorpayPaymentId: healed,
            amountPaise: found.amountPaise,
          });
          const [row] = await db
            .update(refunds)
            .set({ gatewayRefundId, updatedAt: new Date() })
            .where(eq(refunds.refundId, refundId))
            .returning();
          return row;
        } catch {
          // Fall through: the original failure stands.
        }
      }
    }
    return failBack(reason);
  }
}

/** All refund rows of one patient, newest first. */
export async function getRefundsForPatient(
  patientId: number,
): Promise<Refund[]> {
  return db
    .select({
      refundId: refunds.refundId,
      paymentId: refunds.paymentId,
      appointmentId: refunds.appointmentId,
      amountPaise: refunds.amountPaise,
      reason: refunds.reason,
      status: refunds.status,
      gatewayRefundId: refunds.gatewayRefundId,
      failureReason: refunds.failureReason,
      createdAt: refunds.createdAt,
      updatedAt: refunds.updatedAt,
    })
    .from(refunds)
    .innerJoin(
      appointments,
      eq(refunds.appointmentId, appointments.appointmentId),
    )
    .where(eq(appointments.patientId, patientId))
    .orderBy(desc(refunds.createdAt));
}

/** The refund row for one appointment, if one was ever started. */
export async function getRefundForAppointment(
  appointmentId: number,
): Promise<Refund | null> {
  const [row] = await db
    .select()
    .from(refunds)
    .where(eq(refunds.appointmentId, appointmentId));
  return row ?? null;
}

/**
 * Day 4 Stage C helper: one refund row by id, with its
 * appointment's patient, so a retry action can tell a genuine
 * retry failure (row Failed, own patient) from a rejected
 * request — and only the genuine case gets a refund_failed mail.
 */
export async function getRefundById(
  refundId: number,
): Promise<{
  refund: Refund;
  appointmentPatientId: number;
} | null> {
  const [found] = await db
    .select({
      refund: refunds,
      appointmentPatientId: appointments.patientId,
    })
    .from(refunds)
    .innerJoin(
      appointments,
      eq(refunds.appointmentId, appointments.appointmentId),
    )
    .where(eq(refunds.refundId, refundId));
  return found ?? null;
}

export type PaymentHistoryEntry = {
  paymentId: number;
  appointmentId: number;
  appointmentStatus: string;
  doctorName: string;
  amountPaise: number;
  paymentStatus: string;
  paidAt: Date;
  // The gateway payment reference CareBook itself recorded at
  // verify time (the pay_ id), or null when none was recorded.
  // Display-only: it lets the owning patient compare this
  // reference character-for-character with the Payment ID in
  // Razorpay Dashboard when a refund fails. It is never logged
  // server-side and never shown to anyone but the owning patient
  // (this history is queried by the patient's own id only).
  gatewayPaymentId: string | null;
  refund: {
    refundId: number;
    status: string;
    failureReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
};

/**
 * A patient's receipt view: every real payment with its doctor
 * and appointment, newest first, each carrying its refund row
 * (if any) separately. No invented invoice numbers or dates —
 * every field comes from the payments/refunds tables.
 */
export async function getPaymentHistoryForPatient(
  patientId: number,
): Promise<PaymentHistoryEntry[]> {
  const rows = await db
    .select({
      paymentId: payments.paymentId,
      appointmentId: payments.appointmentId,
      appointmentStatus: appointments.status,
      doctorName: users.name,
      amountPaise: payments.amountPaise,
      paymentStatus: payments.status,
      paidAt: payments.createdAt,
      gatewayPaymentId: payments.razorpayPaymentId,
      refundId: refunds.refundId,
      refundStatus: refunds.status,
      refundFailureReason: refunds.failureReason,
      refundCreatedAt: refunds.createdAt,
      refundUpdatedAt: refunds.updatedAt,
    })
    .from(payments)
    .innerJoin(
      appointments,
      eq(payments.appointmentId, appointments.appointmentId),
    )
    .innerJoin(doctors, eq(appointments.doctorId, doctors.doctorId))
    .innerJoin(users, eq(doctors.userId, users.userId))
    .leftJoin(refunds, eq(refunds.paymentId, payments.paymentId))
    .where(eq(appointments.patientId, patientId))
    .orderBy(desc(payments.createdAt));
  return rows.map((r) => ({
    paymentId: r.paymentId,
    appointmentId: r.appointmentId,
    appointmentStatus: r.appointmentStatus,
    doctorName: r.doctorName,
    amountPaise: r.amountPaise,
    paymentStatus: r.paymentStatus,
    paidAt: r.paidAt,
    gatewayPaymentId: r.gatewayPaymentId,
    refund:
      r.refundId === null
        ? null
        : {
            refundId: r.refundId,
            status: r.refundStatus as string,
            failureReason: r.refundFailureReason,
            createdAt: r.refundCreatedAt as Date,
            updatedAt: r.refundUpdatedAt as Date,
          },
  }));
}
