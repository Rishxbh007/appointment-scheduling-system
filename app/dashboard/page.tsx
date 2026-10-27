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
import { Badge } from "@/components/ui/badge";
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
  SlotCreateForm,
  SlotToggleButton,
} from "@/components/dashboard-forms";
import { formatDate, formatTime, todayIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  await ensureDb();
  const user = await getUserById(session.userId);
  if (!user) redirect("/login");

  if (session.role === "Patient") {
    const patientId = await getPatientIdByUser(session.userId);
    const bookings = patientId ? await getPatientBookings(patientId) : [];
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-3xl font-bold">Welcome, {user.name}</h1>
        <p className="mt-1 text-slate-600">Your appointments, in one place.</p>
        <Link href="/doctors">
          <Button className="mt-4">Book a new appointment</Button>
        </Link>

        <h2 className="mt-10 text-xl font-bold">My bookings</h2>
        {bookings.length === 0 ? (
          <p className="mt-2 text-slate-600">
            No bookings yet. Browse doctors and book your first
            appointment.
          </p>
        ) : (
          <div className="mt-4 grid gap-4">
            {bookings.map((b) => (
              <Card key={b.appointmentId}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
                  <div>
                    <p className="font-medium">{b.doctorName}</p>
                    <p className="text-sm text-slate-600">
                      {formatDate(b.slotDate)}, {formatTime(b.slotStart)} –{" "}
                      {formatTime(b.slotEnd)}
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
                      <PatientCancelButton
                        appointmentId={b.appointmentId}
                      />
                    )}
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
  const today = todayIST();
  const upcomingSlots = mySlots.filter((s) => s.date >= today);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold">Welcome, {user.name}</h1>
      <p className="mt-1 text-slate-600">
        Appointments booked with you, and your availability.
      </p>

      <h2 className="mt-10 text-xl font-bold">Appointments</h2>
      {bookings.length === 0 ? (
        <p className="mt-2 text-slate-600">
          No appointments yet. Patients will appear here once they book
          one of your windows.
        </p>
      ) : (
        <div className="mt-4 grid gap-4">
          {bookings.map((b) => (
            <Card key={b.appointmentId}>
              <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
                <div>
                  <p className="font-medium">{b.patientName}</p>
                  <p className="text-sm text-slate-600">
                    {formatDate(b.slotDate)}, {formatTime(b.slotStart)} –{" "}
                    {formatTime(b.slotEnd)}
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
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <h2 className="mt-12 text-xl font-bold">My availability</h2>
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
            <Card key={s.slotId}>
              <CardContent className="flex items-center justify-between gap-3 pt-6">
                <div>
                  <p className="font-medium">{formatDate(s.date)}</p>
                  <p className="text-sm text-slate-600">
                    {formatTime(s.startTime)} – {formatTime(s.endTime)}
                  </p>
                  <p className="text-sm text-slate-500">
                    {s.activeBookings} active booking(s) · max{" "}
                    {s.maxAppointments} ·{" "}
                    {s.isActive ? "Active" : "Inactive"}
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
