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
//   * "vonage" — real SMS via Vonage's SMS API (plain
//     HTTPS, no SDK). Needs VONAGE_API_KEY, VONAGE_API_SECRET,
//     and VONAGE_FROM_NUMBER (an alphanumeric sender like
//     CareBook, or a Vonage virtual number) in env. Missing
//     credentials mean no provider: sending throws loudly
//     instead of fake-sending. A Vonage free trial works for
//     this — no card to sign up, about €2 credit — and it
//     accepts a CUSTOM body, so CareBook's
//     real details go out, with trial limits: trial texts get
//     a demo tag attached, and trial sends only go to numbers
//     verified on the account (status 29 otherwise — the
//     sign-up number is the natural test target). The To
//     number is normalized to E.164 and the leading + stripped
//     at send time (Vonage's examples use digits-only
//     international format). See docs/notifications.md.
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
  if (name === "vonage") return isVonageConfigured();
  return false;
}

function isVonageConfigured(): boolean {
  return Boolean(
    process.env.VONAGE_API_KEY &&
      process.env.VONAGE_API_SECRET &&
      process.env.VONAGE_FROM_NUMBER,
  );
}

/**
 * Normalize a stored phone number to E.164 (Vonage takes
 * the same digits without the +). Indian 10-digit mobiles — this clinic's
 * patients — get +91; a 12-digit number starting with 91 gets
 * +; an existing + is kept with formatting stripped. Anything
 * else passes through unchanged so Vonage's own error names
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
 * Vonage's SMS API over plain HTTPS (no SDK to install):
 * POST form-encoded from/to/text with Basic auth
 * (key:secret). The API answers 200 with one message object
 * per message; status "0" means accepted for delivery and
 * carries message-id, anything else carries error-text
 * (status 29 = demo-mode whitelist: a trial only sends to
 * verified numbers). Resolves to Vonage's message-id;
 * throws with Vonage's own error text on failure, so the
 * outbox records the real reason. The To number is
 * normalized to E.164 and the leading + stripped (Vonage's
 * examples use digits-only international format). Trial
 * caveats: trial texts carry a demo tag, and only verified
 * numbers receive them — the sign-up number is the test
 * target. No template restriction: the custom CareBook body
 * goes out as written.
 */
function vonageProvider(): SmsProvider {
  return {
    async send(message: SmsMessage): Promise<string> {
      const key = process.env.VONAGE_API_KEY!;
      const secret = process.env.VONAGE_API_SECRET!;
      const from = process.env.VONAGE_FROM_NUMBER!;
      const to = normalizePhoneE164(message.to).replace(/^\+/, "");
      const res = await fetch("https://rest.nexmo.com/sms/json", {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ from, to, text: message.text }),
      });
      const data = (await res.json().catch(() => null)) as {
        messages?: {
          status?: string;
          "message-id"?: string;
          "error-text"?: string;
        }[];
      } | null;
      const msg = data?.messages?.[0];
      if (!res.ok || !msg) {
        throw new Error(`Vonage request failed (${res.status})`);
      }
      if (msg.status !== "0") {
        throw new Error(
          msg["error-text"]
            ? `Vonage: ${msg["error-text"]} (status ${msg.status})`
            : `Vonage request failed (status ${msg.status})`,
        );
      }
      if (!msg["message-id"]) {
        throw new Error("Vonage response had no message-id");
      }
      return msg["message-id"];
    },
  };
}

/** The active provider, or null when none is implemented/configured. */
export function getSmsProvider(): SmsProvider | null {
  const name = getSmsProviderName();
  if (name === "log") return loggedProvider();
  if (name === "vonage") return isVonageConfigured() ? vonageProvider() : null;
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
    if (getSmsProviderName() === "vonage") {
      throw new Error(
        "SMS provider 'vonage' is not configured (set VONAGE_API_KEY, VONAGE_API_SECRET, VONAGE_FROM_NUMBER)",
      );
    }
    throw new Error(
      `SMS provider '${getSmsProviderName()}' is not configured`,
    );
  }
  return provider.send(message);
}
