// Day 5 notification tests. Pure functions only — no database,
// no providers — so they run anywhere with `npm test` (Node's
// test runner via tsx). They guard the behaviour Day 5 promises:
// interval parsing, scheduling math, dedup keys, retry policy,
// reschedule recompute, and the content rule (no visit reason
// or medical detail in any notification).

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDoctorEventContent,
  buildEventContent,
  buildReminderContent,
  buildSmsContent,
  buildSmsReminderContent,
  dedupKeyFor,
  nextAttemptAt,
  notificationEventLabel,
  parseReminderIntervals,
  reminderScheduledAt,
  reminderScheduledAtHours,
  retryDelayMs,
  shouldRetry,
  type AppointmentMailContext,
} from "../notifications";

const ctx: AppointmentMailContext = {
  appointmentId: 1,
  status: "Booked",
  patientUserId: 1,
  patientEmail: "patient@example.com",
  patientName: "Test Patient",
  patientPhone: "+91 98765 43210",
  doctorDisplayName: "Dr. Test",
  doctorEmail: "doctor@example.com",
  slotDate: "2026-11-02",
  slotStart: "09:00",
  slotEnd: "09:30",
};

const ALL_EVENTS = [
  "booking_created",
  "booking_cancelled",
  "booking_rescheduled",
  "payment_succeeded",
  "payment_failed",
  "refund_initiated",
  "refund_processed",
  "refund_failed",
];

test("reminder intervals: defaults, parsing, invalid values, dedup", () => {
  assert.deepEqual(parseReminderIntervals("24"), [24]);
  assert.deepEqual(parseReminderIntervals("24,1"), [24, 1]);
  assert.deepEqual(parseReminderIntervals("48, 24"), [48, 24]);
  assert.deepEqual(parseReminderIntervals(""), [24]);
  assert.deepEqual(parseReminderIntervals(undefined), [24]);
  assert.deepEqual(parseReminderIntervals(null), [24]);
  assert.deepEqual(parseReminderIntervals("abc,24"), [24]);
  assert.deepEqual(parseReminderIntervals("0,-5,24"), [24]);
  assert.deepEqual(parseReminderIntervals("24,24,1"), [24, 1]);
  assert.deepEqual(parseReminderIntervals("200"), [24]);
});

test("reminder scheduling: IST slot start minus the interval", () => {
  // 2 Nov 09:00 IST = 03:30 UTC.
  assert.equal(
    reminderScheduledAtHours("2026-11-02", "09:00", 24).toISOString(),
    "2026-11-01T03:30:00.000Z",
  );
  assert.equal(
    reminderScheduledAtHours("2026-11-02", "09:00", 1).toISOString(),
    "2026-11-02T02:30:00.000Z",
  );
  // The 24h helper is exactly the 24-hour interval.
  assert.equal(
    reminderScheduledAt("2026-11-02", "09:00").toISOString(),
    reminderScheduledAtHours("2026-11-02", "09:00", 24).toISOString(),
  );
});

test("reschedule recompute: new start minus the row's interval", () => {
  // Moved from 2 Nov 09:00 to 5 Nov 10:00; the 24h reminder moves
  // to 4 Nov 04:30 UTC (10:00 IST minus 24h).
  assert.equal(
    reminderScheduledAtHours("2026-11-05", "10:00", 24).toISOString(),
    "2026-11-04T04:30:00.000Z",
  );
});

test("dedup keys: recipient, channel, and scheduled instant matter", () => {
  const base = {
    event: "booking_created",
    appointmentId: 1,
    channel: "email",
    recipient: "patient@example.com",
  };
  assert.equal(dedupKeyFor(base), dedupKeyFor(base));
  assert.notEqual(
    dedupKeyFor(base),
    dedupKeyFor({ ...base, recipient: "doctor@example.com" }),
  );
  assert.notEqual(
    dedupKeyFor(base),
    dedupKeyFor({ ...base, channel: "sms" }),
  );
  assert.notEqual(
    dedupKeyFor(base),
    dedupKeyFor({ ...base, appointmentId: 2 }),
  );
  // Event rows ignore the scheduled instant.
  assert.equal(
    dedupKeyFor(base),
    dedupKeyFor({ ...base, scheduledAt: new Date() }),
  );
  // Reminder rows are distinct per scheduled instant.
  const reminder = {
    event: "reminder",
    appointmentId: 1,
    channel: "email",
    recipient: "patient@example.com",
  };
  const at24 = new Date("2026-11-01T03:30:00.000Z");
  const at1 = new Date("2026-11-02T02:30:00.000Z");
  assert.equal(
    dedupKeyFor({ ...reminder, scheduledAt: at24 }),
    dedupKeyFor({ ...reminder, scheduledAt: at24 }),
  );
  assert.notEqual(
    dedupKeyFor({ ...reminder, scheduledAt: at24 }),
    dedupKeyFor({ ...reminder, scheduledAt: at1 }),
  );
});

test("retry policy: linear delay, attempt limit, next attempt", () => {
  assert.equal(retryDelayMs(1, 30), 30 * 60 * 1000);
  assert.equal(retryDelayMs(2, 30), 60 * 60 * 1000);
  assert.equal(retryDelayMs(3, 30), 90 * 60 * 1000);
  assert.equal(shouldRetry(0, 3), true);
  assert.equal(shouldRetry(2, 3), true);
  assert.equal(shouldRetry(3, 3), false);
  const base = new Date("2026-10-31T00:00:00.000Z");
  assert.equal(
    nextAttemptAt(1, base).getTime() - base.getTime(),
    retryDelayMs(1),
  );
});

test("templates: every event renders, and none mentions a reason", () => {
  const extra = {
    amountPaise: 100000,
    previousLabel: "1 Nov at 9:00 AM",
    refundStatus: "Initiated" as const,
    refundAmountPaise: 100000,
  };
  for (const event of ALL_EVENTS) {
    const { subject, body } = buildEventContent(event, ctx, extra);
    assert.ok(subject.length > 0, `${event} subject`);
    assert.ok(body.length > 0, `${event} body`);
    assert.ok(!/reason/i.test(`${subject}\n${body}`), `${event} has no reason`);
  }
  for (const event of [
    "booking_created",
    "booking_cancelled",
    "booking_rescheduled",
  ]) {
    const { subject, body } = buildDoctorEventContent(event, ctx, extra);
    assert.ok(subject.length > 0, `doctor ${event} subject`);
    assert.ok(body.length > 0, `doctor ${event} body`);
    assert.ok(
      !/reason/i.test(`${subject}\n${body}`),
      `doctor ${event} has no reason`,
    );
  }
});

test("SMS content: short, doctor + when present, no reason", () => {
  for (const event of ALL_EVENTS) {
    const { body } = buildSmsContent(event, ctx, {
      amountPaise: 100000,
      refundStatus: "Initiated",
      refundAmountPaise: 100000,
    });
    assert.ok(body.length > 0, `sms ${event} body`);
    assert.ok(body.length < 300, `sms ${event} is short`);
    assert.ok(body.includes("Dr. Test"), `sms ${event} names the doctor`);
    assert.ok(!/reason/i.test(body), `sms ${event} has no reason`);
  }
  const smsReminder = buildSmsReminderContent(
    "Dr. Test",
    "2026-11-02",
    "09:00",
    "09:30",
  );
  assert.ok(smsReminder.body.includes("Dr. Test"));
  assert.ok(!/reason/i.test(smsReminder.body));
});

test("reminder subjects name the interval honestly", () => {
  assert.ok(
    buildReminderContent("Dr. Test", "2026-11-02", "09:00", "09:30", 24)
      .subject.includes("tomorrow"),
  );
  assert.ok(
    buildReminderContent("Dr. Test", "2026-11-02", "09:00", "09:30", 1)
      .subject.includes("in 1 hour"),
  );
  assert.ok(
    buildReminderContent("Dr. Test", "2026-11-02", "09:00", "09:30", 48)
      .subject.includes("in 48 hours"),
  );
});

test("notification event labels: plain words for every event", () => {
  assert.equal(notificationEventLabel("booking_created"), "Appointment confirmed");
  assert.equal(notificationEventLabel("booking_cancelled"), "Appointment cancelled");
  assert.equal(notificationEventLabel("booking_rescheduled"), "Appointment moved");
  assert.equal(notificationEventLabel("payment_succeeded"), "Payment received");
  assert.equal(notificationEventLabel("payment_failed"), "Payment failed");
  assert.equal(notificationEventLabel("refund_initiated"), "Refund initiated");
  assert.equal(notificationEventLabel("refund_processed"), "Refund processed");
  assert.equal(notificationEventLabel("refund_failed"), "Refund failed");
  assert.equal(notificationEventLabel("reminder"), "Appointment reminder");
  assert.equal(notificationEventLabel("something_new"), "Appointment update");
});
