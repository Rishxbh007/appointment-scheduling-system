// Razorpay API client — plain fetch + node crypto, no SDK, no new
// dependencies. Every function here runs server-side only: the key
// secret and the webhook secret must never reach the browser. The
// only value the client ever sees is NEXT_PUBLIC_RAZORPAY_KEY_ID,
// read directly by the checkout component.

import { createHmac, timingSafeEqual } from "node:crypto";

const ORDERS_URL = "https://api.razorpay.com/v1/orders";
const PAYMENTS_URL = "https://api.razorpay.com/v1/payments";

function basicAuth(): string {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error("Payments are not configured.");
  }
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

/** Razorpay's error body, when it carries a human message. The
 * HTTP status and Razorpay's own error code ride along, so a
 * recorded failure reason says exactly what Razorpay said — a
 * bare description hid whether it was a 404, a 400, or a code
 * like BAD_REQUEST_ERROR, and that ambiguity is what made the
 * 30 Oct refund failures hard to diagnose.
 *
 * The 404s seen on 31 Oct carried no description at all, which
 * is anomalous — Razorpay's real errors always carry one. So
 * when there is no description, the raw body (truncated) rides
 * along instead of a bare status: that snippet is what
 * identifies whether the 404 came from Razorpay or an
 * intermediary. It never holds a secret (error pages only;
 * auth travels in headers, never the body). */
async function providerErrorMessage(res: Response): Promise<string> {
  let text: string | null = null;
  try {
    text = await res.text();
  } catch {
    text = null;
  }
  if (text) {
    try {
      const data = JSON.parse(text) as {
        error?: { description?: unknown; code?: unknown };
      };
      const description =
        typeof data.error?.description === "string"
          ? data.error.description
          : null;
      const code =
        typeof data.error?.code === "string" ? data.error.code : null;
      if (description) {
        return `${description} (status ${res.status}${code ? `, code ${code}` : ""}).`;
      }
    } catch {
      // Not JSON — fall through to the snippet below.
    }
  }
  const snippet =
    text && text.trim().length > 0
      ? text.replace(/\s+/g, " ").slice(0, 300)
      : "(empty body)";
  return `Payment provider rejected the request (status ${res.status}). Response: ${snippet}`;
}

/** Both server keys present (test keys start with rzp_test_). */
export function isRazorpayConfigured(): boolean {
  return Boolean(
    process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET,
  );
}

/**
 * Create a Razorpay order for a booking. The receipt is the
 * appointment id, so an order always traces back to one booking.
 * Throws on any non-2xx response or malformed body — callers
 * compensate (cancel the hold, fail the payment row).
 */
export async function createRazorpayOrder(input: {
  amountPaise: number;
  receipt: string;
}): Promise<string> {
  const res = await fetch(ORDERS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: basicAuth(),
    },
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: "INR",
      receipt: input.receipt,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Payment provider rejected the order (status ${res.status}).`,
    );
  }
  const data = (await res.json()) as { id?: unknown };
  if (typeof data.id !== "string" || data.id.length === 0) {
    throw new Error("Payment provider returned an invalid order.");
  }
  return data.id;
}

/**
 * Create a FULL refund for one Razorpay payment (Day 4 Stage B).
 * The amount is always the payment's full amount — this clinic
 * never refunds in part. Returns Razorpay's refund id. Throws on
 * any non-2xx response, carrying Razorpay's own error message
 * when it gives one, so the caller records a real failure reason.
 * A successful call means Razorpay accepted the refund, not that
 * the money has arrived — that confirmation comes via the
 * refund.processed webhook, and the caller must not treat this
 * return as "refunded".
 */
export async function createRazorpayRefund(input: {
  razorpayPaymentId: string;
  amountPaise: number;
}): Promise<string> {
  // Create is SINGULAR /refund: Razorpay accepts POST only on
  // /v1/payments/:id/refund. The plural /refunds accepts only
  // GET (fetching refunds) — POSTing there returns 404
  // {"message":"no Route matched with those values"}, which is
  // exactly what every CareBook refund hit until this fix.
  const res = await fetch(
    `${PAYMENTS_URL}/${input.razorpayPaymentId}/refund`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: basicAuth(),
      },
      body: JSON.stringify({ amount: input.amountPaise }),
    },
  );
  if (!res.ok) {
    throw new Error(await providerErrorMessage(res));
  }
  const data = (await res.json()) as { id?: unknown };
  if (typeof data.id !== "string" || data.id.length === 0) {
    throw new Error("Payment provider returned an invalid refund.");
  }
  return data.id;
}

/**
 * Look for a refund Razorpay already holds for one payment.
 * Returns the first non-failed gateway refund id, or null. Used
 * before creating a refund: if a previous attempt reached
 * Razorpay but its result was lost (crash between the provider
 * call and the database write), adopting the existing refund
 * prevents paying the patient twice. A failed lookup is treated
 * as "none found" — the caller proceeds to create, and a failure
 * there is recorded normally.
 */
export async function findExistingGatewayRefund(
  razorpayPaymentId: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${PAYMENTS_URL}/${razorpayPaymentId}/refunds`,
      {
        headers: { Authorization: basicAuth() },
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      items?: { id?: unknown; status?: unknown }[];
    };
    if (!Array.isArray(data.items)) return null;
    for (const item of data.items) {
      if (
        typeof item.id === "string" &&
        item.id.length > 0 &&
        item.status !== "failed"
      ) {
        return item.id;
      }
    }
    return null;
  } catch (err) {
    console.error("Listing gateway refunds failed:", err);
    return null;
  }
}

/**
 * Read-only re-sync: list the payments Razorpay holds for one
 * order, and return the ids of the captured ones. Used ONLY when
 * a refund fails with 404, to check whether the payment reference
 * CareBook recorded still matches what Razorpay holds (a stale
 * reference 404s even though the payment itself is captured).
 * NEVER throws: any failure (missing keys, network, non-OK,
 * unparseable body) returns null, and the caller keeps its
 * original failure. Read-only — it creates nothing at Razorpay.
 */
export async function fetchPaymentsByOrder(
  orderId: string,
): Promise<string[] | null> {
  try {
    const res = await fetch(`${ORDERS_URL}/${orderId}/payments`, {
      headers: { Authorization: basicAuth() },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      items?: { id?: unknown; status?: unknown }[];
    };
    if (!Array.isArray(data.items)) return null;
    const captured: string[] = [];
    for (const item of data.items) {
      if (
        typeof item.id === "string" &&
        item.id.length > 0 &&
        item.status === "captured"
      ) {
        captured.push(item.id);
      }
    }
    return captured;
  } catch (err) {
    console.error("Listing order payments failed:", err);
    return null;
  }
}

/** Constant-time comparison of two hex digests. */
function digestsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Verify a Checkout.js success payload: HMAC-SHA256 over
 * `order_id|payment_id` with the key secret. False when the secret
 * is missing, so verification can never pass unconfigured.
 */
export function verifyRazorpaySignature(
  orderId: string,
  paymentId: string,
  signature: string,
): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  const expected = createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return digestsEqual(expected, signature);
}

/**
 * Verify a webhook delivery: HMAC-SHA256 over the RAW request body
 * with the webhook secret. Callers must pass request.text() output
 * before any parsing — parsing and re-serializing changes bytes
 * and breaks the signature.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return digestsEqual(expected, signature);
}
