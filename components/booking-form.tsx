// Patient booking form: pick a slot, give a reason, book it.
// Shown only to signed-in patients on a doctor's profile page.

"use client";

import { useActionState } from "react";
import { bookAction } from "@/lib/actions/booking";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatTime } from "@/lib/time";

export type BookableSlot = {
  slotId: number;
  date: string;
  startTime: string;
  endTime: string;
  remaining: number;
};

export function BookingForm({ slots }: { slots: BookableSlot[] }) {
  const [state, dispatch, pending] = useActionState(bookAction, {});

  if (slots.length === 0) {
    return (
      <p className="text-sm text-slate-600">
        No bookable slots right now. Check back later, or try another
        doctor.
      </p>
    );
  }

  return (
    <form action={dispatch} className="flex flex-col gap-4">
      {state.error && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="slotId">Choose a time slot</Label>
        <select
          id="slotId"
          name="slotId"
          required
          className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
        >
          {slots.map((s) => (
            <option key={s.slotId} value={s.slotId}>
              {formatDate(s.date)}, {formatTime(s.startTime)} –{" "}
              {formatTime(s.endTime)} ({s.remaining} left)
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
