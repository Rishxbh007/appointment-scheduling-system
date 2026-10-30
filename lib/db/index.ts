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
  // Doctor payout details (weekly settlement). Additive only, so
  // databases created before this change pick the columns up
  // without a migration step — same pattern as expires_at above.
  // All four start NULL: a doctor may pay out via UPI, via bank
  // transfer, or both, and at least one complete method is
  // enforced in lib/services/payouts.ts, not here.
  `ALTER TABLE doctors ADD COLUMN IF NOT EXISTS payout_upi_id VARCHAR(100)`,
  `ALTER TABLE doctors ADD COLUMN IF NOT EXISTS payout_account_number VARCHAR(20)`,
  `ALTER TABLE doctors ADD COLUMN IF NOT EXISTS payout_ifsc VARCHAR(11)`,
  `ALTER TABLE doctors ADD COLUMN IF NOT EXISTS payout_account_holder VARCHAR(255)`,
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
    booked_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP
  )`,
  // Day 4 Stage A: databases created before Stage A already have
  // appointments without expires_at (CREATE TABLE IF NOT EXISTS
  // never alters), so add the column idempotently.
  `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP`,
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
  // Day 4 Stage A (Razorpay payments). One row per payment attempt;
  // the Razorpay ids start NULL and are filled in once Razorpay
  // answers. A booking's payment rows cascade with it.
  `CREATE TABLE IF NOT EXISTS payments (
    payment_id SERIAL PRIMARY KEY,
    appointment_id INTEGER NOT NULL REFERENCES appointments(appointment_id) ON DELETE CASCADE,
    razorpay_order_id VARCHAR(255) UNIQUE,
    razorpay_payment_id VARCHAR(255) UNIQUE,
    amount_paise INTEGER NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    status VARCHAR(20) NOT NULL DEFAULT 'Pending',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  // Day 4 Stage A webhook dedup: one row per delivered event.
  `CREATE TABLE IF NOT EXISTS webhook_events (
    event_id VARCHAR(255) PRIMARY KEY,
    type VARCHAR(100) NOT NULL,
    received_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  // Day 4 Stage B (refunds). One row per payment: the UNIQUE on
  // payment_id is the database-level duplicate guard, so a payment
  // can never be refunded twice even under a race. The gateway
  // refund id is UNIQUE when present; it starts NULL (keys absent
  // or provider failure means no gateway refund exists yet).
  `CREATE TABLE IF NOT EXISTS refunds (
    refund_id SERIAL PRIMARY KEY,
    payment_id INTEGER NOT NULL UNIQUE REFERENCES payments(payment_id) ON DELETE CASCADE,
    appointment_id INTEGER NOT NULL REFERENCES appointments(appointment_id) ON DELETE CASCADE,
    amount_paise INTEGER NOT NULL,
    reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'Initiated',
    gateway_refund_id VARCHAR(255) UNIQUE,
    failure_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  // Day 4 Stage C (notifications + reminders). The audit trail:
  // every email attempt is a row, and reminders are rows
  // scheduled at booking time. appointment_id is nullable in the
  // schema for future non-booking events, but every Stage C row
  // is booking-linked.
  `CREATE TABLE IF NOT EXISTS notifications (
    notification_id SERIAL PRIMARY KEY,
    appointment_id INTEGER REFERENCES appointments(appointment_id) ON DELETE CASCADE,
    channel VARCHAR(20) NOT NULL DEFAULT 'email',
    event VARCHAR(50) NOT NULL,
    recipient_email VARCHAR(255) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Pending',
    scheduled_at TIMESTAMP,
    sent_at TIMESTAMP,
    failure_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  // Double-booking guard (database level): the same patient can hold
  // at most one ACTIVE appointment on the same slot. Cancelled or
  // completed appointments do not count, so re-booking after a
  // cancellation still works. (The per-slot capacity limit,
  // max_appointments, is enforced in the booking transaction.)
  // Day 4 Stage A: Pending joins the guard — a booking on hold
  // awaiting payment holds its slot exactly like Booked/Confirmed,
  // so the same patient cannot hold two live bookings on one slot.
  // The old index is dropped and recreated so existing databases
  // pick up the wider predicate; expired Pending rows are lazily
  // cancelled by the booking path before insert, so a stale hold
  // can never block a fresh booking.
  `DROP INDEX IF EXISTS appointments_active_patient_slot_uidx`,
  `CREATE UNIQUE INDEX IF NOT EXISTS appointments_active_patient_slot_uidx
     ON appointments (patient_id, slot_id)
     WHERE status IN ('Pending', 'Booked', 'Confirmed')`,
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
