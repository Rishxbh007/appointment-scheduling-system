// SMS send-time phone normalization (Day 5 follow-up). Twilio
// rejects any To that is not E.164, so a stored national-format
// number must be normalized before it reaches the provider —
// at send time, so cron retries of already-stored rows benefit
// too. Run with the rest of the suite: npm test.

import test from "node:test";
import assert from "node:assert/strict";
import { normalizePhoneE164 } from "../sms";

test("normalizePhoneE164: Indian 10-digit mobile gets +91", () => {
  assert.equal(normalizePhoneE164("7416931585"), "+917416931585");
  assert.equal(normalizePhoneE164("98765 43210"), "+919876543210");
});

test("normalizePhoneE164: 12-digit number starting with 91 gets +", () => {
  assert.equal(normalizePhoneE164("917416931585"), "+917416931585");
});

test("normalizePhoneE164: existing + is kept, formatting stripped", () => {
  assert.equal(normalizePhoneE164("+91 74169 31585"), "+917416931585");
  assert.equal(normalizePhoneE164("+15551234567"), "+15551234567");
});

test("normalizePhoneE164: anything else passes through for Twilio to reject honestly", () => {
  assert.equal(normalizePhoneE164("123"), "123");
  assert.equal(normalizePhoneE164(""), "");
});
