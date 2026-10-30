import Link from "next/link";
import { redirect } from "next/navigation";
import { ensureDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  getPatientIdByUser,
  getDoctorIdByUser,
  getUserById,
} from "@/lib/services/accounts";
import {
  getPatientBookings,
  getDoctorBookings,
  getDoctorSlotsForManage,
} from "@/lib/services/booking";
import { getPendingPaymentsForPatient } from "@/lib/services/payments";
import {
  getPaidPaymentsForAppointments,
} from "@/lib/services/payments";
import {
  getPaymentHistoryForPatient,
} from "@/lib/services/refunds";
import { getDoctorProfile, formatDoctorName } from "@/lib/services/doctors";
import { listFavoriteDoctors } from "@/lib/services/doctors";
import { FavoriteToggle } from "@/components/favorite-toggle";
import { RefundRetryButton } from "@/components/refund-retry-button";
import type { BookableSlot } from "@/components/booking-form";
import { Badge } from "@/components/ui/badge";
import { AppointmentTimeline } from "@/components/appointment-timeline";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DoctorStatusButtons,
  PatientCancelButton,
  PatientRescheduleControl,
  SlotCreateForm,
  SlotToggleButton,
} from "@/components/dashboard-forms";
import { formatDate, formatTime, todayIST } from "@/lib/time";
import { formatPaise } from "@/lib/format";
import { PaymentCheckout } from "@/components/payment-checkout";

export const dynamic = "force-dynamic";

/** Payment statuses in plain words (the Badge is appointment-only). */
function paymentStatusLabel(status: string): string {
  switch (status) {
    case "Paid":
      return "Paid";
    case "Pending":
      return "Awaiting payment";
    case "Failed":
      return "Payment failed";
    case "Abandoned":
      return "Payment abandoned";
    case "Expired":
      return "Payment expired";
    default:
      return status;
  }
}

/** Left-accent colour for an appointment card, by status. */
function statusAccent(status: string): string {
  switch (status) {
    case "Booked":
      return "border-l-info-strong";
    case "Confirmed":
      return "border-l-success-strong";
    case "Pending":
      return "border-l-warning-strong";
    case "Cancelled":
      return "border-l-danger-strong";
    default:
      return "border-l-neutral-strong";
  }
}

/** Small pill tone for a payment status label. */
function paymentPill(status: string): string {
  switch (status) {
    case "Paid":
      return "bg-success-soft text-success-strong";
    case "Awaiting payment":
      return "bg-warning-soft text-warning-strong";
    case "Payment failed":
      return "bg-danger-soft text-danger-strong";
    default:
      return "bg-neutral-soft text-neutral-strong";
  }
}

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  await ensureDb();
  const user = await getUserById(session.userId);
  if (!user) redirect("/login");

  if (session.role === "Patient") {
    const patientId = await getPatientIdByUser(session.userId);
    const bookings = patientId ? await getPatientBookings(patientId) : [];
    const pendingPayments = patientId
      ? await getPendingPaymentsForPatient(patientId)
      : new Map();
    const paymentHistory = patientId
      ? await getPaymentHistoryForPatient(patientId)
      : [];
    // Paid amount per appointment, for the cancel dialogs (Day 4
    // Stage B): a booking shows its refund line only when it
    // actually has a Paid payment; anything else states plainly
    // that nothing was paid.
    const paidAmountByAppointment = new Map<number, number>();
    for (const entry of paymentHistory) {
      if (
        entry.paymentStatus === "Paid" &&
        !paidAmountByAppointment.has(entry.appointmentId)
      ) {
        paidAmountByAppointment.set(
          entry.appointmentId,
          entry.amountPaise,
        );
      }
    }
    const favorites = patientId
      ? await listFavoriteDoctors(patientId)
      : [];
    // Slots per doctor, for the reschedule picker on eligible
    // cards. The profile returns every upcoming slot with its
    // state; the picker itself offers bookable slots only. Only
    // the slot fields travel to the client — the profile's
    // email/phone stay on the server.
    const eligibleDoctorIds = [
      ...new Set(
        bookings
          .filter((b) => b.status === "Booked" || b.status === "Confirmed")
          .map((b) => b.doctorId),
      ),
    ];
    const profiles = await Promise.all(
      eligibleDoctorIds.map((id) => getDoctorProfile(id)),
    );
    const slotsByDoctor = new Map<number, BookableSlot[]>();
    for (const profile of profiles) {
      if (profile) slotsByDoctor.set(profile.doctorId, profile.slots);
    }
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="rounded-3xl border border-brand-100 bg-gradient-to-br from-brand-50 via-surface to-amber-50 px-6 py-6 shadow-sm">
          <h1 className="text-3xl font-bold">Welcome, {user.name}</h1>
          <p className="mt-1 text-slate-600">
            Your appointments, in one place.
          </p>
          <Link href="/doctors">
            <Button className="mt-4">Book a new appointment</Button>
          </Link>
        </div>

        <h2 className="mt-10 flex items-center gap-2 text-xl font-bold">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-600" />
          My bookings
        </h2>
        {bookings.length === 0 ? (
          <p className="mt-2 text-slate-600">
            No bookings yet. Browse doctors and book your first
            appointment.
          </p>
        ) : (
          <div className="mt-4 grid gap-4">
            {bookings.map((b) => (
              <Card
                key={b.appointmentId}
                className={`border-l-4 ${statusAccent(b.status)} transition-shadow hover:shadow-md`}
              >
                <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
                  <div>
                    <p className="font-medium">{formatDoctorName(b.doctorName)}</p>
                    <p className="mt-1">
                      <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800">
                        {formatDate(b.slotDate)}, {formatTime(b.slotStart)} –{" "}
                        {formatTime(b.slotEnd)}
                      </span>
                    </p>
                    {b.reason && (
                      <p className="mt-1 text-sm text-slate-600">
                        Reason: {b.reason}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge status={b.status} />
                    {(b.status === "Booked" ||
                      b.status === "Confirmed") && (
                      <div className="flex flex-wrap items-start gap-3">
                        <PatientRescheduleControl
                          appointmentId={b.appointmentId}
                          doctorName={formatDoctorName(b.doctorName)}
                          currentSlotId={b.slotId}
                          oldDateLabel={formatDate(b.slotDate)}
                          oldTimeLabel={`${formatTime(b.slotStart)} – ${formatTime(b.slotEnd)}`}
                          slots={slotsByDoctor.get(b.doctorId) ?? []}
                        />
                        <PatientCancelButton
                          appointmentId={b.appointmentId}
                          doctorName={formatDoctorName(b.doctorName)}
                          dateLabel={formatDate(b.slotDate)}
                          timeLabel={`${formatTime(b.slotStart)} – ${formatTime(b.slotEnd)}`}
                          paidAmountPaise={
                            paidAmountByAppointment.get(
                              b.appointmentId,
                            ) ?? null
                          }
                        />
                      </div>
                    )}
                    {b.status === "Pending" && (
                      <div className="flex flex-wrap items-start gap-3">
                        {(() => {
                          const pay = pendingPayments.get(
                            b.appointmentId,
                          );
                          if (!pay) return null;
                          return (
                            <PaymentCheckout
                              appointmentId={b.appointmentId}
                              orderId={
                                pay.status === "Pending"
                                  ? pay.orderId
                                  : null
                              }
                              amountPaise={pay.amountPaise}
                              expiresAtIso={b.expiresAt?.toISOString()}
                            />
                          );
                        })()}
                        <PatientCancelButton
                          appointmentId={b.appointmentId}
                          doctorName={formatDoctorName(b.doctorName)}
                          dateLabel={formatDate(b.slotDate)}
                          timeLabel={`${formatTime(b.slotStart)} – ${formatTime(b.slotEnd)}`}
                          paidAmountPaise={
                            paidAmountByAppointment.get(
                              b.appointmentId,
                            ) ?? null
                          }
                        />
                      </div>
                    )}
                  </div>
                </CardContent>
                <AppointmentTimeline
                  status={b.status}
                  bookedAt={b.bookedAt}
                  dateLabel={formatDate(b.slotDate)}
                  timeLabel={`${formatTime(b.slotStart)} – ${formatTime(b.slotEnd)}`}
                  expiresAt={b.expiresAt ?? undefined}
                />
              </Card>
            ))}
          </div>
        )}

        <h2 className="mt-10 flex items-center gap-2 text-xl font-bold">
          <span className="h-2.5 w-2.5 rounded-full bg-warning-strong" />
          Payments &amp; refunds
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Every payment you made, with its refund status shown
          separately. Cancelling an appointment never means the
          refund has arrived — only a processed refund does.
        </p>
        {paymentHistory.length === 0 ? (
          <p className="mt-2 text-slate-600">
            No payments yet. Free bookings and bookings still
            awaiting payment do not appear here.
          </p>
        ) : (
          <div className="mt-4 grid gap-4">
            {paymentHistory.map((entry) => (
              <Card key={entry.paymentId} className="transition-shadow hover:shadow-md">
                <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
                  <div>
                    <p className="font-medium">
                      {formatDoctorName(entry.doctorName)}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-bold text-ink">
                        {formatPaise(entry.amountPaise)}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${paymentPill(paymentStatusLabel(entry.paymentStatus))}`}
                      >
                        {paymentStatusLabel(entry.paymentStatus)}
                      </span>
                      <span className="text-slate-600">
                        {formatDate(
                          entry.paidAt.toISOString().slice(0, 10),
                        )}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      Appointment: {entry.appointmentStatus}
                    </p>
                  </div>
                  <div className="flex max-w-sm flex-col items-end gap-2 text-right">
                    {entry.refund === null ? (
                      entry.paymentStatus === "Paid" &&
                      entry.appointmentStatus === "Cancelled" ? (
                        <p className="rounded-xl bg-neutral-soft px-3 py-2 text-sm text-neutral-strong">
                          Refund status not recorded.
                        </p>
                      ) : null
                    ) : entry.refund.status === "Processed" ? (
                      <p className="rounded-xl bg-success-soft px-3 py-2 text-sm text-success-strong">
                        Refund processed — the payment provider has
                        completed the full refund.
                      </p>
                    ) : entry.refund.status === "Initiated" ? (
                      <p className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning-strong">
                        Refund initiated — the full amount is being
                        refunded, but it has not completed yet.
                      </p>
                    ) : (
                      <>
                        <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-strong">
                          Refund failed
                          {entry.refund.failureReason
                            ? ` — ${entry.refund.failureReason}`
                            : ""}
                          . The appointment stays cancelled; only the
                          refund needs another try.
                        </p>
                        <RefundRetryButton
                          refundId={entry.refund.refundId}
                        />
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <h2 className="mt-10 flex items-center gap-2 text-xl font-bold">
          <span className="h-2.5 w-2.5 rounded-full bg-info-strong" />
          Favorite Doctors
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Doctors you have saved to find again quickly. Saving a
          doctor is only a bookmark — it does not book an
          appointment.
        </p>
        {favorites.length === 0 ? (
          <p className="mt-2 text-slate-600">
            You haven&apos;t saved any doctors yet. Browse doctors and
            save the ones you&apos;d like to find again.
          </p>
        ) : (
          <div className="mt-4 grid gap-4">
            {favorites.map((d) => (
              <Card key={d.doctorId} className="transition-shadow hover:shadow-md">
                <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
                  <div>
                    <p className="font-medium">{formatDoctorName(d.name)}</p>
                    <p className="text-sm text-slate-600">
                      {d.specializationNames.join(", ") ||
                        "General practice"}
                    </p>
                    <p className="mt-2">
                      <span className="rounded-full bg-warning-soft px-2.5 py-1 text-xs font-bold text-warning-strong">
                        {d.consultationFee !== null
                          ? `₹${d.consultationFee} consultation`
                          : "Fee on request"}
                      </span>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/doctors/${d.doctorId}`}>
                      <Button variant="outline" size="sm">
                        View &amp; book
                      </Button>
                    </Link>
                    <FavoriteToggle
                      doctorId={d.doctorId}
                      doctorName={formatDoctorName(d.name)}
                      isFavorite
                      savedLabel="Remove"
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Doctor dashboard.
  const doctorId = await getDoctorIdByUser(session.userId);
  const bookings = doctorId ? await getDoctorBookings(doctorId) : [];
  const mySlots = doctorId ? await getDoctorSlotsForManage(doctorId) : [];
  // Day 4 Stage B: paid amounts per booking, so a doctor's cancel
  // dialog states the refund (or its absence) truthfully.
  const paidAmounts = await getPaidPaymentsForAppointments(
    bookings.map((b) => b.appointmentId),
  );
  const today = todayIST();
  const upcomingSlots = mySlots.filter((s) => s.date >= today);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="rounded-3xl border border-brand-100 bg-gradient-to-br from-brand-50 via-surface to-amber-50 px-6 py-6 shadow-sm">
        <h1 className="text-3xl font-bold">Welcome, {user.name}</h1>
        <p className="mt-1 text-slate-600">
          Appointments booked with you, and your availability.
        </p>
      </div>

      <h2 className="mt-10 flex items-center gap-2 text-xl font-bold">
        <span className="h-2.5 w-2.5 rounded-full bg-brand-600" />
        Appointments
      </h2>
      {bookings.length === 0 ? (
        <p className="mt-2 text-slate-600">
          No appointments yet. Patients will appear here once they book
          one of your windows.
        </p>
      ) : (
        <div className="mt-4 grid gap-4">
          {bookings.map((b) => (
            <Card
              key={b.appointmentId}
              className={`border-l-4 ${statusAccent(b.status)} transition-shadow hover:shadow-md`}
            >
              <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
                <div>
                  <p className="font-medium">{b.patientName}</p>
                  <p className="mt-1">
                    <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800">
                      {formatDate(b.slotDate)}, {formatTime(b.slotStart)} –{" "}
                      {formatTime(b.slotEnd)}
                    </span>
                  </p>
                  {b.reason && (
                    <p className="mt-1 text-sm text-slate-600">
                      Reason: {b.reason}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Badge status={b.status} />
                  <DoctorStatusButtons
                    appointmentId={b.appointmentId}
                    status={b.status}
                    patientName={b.patientName}
                    dateLabel={formatDate(b.slotDate)}
                    timeLabel={`${formatTime(b.slotStart)} – ${formatTime(b.slotEnd)}`}
                    paidAmountPaise={
                      paidAmounts.get(b.appointmentId)?.amountPaise ??
                      null
                    }
                  />
                </div>
              </CardContent>
              <AppointmentTimeline
                status={b.status}
                bookedAt={b.bookedAt}
                dateLabel={formatDate(b.slotDate)}
                timeLabel={`${formatTime(b.slotStart)} – ${formatTime(b.slotEnd)}`}
                expiresAt={b.expiresAt ?? undefined}
              />
            </Card>
          ))}
        </div>
      )}

      <h2 className="mt-12 flex items-center gap-2 text-xl font-bold">
        <span className="h-2.5 w-2.5 rounded-full bg-info-strong" />
        My availability
      </h2>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Add a window</CardTitle>
          <CardDescription>
            Patients can only book windows you mark active. Removing a
            window with upcoming bookings is blocked, so patients are
            never stranded.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SlotCreateForm />
        </CardContent>
      </Card>

      {upcomingSlots.length === 0 ? (
        <p className="mt-4 text-slate-600">
          No upcoming windows. Add one above, or use the default Mon–Fri
          schedule created at sign-up.
        </p>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {upcomingSlots.map((s) => (
            <Card
              key={s.slotId}
              className={`border-l-4 ${s.isActive ? "border-l-success-strong" : "border-l-neutral-strong"} transition-shadow hover:shadow-md`}
            >
              <CardContent className="flex items-center justify-between gap-3 pt-6">
                <div>
                  <p className="font-medium">{formatDate(s.date)}</p>
                  <p className="text-sm text-slate-600">
                    {formatTime(s.startTime)} – {formatTime(s.endTime)}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-slate-500">
                      {s.activeBookings} active booking(s) · max{" "}
                      {s.maxAppointments}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.isActive ? "bg-success-soft text-success-strong" : "bg-neutral-soft text-neutral-strong"}`}
                    >
                      {s.isActive ? "Active" : "Inactive"}
                    </span>
                  </p>
                </div>
                <SlotToggleButton
                  slotId={s.slotId}
                  isActive={s.isActive}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
