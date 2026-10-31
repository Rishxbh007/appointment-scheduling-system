// Notification preferences form (client component). Day 5: the
// patient's phone number + SMS opt-in. Saving calls the session
// patient action and reports inline; the dashboard refreshes so
// the card shows the saved state at once. Email notifications
// are not toggleable here — they are operational, always on.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateNotificationPreferencesAction } from "@/lib/actions/notifications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function NotificationPreferencesForm({
  initialPhone,
  initialSmsOptIn,
}: {
  initialPhone: string;
  initialSmsOptIn: boolean;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState(initialPhone);
  const [smsOptIn, setSmsOptIn] = useState(initialSmsOptIn);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        setSaved(false);
        try {
          const result = await updateNotificationPreferencesAction({
            phone,
            smsOptIn,
          });
          if (result.ok) {
            setSaved(true);
            router.refresh();
          } else {
            setError(result.error ?? "Could not save preferences.");
          }
        } catch {
          setError("Could not save preferences.");
        } finally {
          setPending(false);
        }
      }}
      className="mt-4 space-y-4"
    >
      <div>
        <label htmlFor="notif-phone" className="text-sm font-medium">
          Phone number for SMS
        </label>
        <Input
          id="notif-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="e.g. +91 98765 43210"
          className="mt-1"
        />
        <p className="mt-1 text-xs text-slate-500">
          SMS reminders and updates go to this number. Leave it blank
          for no SMS.
        </p>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={smsOptIn}
          onChange={(e) => setSmsOptIn(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Send me SMS reminders and appointment updates
          <span className="block text-xs text-slate-500">
            Off by default. Email notifications are always on — they
            are operational, not promotional, and there are no
            promotional messages to opt out of.
          </span>
        </span>
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save preferences"}
        </Button>
        {saved && (
          <p className="text-sm text-slate-600">
            Saved{smsOptIn ? "." : " — SMS reminders are now off."}
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
