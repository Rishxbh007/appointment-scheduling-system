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

## Sign-in options

- Email + password (always available).
- Continue with Google, GitHub and Microsoft — server-side OAuth
  code flows, no client secrets in browser code. First-time OAuth
  users pick a role (patient or doctor) before any account is
  created. If the OAuth email already belongs to another account,
  sign-in is refused with a clear error and the account is never
  linked or taken over.
- NOT built, on purpose: Apple sign-in (needs a paid Apple
  Developer account) and phone/OTP sign-in (needs a paid SMS
  provider). There is no forgot-password email reset (needs an
  email sending service).

Demo accounts still work in the database, but their credentials are
deliberately NOT shown anywhere on the sign-in or register pages —
anyone testing types them in by hand.

## Set up OAuth (user creates the three OAuth apps himself)

Set `NEXT_PUBLIC_APP_URL` to the production URL (no trailing
slash, e.g. `https://carebook-pearl.vercel.app`), then register
these exact redirect URIs:

- Google (Google Cloud Console → APIs & Services → Credentials →
  Create OAuth client ID → Web application; also add the app's
  domain to Authorized JavaScript origins if asked):
  `https://carebook-pearl.vercel.app/api/auth/google/callback`
- GitHub (GitHub → Settings → Developer settings → OAuth Apps →
  New OAuth App; Authorization callback URL):
  `https://carebook-pearl.vercel.app/api/auth/github/callback`
- Microsoft (Microsoft Entra admin center → App registrations →
  New registration; Supported account types: "Accounts in any
  organizational directory (Any Microsoft Entra ID tenant -
  Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)";
  platform Web; API permissions: openid, profile, email, User.Read):
  `https://carebook-pearl.vercel.app/api/auth/microsoft/callback`

Then set in Vercel (Project → Settings → Environment Variables):
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`,
`MICROSOFT_CLIENT_SECRET`, plus `NEXT_PUBLIC_APP_URL`. Leave any
provider's pair blank and its button shows "isn't configured yet"
instead of breaking. Redeploy after adding variables, then re-test
sign-in with each provider.

## Deploy (Vercel + Neon)

1. Create a Neon Postgres database, copy its connection string.
2. In Vercel, import this project and set environment variables:
   - `DATABASE_URL` — the Neon connection string (with
     `?sslmode=require`)
   - `JWT_SECRET` — a long random string
   - `NEXT_PUBLIC_APP_URL` — the production URL, no trailing slash
   - The six OAuth variables above (optional per provider)
3. Deploy. Tables, the double-booking index, and demo seed data are
   created automatically on first use — no manual migration step.
