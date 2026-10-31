// SMS send-time phone normalization (Day 5 follow-up). Twilio
// rejects any To that is not E.164, so a stored national-format
// number must be normalized before it reaches the provider —
// at send time, so cron retries of already-stored rows benefit
// too. Run with the rest of the suite: npm test.

import test from "node:test";
import assert from "node:assert/strict";
import { getSmsProvider, normalizePhoneE164 } from "../sms";

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

// The Twilio provider is tested with a stubbed fetch: no real
// HTTP, no credentials. Env is saved and restored per test so
// the suite stays hermetic.

async function captureTwilioSend(
  env: Record<string, string | undefined>,
  message: { to: string; text: string },
): Promise<{ params: URLSearchParams; ref: string }> {
  const savedEnv: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    savedEnv[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  const realFetch = globalThis.fetch;
  let captured = "";
  globalThis.fetch = (async (_url: unknown, init: unknown) => {
    captured = String(
      (init as { body?: unknown } | undefined)?.body ?? "",
    );
    return { ok: true, json: async () => ({ sid: "SM123" }) };
  }) as typeof fetch;
  try {
    const provider = getSmsProvider();
    assert.ok(provider);
    const ref = await provider.send(message);
    return { params: new URLSearchParams(captured), ref };
  } finally {
    globalThis.fetch = realFetch;
    for (const key of Object.keys(env)) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
}

const TWILIO_ENV = {
  SMS_PROVIDER: "twilio",
  TWILIO_ACCOUNT_SID: "ACtest",
  TWILIO_AUTH_TOKEN: "tokentest",
  TWILIO_FROM_NUMBER: "+15551234567",
};

test("twilio provider: trial template var replaces the custom body", async () => {
  const { params, ref } = await captureTwilioSend(
    { ...TWILIO_ENV, TWILIO_TRIAL_TEMPLATE: "sms_appointment_reminders" },
    { to: "7416931585", text: "CareBook: payment received" },
  );
  assert.equal(ref, "SM123");
  assert.equal(params.get("To"), "+917416931585");
  assert.equal(params.get("Body"), "sms_appointment_reminders");
});

test("twilio provider: without the template var the custom body is sent", async () => {
  const { params } = await captureTwilioSend(
    { ...TWILIO_ENV, TWILIO_TRIAL_TEMPLATE: undefined },
    { to: "7416931585", text: "CareBook: payment received" },
  );
  assert.equal(params.get("To"), "+917416931585");
  assert.equal(params.get("Body"), "CareBook: payment received");
});
