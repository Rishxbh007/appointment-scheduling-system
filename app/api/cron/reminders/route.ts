// Daily reminder + sweep cron — Day 4 Stage C. Called by
// Vercel Cron (see vercel.json) and triggerable by any external
// scheduler later for exact timing: it is a plain GET endpoint
// guarded by CRON_SECRET, so a scheduler that can set an
// Authorization header can call it on any cadence without a code
// change.
//
// Delivery rule, stated honestly: Vercel's Hobby cron runs at
// most once a day, and the firing time is only guaranteed within
// the hour — so exact 24-hours-before delivery is impossible on
// Hobby alone. What this endpoint guarantees instead: a reminder
// is sent at most once (Pending→Sent under a status guard), only
// while its appointment is still Booked/Confirmed and its slot
// is still in the future, and never for a cancelled, completed,
// or past appointment. An external scheduler calling this
// endpoint hourly would tighten delivery toward the true 24h
// mark; the endpoint itself needs no change for that.
//
// Each run also sweeps expired Pending holds (Stage A), so an
// unpaid hold never lingers past its 15 minutes even if no
// booking traffic arrives.

import { processDueReminders } from "@/lib/services/notifications";
import { sweepExpiredPendings } from "@/lib/services/payments";
import { ensureDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { error: "Cron secret is not configured." },
      { status: 500 },
    );
  }
  const header = req.headers.get("authorization");
  if (header !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    await ensureDb();
  } catch (err) {
    console.error("Reminder cron ensureDb failed:", err);
    return Response.json(
      { error: "Database is not available." },
      { status: 500 },
    );
  }

  const reminders = await processDueReminders();
  const swept = await sweepExpiredPendings();
  return Response.json({
    ok: true,
    reminders: {
      sent: reminders.sent,
      skipped: reminders.skipped,
      failed: reminders.failed,
      cancelled: reminders.cancelled,
    },
    expiredPendingsSwept: {
      appointments: swept.appointments,
      payments: swept.payments,
    },
  });
}
