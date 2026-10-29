// Appointment status timeline — presentational only.
//
// Renders the appointment's progress from its real persisted status,
// nothing else. The app records exactly four statuses (Booked,
// Confirmed, Cancelled, Completed) and only one real timestamp:
// bookedAt, the moment the booking was created. There are NO recorded
// timestamps for the Confirmed or Completed transitions, so those
// steps never show a date — inventing one would be fake history.
// Likewise, an appointment is never shown as completed merely
// because its scheduled time has passed; the status field is the
// only source of truth.
//
// States are distinguished by text and marker, never by colour
// alone: each step names its state ("Done", "Current step",
// "Pending"), the current step carries aria-current="step", and the
// list is vertical so it reads clearly on narrow viewports.
//
// Cancelled appointments do NOT get the step list. Cancellation is
// a terminal state, not a step on the way to completion, and the app
// keeps no history of whether a cancelled appointment had reached
// Confirmed — so rendering any Confirmed step for it would guess.
// Instead a standalone cancelled panel states the outcome, the real
// booked date, and the scheduled time, and makes clear the
// appointment will not continue toward completion.

const STEPS = ["Booked", "Confirmed", "Completed"] as const;

type StepState = "done" | "current" | "pending";

function stepStateFor(status: string, step: string): StepState {
  const current = STEPS.indexOf(status as (typeof STEPS)[number]);
  const at = STEPS.indexOf(step as (typeof STEPS)[number]);
  if (current === -1) return "pending";
  if (at < current) return "done";
  if (at === current) return "current";
  return "pending";
}

const MARKER: Record<StepState, string> = {
  done: "✓",
  current: "●",
  pending: "○",
};

const STATE_WORD: Record<StepState, string> = {
  done: "Done",
  current: "Current step",
  pending: "Pending",
};

/** bookedAt as an IST calendar date ("Wed, 29 Oct 2026"). */
function formatBookedDate(bookedAt: Date): string {
  const dt = bookedAt instanceof Date ? bookedAt : new Date(bookedAt);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatToParts(dt);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")}, ${get("day")} ${get("month")} ${get("year")}`;
}

export function AppointmentTimeline({
  status,
  bookedAt,
  dateLabel,
  timeLabel,
}: {
  status: string;
  bookedAt: Date;
  /** Already formatted with formatDate, e.g. "Wed, 29 Oct 2026". */
  dateLabel: string;
  /** Already formatted with formatTime, e.g. "10:00 AM – 11:00 AM". */
  timeLabel: string;
}) {
  const scheduled = `${dateLabel}, ${timeLabel}`;

  if (status === "Cancelled") {
    return (
      <div
        aria-label={`Cancelled appointment, scheduled for ${scheduled}`}
        className="border-t border-border px-6 py-4"
      >
        <p className="text-sm font-semibold text-danger-strong">
          Cancelled
        </p>
        <p className="mt-1 text-sm text-slate-600">
          This appointment was cancelled and will not continue toward
          confirmation or completion.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Booked on {formatBookedDate(bookedAt)} · Scheduled for{" "}
          {scheduled}
        </p>
      </div>
    );
  }

  if (!STEPS.includes(status as (typeof STEPS)[number])) {
    // Unknown status: show the raw value, never invented progress.
    return (
      <div className="border-t border-border px-6 py-4">
        <p className="text-sm text-slate-600">
          Appointment status: {status} · Scheduled for {scheduled}
        </p>
      </div>
    );
  }

  return (
    <div className="border-t border-border px-6 py-4">
      <p className="text-sm font-medium">Appointment progress</p>
      <p className="mt-1 text-sm text-slate-600">
        Scheduled for {scheduled}
      </p>
      <ol
        aria-label={`Appointment progress, currently ${status}`}
        className="mt-3 space-y-2"
      >
        {STEPS.map((step) => {
          const state = stepStateFor(status, step);
          return (
            <li
              key={step}
              aria-current={state === "current" ? "step" : undefined}
              className="flex items-baseline gap-2 text-sm"
            >
              <span aria-hidden="true" className="font-medium">
                {MARKER[state]}
              </span>
              <span className="font-medium">{step}</span>
              <span className="text-slate-500">— {STATE_WORD[state]}</span>
              {step === "Booked" && (
                <span className="text-slate-500">
                  · Booked on {formatBookedDate(bookedAt)}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
