// First-visit SMS consent banner (client component). Day 5
// follow-up: the ask happens ONCE, at the top of the patient
// dashboard, the first time the patient arrives — never buried
// in settings, never nagging. It shows only while the patient
// has no preferences row; either answer (Allow SMS or Email
// only) records a row, so the banner never returns. The choice
// can still be changed anytime on the notifications page.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateNotificationPreferencesAction } from "@/lib/actions/notifications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

export function NotificationConsentBanner({
  initialPhone,
}: {
  initialPhone: string;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState(initialPhone);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(smsOptIn: boolean) {
    setPending(true);
    setError(null);
    try {
      const result = await updateNotificationPreferencesAction({
        phone,
        smsOptIn,
      });
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error ?? "Could not save your choice.");
      }
    } catch {
      setError("Could not save your choice.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="mt-6 border-info-strong/40 bg-white/80">
      <CardContent className="pt-6">
        <p className="font-semibold">Can we send you SMS updates?</p>
        <p className="mt-1 text-sm text-slate-600">
          Email notifications about your appointments are always on.
          SMS reminders and updates are optional — they need your
          phone number, and you can turn them off anytime from the
          notifications page.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="consent-phone" className="text-sm font-medium">
              Phone number for SMS
            </label>
            <Input
              id="consent-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. +91 98765 43210"
              className="mt-1"
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => answer(true)}
            >
              {pending ? "Saving…" : "Allow SMS"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => answer(false)}
            >
              Email only
            </Button>
          </div>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
