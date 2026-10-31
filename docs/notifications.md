# CareBook notifications — Day 5

Reliable email and SMS notifications for appointment events,
payment outcomes, and upcoming consultations. This doc is the
operator guide: what sends, through which channel, how failures
are handled, and how to add a real SMS provider.

## What exists

| Piece | Where |
|---|---|
| Outbox table (one row per attempt) | `notifications` in `lib/db/schema.ts`, DDL in `lib/db/index.ts` |
| Patient SMS opt-in | `notification_preferences` in `lib/db/schema.ts` |
| Event + reminder logic, dispatcher, retry | `lib/services/notifications.ts` |
| Email provider (Gmail SMTP) | `lib/services/mailer.ts` |
| SMS providers (logged driver + Twilio) | `lib/services/sms.ts` |
| Reminder creation (booking) + reschedule shift | `lib/services/booking.ts` |
| Cancel/sweep reminder cleanup | `lib/services/booking.ts`, `lib/services/payments.ts` |
| Preferences action + form | `lib/actions/notifications.ts`, `components/notification-preferences-form.tsx` |
| Notifications page (history + preferences) | `app/dashboard/notifications/page.tsx` |
| Header bell → notifications page | `components/site-header.tsx` |
| First-visit consent banner | `components/notification-consent-banner.tsx` |
| Cron (due reminders + outbox retries + sweep) | `app/api/cron/reminders/route.ts` |
| Tests | `lib/services/__tests__/day5-notifications.test.ts` (`npm test`) |

## Events and channels

Email is always on (operational). SMS is patient-only, and only
for patients who opted in **and** have a phone number on file.
Doctors stay email-only. No event ever notifies the patient
twice on the same channel.

| Event | Patient email | Patient SMS (if opted in) | Doctor email |
|---|---|---|---|
| booking_created | yes | yes | yes |
| booking_cancelled | yes | yes | yes |
| booking_rescheduled | yes | yes | yes |
| payment_succeeded | yes | yes | no |
| payment_failed | yes | yes | no |
| refund_initiated | yes | yes | no |
| refund_processed | yes | yes | no |
| refund_failed | yes | yes | no |
| reminder | yes | yes | no |

Triggers live in the existing call sites (`lib/actions/booking.ts`,
`lib/actions/payments.ts`, the payments webhook). They all go
through `sendEventEmail`, which now also sends the patient SMS
when opted in. No new trigger code was needed for payments or
refunds — the webhook path gains SMS automatically.

## The outbox

Every notification attempt is a `notifications` row — never a
silent send. The row carries: appointment, channel, event,
recipient (email and/or phone), subject, body, status, scheduled
time (reminders only), sent time, failure reason, dedup key,
provider reference, attempt count, next attempt time, and (for
reminders) the interval in hours.

**Statuses:** `Pending` (waiting or mid-attempt), `Sent`,
`Failed` (with the real reason), `Cancelled` (a reminder killed
by a cancel/complete/opt-out, so it can never send).

**Dedup.** The dedup key is `event:appointment:channel:recipient`
for event rows, plus the scheduled instant for reminders. A
repeat trigger collides on the key and sends nothing — so a
double-fired `booking_created` (free + paid paths) can never
mail the patient twice, and two reminder intervals for one
appointment are distinct rows. Rescheduling recomputes each
Pending reminder's key from its new instant.

**Provider failure never breaks booking.** Sending is
best-effort: `sendEventEmail` catches everything and records
the outcome. A booking, cancel, reschedule, payment, or refund
succeeds or fails on its own merits, never on the notification.

## Retries

- Max attempts per row: `NOTIFICATION_MAX_ATTEMPTS` (default 3).
- Delay: `NOTIFICATION_RETRY_DELAY_MINUTES` (default 30) times
  the attempt number — 30, 60, 90 minutes by default.
- The cron (`GET /api/cron/reminders`) claims retryable Failed
  rows (attempts left, next attempt due) with a guarded
  Failed→Pending flip and re-attempts them. Reminder rows get
  the same eligibility guard as due reminders: a reminder for a
  dead or past appointment is cancelled, never retried.
- Two terminal states are never auto-retried: exhausted rows
  (attempts used up, no next attempt) and rows parked as
  "sent but status could not be recorded" — the provider
  accepted the message but the DB would not record it, so
  auto-retrying would double-send. That reason text says
  exactly what happened; check provider logs before resending
  by hand.

## Reminders

- Intervals: `REMINDER_INTERVALS_HOURS` (default `"24"`).
  Example `"24,1"` sends a day-before and an hour-before
  reminder. Only whole hours 1–168 count; anything else is
  ignored, and an empty value falls back to 24.
- One row per interval per channel, created at booking time
  (free and Pending-hold bookings alike). Email always; SMS
  only when opted in with a phone on file.
- Rescheduling moves every Pending reminder: new start minus
  its own interval, dedup key recomputed. Legacy rows without
  an interval fall back to 24 hours.
- Cancelling or completing an appointment cancels its Pending
  reminders (all channels). The sweep does the same for
  expired holds. System cancellations send no mail.
- The cron sends only for appointments still Booked/Confirmed
  whose slot is still in the future. Unpaid Pending holds are
  skipped (their reminders wait until paid, or die with the
  hold).
- **Delivery timing, stated honestly:** Vercel's Hobby cron
  runs at most once a day, and the firing time is only
  guaranteed within the hour — so exact 24-hours-before
  delivery is impossible on Hobby alone. What the endpoint
  guarantees instead: at most once, only while the appointment
  is live, never for dead bookings. An external scheduler
  calling the endpoint hourly tightens delivery toward the
  true mark; the endpoint itself needs no change for that.
  The endpoint is guarded by `CRON_SECRET`.

## SMS provider setup

**Today: the logged driver.** `SMS_PROVIDER=log` (the default)
writes each SMS to the server log and records a `log-<time>`
reference on the row. The clinic has no SMS provider account
yet, so nothing is delivered to a handset, and nothing
pretends otherwise. The outbox row is still created and
audited, and the log line is the delivery record. Rows with a
`log-` reference are exactly the rows that were log-only.

**Real SMS via Twilio (implemented, inactive until credentials exist).**
`SMS_PROVIDER=twilio` selects the Twilio provider in
`lib/services/sms.ts` (Messages API over HTTPS, no SDK). It
needs three env vars — same names locally and in Vercel:
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_FROM_NUMBER` (the Twilio number). With any of them
missing, sending throws "not configured" instead of
fake-sending.

Free-trial checklist (no card to sign up, 100 free SMS, 30 days):
1. Sign up at Twilio and verify your own phone number (the
   sign-up number is auto-verified).
2. Get a trial number from the console.
3. Copy the Account SID + Auth Token + trial number into
   `.env.local` AND Vercel (same names), and set
   `SMS_PROVIDER=twilio`.
4. On the dashboard, save the same phone number and turn SMS
   on (the consent banner asks on first visit).
5. Make a test booking: the SMS rows on the notifications page
   will carry Twilio SIDs instead of `log-` references.

Trial limits, honestly: texts can only go to numbers verified
on the account (up to 5), texts are restricted to the sign-up
country, trial texts begin with "Sent from a Twilio trial
account", and the trial expires after 30 days. Upgrading
removes all of these.

**Adding another provider (MSG91, …)** — same pattern: one new
provider in `lib/services/sms.ts` with the same `{ send }`
shape, credentials from env, pointed at by `getSmsProvider()`.
No caller changes.

A `SMS_PROVIDER` value with no implementation returns null,
and sending throws "SMS provider '<name>' is not configured"
— a misconfigured env fails loudly, never fake-sends.

## Notifications page + consent banner

- **Bell, top-right of every page** (signed-in users): links
  to `/dashboard/notifications`. The pill nav keeps its three
  tabs; the bell sits beside Sign out, like other apps.
- **The page** (`/dashboard/notifications`): the patient's SMS
  preferences form on top, then the full history — every real
  email + SMS about their appointments, newest first, with
  channel, status, subject, body, and time. Doctors see the
  rows addressed to them (email only) plus a note that SMS is
  patient-only. Nothing on the page is a demo entry.
- **Consent banner**: on the patient's first dashboard visit
  (no preferences row yet), a banner at the top asks "Can we
  send you SMS updates?" with a phone field and Allow SMS /
  Email only. Either answer records a row, so it never asks
  again; the choice can still be changed on the notifications
  page. The old preferences card at the bottom of the
  dashboard is gone — it moved onto the notifications page.
- **Honest labels**: a log-driver SMS row reads "Logged", not
  "Sent" — "Sent" is reserved for rows a real provider
  accepted. While SMS is in log-only mode the page also shows
  a notice saying so, so a "Logged" row is never mistaken for
  a delivered text.

## Preferences

- SMS is **off by default**. The notifications page has the
  SMS preferences form: a phone-number field + an SMS opt-in
  checkbox. The dashboard asks once, up front, via the consent
  banner (see above).
- Turning SMS on requires a phone number (there is nothing to
  text otherwise). Turning it off cancels the patient's
  Pending SMS reminders at once.
- Turning it on does **not** backfill SMS reminders for
  bookings made before the opt-in — same rule as email
  reminders (created only at booking time).
- Operational email is always on and is not gated by this
  table. There are no promotional messages at all, so there
  is nothing else to opt out of.

## Content rule

No notification — email or SMS, patient or doctor — ever
carries the visit reason or any other medical detail. The
reason lives on the appointment record and the dashboard,
where it belongs. Notifications carry only who, when, and
what changed (plus the money line for payment/refund events).
Refund wording stays patient-only. The automated tests assert
this: no template output contains the word "reason".

## Doctor leave / session cancellation

Covered by the existing doctor-cancel flow: when a doctor
cancels, the affected appointments get `booking_cancelled`
notifications (patient email + SMS if opted in, doctor email)
and their Pending reminders are cancelled. There is no
separate leave-management UI — that was the agreed Day 5
scope cut. If PearlThoughts asks for dedicated leave
management later, it builds on this same event + reminder
machinery.

## Monitoring

- **Cron response** (`GET /api/cron/reminders`, guarded by
  `CRON_SECRET`): `reminders` (sent/skipped/failed/cancelled)
  and `outboxRetries` (claimed/sent/failed/cancelled) counts
  per run.
- **Audit table queries** (Postgres):
  - Failed rows awaiting retry:
    `SELECT * FROM notifications WHERE status = 'Failed'
    AND next_attempt_at IS NOT NULL ORDER BY next_attempt_at;`
  - Exhausted failures (need a human look):
    `SELECT * FROM notifications WHERE status = 'Failed'
    AND next_attempt_at IS NULL;`
  - Log-only SMS rows (logged driver, not delivered):
    `SELECT * FROM notifications WHERE channel = 'sms'
    AND provider_ref LIKE 'log-%';`
  - A patient's notification history:
    `SELECT * FROM notifications WHERE appointment_id IN
    (SELECT appointment_id FROM appointments JOIN patients
    USING (patient_id) WHERE user_id = <id>)
    ORDER BY created_at DESC;`
- **Server logs:** dedup skips, insert failures, and every
  logged-driver SMS (with its reference) are written to the
  server log. A notification failure is never silent.

## Tests

`npm test` runs the Day 5 suite (Node's test runner via tsx,
no new framework, no database needed — the tested functions
are pure):

- reminder interval parsing (defaults, invalid values, dedup)
- reminder scheduling math (IST slot → UTC instant, per interval)
- dedup keys (recipient, channel, scheduled instant)
- retry delay / attempt limits / next-attempt math
- reschedule recompute (new start minus interval)
- template audit (every event + doctor copy + SMS: non-empty,
  no "reason", SMS short and doctor + when present)
