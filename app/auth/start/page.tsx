import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { RoleStartForm } from "@/components/role-start";

/*
 * Role-selection entry (Task 2 foundation). Onboarding/navigation only:
 * picking a role creates no account and bypasses nothing — it simply
 * sends the user to registration with that role preselected. The
 * persisted account role and server-side authorization stay authoritative.
 * Signed-in users already have a role, so they go to their dashboard.
 */
export default async function RoleStartPage() {
  if (await getSession()) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      <RoleStartForm />
    </div>
  );
}
