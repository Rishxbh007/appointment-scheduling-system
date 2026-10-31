// Outgoing mail — Day 4 Stage C. ONE swappable module: every
// caller in the app sends through sendMail() here, and no caller
// knows which provider sits behind it.
//
// Provider interface: a provider sends one message and throws on
// failure, so the notifications service can record the outcome
// honestly (Sent vs Failed with the real reason). Swapping the
// provider later — e.g. Resend once the clinic has a verified
// domain — means writing one new provider here and pointing
// getProvider() at it. No caller changes.
//
// Today's provider is Gmail SMTP via nodemailer (host
// smtp.gmail.com, port 587 STARTTLS, SMTP_USER/SMTP_PASS from
// env). SMTP_PASS is a Gmail app password (Google Account ->
// Security -> 2-Step Verification -> App passwords), never the
// account password. Without SMTP_USER/SMTP_PASS the provider is
// absent and isEmailConfigured() is false: notifications are
// recorded as Failed with "email not configured", never
// fake-sent.
//
// Future SMS/WhatsApp design (no code for them yet): the
// notifications table already carries a channel column, and this
// module is the extension point. A future 'sms' provider would be
// a second implementation of the same shape — e.g. sendSms({ to,
// text }) backed by an SMS gateway — with the notifications
// service choosing the provider by the row's channel instead of
// always using sendMail(). Event code that calls
// sendEventEmail() would not change: it hands over an event and
// a recipient, and the service decides the channel. WhatsApp
// plugs in the same way as a third provider.

import nodemailer from "nodemailer";

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
};

export type MailProvider = {
  /** Sends one message; resolves to the provider's message id (if any). */
  send(message: MailMessage): Promise<string | null>;
};

/** True when the Gmail SMTP credentials are present. */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

function gmailProvider(): MailProvider {
  return {
    async send(message: MailMessage): Promise<string | null> {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST ?? "smtp.gmail.com",
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
      const info = await transporter.sendMail({
        from: process.env.EMAIL_FROM ?? process.env.SMTP_USER,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
      return typeof info?.messageId === "string" ? info.messageId : null;
    },
  };
}

/** The active provider, or null when mail is not configured. */
export function getProvider(): MailProvider | null {
  if (!isEmailConfigured()) return null;
  return gmailProvider();
}

/**
 * Send one message through the active provider. Resolves to the
 * provider's message id (or null). Throws when mail is not
 * configured or the provider fails, so callers record the real
 * outcome instead of assuming delivery.
 */
export async function sendMail(message: MailMessage): Promise<string | null> {
  const provider = getProvider();
  if (!provider) throw new Error("email not configured");
  return provider.send(message);
}
