// Razorpay checkout panel — Day 4 Stage A (pay before
// confirmation). Client component: it loads Checkout.js, opens
// the payment window, and hands every outcome to a server action
// (verify / abandon / fail / retry). It never trusts the browser
// for confirmation — the server verifies the signature and the
// amount before any booking turns Booked.
//
// Props: an existing order to pay (dashboard Pending card), or
// null to start from a retry (new order + refreshed hold). The
// public key id comes from NEXT_PUBLIC_RAZORPAY_KEY_ID at build
// time; when it is missing the panel fails closed instead of
// opening a broken checkout.
//
// After Razorpay reports a success, this panel never offers a
// second payment attempt for that order: if server verification
// fails, the webhook still confirms the payment, so paying again
// would double-charge. The panel says so and points at the
// dashboard instead.

"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  abandonPaymentAction,
  failPaymentAction,
  retryPaymentAction,
  verifyPaymentAction,
} from "@/lib/actions/payments";
import { Button } from "@/components/ui/button";

type RazorpaySuccess = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayInstance = {
  open: () => void;
  on: (
    event: "payment.failed",
    handler: (response: { error?: { description?: string } }) => void,
  ) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

const CHECKOUT_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

/** Load Checkout.js on demand; true when Razorpay is usable. */
function loadCheckoutScript(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const existing = document.querySelector(
      `script[src="${CHECKOUT_SCRIPT}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(true));
      existing.addEventListener("error", () => resolve(false));
      return;
    }
    const script = document.createElement("script");
    script.src = CHECKOUT_SCRIPT;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

/** Paise to a readable rupee amount ("500", "999.99"). */
function formatRupees(paise: number): string {
  return (paise / 100).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  });
}

/** ISO timestamp to an IST deadline ("Fri, 30 Oct 2026, 3:45 PM"). */
function formatExpiry(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export type CheckoutPrefill = {
  name?: string;
  email?: string;
  /** Patient phone, when one is on file. */
  contact?: string;
};

export function PaymentCheckout({
  appointmentId,
  orderId,
  amountPaise,
  expiresAtIso,
  prefill,
}: {
  appointmentId: number;
  /** Null when there is no live order — the button retries first. */
  orderId: string | null;
  amountPaise: number;
  expiresAtIso?: string;
  /** Signed-in patient's own details, when known. Razorpay
   * pre-fills these so it never asks for a mobile number the
   * patient already gave us; fields that are absent are simply
   * omitted, never sent as blanks. */
  prefill?: CheckoutPrefill;
}) {
  const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(
    orderId,
  );
  const [currentExpiry, setCurrentExpiry] = useState<string | undefined>(
    expiresAtIso,
  );
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [paidButUnconfirmed, setPaidButUnconfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Set the moment Razorpay reports a success, so the modal's
  // dismiss handler (which also fires on close) never marks a
  // completed payment as abandoned.
  const completedRef = useRef(false);

  const openCheckout = async (orderToPay: string) => {
    if (!keyId) {
      setError(
        "Online payment is not configured for this clinic yet. Please try again later.",
      );
      return;
    }
    setError(null);
    setNotice(null);
    const ready = await loadCheckoutScript();
    if (!ready || !window.Razorpay) {
      setError(
        "The payment window failed to load. Check your connection and try again.",
      );
      return;
    }
    // Prefill only the fields the patient actually has on file —
    // an absent phone stays absent rather than arriving blank and
    // re-triggering Razorpay's mobile-number step.
    const prefillOptions: Record<string, string> = {};
    if (prefill?.name) prefillOptions.name = prefill.name;
    if (prefill?.email) prefillOptions.email = prefill.email;
    if (prefill?.contact) prefillOptions.contact = prefill.contact;
    const checkout = new window.Razorpay({
      key: keyId,
      amount: amountPaise,
      currency: "INR",
      order_id: orderToPay,
      name: "CareBook",
      description: "Consultation fee",
      ...(Object.keys(prefillOptions).length > 0
        ? { prefill: prefillOptions }
        : {}),
      handler: (response: RazorpaySuccess) => {
        completedRef.current = true;
        setBusy(true);
        void verifyPaymentAction({
          orderId: response.razorpay_order_id,
          paymentId: response.razorpay_payment_id,
          signature: response.razorpay_signature,
        }).then((result) => {
          setBusy(false);
          if (result.ok) {
            setDone(true);
          } else {
            // Razorpay took the payment but server confirmation
            // failed: the webhook still confirms it. Never ask
            // the patient to pay twice on this screen.
            setPaidButUnconfirmed(true);
            setError(
              `${result.error ?? "Payment could not be confirmed."} If you were charged, your booking usually confirms within moments — check your dashboard instead of paying again.`,
            );
          }
        });
      },
      modal: {
        ondismiss: () => {
          if (completedRef.current) return;
          void abandonPaymentAction({ orderId: orderToPay });
          setNotice(
            "Payment not completed. Your booking is still held — you can pay from your dashboard before the hold expires.",
          );
        },
      },
    });
    checkout.on("payment.failed", () => {
      void failPaymentAction({ orderId: orderToPay });
      setError(
        "Payment failed. No booking was confirmed — try again with a new payment attempt below.",
      );
    });
    checkout.open();
  };

  const retry = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await retryPaymentAction(appointmentId);
    setBusy(false);
    if (!result.ok || !result.orderId) {
      setError(result.error ?? "Could not start a new payment attempt.");
      return;
    }
    setCurrentOrderId(result.orderId);
    if (result.expiresAtIso) setCurrentExpiry(result.expiresAtIso);
    await openCheckout(result.orderId);
  };

  const payNow = () => {
    if (currentOrderId) {
      void openCheckout(currentOrderId);
      return;
    }
    void retry();
  };

  if (done) {
    return (
      <div
        role="status"
        className="max-w-sm rounded-lg border border-teal-200 bg-teal-50/60 p-3"
      >
        <p className="text-sm font-medium text-teal-900">
          Payment complete — your appointment is confirmed.
        </p>
        <Link href="/dashboard" className="mt-3 inline-block">
          <Button size="sm">View my bookings</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-sm rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <p className="text-sm font-medium">
        Complete payment to confirm this booking
      </p>
      <p className="mt-1 text-sm text-slate-600">
        Consultation fee: ₹{formatRupees(amountPaise)}
      </p>
      {currentExpiry && (
        <p className="mt-1 text-sm text-slate-600">
          Your slot is held until {formatExpiry(currentExpiry)}.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-2 text-sm text-slate-600">
          {notice}
        </p>
      )}
      {paidButUnconfirmed ? (
        <Link href="/dashboard" className="mt-3 inline-block">
          <Button size="sm">Check my bookings</Button>
        </Link>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={payNow}>
            {busy
              ? "Working…"
              : currentOrderId
                ? "Pay now"
                : "Retry payment"}
          </Button>
          {currentOrderId && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void retry()}
            >
              New payment attempt
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
