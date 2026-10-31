// Outgoing SMS — Day 5. The same shape as the mail provider in
// lib/services/mailer.ts: a provider sends one message and
// throws on failure, returning its own reference on success, so
// the notifications service can record the outcome honestly
// (Sent + provider_ref, or Failed + real reason). The
// notifications service chooses the provider by the row's
// channel; event code never knows which provider sits behind it.
//
// Provider selection (SMS_PROVIDER env, default "log"):
//   * "log" — the logged driver. It writes the message to the
//     server log and returns a log reference. This is the
//     honest no-account state: the clinic has no SMS provider
//     account yet, so nothing is delivered to a handset, and
//     nothing pretends otherwise. The outbox row is still
//     created, still audited, and the log line is the delivery
//     record. When a real provider account exists, the row's
//     provider_ref tells you exactly which rows were log-only.
//   * "twilio" — real SMS via Twilio's Messages API (plain
//     HTTPS, no SDK). Needs TWILIO_ACCOUNT_SID,
//     TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER (the Twilio
//     number) in env. Missing credentials mean no provider:
//     sending throws loudly instead of fake-sending. A Twilio
//     free trial works for this — no card to sign up, 100 free
//     SMS, 30 days — with trial limits: texts can only go to
//     numbers verified on the account (up to 5; the sign-up
//     number is auto-verified), texts are restricted to the
//     sign-up country, and trial texts begin with "Sent from a
//     Twilio trial account". The 100-free-message trial goes
//     further: its Messages API only accepts E.164 recipients
//     AND a body that is one of Twilio's own templates
//     (sms_appointment_reminders, sms_2fa, …) — a custom body
//     like CareBook's is rejected as a disallowed parameter,
//     which is exactly the 31 Oct live failure. Upgrading the
//     Twilio account removes that limit; until then, no
//     CareBook-detail text can be delivered on that trial —
//     only a template body, via TWILIO_TRIAL_TEMPLATE (see
//     twilioProvider), which delivers Twilio's generic
//     template text and proves delivery without the details.
//     The To number is normalized to E.164 at send time (see
//     normalizePhoneE164) so a stored national-format number
//     still sends. See docs/notifications.md for the setup
//     checklist.
//   * anything else — not implemented, so getSmsProvider()
//     returns null and sendSms() throws "SMS provider '<name>'
//     is not configured". A misconfigured env fails loudly
//     instead of fake-sending.
//
// Adding another real provider (MSG91, …) means writing one
// new provider here — same { send } shape, credentials from
// env — and pointing getSmsProvider() at it. No caller changes:
// the notifications service, the cron, and the preferences UI
// all keep working through the same interface. See
// docs/notifications.md for the setup checklist.

export type SmsMessage = {
  to: string;
  text: string;
};

export type SmsProvider = {
  /** Sends one message; resolves to the provider's reference. */
  send(message: SmsMessage): Promise<string>;
};

export function getSmsProviderName(): string {
  return process.env.SMS_PROVIDER ?? "log";
}

/** True when a provider implementation exists for the configured name. */
export function isSmsConfigured(): boolean {
  const name = getSmsProviderName();
  if (name === "log") return true;
  if (name === "twilio") return isTwilioConfigured();
  return false;
}

function isTwilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER,
  );
}

/**
 * Normalize a stored phone number to E.164 for Twilio, which
 * rejects anything else (its To parameter must be + followed
 * by country code and subscriber number, no spaces or
 * punctuation). Indian 10-digit mobiles — this clinic's
 * patients — get +91; a 12-digit number starting with 91 gets
 * +; an existing + is kept with formatting stripped. Anything
 * else passes through unchanged so Twilio's own error names
 * the problem instead of a guess. Applied at SEND time, not
 * at save time, so it also fixes cron retries of rows that
 * were stored before this existed.
 */
export function normalizePhoneE164(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) return trimmed.replace(/[\s()\-]/g, "");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return trimmed;
}

function loggedProvider(): SmsProvider {
  return {
    async send(message: SmsMessage): Promise<string> {
      const ref = `log-${Date.now()}`;
      console.log(
        `[sms:log ref=${ref}] to=${message.to} text=${message.text}`,
      );
      return ref;
    },
  };
}

/**
 * Twilio's Messages API over plain HTTPS (no SDK to install):
 * POST the form-encoded message with Basic auth (SID:token).
 * Resolves to Twilio's message SID; throws with Twilio's own
 * error message on failure, so the outbox records the real
 * reason instead of a generic one. The To number is normalized
 * to E.164 (see normalizePhoneE164). TWILIO_TRIAL_TEMPLATE,
 * when set, replaces the custom body with a Twilio template
 * name (e.g. sms_appointment_reminders): the 100-free-message
 * trial rejects any other body as a disallowed parameter, so
 * trial delivery is only possible with a template body — and
 * the delivered text is then Twilio's generic template text,
 * not CareBook's details. Leave the var unset on a full
 * (upgraded) account, where custom bodies are allowed.
 */
function twilioProvider(): SmsProvider {
  return {
    async send(message: SmsMessage): Promise<string> {
      const sid = process.env.TWILIO_ACCOUNT_SID!;
      const token = process.env.TWILIO_AUTH_TOKEN!;
      const from = process.env.TWILIO_FROM_NUMBER!;
      const template = process.env.TWILIO_TRIAL_TEMPLATE?.trim();
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: normalizePhoneE164(message.to),
            From: from,
            Body: template ? template : message.text,
          }),
        },
      );
      const data = (await res.json().catch(() => null)) as {
        sid?: string;
        message?: string;
      } | null;
      if (!res.ok) {
        throw new Error(
          data?.message
            ? `Twilio: ${data.message}`
            : `Twilio request failed (${res.status})`,
        );
      }
      if (!data?.sid) throw new Error("Twilio response had no message SID");
      return data.sid;
    },
  };
}

/** The active provider, or null when none is implemented/configured. */
export function getSmsProvider(): SmsProvider | null {
  const name = getSmsProviderName();
  if (name === "log") return loggedProvider();
  if (name === "twilio") return isTwilioConfigured() ? twilioProvider() : null;
  return null;
}

/**
 * Send one SMS through the active provider. Resolves to the
 * provider reference. Throws when no provider is configured or
 * the provider fails, so callers record the real outcome
 * instead of assuming delivery.
 */
export async function sendSms(message: SmsMessage): Promise<string> {
  const provider = getSmsProvider();
  if (!provider) {
    if (getSmsProviderName() === "twilio") {
      throw new Error(
        "SMS provider 'twilio' is not configured (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER)",
      );
    }
    throw new Error(
      `SMS provider '${getSmsProviderName()}' is not configured`,
    );
  }
  return provider.send(message);
}
