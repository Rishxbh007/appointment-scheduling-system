// Demo seed data — clearly marked, runs only on a fresh database.
//
// Runs when the users table is empty (see ensureDb). It creates:
//   - one demo patient login: patient@demo.local / demo1234
//   - one demo doctor login:  doctor@demo.local  / demo1234
//   - three more demo doctors across common specializations
// Every demo doctor is approved and has a week of bookable slots, so
// the booking flow can be demonstrated immediately after first run.
// Real users' data is never mixed with this: the seed runs once, on
// an empty database, and nothing in the app depends on these rows.

import bcrypt from "bcryptjs";
import { db } from "./index";
import { users, patients, doctors, specializations, slots } from "./schema";
import { seedScheduleSlots } from "@/lib/services/schedule";

const DEMO_PASSWORD = "demo1234";

type SeedDoctor = {
  name: string;
  email: string;
  qualification: string;
  experienceYears: number;
  consultationFee: string;
  specialization: string;
};

const SEED_DOCTORS: SeedDoctor[] = [
  {
    name: "Dr. Ananya Sharma",
    email: "doctor@demo.local",
    qualification: "MBBS, MD General Medicine",
    experienceYears: 12,
    consultationFee: "500",
    specialization: "General Physician",
  },
  {
    name: "Dr. Rohan Mehta",
    email: "rohan.mehta@demo.local",
    qualification: "MBBS, DM Cardiology",
    experienceYears: 15,
    consultationFee: "800",
    specialization: "Cardiology",
  },
  {
    name: "Dr. Priya Nair",
    email: "priya.nair@demo.local",
    qualification: "MBBS, MD Dermatology",
    experienceYears: 8,
    consultationFee: "600",
    specialization: "Dermatology",
  },
  {
    name: "Dr. Vikram Rao",
    email: "vikram.rao@demo.local",
    qualification: "MBBS, MD Pediatrics",
    experienceYears: 10,
    consultationFee: "450",
    specialization: "Pediatrics",
  },
];

/**
 * The exact marker for a demo/seed doctor: the four seed emails
 * above. lib/services/demo-slots.ts reuses this list (never a
 * guess, never a domain pattern) so the rolling top-up can only
 * ever touch these doctors — a real registered doctor, even one
 * who happens to share a name, is never matched.
 */
export const SEED_DOCTOR_EMAILS: string[] = SEED_DOCTORS.map(
  (d) => d.email,
);

export async function seedDemoData(): Promise<void> {
  const count = await db.$count(users);
  if (count > 0) return; // Never seed over real data.

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // Demo patient.
  const [patientUser] = await db
    .insert(users)
    .values({
      name: "Demo Patient",
      email: "patient@demo.local",
      phone: "9999999999",
      passwordHash,
      role: "Patient",
      authProvider: "Email",
      isVerified: true,
    })
    .returning();
  await db.insert(patients).values({ userId: patientUser.userId });

  // Demo doctors, each with a specialization and a week of slots.
  for (const d of SEED_DOCTORS) {
    const [user] = await db
      .insert(users)
      .values({
        name: d.name,
        email: d.email,
        phone: "9999999999",
        passwordHash,
        role: "Doctor",
        authProvider: "Email",
        isVerified: true,
      })
      .returning();
    const [doctor] = await db
      .insert(doctors)
      .values({
        userId: user.userId,
        qualification: d.qualification,
        experienceYears: d.experienceYears,
        consultationFee: d.consultationFee,
        // Demo simplification: seed doctors are approved so they can
        // receive bookings immediately. Real approvals would go
        // through an admin review step (not part of this task).
        isApproved: true,
      })
      .returning();
    await db
      .insert(specializations)
      .values({ doctorId: doctor.doctorId, name: d.specialization });
    const rows = seedScheduleSlots(doctor.doctorId);
    if (rows.length > 0) await db.insert(slots).values(rows);
  }
}
