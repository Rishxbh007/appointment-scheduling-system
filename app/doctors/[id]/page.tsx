import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  getDoctorProfile,
  getFavoriteDoctorIds,
} from "@/lib/services/doctors";
import type { DoctorSlotView } from "@/lib/services/doctors";
import { getPatientIdByUser } from "@/lib/services/accounts";
import { FavoriteToggle } from "@/components/favorite-toggle";
import { BookingForm } from "@/components/booking-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDate, formatTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function DoctorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const doctorId = Number(id);
  if (!Number.isInteger(doctorId)) notFound();

  await ensureDb();
  const session = await getSession();
  const profile = await getDoctorProfile(doctorId);
  if (!profile) notFound();

  // Whether this signed-in patient has saved this doctor. Only
  // computed for patients; doctors and signed-out visitors never
  // see the toggle.
  let isFavorite = false;
  if (session?.role === "Patient") {
    const patientId = await getPatientIdByUser(session.userId);
    if (patientId) {
      isFavorite = (await getFavoriteDoctorIds(patientId)).includes(
        doctorId,
      );
    }
  }

  // Group ALL upcoming slots by date for display, including
  // unavailable ones: a date with no bookable slots still shows
  // its slots marked unavailable, instead of empty silence.
  const byDate = new Map<string, typeof profile.slots>();
  for (const s of profile.slots) {
    const list = byDate.get(s.date) ?? [];
    list.push(s);
    byDate.set(s.date, list);
  }

  // Text state label per slot. The label is the signal — colour
  // alone is never used to convey availability.
  function slotStateText(s: DoctorSlotView): string {
    if (s.bookable) return `${s.remaining} of ${s.maxAppointments} left`;
    if (s.state === "fully-booked")
      return `Fully booked (0 of ${s.maxAppointments} left)`;
    if (s.state === "unavailable") return "Unavailable";
    return "Passed";
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Link href="/doctors" className="text-sm underline">
        ← All doctors
      </Link>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">{profile.name}</CardTitle>
            <CardDescription>
              {profile.specializationNames.join(", ") ||
                "General practice"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            <p>
              <span className="font-medium">Qualification: </span>
              {profile.qualification ?? "—"}
            </p>
            <p>
              <span className="font-medium">Experience: </span>
              {profile.experienceYears !== null
                ? `${profile.experienceYears} years`
                : "—"}
            </p>
            <p>
              <span className="font-medium">Consultation fee: </span>
              {profile.consultationFee !== null
                ? `₹${profile.consultationFee}`
                : "On request"}
            </p>
            <p>
              <span className="font-medium">Contact: </span>
              {profile.email}
              {profile.phone ? ` · ${profile.phone}` : ""}
            </p>
            {session?.role === "Patient" && (
              <div className="mt-3">
                <FavoriteToggle
                  doctorId={doctorId}
                  doctorName={profile.name}
                  isFavorite={isFavorite}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Book an appointment</CardTitle>
            <CardDescription>
              Pick an available window and tell the doctor why you are
              visiting.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {session?.role === "Patient" ? (
              <BookingForm slots={profile.slots} />
            ) : session?.role === "Doctor" ? (
              <p className="text-sm text-slate-600">
                You are signed in as a doctor. Doctors cannot book
                appointments — patients book with you from this page.
              </p>
            ) : (
              <div className="flex flex-col items-start gap-3">
                <p className="text-sm text-slate-600">
                  Sign in as a patient to book an appointment with{" "}
                  {profile.name}.
                </p>
                <Link href="/login">
                  <Button>Sign in</Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <h2 className="mt-10 text-xl font-bold">Upcoming windows</h2>
      <p className="mt-1 text-sm text-slate-600">
        All times shown in IST. Slots marked Fully booked, Unavailable
        or Passed cannot be booked.
      </p>
      {byDate.size === 0 ? (
        <p className="mt-2 text-slate-600">
          No upcoming windows right now. Check back later.
        </p>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...byDate.entries()].map(([date, daySlots]) => (
            <Card key={date}>
              <CardHeader>
                <CardTitle className="text-base">
                  {formatDate(date)}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1">
                {daySlots.map((s) => (
                  <p
                    key={s.slotId}
                    className={
                      s.bookable
                        ? "text-sm text-slate-700"
                        : "text-sm text-slate-500"
                    }
                  >
                    {formatTime(s.startTime)} – {formatTime(s.endTime)}
                    <span> · {slotStateText(s)}</span>
                  </p>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
