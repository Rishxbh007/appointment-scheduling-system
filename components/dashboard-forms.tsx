// Dashboard action forms (client components so server-action errors
// are visible inline instead of failing silently).

"use client";

import { useActionState, useEffect, useState } from "react";
import {
  doctorStatusAction,
  patientCancelAction,
  patientRescheduleAction,
  createSlotAction,
  toggleSlotAction,
} from "@/lib/actions/booking";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate, formatTime } from "@/lib/time";
import { formatPaise } from "@/lib/format";
import type { BookableSlot } from "./booking-form";

function ErrorNote({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-2 text-sm text-red-700">
      {message}
    </p>
  );
}

/**
 * Short cancellation policy. It describes only behavior the app
 * actually implements: cancelling frees the slot, and a cancelled
 * appointment cannot be restored. Refund wording lives separately
 * in each dialog (Day 4 Stage B): a paid booking's dialog states
 * the refund starts separately, and an unpaid booking's dialog
 * states plainly that nothing was paid, so no refund promise is
 * ever made or implied by this policy text.
 */
function CancellationPolicy() {
  return (
    <p className="text-xs leading-relaxed text-slate-600">
      Cancellation policy: cancelling an appointment frees its time
      slot for other patients. A cancelled appointment cannot be
      restored — to see the doctor again you would need to make a
      new booking. Completed or already-cancelled appointments
      cannot be cancelled.
    </p>
  );
}

/** Doctor actions for one appointment: only legal next steps shown.
 * Cancel is a two-step confirmation; Confirm/Complete stay direct
 * submits, exactly as before. paidAmountPaise (Day 4 Stage B) is
 * the Paid payment's amount when the patient paid for this
 * booking, else null: the confirm panel states the refund
 * separately from the cancellation, and never promises a refund
 * for an unpaid booking. */
export function DoctorStatusButtons({
  appointmentId,
  status,
  patientName,
  dateLabel,
  timeLabel,
  paidAmountPaise = null,
}: {
  appointmentId: number;
  status: string;
  patientName: string;
  dateLabel: string;
  timeLabel: string;
  paidAmountPaise?: number | null;
}) {
  const [state, dispatch, pending] = useActionState(doctorStatusAction, {});
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const next: string[] =
    status === "Booked"
      ? ["Confirmed", "Cancelled"]
      : status === "Confirmed"
        ? ["Completed", "Cancelled"]
        : [];
  if (next.length === 0) return null;

  if (confirmingCancel) {
    return (
      <form
        action={dispatch}
        role="alertdialog"
        aria-label="Confirm cancellation"
        className="max-w-sm rounded-lg border border-red-200 bg-red-50/60 p-3"
      >
        <input type="hidden" name="appointmentId" value={appointmentId} />
        <input type="hidden" name="status" value="Cancelled" />
        <p className="text-sm font-medium">
          Cancel the appointment with {patientName} on {dateLabel} at{" "}
          {timeLabel}?
        </p>
        <p className="mt-2 text-sm text-slate-600">
          After confirmation, this appointment will show as Cancelled
          and its time slot will be freed for other patients. This
          cannot be undone.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          {paidAmountPaise !== null
            ? `This patient paid ${formatPaise(paidAmountPaise)} for this appointment. Cancelling will also start a full refund to their original payment method. The refund is tracked separately — cancelling does not mean the refund has arrived yet.`
            : "No payment was made for this appointment, so there is nothing to refund."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="submit"
            size="sm"
            variant="destructive"
            disabled={pending}
          >
            {pending ? "Cancelling…" : "Confirm cancellation"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => setConfirmingCancel(false)}
          >
            Keep appointment
          </Button>
        </div>
        <ErrorNote message={state.error} />
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <form action={dispatch} className="flex flex-wrap gap-2">
        <input type="hidden" name="appointmentId" value={appointmentId} />
        {next.map((s) =>
          s === "Cancelled" ? (
            <Button
              key={s}
              type="button"
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() => setConfirmingCancel(true)}
            >
              Cancel
            </Button>
          ) : (
            <Button
              key={s}
              type="submit"
              name="status"
              value={s}
              size="sm"
              variant="outline"
              disabled={pending}
            >
              {s === "Completed" ? "Mark completed" : s}
            </Button>
          ),
        )}
        <ErrorNote message={state.error} />
      </form>
      <div className="max-w-md">
        <CancellationPolicy />
      </div>
    </div>
  );
}

/** Patient cancels one of their own bookings. Two steps: the first
 * click only opens an inline confirmation panel identifying the
 * appointment; only "Confirm cancellation" submits. Both panel
 * buttons disable while the action is pending, so a double click
 * cannot submit twice. After a failure the error stays visible and
 * the Cancel button stays usable for a retry. paidAmountPaise
 * (Day 4 Stage B) is the Paid payment's amount when this booking
 * was paid for, else null: the confirm panel states the refund
 * separately from the cancellation, and never promises a refund
 * for an unpaid or still-awaiting-payment booking. */
export function PatientCancelButton({
  appointmentId,
  doctorName,
  dateLabel,
  timeLabel,
  paidAmountPaise = null,
}: {
  appointmentId: number;
  doctorName: string;
  dateLabel: string;
  timeLabel: string;
  paidAmountPaise?: number | null;
}) {
  const [state, dispatch, pending] = useActionState(patientCancelAction, {});
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <form
        action={dispatch}
        role="alertdialog"
        aria-label="Confirm cancellation"
        className="max-w-sm rounded-lg border border-red-200 bg-red-50/60 p-3"
      >
        <input type="hidden" name="appointmentId" value={appointmentId} />
        <p className="text-sm font-medium">
          Cancel your appointment with {doctorName} on {dateLabel} at{" "}
          {timeLabel}?
        </p>
        <div className="mt-2">
          <CancellationPolicy />
        </div>
        <p className="mt-2 text-sm text-slate-600">
          After confirmation, this appointment will show as Cancelled.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          {paidAmountPaise !== null
            ? `Cancelling will also start a full refund of ${formatPaise(paidAmountPaise)} to your original payment method. The refund is tracked separately — cancelling does not mean the refund has arrived yet. You can follow its status in Payments & refunds on this page.`
            : "No payment was made for this booking, so there is nothing to refund."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="submit"
            size="sm"
            variant="destructive"
            disabled={pending}
          >
            {pending ? "Cancelling…" : "Confirm cancellation"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => setConfirming(false)}
          >
            Keep appointment
          </Button>
        </div>
        <ErrorNote message={state.error} />
      </form>
    );
  }

  return (
    <div className="flex max-w-sm flex-col items-end gap-2 text-right">
      <Button
        type="button"
        size="sm"
        variant="destructive"
        onClick={() => setConfirming(true)}
      >
        Cancel
      </Button>
      <CancellationPolicy />
      <ErrorNote message={state.error} />
    </div>
  );
}

/** Confirm step of a reschedule. Kept as its own component so it can
 * be remounted (fresh action state) for every new attempt: the
 * parent passes a new key each time the picker opens. */
function RescheduleConfirmForm({
  appointmentId,
  newSlotId,
  doctorName,
  oldDateLabel,
  oldTimeLabel,
  newDateLabel,
  newTimeLabel,
  onDone,
  onBack,
}: {
  appointmentId: number;
  newSlotId: number;
  doctorName: string;
  oldDateLabel: string;
  oldTimeLabel: string;
  newDateLabel: string;
  newTimeLabel: string;
  onDone: () => void;
  onBack: () => void;
}) {
  const [state, dispatch, pending] = useActionState(
    patientRescheduleAction,
    {},
  );
  useEffect(() => {
    if (state.success) onDone();
  }, [state.success, onDone]);
  return (
    <form
      action={dispatch}
      role="alertdialog"
      aria-label="Confirm reschedule"
      className="max-w-sm rounded-lg border border-slate-200 bg-slate-50/60 p-3"
    >
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <input type="hidden" name="newSlotId" value={newSlotId} />
      <p className="text-sm font-medium">
        Move your appointment with {doctorName}?
      </p>
      <p className="mt-2 text-sm text-slate-600">
        From: {oldDateLabel} at {oldTimeLabel}
      </p>
      <p className="text-sm font-medium text-slate-800">
        To: {newDateLabel} at {newTimeLabel}
      </p>
      <p className="mt-2 text-sm text-slate-600">
        Your booking, its status and its reason stay exactly as they
        are — only the time changes. If this fails, your original
        appointment is untouched.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Rescheduling…" : "Confirm reschedule"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={onBack}
        >
          Back
        </Button>
      </div>
      <ErrorNote message={state.error} />
    </form>
  );
}

/** Patient moves one of their own bookings to another slot of the
 * same doctor. Three steps: pick a genuinely bookable slot, review
 * the old and new times, then confirm. The picker offers bookable
 * slots only — the profile now returns unavailable slots too, so
 * the bookable filter below is load-bearing, not decorative. The
 * server revalidates the slot at confirmation time, so a stale or
 * forged slot is still rejected. */
export function PatientRescheduleControl({
  appointmentId,
  doctorName,
  currentSlotId,
  oldDateLabel,
  oldTimeLabel,
  slots,
}: {
  appointmentId: number;
  doctorName: string;
  currentSlotId: number;
  oldDateLabel: string;
  oldTimeLabel: string;
  slots: BookableSlot[];
}) {
  const options = slots.filter(
    (s) => s.slotId !== currentSlotId && s.bookable,
  );
  const [stage, setStage] = useState<"idle" | "pick" | "confirm" | "done">(
    "idle",
  );
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [runId, setRunId] = useState(0);
  const [doneLabel, setDoneLabel] = useState("");
  const selected =
    options.find((s) => s.slotId === selectedSlotId) ?? null;

  const openPicker = () => {
    setSelectedSlotId(options[0]?.slotId ?? null);
    setRunId((n) => n + 1);
    setStage("pick");
  };

  const handleDone = () => {
    if (selected) {
      setDoneLabel(
        `${formatDate(selected.date)}, ${formatTime(selected.startTime)} – ${formatTime(selected.endTime)}`,
      );
    }
    setStage("done");
  };

  if (stage === "done") {
    return (
      <div
        role="status"
        className="max-w-sm rounded-lg border border-teal-200 bg-teal-50/60 p-3"
      >
        <p className="text-sm font-medium text-teal-900">
          Rescheduled to {doneLabel}.
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Your booking card now shows the new time.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={() => setStage("idle")}
        >
          Close
        </Button>
      </div>
    );
  }

  if (stage === "confirm" && selected) {
    return (
      <RescheduleConfirmForm
        key={runId}
        appointmentId={appointmentId}
        newSlotId={selected.slotId}
        doctorName={doctorName}
        oldDateLabel={oldDateLabel}
        oldTimeLabel={oldTimeLabel}
        newDateLabel={formatDate(selected.date)}
        newTimeLabel={`${formatTime(selected.startTime)} – ${formatTime(selected.endTime)}`}
        onDone={handleDone}
        onBack={() => setStage("pick")}
      />
    );
  }

  if (stage === "pick") {
    const selectId = `reschedule-slot-${appointmentId}`;
    return (
      <div
        role="dialog"
        aria-label="Pick a new time slot"
        className="max-w-sm rounded-lg border border-slate-200 bg-slate-50/60 p-3"
      >
        {options.length === 0 ? (
          <>
            <p className="text-sm text-slate-600">
              No other available slots for this doctor right now.
              Check back later, or keep your current appointment.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => setStage("idle")}
            >
              Close
            </Button>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={selectId}>Pick a new time slot (IST)</Label>
              <select
                id={selectId}
                value={selectedSlotId ?? ""}
                onChange={(e) => setSelectedSlotId(Number(e.target.value))}
                className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
              >
                {options.map((s) => (
                  <option key={s.slotId} value={s.slotId}>
                    {formatDate(s.date)}, {formatTime(s.startTime)} –{" "}
                    {formatTime(s.endTime)} ({s.remaining} left)
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={!selected}
                onClick={() => setStage("confirm")}
              >
                Review new time
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setStage("idle")}
              >
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={openPicker}>
      Reschedule
    </Button>
  );
}

/** Doctor adds one availability window. */
export function SlotCreateForm() {
  const [state, dispatch, pending] = useActionState(createSlotAction, {});
  return (
    <form action={dispatch} className="flex flex-col gap-3">
      <ErrorNote message={state.error} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="date">Date</Label>
          <Input id="date" name="date" type="date" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="startTime">Start</Label>
          <Input id="startTime" name="startTime" type="time" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="endTime">End</Label>
          <Input id="endTime" name="endTime" type="time" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="maxAppointments">Max patients</Label>
          <Input
            id="maxAppointments"
            name="maxAppointments"
            type="number"
            min={1}
            max={20}
            defaultValue={3}
            required
          />
        </div>
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Adding…" : "Add availability"}
      </Button>
    </form>
  );
}

/** Doctor activates / deactivates one window. */
export function SlotToggleButton({
  slotId,
  isActive,
}: {
  slotId: number;
  isActive: boolean;
}) {
  const [state, dispatch] = useActionState(toggleSlotAction, {});
  return (
    <form action={dispatch}>
      <input type="hidden" name="slotId" value={slotId} />
      <input
        type="hidden"
        name="isActive"
        value={isActive ? "false" : "true"}
      />
      <Button type="submit" size="sm" variant="outline">
        {isActive ? "Deactivate" : "Activate"}
      </Button>
      <ErrorNote message={state.error} />
    </form>
  );
}
