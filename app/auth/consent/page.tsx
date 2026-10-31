import { redirect } from "next/navigation";
import { ensureDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/services/accounts";
import { getNotificationPreferences } from "@/lib/services/notifications";
import { NotificationConsentBanner } from "@/components/notification-consent-banner";
import { RadialBackground } from "@/components/ui/light-theme-tailwind-css-background-snippet";

export const dynamic = "force-dynamic";

// Login-time SMS consent gate (Day 5 follow-up to the
// follow-up). The consent ask used to live as a banner on the
// patient dashboard, where it was still one more thing below
// the fold. Now it lives HERE, at login, and it is mandatory:
// every sign-in lands on /dashboard, and the dashboard sends
// a patient with no preferences row straight back here, so
// the dashboard is unreachable until the question is answered.
// Either answer (Allow SMS or Email only) records a row, so
// the gate never returns. The phone field is the point: SMS
// needs a target number, and this is where it is captured —
// Allow SMS without a number is refused by the action, so a
// patient who wants texts must leave a number behind. Doctors
// skip the gate entirely (SMS is patient-only), and patients
// who already answered skip it too. The choice can still be
// changed anytime on the notifications page.
export default async function ConsentGatePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "Doctor") redirect("/dashboard");
  await ensureDb();
  const user = await getUserById(session.userId);
  if (!user) redirect("/login");
  const prefs = await getNotificationPreferences(session.userId);
  if (prefs !== null) redirect("/dashboard");

  // Narrow centred column on the login page's violet radial —
  // this is an auth-flow page, not a dashboard page.
  return (
    <div className="relative min-h-dvh min-w-0 overflow-hidden">
      <RadialBackground />
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-sm min-w-0 flex-col items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full min-w-0">
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-xl leading-tight font-bold tracking-tight text-ink sm:text-2xl">
              One last step
            </h1>
            <p className="text-sm leading-relaxed text-ink-soft">
              Before you reach your dashboard, tell us how we may
              reach you about your appointments. This is asked
              once, here — and you can change it anytime from
              the notifications page.
            </p>
          </div>
          <NotificationConsentBanner initialPhone={user.phone ?? ""} />
          <p className="mt-4 text-center text-xs text-slate-500">
            Email notifications about your appointments are always
            on. SMS is optional — it needs your mobile number.
          </p>
        </div>
      </div>
    </div>
  );
}
