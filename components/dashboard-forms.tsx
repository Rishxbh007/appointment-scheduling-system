// Dashboard action forms (client components so server-action errors
// are visible inline instead of failing silently).

"use client";

import { useActionState } from "react";
import {
  doctorStatusAction,
  patientCancelAction,
  createSlotAction,
  toggleSlotAction,
} from "@/lib/actions/booking";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function ErrorNote({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-2 text-sm text-red-700">
      {message}
    </p>
  );
}

/** Doctor actions for one appointment: only legal next steps shown. */
export function DoctorStatusButtons({
  appointmentId,
  status,
}: {
  appointmentId: number;
  status: string;
}) {
  const [state, dispatch] = useActionState(doctorStatusAction, {});
  const next: string[] =
    status === "Booked"
      ? ["Confirmed", "Cancelled"]
      : status === "Confirmed"
        ? ["Completed", "Cancelled"]
        : [];
  if (next.length === 0) return null;
  return (
    <form action={dispatch} className="flex flex-wrap gap-2">
      <input type="hidden" name="appointmentId" value={appointmentId} />
      {next.map((s) => (
        <Button
          key={s}
          type="submit"
          name="status"
          value={s}
          size="sm"
          variant={s === "Cancelled" ? "destructive" : "outline"}
        >
          {s === "Completed" ? "Mark completed" : s}
        </Button>
      ))}
      <ErrorNote message={state.error} />
    </form>
  );
}

/** Patient cancels one of their own bookings. */
export function PatientCancelButton({
  appointmentId,
}: {
  appointmentId: number;
}) {
  const [state, dispatch] = useActionState(patientCancelAction, {});
  return (
    <form action={dispatch}>
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <Button type="submit" size="sm" variant="destructive">
        Cancel
      </Button>
      <ErrorNote message={state.error} />
    </form>
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
