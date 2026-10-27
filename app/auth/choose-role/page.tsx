import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { OAuthRoleForm } from "@/components/auth-forms";
import { verifyPendingOAuth } from "@/lib/oauth";

export default async function ChooseRolePage() {
  const store = await cookies();
  const pending = verifyPendingOAuth(store.get("oauth_pending")?.value);
  if (!pending) redirect("/login");

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
      <OAuthRoleForm pending={pending} />
    </div>
  );
}
