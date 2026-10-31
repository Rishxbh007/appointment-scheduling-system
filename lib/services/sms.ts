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
//   * anything else — not implemented, so getSmsProvider()
//     returns null and sendSms() throws "SMS provider '<name>'
//     is not configured". A misconfigured env fails loudly
//     instead of fake-sending.
//
// Adding a real provider (Twilio, MSG91, …) means writing one
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
  return getSmsProviderName() === "log";
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

/** The active provider, or null when none is implemented/configured. */
export function getSmsProvider(): SmsProvider | null {
  if (getSmsProviderName() === "log") return loggedProvider();
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
    throw new Error(
      `SMS provider '${getSmsProviderName()}' is not configured`,
    );
  }
  return provider.send(message);
}
