// SMS send-time phone normalization (Day 5 follow-up). The
// provider needs E.164 digits, so a stored national-format
// number must be normalized before it reaches the provider —
// at send time, so cron retries of already-stored rows benefit
// too. Run with the rest of the suite: npm test.

import test from "node:test";
import assert from "node:assert/strict";
import { getSmsProvider, isSmsConfigured, normalizePhoneE164 } from "../sms";

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

test("normalizePhoneE164: anything else passes through for the provider to reject honestly", () => {
  assert.equal(normalizePhoneE164("123"), "123");
  assert.equal(normalizePhoneE164(""), "");
});

// The Vonage provider is tested the same way: stubbed fetch,
// no real HTTP, no credentials. Env is saved and restored
// per test so the suite stays hermetic.

async function captureVonageSend(
  env: Record<string, string | undefined>,
  message: { to: string; text: string },
  stubResponse: unknown,
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
    return { ok: true, json: async () => stubResponse };
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

const VONAGE_ENV = {
  SMS_PROVIDER: "vonage",
  VONAGE_API_KEY: "keytest",
  VONAGE_API_SECRET: "secrettest",
  VONAGE_FROM_NUMBER: "CareBook",
};

test("vonage provider: custom body sent, To digits-only E.164, message-id returned", async () => {
  const { params, ref } = await captureVonageSend(
    VONAGE_ENV,
    { to: "7416931585", text: "CareBook: appointment with Dr. Naman on 2 Nov, 10:00 AM" },
    { messages: [{ status: "0", "message-id": "1700000012345678" }] },
  );
  assert.equal(ref, "1700000012345678");
  assert.equal(params.get("to"), "917416931585");
  assert.equal(params.get("from"), "CareBook");
  assert.equal(
    params.get("text"),
    "CareBook: appointment with Dr. Naman on 2 Nov, 10:00 AM",
  );
});

test("vonage provider: non-zero status throws Vonage's own error text", async () => {
  const savedEnv: Record<string, string | undefined> = {};
  for (const key of Object.keys(VONAGE_ENV)) {
    savedEnv[key] = process.env[key];
    process.env[key] = VONAGE_ENV[key as keyof typeof VONAGE_ENV];
  }
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({
      messages: [{ status: "29", "error-text": "Non-Whitelisted Destination" }],
    }),
  })) as unknown as typeof fetch;
  try {
    const provider = getSmsProvider();
    assert.ok(provider);
    await assert.rejects(
      provider.send({ to: "7416931585", text: "hello" }),
      /Non-Whitelisted Destination \(status 29\)/,
    );
  } finally {
    globalThis.fetch = realFetch;
    for (const key of Object.keys(VONAGE_ENV)) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
});

test("vonage provider: missing credentials mean no provider, never a fake send", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const keys = [
    "SMS_PROVIDER",
    "VONAGE_API_KEY",
    "VONAGE_API_SECRET",
    "VONAGE_FROM_NUMBER",
  ];
  for (const key of keys) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.SMS_PROVIDER = "vonage";
  try {
    assert.equal(getSmsProvider(), null);
    assert.equal(isSmsConfigured(), false);
  } finally {
    for (const key of keys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
});
