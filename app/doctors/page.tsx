import Link from "next/link";
import { ensureDb } from "@/lib/db";
import { listDoctors } from "@/lib/services/doctors";
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
                <CardTitle>{d.name}</CardTitle>
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
                <Link href={`/doctors/${d.doctorId}`}>
                  <Button variant="outline" size="sm" className="mt-4">
                    View &amp; book
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
