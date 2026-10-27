import Link from "next/link";
import { ensureDb } from "@/lib/db";
import { listDoctors } from "@/lib/services/doctors";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function Home() {
  // The landing page degrades gracefully: if the database is not up
  // yet, the page still renders and the doctors section is empty.
  let doctors: Awaited<ReturnType<typeof listDoctors>> = [];
  try {
    await ensureDb();
    doctors = (await listDoctors()).slice(0, 3);
  } catch (err) {
    console.error("Home page doctor preview failed:", err);
  }

  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-16 text-center sm:py-24">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Book a doctor&apos;s appointment in minutes
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-slate-600">
          Find a doctor by specialization, pick a real time slot, and
          follow your appointment from booking to completion — patients
          and doctors in one place.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/doctors">
            <Button size="lg">Find doctors</Button>
          </Link>
          <Link href="/register">
            <Button size="lg" variant="outline">
              Create an account
            </Button>
          </Link>
        </div>
      </section>

      <section className="grid gap-4 pb-16 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>1. Find your doctor</CardTitle>
            <CardDescription>
              Browse doctors by specialization, qualification, experience
              and consultation fee.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>2. Book a real slot</CardTitle>
            <CardDescription>
              Pick a date and time window with live availability — a slot
              cannot be overbooked.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>3. Track the status</CardTitle>
            <CardDescription>
              Booked → Confirmed → Completed, with cancellation on either
              side when plans change.
            </CardDescription>
          </CardHeader>
        </Card>
      </section>

      <section className="pb-16">
        <h2 className="mb-4 text-2xl font-bold">Doctors on CareBook</h2>
        {doctors.length === 0 ? (
          <p className="text-slate-600">
            No doctors listed yet. Doctors appear here once they register
            and their profile is approved.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
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
      </section>
    </div>
  );
}
