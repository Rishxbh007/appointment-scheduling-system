import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth-forms";
import { getSession } from "@/lib/auth";
import { getOAuthAvailability } from "@/lib/oauth";

function providerName(value?: string): string {
  if (value === "google") return "Google";
  if (value === "github") return "GitHub";
  if (value === "microsoft") return "Microsoft";
  return "Google or GitHub";
}

function errorMessage(error?: string, provider?: string): string | undefined {
  const name = providerName(provider);
  switch (error) {
    case "oauth_not_configured":
      return `${name} sign-in isn't configured yet. Please sign in with email and password.`;
    case "account_exists":
      return "An account with this email already exists. Please sign in with email and password instead — it was not linked to another provider.";
    case "oauth_denied":
      return `You cancelled the ${name} sign-in. Try again, or use email and password.`;
    case "oauth_no_email":
      return `We couldn't get an email address from ${name}. Please use email and password.`;
    case "oauth_state":
      return "Your sign-in session expired. Please try signing in again.";
    case "oauth_failed":
      return `${name} sign-in failed. Please try again, or use email and password.`;
    default:
      return undefined;
  }
}

// Task 3A: ?role= is MESSAGING ONLY for the sign-in page (patient- vs
// doctor-oriented wording + the registration link target). It is never
// proof of identity: the same loginAction runs for both roles, the
// server-side account role stays authoritative, and a successful sign-in
// always redirects to /dashboard. Anything else falls back to the
// no-role state, which shows a Patient | Doctor switcher.
function initialRole(value?: string): "Patient" | "Doctor" | undefined {
  if (value === "patient") return "Patient";
  if (value === "doctor") return "Doctor";
  return undefined;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{
    error?: string;
    provider?: string;
    role?: string;
  }>;
}) {
  const params = (await searchParams) ?? {};
  // Signed-in users have no business on the sign-in page — send them to
  // the dashboard, which branches by role. The error case is exempt:
  // OAuth failures redirect here with ?error=, and that message must
  // still reach the form even for a signed-in user. The role parameter
  // rides along untouched, so an OAuth error keeps its role context.
  if (!params.error && (await getSession())) redirect("/dashboard");
  // The Linear-style narrow-column layout lives in LoginForm itself,
  // so no shared container here — that shared wrapper was part of why
  // both pages used to look the same.
  return (
    <LoginForm
      oauth={getOAuthAvailability()}
      initialError={errorMessage(params.error, params.provider)}
      initialRole={initialRole(params.role)}
    />
  );
}
