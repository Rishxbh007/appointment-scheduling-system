// Patient booking form — guided steps, rebuilt from zero.
//
// One clear path, no dropdowns, no walls of cards, no disabled
// grey options: 1) pick a day, 2) pick a time, 3) reason for
// visit, 4) review, 5) pay. Only bookable slots ever appear as
// chips (see components/slot-picker.tsx); the server action
// revalidates the slot anyway — the picker filter is display
// only, never the guard.
//
// What the submit still sends is unchanged: slotId + reason to
// bookAction, exactly as before. Paid bookings still go through
// the same Razorpay Checkout panel (PaymentCheckout, untouched):
// the slot is held Pending for 15 minutes while the patient
// pays, and cancelling a paid booking still starts a full refund
// to the original payment method, tracked separately from the
// cancellation. That Day 4 information is preserved here in
// short plain words on the review step — simplified, never
// removed. Free bookings still redirect to the dashboard.
"use client";

import { useActionState, useState } from "react";
import { bookAction } from "@/lib/actions/booking";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SlotPicker, type SlotChoice } from "@/components/slot-picker";
import { formatDate, formatTime } from "@/lib/time";
import {
  PaymentCheckout,
  type CheckoutPrefill,
} from "@/components/payment-checkout";
import type { DoctorSlotView } from "@/lib/services/doctors";

export type BookableSlot = Pick<
  DoctorSlotView,
  | "slotId"
  | "date"
  | "startTime"
  | "endTime"
  | "remaining"
  | "bookable"
  | "state"
>;

const STEPS = ["Day & time", "Reason", "Review"] as const;

function StepHeader({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="Booking steps">
      {STEPS.map((label, i) => {
        const done = i < step;
        const current = i === step;
        return (
          <li key={label} className="flex items-center gap-1.5">
            <span
              className={
                current
                  ? "rounded-full bg-brand-700 px-3 py-1 text-xs font-bold text-white"
                  : done
                    ? "rounded-full bg-brand-100 px-3 py-1 text-xs font-bold text-brand-800"
                    : "rounded-full bg-surface-subtle px-3 py-1 text-xs font-medium text-ink-faint"
              }
            >
              {done ? "✓ " : ""}
              {i + 1}. {label}
            </span>
            {i < STEPS.length - 1 && (
              <span aria-hidden className="text-ink-faint">
                ›
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function BookingForm({
  slots,
  consultationFee,
  doctorName,
  prefill,
  initialSlotId,
}: {
  slots: BookableSlot[];
  /** The doctor's fee as stored (e.g. "500.00"), or null. */
  consultationFee?: string | null;
  doctorName?: string;
  /** Signed-in patient's own details for checkout prefill. */
  prefill?: CheckoutPrefill;
  /** Slot preselected from the profile's Available-times pills
   * (?slot=). Ignored unless it is still bookable — the server
   * revalidates the chosen slot at submit time anyway. */
  initialSlotId?: number | null;
}) {
  const [state, dispatch, pending] = useActionState(bookAction, {});
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<SlotChoice | null>(
    () =>
      slots.find((s) => s.slotId === initialSlotId && s.bookable) ??
      null,
  );
  const [reason, setReason] = useState("");
  // Pill picks arrive AFTER mount: an Available-times pill is a
  // link to ?slot=, and that navigation re-renders the page
  // without remounting this form — so the useState initializer
  // above never re-runs and the card kept the old time. Adjust
  // the selection during render when the pill slot changes to a
  // still-bookable slot (React's sanctioned prop-change
  // pattern, not an effect). The typed reason and the current
  // step are untouched, and an unbookable pill slot leaves the
  // current selection alone.
  const [prevInitialSlotId, setPrevInitialSlotId] =
    useState(initialSlotId);
  if (initialSlotId !== prevInitialSlotId) {
    setPrevInitialSlotId(initialSlotId);
    const picked =
      slots.find((s) => s.slotId === initialSlotId && s.bookable) ??
      null;
    if (picked && picked.slotId !== selected?.slotId) {
      setSelected(picked);
    }
  }

  const bookable = slots.filter((s) => s.bookable);

  if (bookable.length === 0) {
    return (
      <p className="text-sm text-slate-600">
        No bookable times right now. Check back later, or try another
        doctor.
      </p>
    );
  }

  // Paid booking: the slot is held Pending and the checkout panel
  // takes over — the form itself is done until payment resolves.
  if (state.payment) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">
          Your slot is held while you pay. It is not confirmed yet.
        </p>
        <PaymentCheckout
          appointmentId={state.payment.appointmentId}
          orderId={state.payment.orderId}
          amountPaise={state.payment.amountPaise}
          expiresAtIso={state.payment.expiresAtIso}
          prefill={prefill}
        />
      </div>
    );
  }

  const feeNumber =
    consultationFee === null || consultationFee === undefined
      ? NaN
      : Number.parseFloat(consultationFee);
  const paidBooking = Number.isFinite(feeNumber) && feeNumber > 0;

  return (
    <form action={dispatch} className="flex flex-col gap-5">
      {/* Hidden fields only: the visible UI is chips + textarea.
          These carry the submission, exactly as the old form did. */}
      <input type="hidden" name="slotId" value={selected?.slotId ?? ""} />
      {step === 2 && <input type="hidden" name="reason" value={reason} />}
      <StepHeader step={step} />
      {state.error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </p>
      )}

      {step === 0 && (
        <>
          <SlotPicker
            slots={bookable}
            selectedSlotId={selected?.slotId ?? null}
            onSelect={setSelected}
            onDaySelect={() => setSelected(null)}
          />
          <Button
            type="button"
            size="lg"
            className="w-full sm:w-auto sm:self-start"
            disabled={!selected}
            onClick={() => setStep(1)}
          >
            Continue with this time →
          </Button>
        </>
      )}

      {step === 1 && (
        <>
          <div className="rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3">
            <p className="text-sm font-bold text-brand-800">
              {selected
                ? `${formatDate(selected.date)} · ${formatTime(selected.startTime)} – ${formatTime(selected.endTime)}`
                : "No time picked yet"}
            </p>
            <Button
              type="button"
              className="mt-1 h-auto justify-start p-0 text-sm font-medium text-brand-700 underline hover:bg-transparent hover:text-brand-800"
              onClick={() => setStep(0)}
            >
              Change day or time
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reason">Why are you visiting?</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              placeholder="Briefly describe why you are visiting, e.g. fever and cough for 3 days."
            />
            <p className="text-xs text-ink-faint">
              This helps the doctor prepare for your visit.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="lg"
              disabled={reason.trim().length === 0}
              onClick={() => setStep(2)}
            >
              Review booking →
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              onClick={() => setStep(0)}
            >
              Back
            </Button>
          </div>
        </>
      )}

      {step === 2 && selected && (
        <>
          <div className="flex flex-col gap-4 rounded-2xl border border-border bg-gradient-to-br from-brand-50 via-surface to-amber-50 p-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-ink-faint">
                Your appointment
              </p>
              {doctorName && (
                <p className="mt-1 text-lg font-bold text-ink">{doctorName}</p>
              )}
              <p className="mt-1 text-base font-semibold text-brand-800">
                {formatDate(selected.date)} ·{" "}
                {formatTime(selected.startTime)} –{" "}
                {formatTime(selected.endTime)} (IST)
              </p>
              <p className="mt-1 text-sm text-ink-soft">
                Reason: {reason.trim()}
              </p>
            </div>
            <div className="border-t border-border pt-3 text-sm text-ink-soft">
              {paidBooking ? (
                <>
                  <p className="font-bold text-ink">
                    Consultation fee: ₹{consultationFee}
                  </p>
                  <p className="mt-1">
                    You pay now to confirm. Your time is held for 15
                    minutes while you pay — if payment does not
                    finish in time, the hold ends and the time opens
                    up again.
                  </p>
                </>
              ) : (
                <p>
                  No payment needed for this booking — it confirms
                  straight away.
                </p>
              )}
              <p className="mt-2">
                If you cancel later, your time opens up for other
                patients and the booking cannot be restored.
                {paidBooking
                  ? " Cancelling a paid booking starts a full refund to your original payment method. The refund is tracked separately — cancelling does not mean the money has arrived yet."
                  : " Nothing was paid, so there is nothing to refund."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg" disabled={pending}>
              {pending
                ? "Booking…"
                : paidBooking
                  ? "Continue to payment →"
                  : "Confirm booking"}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              disabled={pending}
              onClick={() => setStep(1)}
            >
              Back
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
