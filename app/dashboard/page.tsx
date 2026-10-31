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
import { getPayoutDetails } from "@/lib/services/payouts";
import { getDoctorProfile, formatDoctorName } from "@/lib/services/doctors";
import { listFavoriteDoctors } from "@/lib/services/doctors";
import { FavoriteToggle } from "@/components/favorite-toggle";
import { RefundRetryButton } from "@/components/refund-retry-button";
import { NotificationConsentBanner } from "@/components/notification-consent-banner";
import { getNotificationPreferences } from "@/lib/services/notifications";
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
  PayoutDetailsForm,
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

/** Rotating avatar tints, so card grids read colourful at a
 * glance. Deterministic by position — never random. */
const AVATAR_TINTS = [
  "bg-teal-100 text-teal-800",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-800",
  "bg-violet-100 text-violet-800",
];

/** Initials for avatar circles, from a display name
 * ("Dr. Ananya Sharma" → "AS"). */
function initialsOf(displayName: string): string {
  const withoutPrefix = displayName.replace(/^Dr\.\s*/i, "");
  const words = withoutPrefix.split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "");
  return letters.join("") || "Dr";
}

/**
 * Dashboard wording for a failed refund. A not-found from Razorpay
 * (status 404, or Razorpay's own "id does not exist" description)
 * means the gateway does not recognise the payment reference
 * under the configured keys — the refund was never created, and
 * the generic provider-status text hides that. Any why-not detail
 * the self-heal appended is kept, so a still-failing refund says
 * what the order lookup found. Any other reason is shown exactly
 * as recorded.
 */
function refundFailureText(reason: string | null): string {
  if (!reason) return "";
  const check = reason.match(/\[(refund check:[^\]]+)\]/);
  const suffix = check ? ` ${check[0]}` : "";
  if (/status 404\b/.test(reason) || /does not exist/i.test(reason)) {
    return ` — Razorpay could not find this payment reference — the refund was not created${suffix}`;
  }
  return ` — ${reason}`;
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
    // Refund per appointment, for the refund line on cancelled
    // booking cards: booking cards used to say nothing about
    // refunds at all, so a cancelled paid booking looked like
    // its refund had vanished — the status only lived in the
    // Payments & refunds section below.
    const refundByAppointment = new Map<
      number,
      NonNullable<(typeof paymentHistory)[number]["refund"]>
    >();
    for (const entry of paymentHistory) {
      if (
        entry.refund &&
        !refundByAppointment.has(entry.appointmentId)
      ) {
        refundByAppointment.set(entry.appointmentId, entry.refund);
      }
    }
    const favorites = patientId
      ? await listFavoriteDoctors(patientId)
      : [];
    // Day 5 follow-up: the first-visit consent banner shows only
    // while the patient has never set preferences — either
    // answer records a row, so it never returns.
    const hasNotificationPreferences =
      (await getNotificationPreferences(session.userId)) !== null;
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
      <div className="min-h-dvh bg-gradient-to-br from-teal-50 via-amber-50 to-rose-100">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-r from-teal-600 via-emerald-600 to-teal-700 px-6 py-8 shadow-xl shadow-teal-600/20 sm:px-8">
          <div
            aria-hidden="true"
            className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/10"
          />
          <div
            aria-hidden="true"
            className="absolute -right-4 -bottom-16 h-32 w-32 rounded-full bg-amber-300/20"
          />
          <h1 className="relative text-3xl font-bold text-white sm:text-4xl">
            Welcome, {user.name}
          </h1>
          <p className="relative mt-2 max-w-lg text-teal-50">
            Your appointments, payments, and saved doctors — in one
            place.
          </p>
          <Link href="/doctors" className="relative mt-5 inline-block">
            <Button className="rounded-full bg-white px-6 text-teal-800 shadow-md hover:bg-teal-50">
              Book a new appointment
            </Button>
          </Link>
        </div>

        {!hasNotificationPreferences && (
          <NotificationConsentBanner initialPhone={user.phone ?? ""} />
        )}

        <h2 className="mt-12 flex items-center gap-2 text-2xl font-bold">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-600" />
          My bookings
        </h2>
        {bookings.length === 0 ? (
          <Card className="mt-4 border-dashed border-brand-200 bg-white/70">
            <CardContent className="pt-6">
              <p className="font-semibold">No bookings yet</p>
              <p className="mt-1 text-sm text-slate-600">
                Browse doctors and book your first appointment — pick
                a day, pick a time, and pay to confirm.
              </p>
              <Link href="/doctors">
                <Button className="mt-4 rounded-full" size="sm">
                  Find a doctor
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-4 grid gap-4">
            {bookings.map((b, i) => (
              <Card
                key={b.appointmentId}
                className={`border-l-4 ${statusAccent(b.status)} transition-shadow hover:shadow-lg`}
              >
                <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-bold ${AVATAR_TINTS[i % AVATAR_TINTS.length]}`}
                    >
                      {initialsOf(formatDoctorName(b.doctorName))}
                    </span>
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
                    {b.status === "Cancelled" &&
                      (() => {
                        const refund = refundByAppointment.get(
                          b.appointmentId,
                        );
                        if (!refund) {
                          return paidAmountByAppointment.has(
                            b.appointmentId,
                          ) ? (
                            <p className="mt-1 text-sm text-slate-600">
                              Refund status not recorded — see
                              Payments &amp; refunds below.
                            </p>
                          ) : (
                            <p className="mt-1 text-sm text-slate-600">
                              Nothing was paid for this booking, so
                              there is no refund.
                            </p>
                          );
                        }
                        if (refund.status === "Processed") {
                          return (
                            <p className="mt-1 text-sm font-medium text-success-strong">
                              Refund processed — the full amount has
                              been refunded.
                            </p>
                          );
                        }
                        if (refund.status === "Initiated") {
                          return (
                            <p className="mt-1 text-sm font-medium text-warning-strong">
                              Refund initiated — the full amount is
                              being refunded.
                            </p>
                          );
                        }
                        return (
                          <p className="mt-1 text-sm font-medium text-danger-strong">
                            Refund failed — see Payments &amp; refunds
                            below to retry.
                          </p>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge status={b.status} />
                    {(b.status === "Booked" ||
                      b.status === "Confirmed") && (
                      <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-3 shadow-sm">
                        <p className="mb-2 text-xs font-semibold tracking-wide text-brand-800 uppercase">
                          Manage booking
                        </p>
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
                              prefill={{
                                name: user.name,
                                email: user.email,
                                ...(user.phone
                                  ? { contact: user.phone }
                                  : {}),
                              }}
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

        <h2 className="mt-12 flex items-center gap-2 text-2xl font-bold">
          <span className="h-2.5 w-2.5 rounded-full bg-warning-strong" />
          Payments &amp; refunds
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Every payment you made, with its refund status shown
          separately. Cancelling an appointment never means the
          refund has arrived — only a processed refund does.
        </p>
        {paymentHistory.length === 0 ? (
          <Card className="mt-4 border-dashed border-warning-strong/40 bg-white/70">
            <CardContent className="pt-6">
              <p className="font-semibold">No payments yet</p>
              <p className="mt-1 text-sm text-slate-600">
                Free bookings and bookings still awaiting payment do
                not appear here. Paid bookings and their refund
                status will list here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-4 grid gap-4">
            {paymentHistory.map((entry) => (
              <Card key={entry.paymentId} className="transition-shadow hover:shadow-lg">
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
                          {refundFailureText(entry.refund.failureReason)}
                          . The appointment stays cancelled; only the
                          refund needs another try.
                        </p>
                        <p className="rounded-xl bg-white px-3 py-2 text-xs break-all text-slate-600 ring-1 ring-slate-200">
                          Payment reference recorded by CareBook:{" "}
                          {entry.gatewayPaymentId ? (
                            <span className="font-mono font-semibold text-slate-900">
                              {entry.gatewayPaymentId}
                            </span>
                          ) : (
                            "No payment reference recorded"
                          )}
                        </p>
                        <RefundRetryButton
                          refundId={entry.refund.refundId}
                        />
                      </>
                    )}
                  </div>
                </CardContent>
                {entry.refund !== null && (
                  <div className="border-t border-slate-100 px-6 py-4">
                    <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                      Refund tracking
                    </p>
                    <ol className="mt-3 space-y-2 text-sm">
                      <li className="flex items-start gap-2.5">
                        <span
                          aria-hidden="true"
                          className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-success-strong"
                        />
                        <span>
                          <span className="font-medium">
                            Refund requested
                          </span>
                          <span className="text-slate-600">
                            {" "}
                            —{" "}
                            {formatDate(
                              entry.refund.createdAt
                                .toISOString()
                                .slice(0, 10),
                            )}
                          </span>
                        </span>
                      </li>
                      {entry.refund.status === "Failed" ? (
                        <li className="flex items-start gap-2.5">
                          <span
                            aria-hidden="true"
                            className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-danger-strong"
                          />
                          <span>
                            <span className="font-medium text-danger-strong">
                              Refund failed
                            </span>
                            <span className="text-slate-600">
                              {" "}
                              —{" "}
                              {formatDate(
                                entry.refund.updatedAt
                                  .toISOString()
                                  .slice(0, 10),
                              )}
                              . See the status above to retry.
                            </span>
                          </span>
                        </li>
                      ) : (
                        <>
                          <li className="flex items-start gap-2.5">
                            <span
                              aria-hidden="true"
                              className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${entry.refund.status === "Processed" ? "bg-success-strong" : "bg-warning-strong"}`}
                            />
                            <span>
                              <span className="font-medium">
                                Refund initiated at the payment
                                provider
                              </span>
                              {entry.refund.status === "Initiated" && (
                                <span className="text-slate-600">
                                  {" "}
                                  — waiting for it to complete.
                                </span>
                              )}
                            </span>
                          </li>
                          <li className="flex items-start gap-2.5">
                            <span
                              aria-hidden="true"
                              className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${entry.refund.status === "Processed" ? "bg-success-strong" : "bg-slate-300"}`}
                            />
                            <span>
                              <span className="font-medium">
                                Refund processed
                              </span>
                              {entry.refund.status === "Processed" ? (
                                <span className="text-slate-600">
                                  {" "}
                                  —{" "}
                                  {formatDate(
                                    entry.refund.updatedAt
                                      .toISOString()
                                      .slice(0, 10),
                                  )}
                                </span>
                              ) : (
                                <span className="text-slate-600">
                                  {" "}
                                  — pending.
                                </span>
                              )}
                            </span>
                          </li>
                        </>
                      )}
                    </ol>
                    <p className="mt-3 text-xs break-all text-slate-500">
                      Gateway refund:{" "}
                      {entry.refund.gatewayRefundId ? (
                        <span className="font-mono font-semibold text-slate-700">
                          {entry.refund.gatewayRefundId}
                        </span>
                      ) : (
                        "not issued yet"
                      )}
                      {" · "}
                      Amount: {formatPaise(entry.amountPaise)}
                      {entry.refund.status === "Processed" &&
                        " · The bank usually credits the amount within 5–7 working days after processing."}
                    </p>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}

        <h2 className="mt-12 flex items-center gap-2 text-2xl font-bold">
          <span className="h-2.5 w-2.5 rounded-full bg-info-strong" />
          Favorite Doctors
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Doctors you have saved to find again quickly. Saving a
          doctor is only a bookmark — it does not book an
          appointment.
        </p>
        {favorites.length === 0 ? (
          <Card className="mt-4 border-dashed border-info-strong/40 bg-white/70">
            <CardContent className="pt-6">
              <p className="font-semibold">No saved doctors yet</p>
              <p className="mt-1 text-sm text-slate-600">
                Browse doctors and save the ones you&apos;d like to
                find again. Saving is only a bookmark — it does not
                book an appointment.
              </p>
              <Link href="/doctors">
                <Button className="mt-4 rounded-full" size="sm">
                  Browse doctors
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-4 grid gap-4">
            {favorites.map((d) => (
              <Card key={d.doctorId} className="transition-shadow hover:shadow-lg">
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
      </div>
    );
  }

  // Doctor dashboard — the doctor's own premium home, not a copy
  // of the patient view. Every number and list below derives from
  // the bookings, slots, and paid payments already loaded above;
  // nothing is invented. All actions (confirm/complete/cancel)
  // keep their existing dialogs and policy text via
  // DoctorStatusButtons; only the presentation changes.
  const doctorId = await getDoctorIdByUser(session.userId);
  const bookings = doctorId ? await getDoctorBookings(doctorId) : [];
  const mySlots = doctorId ? await getDoctorSlotsForManage(doctorId) : [];
  // Doctor payout details (weekly settlement): loaded by the
  // session's own doctorId, so a doctor only ever sees their own.
  const payout = doctorId ? await getPayoutDetails(doctorId) : null;
  // Day 4 Stage B: paid amounts per booking, so a doctor's cancel
  // dialog states the refund (or its absence) truthfully.
  const paidAmounts = await getPaidPaymentsForAppointments(
    bookings.map((b) => b.appointmentId),
  );
  const today = todayIST();
  const upcomingSlots = mySlots.filter((s) => s.date >= today);

  // Partition: every booking lands in exactly one section below.
  const isLive = (status: string) =>
    status === "Booked" || status === "Confirmed";
  const byDateTime = (
    a: { slotDate: string; slotStart: string },
    b: { slotDate: string; slotStart: string },
  ) =>
    a.slotDate === b.slotDate
      ? a.slotStart.localeCompare(b.slotStart)
      : a.slotDate.localeCompare(b.slotDate);
  const todaySchedule = bookings
    .filter((b) => b.slotDate === today && isLive(b.status))
    .sort(byDateTime);
  const upcoming = bookings
    .filter((b) => b.slotDate > today && isLive(b.status))
    .sort(byDateTime);
  const awaiting = bookings
    .filter((b) => b.status === "Pending")
    .sort(byDateTime);
  const history = bookings
    .filter(
      (b) =>
        b.status === "Completed" ||
        b.status === "Cancelled" ||
        (isLive(b.status) && b.slotDate < today),
    )
    .sort((a, b) => -byDateTime(a, b));

  // Distinct patients, from non-cancelled bookings only: a patient
  // who only ever cancelled is not yet this doctor's patient.
  // Counts and latest dates are real, from the same bookings.
  const patientMap = new Map<string, { count: number; latest: string }>();
  for (const b of bookings) {
    if (b.status === "Cancelled") continue;
    const cur = patientMap.get(b.patientName) ?? {
      count: 0,
      latest: b.slotDate,
    };
    cur.count += 1;
    if (b.slotDate > cur.latest) cur.latest = b.slotDate;
    patientMap.set(b.patientName, cur);
  }
  const patients = [...patientMap.entries()].sort(
    (a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]),
  );

  // Payments received: every Paid payment for this doctor's
  // appointments, joined back to its booking for the patient and
  // date. Gross received — refunds, if any, live on the patient's
  // payment record, not here.
  const bookingById = new Map(
    bookings.map((b) => [b.appointmentId, b]),
  );
  const earningsEntries = [...paidAmounts.entries()]
    .flatMap(([appointmentId, pay]) => {
      const booking = bookingById.get(appointmentId);
      return booking
        ? [{ appointmentId, amountPaise: pay.amountPaise, booking }]
        : [];
    })
    .sort((a, b) => -byDateTime(a.booking, b.booking));
  const earningsTotal = earningsEntries.reduce(
    (sum, e) => sum + e.amountPaise,
    0,
  );

  // One booking card, reused by every schedule section so the
  // actions and timeline never drift apart. A plain helper, not a
  // component, so no client state is ever remade.
  const doctorBookingCard = (b: (typeof bookings)[number]) => (
    <Card
      key={b.appointmentId}
      className={`border-l-4 ${statusAccent(b.status)} transition-shadow hover:shadow-lg`}
    >
      <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-teal-100 text-sm font-bold text-teal-800"
          >
            {initialsOf(b.patientName)}
          </span>
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
              paidAmounts.get(b.appointmentId)?.amountPaise ?? null
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
  );

  return (
    <div className="min-h-dvh bg-gradient-to-br from-teal-50 via-amber-50 to-rose-100">
      <div className="mx-auto max-w-6xl px-4 py-10">
        {/* Hero: the doctor's own home. */}
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-r from-teal-700 via-emerald-600 to-cyan-600 px-6 py-8 shadow-xl shadow-teal-600/20 sm:px-8">
          <div
            aria-hidden="true"
            className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/10"
          />
          <div
            aria-hidden="true"
            className="absolute -right-4 -bottom-16 h-32 w-32 rounded-full bg-amber-300/20"
          />
          <h1 className="relative text-3xl font-bold text-white sm:text-4xl">
            Welcome, {user.name}
          </h1>
          <p className="relative mt-2 max-w-xl text-teal-50">
            Today is {formatDate(today)}. Here is your practice at a
            glance — today&apos;s patients, what&apos;s coming up,
            and what you have received.
          </p>
          <div className="relative mt-5 flex flex-wrap gap-3">
            {doctorId && (
              <Link href={`/doctors/${doctorId}`}>
                <Button className="rounded-full bg-white px-6 text-teal-800 shadow-md hover:bg-teal-50">
                  View my public profile
                </Button>
              </Link>
            )}
            <a
              href="#availability"
              className="inline-flex h-10 items-center rounded-full border border-white/40 bg-white/10 px-6 text-sm font-medium text-white shadow-md transition-colors hover:bg-white/20"
            >
              Manage availability
            </a>
          </div>
        </div>

        {/* Stat strip: only this doctor's own real numbers. */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-3xl border border-teal-200 bg-gradient-to-br from-teal-50 to-emerald-100 px-5 py-5 shadow-sm">
            <p className="text-3xl font-bold text-teal-900">
              {todaySchedule.length}
            </p>
            <p className="mt-1 text-sm font-semibold text-teal-800">
              Appointments today
            </p>
            <p className="text-xs text-teal-700">
              Booked or confirmed for today.
            </p>
          </div>
          <div className="rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-100 px-5 py-5 shadow-sm">
            <p className="text-3xl font-bold text-amber-900">
              {upcoming.length}
            </p>
            <p className="mt-1 text-sm font-semibold text-amber-800">
              Coming up
            </p>
            <p className="text-xs text-amber-700">
              Booked or confirmed after today.
            </p>
          </div>
          <div className="rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 to-purple-100 px-5 py-5 shadow-sm">
            <p className="text-3xl font-bold text-violet-900">
              {patients.length}
            </p>
            <p className="mt-1 text-sm font-semibold text-violet-800">
              Patients
            </p>
            <p className="text-xs text-violet-700">
              People with a booking with you.
            </p>
          </div>
          <div className="rounded-3xl border border-rose-200 bg-gradient-to-br from-rose-50 to-pink-100 px-5 py-5 shadow-sm">
            <p className="text-3xl font-bold text-rose-900">
              {formatPaise(earningsTotal)}
            </p>
            <p className="mt-1 text-sm font-semibold text-rose-800">
              Payments received
            </p>
            <p className="text-xs text-rose-700">
              Across {earningsEntries.length} paid booking
              {earningsEntries.length === 1 ? "" : "s"}.
            </p>
          </div>
        </div>

        <h2 className="mt-12 flex items-center gap-2 text-2xl font-bold">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-600" />
          Today&apos;s schedule
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Everyone you are seeing today, in time order. Confirm an
          appointment when the patient arrives, complete it when it
          is done.
        </p>
        {todaySchedule.length === 0 ? (
          <Card className="mt-4 border-dashed border-brand-200 bg-white/70">
            <CardContent className="pt-6">
              <p className="font-semibold">Nothing on today</p>
              <p className="mt-1 text-sm text-slate-600">
                No booked or confirmed appointments for today. New
                bookings appear here as soon as a patient books one
                of your windows.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-4 grid gap-4">
            {todaySchedule.map(doctorBookingCard)}
          </div>
        )}

        <h2 className="mt-12 flex items-center gap-2 text-2xl font-bold">
          <span className="h-2.5 w-2.5 rounded-full bg-warning-strong" />
          Upcoming
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Booked and confirmed appointments after today.
        </p>
        {upcoming.length === 0 ? (
          <Card className="mt-4 border-dashed border-warning-strong/40 bg-white/70">
            <CardContent className="pt-6">
              <p className="font-semibold">Nothing coming up yet</p>
              <p className="mt-1 text-sm text-slate-600">
                Future bookings will list here. Make sure your
                windows below are active, so patients can book them.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-4 grid gap-4">
            {upcoming.map(doctorBookingCard)}
          </div>
        )}

        {awaiting.length > 0 && (
          <>
            <h2 className="mt-12 flex items-center gap-2 text-2xl font-bold">
              <span className="h-2.5 w-2.5 rounded-full bg-info-strong" />
              Awaiting payment
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              These holds expire 15 minutes after booking if the
              patient does not pay — the slot then frees itself.
            </p>
            <div className="mt-4 grid gap-4">
              {awaiting.map(doctorBookingCard)}
            </div>
          </>
        )}

        <h2 className="mt-12 flex items-center gap-2 text-2xl font-bold">
          <span className="h-2.5 w-2.5 rounded-full bg-violet-600" />
          Your patients
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Everyone who has booked with you, with how often and how
          recently.
        </p>
        {patients.length === 0 ? (
          <Card className="mt-4 border-dashed border-violet-300 bg-white/70">
            <CardContent className="pt-6">
              <p className="font-semibold">No patients yet</p>
              <p className="mt-1 text-sm text-slate-600">
                Patients will appear here as soon as someone books
                one of your windows. Add an availability window
                below, and share your public profile link so patients
                can find you.
              </p>
              {doctorId && (
                <Link href={`/doctors/${doctorId}`}>
                  <Button className="mt-4 rounded-full" size="sm">
                    View my public profile
                  </Button>
                </Link>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {patients.map(([name, info], i) => (
              <Card
                key={name}
                className="transition-shadow hover:shadow-lg"
              >
                <CardContent className="flex items-start gap-3 pt-6">
                  <span
                    aria-hidden="true"
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-bold ${AVATAR_TINTS[i % AVATAR_TINTS.length]}`}
                  >
                    {initialsOf(name)}
                  </span>
                  <div>
                    <p className="font-medium">{name}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {info.count} appointment
                      {info.count === 1 ? "" : "s"} · latest{" "}
                      {formatDate(info.latest)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <h2 className="mt-12 flex items-center gap-2 text-2xl font-bold">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
          Payments received
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Paid bookings — the money patients have paid for
          appointments with you.
        </p>
        <p className="mt-3 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-medium text-teal-900">
          Payments for your completed appointments are settled every
          week.
        </p>
        {earningsEntries.length === 0 ? (
          <Card className="mt-4 border-dashed border-rose-300 bg-white/70">
            <CardContent className="pt-6">
              <p className="font-semibold">No payments received yet</p>
              <p className="mt-1 text-sm text-slate-600">
                Payments appear here when a patient pays for a
                booking with you. Unpaid holds and free bookings do
                not appear here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-4 grid gap-4">
            {earningsEntries.map((e) => (
              <Card
                key={e.appointmentId}
                className="transition-shadow hover:shadow-lg"
              >
                <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-sm font-bold text-rose-800"
                    >
                      {initialsOf(e.booking.patientName)}
                    </span>
                    <div>
                      <p className="font-medium">{e.booking.patientName}</p>
                      <p className="mt-1">
                        <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800">
                          {formatDate(e.booking.slotDate)},{" "}
                          {formatTime(e.booking.slotStart)} –{" "}
                          {formatTime(e.booking.slotEnd)}
                        </span>
                      </p>
                    </div>
                  </div>
                  <p className="text-lg font-bold text-ink">
                    {formatPaise(e.amountPaise)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <h2 className="mt-12 flex items-center gap-2 text-2xl font-bold">
          <span className="h-2.5 w-2.5 rounded-full bg-teal-600" />
          Payout details
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Where your weekly settlements go. Only you see this —
          patients never see payout details.
        </p>
        <Card className="mt-4 border-2 border-teal-200 bg-gradient-to-br from-white to-teal-50 shadow-md">
          <CardContent className="pt-6">
            <PayoutDetailsForm
              upiId={payout?.upiId ?? null}
              ifsc={payout?.ifsc ?? null}
              accountHolder={payout?.accountHolder ?? null}
              maskedAccountNumber={payout?.maskedAccountNumber ?? null}
              hasDetails={payout?.hasDetails ?? false}
            />
          </CardContent>
        </Card>

        <h2
          id="availability"
          className="mt-12 flex scroll-mt-24 items-center gap-2 text-2xl font-bold"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-info-strong" />
          My availability
        </h2>
        <Card className="mt-4 border-2 border-brand-200 bg-gradient-to-br from-white to-brand-50 shadow-md">
          <CardHeader>
            <CardTitle>Add a window</CardTitle>
            <CardDescription>
              Patients can only book windows you mark active.
              Removing a window with upcoming bookings is blocked, so
              patients are never stranded.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SlotCreateForm />
          </CardContent>
        </Card>

        {upcomingSlots.length === 0 ? (
          <Card className="mt-4 border-dashed border-info-strong/40 bg-white/70">
            <CardContent className="pt-6">
              <p className="font-semibold">No upcoming windows</p>
              <p className="mt-1 text-sm text-slate-600">
                Add one above to open bookings, or use the default
                Mon–Fri schedule created at sign-up. Inactive windows
                never appear to patients.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {upcomingSlots.map((s) => (
              <Card
                key={s.slotId}
                className={`border-l-4 ${s.isActive ? "border-l-success-strong" : "border-l-neutral-strong"} transition-shadow hover:shadow-lg`}
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

        {history.length > 0 && (
          <>
            <h2 className="mt-12 flex items-center gap-2 text-2xl font-bold">
              <span className="h-2.5 w-2.5 rounded-full bg-neutral-strong" />
              History
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Completed, cancelled, and past appointments.
            </p>
            <div className="mt-4 grid gap-4">
              {history.map(doctorBookingCard)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
