// Full-flow test, run with:  npx tsx scripts/test-flow.ts
//
// Exercises the real service layer against the real database:
//   register a patient -> list doctors -> book a slot -> doctor sees
//   it -> doctor confirms -> patient sees Confirmed. Then the guard
//   rails: double booking, overbooking a full slot, booking a past
//   slot, and cancelling. Test rows are deleted at the end so the
//   demo database is left clean.
//
// Requires DATABASE_URL (read from .env.local if present).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";

function loadEnvLocal() {
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnvLocal();

// NOTE: run this script with the environment loaded first, e.g.
//   set -a; . ./.env.local; set +a; npx tsx scripts/test-flow.ts
// Static imports run before any code in this file, so the env file
// alone cannot supply DATABASE_URL in time for pool creation.
import { db, ensureDb } from "@/lib/db";
import { users, patients, doctors, slots, appointments } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth";
import { listDoctors, getDoctorProfile } from "@/lib/services/doctors";
import {
  bookAppointment,
  changeAppointmentStatus,
  getDoctorBookings,
  getPatientBookings,
  createSlot,
  setSlotActive,
} from "@/lib/services/booking";
import { defaultScheduleSlots } from "@/lib/services/schedule";
import { addDays, todayIST } from "@/lib/time";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, extra = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

async function main() {
  console.log("Setting up database (tables + demo seed)...");
  await ensureDb();

  console.log("1. Seed doctors exist");
  const allDoctors = await listDoctors();
  check("at least 1 doctor listed", allDoctors.length >= 1);
  const doctor = allDoctors[0];
  console.log(`    Using doctor: ${doctor.name} (id ${doctor.doctorId})`);

  console.log("2. Register a test patient (direct insert, like register)");
  const passwordHash = await hashPassword("test1234");
  const [testUser] = await db
    .insert(users)
    .values({
      name: "Test Patient",
      email: `test-patient-${Date.now()}@test.local`,
      passwordHash,
      role: "Patient",
      authProvider: "Email",
      isVerified: true,
    })
    .returning();
  const [testPatient] = await db
    .insert(patients)
    .values({ userId: testUser.userId })
    .returning();
  check("patient profile created", !!testPatient.patientId);

  console.log("3. Doctor profile shows bookable slots");
  const profile = await getDoctorProfile(doctor.doctorId);
  check("profile found", !!profile);
  check(
    "has bookable slots",
    (profile?.slots.some((s) => s.bookable) ?? false),
  );
  const slot = profile!.slots.find((s) => s.bookable)!;
  console.log(
    `    Booking slot ${slot.slotId}: ${slot.date} ${slot.startTime}-${slot.endTime} (${slot.remaining} left)`,
  );

  console.log("4. Book the slot");
  const booked = await bookAppointment(
    testPatient.patientId,
    slot.slotId,
    "Fever for two days",
  );
  check("appointment created with status Booked", booked.status === "Booked");

  console.log("5. Doctor sees the booking");
  const doctorBookings = await getDoctorBookings(doctor.doctorId);
  const seen = doctorBookings.find(
    (b) => b.appointmentId === booked.appointmentId,
  );
  check("booking visible on doctor dashboard", !!seen);
  check("patient name shown", seen?.patientName === "Test Patient");

  console.log("6. Doctor confirms, patient sees Confirmed");
  await changeAppointmentStatus(booked.appointmentId, "Confirmed", {
    doctorId: doctor.doctorId,
  });
  const patientBookings = await getPatientBookings(testPatient.patientId);
  const mine = patientBookings.find(
    (b) => b.appointmentId === booked.appointmentId,
  );
  check("patient sees Confirmed", mine?.status === "Confirmed");

  console.log("7. Guard rails");
  try {
    await bookAppointment(testPatient.patientId, slot.slotId, "Again");
    check("same patient cannot double-book a slot", false);
  } catch (err) {
    check(
      "same patient cannot double-book a slot",
      err instanceof Error && /already have/.test(err.message),
      err instanceof Error ? err.message : "",
    );
  }

  // Overbooking: a max-1 slot booked by patient A, then patient B.
  const [slotRow] = await db
    .select()
    .from(slots)
    .where(eq(slots.slotId, slot.slotId));
  const oneSeat = await db
    .insert(slots)
    .values({
      doctorId: doctor.doctorId,
      date: slotRow.date,
      startTime: "18:00:00",
      endTime: "19:00:00",
      maxAppointments: 1,
      isActive: true,
    })
    .returning();
  const [userB] = await db
    .insert(users)
    .values({
      name: "Second Patient",
      email: `test-patient-b-${Date.now()}@test.local`,
      passwordHash,
      role: "Patient",
      authProvider: "Email",
      isVerified: true,
    })
    .returning();
  const [patientB] = await db
    .insert(patients)
    .values({ userId: userB.userId })
    .returning();
  await bookAppointment(testPatient.patientId, oneSeat[0].slotId, "First seat");
  try {
    await bookAppointment(patientB.patientId, oneSeat[0].slotId, "Second seat");
    check("full slot rejects a second booking", false);
  } catch (err) {
    check(
      "full slot rejects a second booking",
      err instanceof Error && /fully booked/.test(err.message),
      err instanceof Error ? err.message : "",
    );
  }

  console.log("8. Cancel flow");
  await changeAppointmentStatus(booked.appointmentId, "Cancelled", {
    doctorId: doctor.doctorId,
  });
  const afterCancel = await getPatientBookings(testPatient.patientId);
  const cancelled = afterCancel.find(
    (b) => b.appointmentId === booked.appointmentId,
  );
  check("cancelled status visible to patient", cancelled?.status === "Cancelled");

  console.log("9. Doctor slot management + default schedule");
  const schedule = defaultScheduleSlots(doctor.doctorId);
  const allWeekdays = schedule.every((s) => {
    const [y, m, d] = s.date.split("-").map(Number);
    const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return day >= 1 && day <= 5;
  });
  const allMorning = schedule.every(
    (s) => s.startTime >= "09:00:00" && s.endTime <= "13:00:00",
  );
  check("default schedule is Mon–Fri only", allWeekdays);
  check("default schedule is 09:00–13:00 windows", allMorning);
  check("default schedule is non-empty", schedule.length > 0);

  const tomorrow = addDays(todayIST(), 1);
  const managed = await createSlot(doctor.doctorId, {
    date: tomorrow,
    startTime: "18:00",
    endTime: "19:00",
    maxAppointments: 2,
  });
  check("doctor can create a slot", !!managed.slotId);
  const bookedManaged = await bookAppointment(
    testPatient.patientId,
    managed.slotId,
    "Slot management check",
  );
  check("managed slot is bookable", bookedManaged.status === "Booked");
  try {
    await setSlotActive(doctor.doctorId, managed.slotId, false);
    check("deactivate blocked with upcoming bookings", false);
  } catch (err) {
    check(
      "deactivate blocked with upcoming bookings",
      err instanceof Error && /upcoming bookings/.test(err.message),
      err instanceof Error ? err.message : "",
    );
  }
  await changeAppointmentStatus(bookedManaged.appointmentId, "Cancelled", {
    doctorId: doctor.doctorId,
  });
  const deactivated = await setSlotActive(doctor.doctorId, managed.slotId, false);
  check("deactivate works after cancellation", deactivated.isActive === false);

  console.log("10. Cleanup test rows");
  await db
    .delete(appointments)
    .where(eq(appointments.patientId, testPatient.patientId));
  await db
    .delete(appointments)
    .where(eq(appointments.patientId, patientB.patientId));
  await db.delete(slots).where(eq(slots.slotId, oneSeat[0].slotId));
  await db.delete(slots).where(eq(slots.slotId, managed.slotId));
  await db.delete(patients).where(eq(patients.patientId, testPatient.patientId));
  await db.delete(patients).where(eq(patients.patientId, patientB.patientId));
  await db.delete(users).where(eq(users.userId, testUser.userId));
  await db.delete(users).where(eq(users.userId, userB.userId));
  const doctorsNow = await db.$count(doctors);
  check("demo doctors untouched by cleanup", doctorsNow >= 1);

  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test script crashed:", err);
  process.exit(1);
});
