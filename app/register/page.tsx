import { RegisterForm } from "@/components/auth-forms";
import { getOAuthAvailability } from "@/lib/oauth";

export default function RegisterPage() {
  // The wide centred layout lives in RegisterForm itself, so no shared
  // container here — that shared wrapper was part of why both pages
  // used to look the same.
  return <RegisterForm oauth={getOAuthAvailability()} />;
}
