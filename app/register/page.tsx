import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/auth-forms";
import { getSession } from "@/lib/auth";
import { getOAuthAvailability } from "@/lib/oauth";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams?: Promise<{ role?: string }>;
}) {
  // Signed-in users already have a role — the dashboard branches by it.
  if (await getSession()) redirect("/dashboard");

  // Optional role preselect, used by /auth/start. Only the two real
  // roles are honoured; anything else falls back to the form default
  // (Patient). This changes no registration logic — it only preselects
  // the role card the user already chose.
  const params = (await searchParams) ?? {};
  const initialRole =
    params.role === "doctor"
      ? "Doctor"
      : params.role === "patient"
        ? "Patient"
        : undefined;

  // The wide centred layout lives in RegisterForm itself, so no shared
  // container here — that shared wrapper was part of why both pages
  // used to look the same.
  return (
    <RegisterForm oauth={getOAuthAvailability()} initialRole={initialRole} />
  );
}
