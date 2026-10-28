// Role-selection entry form (Task 2).
//
// Pattern note: this deliberately reuses the in-repo card-selection
// pattern already proven in auth-forms.tsx RoleCards (radio input +
// peer-checked card), enlarged for a dedicated entry page and restyled
// with the Task 2 design tokens. 21st.dev onboarding components were
// reviewed and NOT adopted: the candidates found need framer-motion
// (not installed) or solve a different problem (team management,
// display-name/avatar onboarding, animated milestone pickers). Adding
// a dependency for a two-card choice would be worse than the pattern
// the codebase already has.
//
// Selecting a role navigates to /register?role=patient|doctor, which
// preselects that role card. It creates no account.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";

function PatientMark() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className="text-brand-700"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

function DoctorMark() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className="text-brand-700"
    >
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

const OPTIONS = [
  {
    value: "Patient" as const,
    role: "patient" as const,
    title: "I'm a patient",
    text: "Find doctors by specialisation, book a real time slot, and track your appointments from booking to completion.",
    mark: <PatientMark />,
  },
  {
    value: "Doctor" as const,
    role: "doctor" as const,
    title: "I'm a doctor",
    text: "Receive bookings from patients, manage your availability, and confirm appointments on your dashboard.",
    mark: <DoctorMark />,
  },
];

export function RoleStartForm() {
  const router = useRouter();
  const [role, setRole] = useState<"Patient" | "Doctor">("Patient");
  const selected = OPTIONS.find((o) => o.value === role)!;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-xl font-bold tracking-tight text-brand-700">
          CareBook
        </p>
        <h1 className="text-3xl leading-tight font-bold tracking-tight text-ink sm:text-4xl">
          How are you joining CareBook?
        </h1>
        <p className="max-w-lg text-sm leading-relaxed text-ink-soft sm:text-base">
          Choose the role that fits you. This only decides where you
          register — it doesn&apos;t create an account.
        </p>
      </div>

      <fieldset>
        <legend className="sr-only">I am joining as</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {OPTIONS.map((o) => (
            <label key={o.value} className="cursor-pointer">
              <input
                type="radio"
                name="role"
                value={o.value}
                checked={role === o.value}
                onChange={() => setRole(o.value)}
                className="peer sr-only"
              />
              <span className="block h-full rounded-2xl border border-border bg-surface p-6 shadow-sm transition-colors hover:border-brand-200 hover:shadow-md peer-checked:border-brand-700 peer-checked:bg-brand-50 peer-checked:shadow-md peer-checked:ring-1 peer-checked:ring-brand-700 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-600">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50">
                  {o.mark}
                </span>
                <span className="mt-4 block text-lg font-semibold text-ink">
                  {o.title}
                </span>
                <span className="mt-1 block text-sm leading-relaxed text-ink-soft">
                  {o.text}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col items-center gap-3">
        <Button
          size="lg"
          className="w-full sm:w-auto sm:px-10"
          onClick={() => router.push(`/register?role=${selected.role}`)}
        >
          Continue as {role === "Patient" ? "a patient" : "a doctor"}
        </Button>
        <p className="text-center text-sm text-ink-soft">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-brand-700 underline underline-offset-4 hover:text-brand-800"
          >
            Sign in
          </Link>
        </p>
        <p className="text-center text-xs leading-relaxed text-ink-faint">
          One account, one role — patient or doctor, never both. Your role
          is confirmed when you register.
        </p>
      </div>
    </div>
  );
}
