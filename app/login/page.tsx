import Link from "next/link";
import { LoginForm } from "@/components/auth-forms";

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <LoginForm />
      <p className="mt-4 text-center text-sm text-slate-600">
        No account yet?{" "}
        <Link href="/register" className="font-medium underline">
          Register
        </Link>
      </p>
    </div>
  );
}
