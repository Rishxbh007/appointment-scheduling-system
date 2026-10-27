import { RegisterForm } from "@/components/auth-forms";
import { getOAuthAvailability } from "@/lib/oauth";

export default function RegisterPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:py-16">
      <RegisterForm oauth={getOAuthAvailability()} />
    </div>
  );
}
