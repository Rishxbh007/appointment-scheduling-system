// Database connection + first-run setup.
//
// Production path: plain node-postgres against DATABASE_URL. That URL
// points at Neon on Vercel and at a local Postgres here — same driver,
// same SQL, no divergence between dev and deploy.
//
// First-run setup (ensureDb) is idempotent: it creates the ER
// diagram tables if they are missing, plus the Stage 5 favorites
// table below, adds the double-booking guard index, and seeds demo
// data only when the users table is empty.
// Every server action and data page calls ensureDb() first, so the
// app works on a fresh database with no manual migration step.

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

function pool() {
  // Pool creation never connects, so importing this module is safe
  // even during `next build` (when no DATABASE_URL exists yet). The
  // fallback URL is never dialled in practice: ensureDb() below
  // throws a clear error when DATABASE_URL is unset, and every
  // action/page calls ensureDb() before any query.
  const url = process.env.DATABASE_URL ?? "postgres://127.0.0.1:1/unused";
  return new Pool({ connectionString: url });
}

// One pool per server process.
const client = pool();
export const db = drizzle(client, { schema });

// DDL mirrors lib/db/schema.ts exactly. Kept as plain SQL so a fresh
// database can be prepared without a separate migration runner; the
// same statements also work on Neon.
const DDL = [
  `CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(20),
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL,
    auth_provider VARCHAR(20) NOT NULL DEFAULT 'Email',
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS verification_tokens (
    token_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    is_used BOOLEAN NOT NULL DEFAULT FALSE
  )`,
  `CREATE TABLE IF NOT EXISTS patients (
    patient_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
    date_of_birth DATE,
    gender VARCHAR(20),
    address VARCHAR(500),
    emergency_contact VARCHAR(20)
  )`,
  `CREATE TABLE IF NOT EXISTS doctors (
    doctor_id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
    qualification VARCHAR(255),
    experience_years INTEGER,
    consultation_fee NUMERIC(10, 2),
    is_approved BOOLEAN NOT NULL DEFAULT FALSE
  )`,
  `CREATE TABLE IF NOT EXISTS specializations (
    specialization_id SERIAL PRIMARY KEY,
    doctor_id INTEGER NOT NULL REFERENCES doctors(doctor_id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS slots (
    slot_id SERIAL PRIMARY KEY,
    doctor_id INTEGER NOT NULL REFERENCES doctors(doctor_id) ON DELETE CASCADE,
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    max_appointments INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
  )`,
  `CREATE TABLE IF NOT EXISTS appointments (
    appointment_id SERIAL PRIMARY KEY,
    patient_id INTEGER NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
    doctor_id INTEGER NOT NULL REFERENCES doctors(doctor_id) ON DELETE CASCADE,
    slot_id INTEGER NOT NULL REFERENCES slots(slot_id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'Booked',
    reason TEXT,
    booked_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  // Stage 5 (favorite doctors). Additive only: no existing table is
  // touched. The composite primary key is the duplicate guard — the
  // same patient cannot save the same doctor twice, even under a
  // race. A favorite is only a bookmark, never a booking.
  `CREATE TABLE IF NOT EXISTS patient_favorite_doctors (
    patient_id INTEGER NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
    doctor_id INTEGER NOT NULL REFERENCES doctors(doctor_id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (patient_id, doctor_id)
  )`,
  // Double-booking guard (database level): the same patient can hold
  // at most one ACTIVE appointment on the same slot. Cancelled or
  // completed appointments do not count, so re-booking after a
  // cancellation still works. (The per-slot capacity limit,
  // max_appointments, is enforced in the booking transaction.)
  `CREATE UNIQUE INDEX IF NOT EXISTS appointments_active_patient_slot_uidx
     ON appointments (patient_id, slot_id)
     WHERE status IN ('Booked', 'Confirmed')`,
];

let ready: Promise<void> | null = null;

/** Create tables + guard index if missing, then seed demo data once. */
export function ensureDb(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      if (!process.env.DATABASE_URL) {
        throw new Error(
          "DATABASE_URL is not set. Copy .env.example to .env.local and " +
            "fill in your Postgres connection string (Neon on deploy, " +
            "local Postgres here).",
        );
      }
      for (const statement of DDL) {
        await db.execute(sql.raw(statement));
      }
      const { seedDemoData } = await import("./seed");
      await seedDemoData();
    })().catch((err) => {
      // Let the next call retry instead of caching a failure.
      ready = null;
      throw err;
    });
  }
  return ready;
}
