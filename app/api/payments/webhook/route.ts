// Razorpay webhook — Day 4 Stages A + B + C. Server-to-server, no session:
// Razorpay proves itself with the x-razorpay-signature HMAC over
// the RAW body, verified before any parsing. (Parsing and
// re-serializing changes bytes and breaks the signature, so the
// body is read with request.text() first and only then parsed.)
//
// Idempotency is two layers deep: the event is recorded in
// webhook_events inside the same transaction that applies it, so a
// redelivery inserts nothing and applies nothing; and every state
// change is Pending-guarded, so even a replayed application is a
// no-op. A failed transaction rolls back the record too, so
// Razorpay's retry can still apply the event later.
//
// Effects:
//   payment.captured / order.paid → payment Paid (if Pending) and
//     its appointment Booked (if still Pending, hold cleared).
//   payment.failed → payment Failed only; the hold stays Pending.
//   refund.processed → refund Processed (gateway id stored).
//   refund.failed → refund Failed + reason (never from Processed).
//   anything else → recorded, 200, no effect.
//
// Day 4 Stage C: each branch reports whether its guarded update
// actually transitioned a row, and only then is a mail queued —
// so the first confirmer (verify action or webhook) sends the
// mail, and the loser's redelivery sends nothing. Mails go out
// after the transaction commits, never inside it.

import { and, eq, ne } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db, ensureDb } from "@/lib/db";
import {
  appointments,
  payments,
  refunds,
  webhookEvents,
} from "@/lib/db/schema";
import { verifyWebhookSignature } from "@/lib/services/razorpay";
import {
  sendEventEmail,
  type EventExtra,
} from "@/lib/services/notifications";

type WebhookPayload = {
  id?: unknown;
  event?: unknown;
  payload?: {
    payment?: { entity?: { id?: unknown; order_id?: unknown } };
    order?: { entity?: { id?: unknown } };
    refund?: {
      entity?: {
        id?: unknown;
        payment_id?: unknown;
        error_description?: unknown;
        error_reason?: unknown;
      };
    };
  };
};

/**
 * Dedup key for one delivery. Razorpay's own event id when the
 * payload carries one; otherwise a per-event key (the payment or
 * order the event is about); otherwise a hash of the raw body, so
 * an unrecognized shape still dedups on exact redelivery.
 */
function dedupKey(
  payload: WebhookPayload,
  rawBody: string,
  event: string,
): string {
  if (typeof payload.id === "string" && payload.id.length > 0) {
    return payload.id;
  }
  const paymentId = payload.payload?.payment?.entity?.id;
  if (
    (event === "payment.captured" || event === "payment.failed") &&
    typeof paymentId === "string" &&
    paymentId.length > 0
  ) {
    return `${event}:${paymentId}`;
  }
  const orderId = payload.payload?.order?.entity?.id;
  if (
    event === "order.paid" &&
    typeof orderId === "string" &&
    orderId.length > 0
  ) {
    return `${event}:${orderId}`;
  }
  // Last resort: hash the raw body.
  return `raw:${createHash("sha256").update(rawBody).digest("hex")}`;
}

function entityId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature");
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    return Response.json(
      { error: "Webhook secret is not configured." },
      { status: 500 },
    );
  }
  if (!signature || !verifyWebhookSignature(rawBody, signature)) {
    return Response.json({ error: "Invalid signature." }, { status: 401 });
  }
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const event = typeof payload.event === "string" ? payload.event : "";
  if (!event) {
    return Response.json({ error: "Missing event type." }, { status: 400 });
  }

  try {
    await ensureDb();
  } catch (err) {
    console.error("Webhook ensureDb failed:", err);
    return Response.json(
      { error: "Database is not available." },
      { status: 500 },
    );
  }

  const key = dedupKey(payload, rawBody, event);
  // Day 4 Stage C: mails for the transitions this delivery
  // actually applies. Filled inside the transaction, sent only
  // after it commits (see below).
  const pendingNotifications: Array<{
    appointmentId: number;
    event: string;
    extra: EventExtra;
  }> = [];
  try {
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(webhookEvents)
        .values({ eventId: key, type: event })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) return; // redelivery: nothing to do

      if (event === "payment.captured" || event === "order.paid") {
        const orderId =
          event === "payment.captured"
            ? entityId(payload.payload?.payment?.entity?.order_id)
            : entityId(payload.payload?.order?.entity?.id);
        const paymentId =
          event === "payment.captured"
            ? entityId(payload.payload?.payment?.entity?.id)
            : null;
        if (orderId) {
          const [row] = await tx
            .select()
            .from(payments)
            .where(eq(payments.razorpayOrderId, orderId));
          if (row) {
            const paidRows = await tx
              .update(payments)
              .set({
                status: "Paid",
                ...(paymentId ? { razorpayPaymentId: paymentId } : {}),
              })
              .where(
                and(
                  eq(payments.paymentId, row.paymentId),
                  eq(payments.status, "Pending"),
                ),
              )
              .returning();
            await tx
              .update(appointments)
              .set({ status: "Booked", expiresAt: null })
              .where(
                and(
                  eq(appointments.appointmentId, row.appointmentId),
                  eq(appointments.status, "Pending"),
                ),
              );
            // Only the path that actually confirmed sends mail:
            // a verify that already won leaves zero rows here.
            if (paidRows.length > 0) {
              pendingNotifications.push({
                appointmentId: row.appointmentId,
                event: "booking_created",
                extra: {},
              });
              pendingNotifications.push({
                appointmentId: row.appointmentId,
                event: "payment_succeeded",
                extra: { amountPaise: row.amountPaise },
              });
            }
          }
        }
      } else if (event === "payment.failed") {
        const orderId = entityId(
          payload.payload?.payment?.entity?.order_id,
        );
        if (orderId) {
          const [payRow] = await tx
            .select()
            .from(payments)
            .where(eq(payments.razorpayOrderId, orderId));
          if (payRow) {
            const failedRows = await tx
              .update(payments)
              .set({ status: "Failed" })
              .where(
                and(
                  eq(payments.paymentId, payRow.paymentId),
                  eq(payments.status, "Pending"),
                ),
              )
              .returning();
            // The appointment deliberately stays Pending.
            if (failedRows.length > 0) {
              pendingNotifications.push({
                appointmentId: payRow.appointmentId,
                event: "payment_failed",
                extra: { amountPaise: payRow.amountPaise },
              });
            }
          }
        }
      } else if (event === "refund.processed" || event === "refund.failed") {
        // Day 4 Stage B. Resolve the refund row by its gateway id
        // when Razorpay gives one, else through the payment it
        // belongs to. A processed refund never moves backwards:
        // failed handling skips rows that already reached
        // Processed, and processed handling skips rows already
        // Processed, so redelivery is a no-op either way.
        const refundEntity = payload.payload?.refund?.entity;
        const gatewayId = entityId(refundEntity?.id);
        const gatewayPaymentId = entityId(refundEntity?.payment_id);
        let refundId: number | null = null;
        if (gatewayId) {
          const [row] = await tx
            .select({ refundId: refunds.refundId })
            .from(refunds)
            .where(eq(refunds.gatewayRefundId, gatewayId));
          refundId = row?.refundId ?? null;
        }
        if (refundId === null && gatewayPaymentId) {
          const [pay] = await tx
            .select({ paymentId: payments.paymentId })
            .from(payments)
            .where(eq(payments.razorpayPaymentId, gatewayPaymentId));
          if (pay) {
            const [row] = await tx
              .select({ refundId: refunds.refundId })
              .from(refunds)
              .where(eq(refunds.paymentId, pay.paymentId));
            refundId = row?.refundId ?? null;
          }
        }
        if (refundId !== null) {
          const [refundRow] = await tx
            .select()
            .from(refunds)
            .where(eq(refunds.refundId, refundId));
          if (event === "refund.processed") {
            const processedRows = await tx
              .update(refunds)
              .set({
                status: "Processed",
                ...(gatewayId ? { gatewayRefundId: gatewayId } : {}),
                failureReason: null,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(refunds.refundId, refundId),
                  ne(refunds.status, "Processed"),
                ),
              )
              .returning();
            if (processedRows.length > 0 && refundRow) {
              pendingNotifications.push({
                appointmentId: refundRow.appointmentId,
                event: "refund_processed",
                extra: { amountPaise: refundRow.amountPaise },
              });
            }
          } else {
            const reason =
              typeof refundEntity?.error_description === "string" &&
              refundEntity.error_description.length > 0
                ? refundEntity.error_description
                : typeof refundEntity?.error_reason === "string" &&
                    refundEntity.error_reason.length > 0
                  ? refundEntity.error_reason
                  : "Refund failed at the payment provider.";
            const failedRows = await tx
              .update(refunds)
              .set({
                status: "Failed",
                failureReason: reason,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(refunds.refundId, refundId),
                  ne(refunds.status, "Processed"),
                ),
              )
              .returning();
            if (failedRows.length > 0 && refundRow) {
              pendingNotifications.push({
                appointmentId: refundRow.appointmentId,
                event: "refund_failed",
                extra: {
                  amountPaise: refundRow.amountPaise,
                  failureReason: reason,
                },
              });
            }
          }
        }
      }
      // Unknown types: recorded above, no effect, still 200.
    });
    // Day 4 Stage C: mails for the transitions this delivery
    // applied, sent only now that the transaction committed — a
    // mail failure must never roll back the webhook. (Redelivery
    // or a verify that already won leaves this list empty.)
    for (const n of pendingNotifications) {
      try {
        await sendEventEmail(n.appointmentId, n.event, n.extra);
      } catch (err) {
        console.error("Webhook notification failed:", err);
      }
    }
    return Response.json({ ok: true });
  } catch (err) {
    // Transaction rolled back, including the dedup record, so
    // Razorpay's retry can still apply this event.
    console.error("Webhook handling failed:", err);
    return Response.json(
      { error: "Webhook handling failed." },
      { status: 500 },
    );
  }
}
