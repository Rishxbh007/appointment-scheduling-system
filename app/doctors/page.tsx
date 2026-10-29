import Link from "next/link";
import { ensureDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  listDoctors,
  getFavoriteDoctorIds,
  formatDoctorName,
} from "@/lib/services/doctors";
import { getPatientIdByUser } from "@/lib/services/accounts";
import { FavoriteToggle } from "@/components/favorite-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold">Find a doctor</h1>
      <p className="mt-1 text-slate-600">
        Search by specialization (e.g. Cardiology) or doctor name.
      </p>
      <form method="get" action="/doctors" className="mt-6 flex gap-2">
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search specialization or name…"
          className="max-w-md"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
        {q && (
          <Link href="/doctors">
            <Button variant="ghost">Clear</Button>
          </Link>
        )}
      </form>

      {doctors.length === 0 ? (
        <p className="mt-8 text-slate-600">
          No doctors match that search yet.
        </p>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {doctors.map((d) => (
            <Card key={d.doctorId}>
              <CardHeader>
                <CardTitle>{formatDoctorName(d.name)}</CardTitle>
                <CardDescription>
                  {d.specializationNames.join(", ") || "General practice"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-600">
                  {d.qualification ?? "—"}
                  {d.experienceYears !== null &&
                    ` · ${d.experienceYears} yrs experience`}
                </p>
                <p className="mt-1 text-sm font-medium">
                  {d.consultationFee !== null
                    ? `₹${d.consultationFee} consultation`
                    : "Fee on request"}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Link href={`/doctors/${d.doctorId}`}>
                    <Button variant="outline" size="sm">
                      View &amp; book
                    </Button>
                  </Link>
                  {session?.role === "Patient" && (
                    <FavoriteToggle
                      doctorId={d.doctorId}
                      doctorName={formatDoctorName(d.name)}
                      isFavorite={favoriteIds.has(d.doctorId)}
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
