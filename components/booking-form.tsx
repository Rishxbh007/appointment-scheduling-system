// Patient booking form: pick a slot, give a reason, book it.
// Shown only to signed-in patients on a doctor's profile page.
//
// The form receives ALL of the doctor's upcoming slots, not just
// the bookable ones: unavailable slots render as disabled options
// with their reason in the label, so they can be seen but never
// selected. Bookable options come first, so the default selection
// is always a slot the server would accept. The server action
// revalidates the slot anyway — disabled styling is never the
// guard, it is only the display.
"use client";

import { useActionState } from "react";
import { bookAction } from "@/lib/actions/booking";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatTime } from "@/lib/time";
import { PaymentCheckout } from "@/components/payment-checkout";
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

const STATE_LABEL: Record<BookableSlot["state"], string> = {
  available: "Available",
  "fully-booked": "Fully booked",
  unavailable: "Unavailable",
  passed: "Passed",
};

export function BookingForm({
  slots,
  consultationFee,
}: {
  slots: BookableSlot[];
  /** The doctor's fee as stored (e.g. "500.00"), or null. */
  consultationFee?: string | null;
}) {
  const [state, dispatch, pending] = useActionState(bookAction, {});

  const bookable = slots.filter((s) => s.bookable);
  // Bookable first (in date order), then unavailable ones: the
  // browser pre-selects the first option, which must be bookable.
  const ordered = [
    ...bookable,
    ...slots.filter((s) => !s.bookable),
  ];

  if (bookable.length === 0) {
    return (
      <p className="text-sm text-slate-600">
        No bookable slots right now. Check back later, or try another
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
    <form action={dispatch} className="flex flex-col gap-4">
      {state.error && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </p>
      )}
      {paidBooking && (
        <p className="rounded-md bg-teal-50 p-3 text-sm text-teal-900">
          Consultation fee ₹{consultationFee}: payment is required to
          confirm this booking. Your slot is held for 15 minutes
          while you pay.
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="slotId">Choose a time slot (IST)</Label>
        <select
          id="slotId"
          name="slotId"
          required
          className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
        >
          {ordered.map((s) => (
            <option
              key={s.slotId}
              value={s.slotId}
              disabled={!s.bookable}
            >
              {formatDate(s.date)}, {formatTime(s.startTime)} –{" "}
              {formatTime(s.endTime)}{" "}
              {s.bookable
                ? `(${s.remaining} left)`
                : `(${STATE_LABEL[s.state]})`}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reason">Reason for visit</Label>
        <Textarea
          id="reason"
          name="reason"
          required
          placeholder="Briefly describe why you are visiting, e.g. fever and cough for 3 days."
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Booking…" : "Book appointment"}
      </Button>
    </form>
  );
}
