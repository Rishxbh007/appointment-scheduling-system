import Link from "next/link";
import { ensureDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  listDoctors,
  getFavoriteDoctorIds,
  formatDoctorName,
} from "@/lib/services/doctors";
import { getPatientIdByUser } from "@/lib/services/accounts";
import { DoctorCard } from "@/components/doctor-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

export default async function DoctorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  await ensureDb();
  const doctors = await listDoctors(q);

  // The signed-in patient's own favorite set, computed server-side.
  // Only booleans travel to the cards below — never another
  // patient's data, and no toggle at all unless the viewer is a
  // signed-in patient.
  const session = await getSession();
  let favoriteIds = new Set<number>();
  if (session?.role === "Patient") {
    const patientId = await getPatientIdByUser(session.userId);
    if (patientId) {
      favoriteIds = new Set(await getFavoriteDoctorIds(patientId));
    }
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
            Find a doctor
          </h1>
          <p className="relative mt-2 max-w-lg text-teal-50">
            Search by specialization (e.g. Cardiology) or doctor
            name. Tap any doctor&apos;s card to view their profile
            and book.
          </p>
        </div>

        <form method="get" action="/doctors" className="mt-6 flex gap-2">
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search specialization or name…"
            className="h-12 max-w-md rounded-full border-slate-200 bg-white shadow-sm"
          />
          <Button
            type="submit"
            className="h-12 rounded-full px-6 shadow-md shadow-brand-600/20"
          >
            Search
          </Button>
          {q && (
            <Link href="/doctors">
              <Button variant="ghost" className="h-12 rounded-full">
                Clear
              </Button>
            </Link>
          )}
        </form>
        <p className="mt-3 text-sm text-slate-600">
          {q ? (
            <>
              Results for “{q}”: {doctors.length} doctor
              {doctors.length === 1 ? "" : "s"}
            </>
          ) : (
            <>
              {doctors.length} doctor{doctors.length === 1 ? "" : "s"}{" "}
              available
            </>
          )}
        </p>

        {doctors.length === 0 ? (
          <div className="mt-8 rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <p className="text-lg font-semibold text-slate-900">
              No doctors match that search yet.
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Try a different specialization or name.
            </p>
            {q && (
              <Link href="/doctors">
                <Button className="mt-4 rounded-full">
                  Show all doctors
                </Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {doctors.map((d, i) => (
              <DoctorCard
                key={d.doctorId}
                doctorId={d.doctorId}
                name={formatDoctorName(d.name)}
                specializationNames={d.specializationNames}
                qualification={d.qualification}
                experienceYears={d.experienceYears}
                consultationFee={d.consultationFee}
                isFavorite={favoriteIds.has(d.doctorId)}
                showFavorite={session?.role === "Patient"}
                accentIndex={i}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
