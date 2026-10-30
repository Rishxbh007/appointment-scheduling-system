import Link from "next/link";
import { notFound } from "next/navigation";
import { ensureDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  getDoctorProfile,
  getFavoriteDoctorIds,
  formatDoctorName,
} from "@/lib/services/doctors";
import {
  getPatientIdByUser,
  getUserById,
} from "@/lib/services/accounts";
import { FavoriteToggle } from "@/components/favorite-toggle";
import { BookingForm } from "@/components/booking-form";
import { AvailableTimes } from "@/components/slot-picker";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

/** Initials for the profile avatar circle ("Dr. Ananya Sharma" → "AS"). */
function initialsOf(displayName: string): string {
  const withoutPrefix = displayName.replace(/^Dr\.\s*/i, "");
  const words = withoutPrefix.split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "");
  return letters.join("") || "Dr";
}

export default async function DoctorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ slot?: string | string[] }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const rawSlot = Array.isArray(sp?.slot) ? sp.slot[0] : sp?.slot;
  // ?slot= from the Available-times pills below: preselect that
  // time in the booking card. BookingForm ignores it unless the
  // slot is still bookable.
  const initialSlotId =
    rawSlot && /^\d+$/.test(rawSlot) ? Number(rawSlot) : null;
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
  // The signed-in patient's own details, for checkout prefill
  // only — their phone/email never travel to anyone else's view.
  let checkoutPrefill: { name: string; email: string; contact?: string } | undefined;
  if (session?.role === "Patient") {
    const patientId = await getPatientIdByUser(session.userId);
    if (patientId) {
      isFavorite = (await getFavoriteDoctorIds(patientId)).includes(
        doctorId,
      );
    }
    const viewer = await getUserById(session.userId);
    if (viewer) {
      checkoutPrefill = {
        name: viewer.name,
        email: viewer.email,
        ...(viewer.phone ? { contact: viewer.phone } : {}),
      };
    }
  }

  return (
    <div className="min-h-dvh bg-gradient-to-br from-teal-50 via-amber-50 to-rose-100">
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Link
        href="/doctors"
        className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-brand-700 shadow-sm hover:text-brand-800"
      >
        ← All doctors
      </Link>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden shadow-lg">
          <CardHeader className="bg-gradient-to-br from-brand-50 via-surface to-amber-50">
            <div className="flex items-center gap-4">
              <span
                aria-hidden="true"
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-teal-100 text-xl font-bold text-teal-800"
              >
                {initialsOf(formatDoctorName(profile.name))}
              </span>
              <div>
            <CardTitle className="text-2xl">{formatDoctorName(profile.name)}</CardTitle>
            <CardDescription>
              {profile.specializationNames.length > 0 ? (
                <span className="flex flex-wrap gap-1.5">
                  {profile.specializationNames.map((s) => (
                    <span
                      key={s}
                      className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-800"
                    >
                      {s}
                    </span>
                  ))}
                </span>
              ) : (
                "General practice"
              )}
            </CardDescription>
              </div>
            </div>
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
              <span className="rounded-full bg-warning-soft px-2.5 py-1 text-xs font-bold text-warning-strong">
                {profile.consultationFee !== null
                  ? `₹${profile.consultationFee}`
                  : "On request"}
              </span>
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
                  doctorName={formatDoctorName(profile.name)}
                  isFavorite={isFavorite}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card id="book" className="scroll-mt-24 shadow-xl ring-2 ring-brand-200">
          <CardHeader className="bg-gradient-to-br from-teal-50 via-surface to-amber-50">
            <CardTitle>Book an appointment</CardTitle>
            <CardDescription>
              Choose a day, pick a time, tell the doctor why you are
              visiting, then review and pay.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {session?.role === "Patient" ? (
              <BookingForm
                slots={profile.slots}
                consultationFee={profile.consultationFee}
                doctorName={formatDoctorName(profile.name)}
                prefill={checkoutPrefill}
                initialSlotId={initialSlotId}
              />
            ) : session?.role === "Doctor" ? (
              <p className="text-sm text-slate-600">
                You are signed in as a doctor. Doctors cannot book
                appointments — patients book with you from this page.
              </p>
            ) : (
              <div className="flex flex-col items-start gap-3">
                <p className="text-sm text-slate-600">
                  Sign in as a patient to book an appointment with{" "}
                  {formatDoctorName(profile.name)}.
                </p>
                <Link href="/login">
                  <Button>Sign in</Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <h2 className="mt-12 flex items-center gap-2 text-2xl font-bold">
        <span className="h-2.5 w-2.5 rounded-full bg-brand-600" />
        Available times
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        All times shown in IST. Only days and times that are actually
        available are listed — tap a time to pick it in the booking
        card above.
      </p>
      <AvailableTimes slots={profile.slots} doctorId={doctorId} />
    </div>
    </div>
  );
}
