// Notifications page — Day 5 follow-up. The separate section
// other apps have: every real email + SMS the app sent about
// the signed-in user's appointments, newest first, with its
// channel and honest status — plus the SMS preferences form
// (moved here from the bottom of the dashboard, where nobody
// found it). Patients see their own rows (both channels);
// doctors see the rows addressed to them (email only). Nothing
// here is a demo entry: these are the actual outbox rows,
// including emails from before this page existed.

import { redirect } from "next/navigation";
import { ensureDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  getPatientIdByUser,
  getDoctorIdByUser,
  getUserById,
} from "@/lib/services/accounts";
import {
  getSmsOptIn,
  listNotificationsForDoctor,
  listNotificationsForPatient,
  notificationEventLabel,
  type NotificationHistoryRow,
} from "@/lib/services/notifications";
import { NotificationPreferencesForm } from "@/components/notification-preferences-form";
import { Card, CardContent } from "@/components/ui/card";

function statusClass(status: string): string {
  switch (status) {
    case "Sent":
      return "text-success-strong";
    case "Failed":
      return "text-danger-strong";
    case "Pending":
      return "text-warning-strong";
    default:
      return "text-slate-500";
  }
}

/** IST date + time for one row, labelled by what the time means. */
function timeLine(row: NotificationHistoryRow): string {
  const fmt = (d: Date) =>
    d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  if (row.sentAt) return `Sent ${fmt(row.sentAt)}`;
  if (row.status === "Pending" && row.scheduledAt)
    return `Scheduled for ${fmt(row.scheduledAt)}`;
  return `Created ${fmt(row.createdAt)}`;
}

export default async function NotificationsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  await ensureDb();
  const user = await getUserById(session.userId);
  if (!user) redirect("/login");

  const isPatient = session.role === "Patient";
  let rows: NotificationHistoryRow[] = [];
  let smsOptIn = false;
  if (isPatient) {
    const patientId = await getPatientIdByUser(session.userId);
    rows = patientId ? await listNotificationsForPatient(patientId) : [];
    smsOptIn = (await getSmsOptIn(session.userId)) ?? false;
  } else {
    const doctorId = await getDoctorIdByUser(session.userId);
    rows = doctorId
      ? await listNotificationsForDoctor(doctorId, user.email)
      : [];
  }

  return (
    <div className="min-h-dvh bg-gradient-to-br from-teal-50 via-amber-50 to-rose-100">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-3xl font-bold">Notifications</h1>
        <p className="mt-2 max-w-lg text-slate-600">
          Every email and SMS CareBook sent about your appointments
          — newest first, with its real status. Nothing here is a
          demo entry.
        </p>

        {isPatient ? (
          <Card className="mt-6">
            <CardContent className="pt-6">
              <p className="font-semibold">SMS preferences</p>
              <NotificationPreferencesForm
                initialPhone={user.phone ?? ""}
                initialSmsOptIn={smsOptIn}
              />
            </CardContent>
          </Card>
        ) : (
          <Card className="mt-6">
            <CardContent className="pt-6">
              <p className="text-sm text-slate-600">
                Doctors receive booking updates by email. SMS
                notifications are patient-only.
              </p>
            </CardContent>
          </Card>
        )}

        <h2 className="mt-10 text-2xl font-bold">History</h2>
        {rows.length === 0 ? (
          <Card className="mt-4 border-dashed border-info-strong/40 bg-white/70">
            <CardContent className="pt-6">
              <p className="font-semibold">No notifications yet</p>
              <p className="mt-1 text-sm text-slate-600">
                Notifications about your appointments will appear
                here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-4 space-y-4">
            {rows.map((row) => (
              <Card key={row.notificationId}>
                <CardContent className="pt-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">
                      {notificationEventLabel(row.event)}
                    </span>
                    <span className="text-xs text-slate-500">
                      {row.channel === "sms" ? "SMS" : "Email"}
                    </span>
                    <span
                      className={`text-xs font-medium ${statusClass(row.status)}`}
                    >
                      {row.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium">{row.subject}</p>
                  <p className="mt-1 text-sm whitespace-pre-wrap text-slate-600">
                    {row.body}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    {timeLine(row)}
                    {row.failureReason
                      ? ` · ${row.failureReason}`
                      : ""}
                    {row.channel === "sms" && row.providerRef
                      ? ` · ref ${row.providerRef}`
                      : ""}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
