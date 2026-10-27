# CareBook — Appointment Booking Application

A working appointment booking app built for the PearlThoughts
internship (Schedule Project Module). Patients register, browse
doctors by specialization, and book real time slots. Doctors see
their appointments on a dashboard and confirm, cancel, or complete
them, and manage their own availability.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS + shadcn-style UI
- Backend: Next.js Server Actions, Zod validation
- Database: PostgreSQL + Drizzle ORM
- Auth: JWT in an HTTP-only cookie, bcrypt password hashes

## Data model (day-1 ER diagram)

`users`, `verification_tokens`, `patients`, `doctors`,
`specializations`, `slots`, `appointments` — exactly the ER diagram
from day 1. One profile per user (Patient OR Doctor, decided by
role). Time lives in `slots` (date, start/end time,
max_appointments, is_active); appointments carry status
(Booked / Confirmed / Cancelled / Completed). One documented
addition: appointments has a `reason` column, because the booking
reason must be saved and shown on the doctor's dashboard.
RescheduleHistory and Notifications are intentionally absent
(weeks 3–4 of the project plan).

Booking is guarded twice: the booking transaction locks the slot
row and checks capacity, and a partial unique index prevents the
same patient holding two active appointments on one slot. All
date/time logic uses Asia/Kolkata, so "today" is correct no matter
where the server runs.

## Run locally

```bash
npm install
cp .env.example .env.local   # then fill in DATABASE_URL + JWT_SECRET
npm run dev                  # http://localhost:3000
```

First run creates the tables and seeds demo data automatically
(demo doctors with a week of slots).

## Demo accounts

- Patient: `patient@demo.local` / `demo1234`
- Doctor: `doctor@demo.local` / `demo1234`

## Test the full flow

```bash
set -a; . ./.env.local; set +a; npx tsx scripts/test-flow.ts
```

Registers a test patient, books a slot, confirms it as the doctor,
checks the patient sees Confirmed, then checks the guard rails
(double booking, full slot, cancel) and cleans up its own rows.

## Deploy (Vercel + Neon)

1. Create a Neon Postgres database, copy its connection string.
2. In Vercel, import this project and set environment variables:
   - `DATABASE_URL` — the Neon connection string (with
     `?sslmode=require`)
   - `JWT_SECRET` — a long random string
3. Deploy. Tables, the double-booking index, and demo seed data are
   created automatically on first use — no manual migration step.
