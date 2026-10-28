// Sign-in, registration and OAuth role-choice forms.
//
// DESIGN (redesigned 2026-10-28 after the user rejected the previous
// generic centred card, which made sign-in and sign-up look identical):
// the two pages are deliberately DIFFERENT compositions, adapted from
// 21st.dev reference designs, with CareBook branding kept consistent
// (same wordmark, Geist type, teal healthcare accent, provider marks).
//   - Sign-in is a centred premium card (MNC style: generous white
//     space, one clear card, minimal chrome) under a giant CAREBOOK
//     wordmark adapted from the TIDE landing screenshot the user
//     supplied. The backdrop is a restrained aurora: a violet radial
//     glow (components/ui/light-theme-tailwind-css-background-snippet)
//     with a subdued soft-yellow glow layered below the card
//     (components/ui/background-components). Teal appears only on
//     buttons, links, the switcher and focus rings. Task 3A's
//     split-screen panel was removed outright after the user rejected
//     it ("not even 1%"). Sign-in shows ONLY its own content and stays
//     role-aware: ?role=patient|doctor changes the messaging (never
//     the authorization), and a direct visit gets a Patient | Doctor
//     switcher. The role copy map lives with LoginForm below.
//   - Registration follows the 21st.dev full-screen sign-up pattern
//     ("Full Screen Signup" by Preet Suthar; "Premium Auth" by Dhileep
//     Kumar GM): a wide, centred page on a soft teal wash, with a
//     large display heading, provider buttons in a horizontal row, a
//     two-column field grid, and a prominent role-choice section.
//     Registration shows ONLY its own content.
// No demo credentials, demo buttons or demo banners appear anywhere
// here: demo accounts still work in the database, but anyone testing
// types them in by hand.
//
// All forms are client components so validation errors can be shown
// inline without losing input. Server actions remain the source of
// truth for authentication; client validation only catches obvious
// mistakes early.

"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  loginAction,
  registerAction,
  completeOAuthSignupAction,
} from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { OAuthProvider } from "@/lib/oauth";
import { LoginWordmark } from "@/components/login-wordmark";
import { RadialBackground } from "@/components/ui/light-theme-tailwind-css-background-snippet";
import { Component as SoftYellowGlow } from "@/components/ui/background-components";

export type OAuthAvailability = {
  google: boolean;
  github: boolean;
  microsoft: boolean;
};

const PROVIDERS: Array<{
  id: OAuthProvider;
  label: string;
  configured: (o: OAuthAvailability) => boolean;
}> = [
  { id: "google", label: "Google", configured: (o) => o.google },
  { id: "github", label: "GitHub", configured: (o) => o.github },
  { id: "microsoft", label: "Microsoft", configured: (o) => o.microsoft },
];

function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29A7.2 7.2 0 0 1 4.89 12c0-.8.14-1.57.38-2.29H1.29a12 12 0 0 0 0 9.58l3.98-3z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.29 7.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg width="19" height="19" viewBox="0 0 23 23" aria-hidden="true">
      <rect width="11" height="11" fill="#F25022" />
      <rect x="12" width="11" height="11" fill="#7FBA00" />
      <rect y="12" width="11" height="11" fill="#00A4EF" />
      <rect x="12" y="12" width="11" height="11" fill="#FFB900" />
    </svg>
  );
}

function ProviderMark({ id }: { id: OAuthProvider }) {
  if (id === "google") return <GoogleMark />;
  if (id === "github") return <GitHubMark />;
  return <MicrosoftMark />;
}

/** Provider buttons. Unconfigured providers are disabled and named in
 *  the note underneath — never a crash, never a hang. Two arrangements:
 *  "stack" (sign-in: full-width rows) and "row" (registration: three
 *  compact buttons side by side). */
function OAuthButtons({
  oauth,
  variant,
}: {
  oauth: OAuthAvailability;
  variant: "stack" | "row";
}) {
  const missing = PROVIDERS.filter((p) => !p.configured(oauth));
  const layout =
    variant === "stack" ? "flex flex-col gap-3" : "grid grid-cols-3 gap-3";
  return (
    <div>
      <div className={layout}>
        {PROVIDERS.map((p) =>
          p.configured(oauth) ? (
            <a
              key={p.id}
              href={`/api/auth/${p.id}`}
              aria-label={`Continue with ${p.label}`}
              className="inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 transition-colors hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
            >
              <ProviderMark id={p.id} />
              {variant === "stack" ? `Continue with ${p.label}` : p.label}
            </a>
          ) : (
            <button
              key={p.id}
              type="button"
              disabled
              aria-disabled="true"
              aria-label={`Continue with ${p.label}`}
              className="inline-flex h-12 w-full cursor-not-allowed items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-400"
            >
              <ProviderMark id={p.id} />
              {variant === "stack" ? `Continue with ${p.label}` : p.label}
            </button>
          ),
        )}
      </div>
      {missing.length > 0 && (
        <p className="mt-3 text-center text-xs text-slate-500">
          {missing.map((p) => `${p.label} sign-in isn't configured yet`).join(" · ")}
        </p>
      )}
    </div>
  );
}

function Divider({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <span className="h-px flex-1 bg-slate-200" />
      <span className="text-xs font-medium tracking-wide text-slate-500 uppercase">
        {children}
      </span>
      <span className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm leading-relaxed text-red-700"
    >
      {message}
    </p>
  );
}

function FieldError({ message, id }: { message?: string; id: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs leading-relaxed text-red-600">
      {message}
    </p>
  );
}

// Shared by sign-in and registration. The three optional props below are
// Task 3A additions for the sign-in page ONLY: every caller that omits
// them (registration included) renders exactly what it rendered before.
function PasswordField({
  id,
  name,
  value,
  onChange,
  onBlur,
  errorId,
  hasError,
  autoComplete,
  inputClassName,
  toggleClassName,
  toggleIcon,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  errorId: string;
  hasError: boolean;
  autoComplete: string;
  inputClassName?: string;
  toggleClassName?: string;
  toggleIcon?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        required
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={hasError}
        aria-describedby={hasError ? errorId : undefined}
        className={
          inputClassName ??
          "h-12 rounded-xl border-slate-300 pr-16 focus:ring-teal-600"
        }
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className={
          toggleClassName ??
          "absolute top-1/2 right-3 -translate-y-1/2 rounded text-xs font-medium text-slate-600 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
        }
      >
        <span className="inline-flex items-center gap-1.5">
          {toggleIcon && (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {visible ? (
                <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M9.88 9.88 2 2" />
              ) : (
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
              )}
            </svg>
          )}
          {visible ? "Hide" : "Show"}
        </span>
      </button>
    </div>
  );
}

function BrandHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-lg font-bold tracking-tight text-slate-900">
        CareBook
      </p>
      <CardTitle className="text-2xl leading-tight">{title}</CardTitle>
      <CardDescription className="text-sm leading-relaxed">
        {description}
      </CardDescription>
    </div>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function RoleCards({
  role,
  onChange,
}: {
  role: "Patient" | "Doctor";
  onChange: (r: "Patient" | "Doctor") => void;
}) {
  const options: Array<{
    value: "Patient" | "Doctor";
    title: string;
    text: string;
  }> = [
    {
      value: "Patient",
      title: "Patient",
      text: "Book appointments with doctors.",
    },
    {
      value: "Doctor",
      title: "Doctor",
      text: "Receive bookings from patients.",
    },
  ];
  return (
    <fieldset>
      <legend className="text-sm font-medium text-slate-900">
        I am joining as
      </legend>
      <div className="mt-2 grid grid-cols-2 gap-3">
        {options.map((o) => (
          <label key={o.value} className="cursor-pointer">
            <input
              type="radio"
              name="role"
              value={o.value}
              checked={role === o.value}
              onChange={() => onChange(o.value)}
              className="peer sr-only"
            />
            <span className="block rounded-2xl border border-slate-300 bg-white p-5 transition-colors peer-checked:border-teal-700 peer-checked:bg-teal-50 peer-checked:ring-1 peer-checked:ring-teal-700 peer-focus-visible:ring-2 peer-focus-visible:ring-teal-600">
              <span className="block text-base font-semibold text-slate-900">
                {o.title}
              </span>
              <span className="mt-1 block text-sm leading-relaxed text-slate-500">
                {o.text}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function DoctorFields({
  errors,
  onBlurField,
}: {
  errors: Record<string, string>;
  onBlurField: (field: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="qualification">Qualification</Label>
        <Input
          id="qualification"
          name="qualification"
          placeholder="MBBS, MD General Medicine"
          onBlur={() => onBlurField("qualification")}
          className="h-12 rounded-xl border-slate-300 focus:ring-teal-600"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="experienceYears">Experience (years)</Label>
          <Input
            id="experienceYears"
            name="experienceYears"
            type="number"
            min={0}
            placeholder="10"
            className="h-12 rounded-xl border-slate-300 focus:ring-teal-600"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="consultationFee">Consultation fee (₹)</Label>
          <Input
            id="consultationFee"
            name="consultationFee"
            type="number"
            min={0}
            placeholder="500"
            className="h-12 rounded-xl border-slate-300 focus:ring-teal-600"
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="specialization">Specialization</Label>
        <Input
          id="specialization"
          name="specialization"
          required
          placeholder="General Physician"
          aria-invalid={Boolean(errors.specialization)}
          aria-describedby={
            errors.specialization ? "specialization-error" : undefined
          }
          className="h-12 rounded-xl border-slate-300 focus:ring-teal-600"
        />
        <FieldError
          message={errors.specialization}
          id="specialization-error"
        />
      </div>
      <p className="text-xs leading-relaxed text-slate-500">
        New doctors get a default Mon–Fri 09:00–13:00 schedule on sign-up,
        so patients can book with you right away.
      </p>
    </div>
  );
}

/** SIGN-IN ONLY. Premium split-screen composition (Task 3A): a
 *  midnight-teal brand panel on the left (desktop) or a compact brand
 *  strip on top (mobile), and a narrow form column. Fields: provider
 *  buttons, email, password — nothing else. No name, no phone, no
 *  registration fields, no demo credentials.
 *
 *  Role awareness is MESSAGING ONLY: ?role=patient|doctor (or the
 *  switcher below) picks the wording and the registration link target.
 *  It never changes authentication: the same loginAction runs for both
 *  roles, the server-side account role stays authoritative, and a
 *  successful sign-in always redirects to /dashboard. Editing the URL
 *  therefore grants nothing. */
/** Role-aware sign-in copy. The role only picks wording; it is never
 *  proof of identity and never changes what the account can do.
 *  (Moved here, wording unchanged, from the deleted Task 3A panel file.) */
export type LoginRole = "Patient" | "Doctor" | null;

type RoleCopy = {
  formHeading: string;
  formSub: string;
};

const COPY: Record<"Patient" | "Doctor" | "Neutral", RoleCopy> = {
  Patient: {
    formHeading: "Sign in as a patient",
    formSub:
      "Find doctors by specialisation, book a real time slot, and follow your appointment from booking to completion.",
  },
  Doctor: {
    formHeading: "Sign in as a doctor",
    formSub:
      "Check today's bookings, manage your availability, and confirm appointments on your dashboard.",
  },
  Neutral: {
    formHeading: "Sign in to CareBook",
    formSub:
      "Book appointments or manage your practice — your account's role decides your dashboard.",
  },
};

export function loginCopy(role: LoginRole): RoleCopy {
  if (role === "Patient") return COPY.Patient;
  if (role === "Doctor") return COPY.Doctor;
  return COPY.Neutral;
}

export function LoginForm({
  oauth,
  initialError,
  initialRole,
}: {
  oauth: OAuthAvailability;
  initialError?: string;
  initialRole?: "Patient" | "Doctor";
}) {
  const [state, dispatch, pending] = useActionState(loginAction, {});
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Null = direct visit with no role context: neutral wording until the
  // visitor picks a side. Picking only rewords this page and the
  // registration link — it submits nothing and proves nothing.
  const [role, setRole] = useState<"Patient" | "Doctor" | null>(
    initialRole ?? null,
  );
  const copy = loginCopy(role);
  const registerHref = role
    ? `/register?role=${role.toLowerCase()}`
    : "/register";

  const validateEmail = () => {
    setErrors((e) => ({
      ...e,
      email: EMAIL_RE.test(email.trim())
        ? ""
        : "Enter a valid email address.",
    }));
  };
  const validatePassword = () => {
    setErrors((e) => ({
      ...e,
      password: password ? "" : "Enter your password.",
    }));
  };
  const handleSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    const next: Record<string, string> = {
      email: EMAIL_RE.test(email.trim())
        ? ""
        : "Enter a valid email address.",
      password: password ? "" : "Enter your password.",
    };
    setErrors(next);
    if (next.email || next.password) ev.preventDefault();
  };

  return (
    <div className="relative min-h-dvh min-w-0 overflow-hidden">
      <RadialBackground />
      <SoftYellowGlow />
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-6xl min-w-0 flex-col px-4 sm:px-6">
        <div className="pt-8 sm:pt-12">
          <LoginWordmark />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center py-8 sm:py-10">
          <div className="w-full max-w-md min-w-0 rounded-3xl border border-border bg-white p-6 shadow-xl shadow-slate-900/10 sm:p-8">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl leading-tight font-bold tracking-tight text-ink sm:text-3xl">
                {copy.formHeading}
              </h1>
              <p className="text-sm leading-relaxed text-ink-soft sm:text-base">
                {copy.formSub}
              </p>
            </div>

            {/* Role switcher: wording + registration link only. */}
            <fieldset className="mt-6">
              <legend className="sr-only">Signing in as</legend>
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface-subtle p-1">
                {(["Patient", "Doctor"] as const).map((option) => (
                  <label key={option} className="cursor-pointer">
                    <input
                      type="radio"
                      name="signin-role"
                      value={option}
                      checked={role === option}
                      onChange={() => setRole(option)}
                      className="peer sr-only"
                    />
                    <span className="block rounded-lg px-3 py-2.5 text-center text-sm font-medium text-ink-soft transition-colors peer-checked:bg-brand-700 peer-checked:text-white peer-checked:shadow-sm peer-focus-visible:outline-2 peer-focus-visible:outline-brand-600 peer-focus-visible:outline-offset-2">
                      {option}
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-ink-faint">
                This only changes the wording on this page — your
                account&apos;s role decides your dashboard after sign-in.
              </p>
            </fieldset>

            <div className="mt-8 flex flex-col gap-6">
              <OAuthButtons oauth={oauth} variant="stack" />
              <Divider>or continue with email</Divider>
              <form
                action={dispatch}
                onSubmit={handleSubmit}
                className="flex flex-col gap-4"
                noValidate
              >
                <FormError message={state.error ?? initialError} />
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={validateEmail}
                    aria-invalid={Boolean(errors.email)}
                    aria-describedby={errors.email ? "email-error" : undefined}
                    placeholder="you@example.com"
                    className="h-12"
                  />
                  <FieldError message={errors.email} id="email-error" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="password">Password</Label>
                  <PasswordField
                    id="password"
                    name="password"
                    value={password}
                    onChange={setPassword}
                    onBlur={validatePassword}
                    errorId="password-error"
                    hasError={Boolean(errors.password)}
                    autoComplete="current-password"
                    inputClassName="h-12 rounded-xl border-border pr-16 focus-visible:ring-brand-600"
                    toggleClassName="absolute top-1/2 right-3 -translate-y-1/2 rounded text-xs font-medium text-ink-soft hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                    toggleIcon
                  />
                  <FieldError message={errors.password} id="password-error" />
                </div>
                <Button
                  type="submit"
                  size="lg"
                  disabled={pending}
                  className="mt-1 w-full"
                >
                  {pending ? "Signing in…" : "Sign in"}
                </Button>
              </form>
              <p className="text-center text-sm text-ink-soft">
                New to CareBook?{" "}
                <Link
                  href={registerHref}
                  className="font-medium text-brand-700 underline underline-offset-4 hover:text-brand-800"
                >
                  Create an account
                </Link>
              </p>
              <p className="text-center text-sm text-ink-soft">
                Not sure which role fits you?{" "}
                <Link
                  href="/auth/start"
                  className="font-medium text-brand-700 underline underline-offset-4 hover:text-brand-800"
                >
                  Choose on the role page
                </Link>
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 px-1 py-6 text-xs leading-relaxed text-ink-faint">
          <span>Appointments are shown in IST.</span>
          <Link
            href="/"
            className="inline-flex items-center gap-1 font-medium text-brand-700 hover:text-brand-800"
          >
            Back to home
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}
/** REGISTRATION ONLY. Wide, centred full-screen composition on a soft
 *  teal wash: display heading, provider buttons in a horizontal row, a
 *  two-column field grid, and a prominent role-choice section with
 *  doctor fields when Doctor is chosen. No sign-in-only elements, no
 *  demo credentials. */
export function RegisterForm({
  oauth,
  initialRole,
}: {
  oauth: OAuthAvailability;
  // Optional preselect from /auth/start (?role=patient|doctor). Defaults
  // to Patient, exactly as before, when absent. No logic changes.
  initialRole?: "Patient" | "Doctor";
}) {
  const [state, dispatch, pending] = useActionState(registerAction, {});
  const [role, setRole] = useState<"Patient" | "Doctor">(
    initialRole ?? "Patient",
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateField = (field: string) => {
    setErrors((e) => {
      const next = { ...e };
      if (field === "name")
        next.name =
          name.trim().length >= 2
            ? ""
            : "Name must be at least 2 characters.";
      if (field === "email")
        next.email = EMAIL_RE.test(email.trim())
          ? ""
          : "Enter a valid email address.";
      if (field === "password")
        next.password =
          password.length >= 6
            ? ""
            : "Password must be at least 6 characters.";
      return next;
    });
  };

  const handleSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    const form = ev.currentTarget;
    const specialization = (
      form.elements.namedItem("specialization") as HTMLInputElement | null
    )?.value.trim();
    const next: Record<string, string> = {
      name:
        name.trim().length >= 2
          ? ""
          : "Name must be at least 2 characters.",
      email: EMAIL_RE.test(email.trim())
        ? ""
        : "Enter a valid email address.",
      password:
        password.length >= 6
          ? ""
          : "Password must be at least 6 characters.",
      specialization:
        role === "Doctor" && !specialization
          ? "Doctors must add their specialization."
          : "",
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) ev.preventDefault();
  };

  return (
    <div className="bg-gradient-to-b from-teal-50 via-white to-white px-4 py-10 sm:py-14">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-xl font-bold tracking-tight text-teal-700">
            CareBook
          </p>
          <h1 className="text-4xl leading-tight font-bold tracking-tight text-slate-900 sm:text-[2.75rem]">
            Create your account
          </h1>
          <p className="max-w-lg text-sm leading-relaxed text-slate-500 sm:text-base">
            Join as a patient to book appointments, or as a doctor to
            receive them. One account, one role.
          </p>
        </div>
        <div className="mt-10 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-900/5 sm:p-10">
          <div className="flex flex-col gap-6">
            <OAuthButtons oauth={oauth} variant="row" />
            <Divider>or sign up with email</Divider>
            <form
              action={dispatch}
              onSubmit={handleSubmit}
              className="flex flex-col gap-5"
              noValidate
            >
              <FormError message={state.error} />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label htmlFor="name">Full name</Label>
                  <Input
                    id="name"
                    name="name"
                    required
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => validateField("name")}
                    aria-invalid={Boolean(errors.name)}
                    aria-describedby={errors.name ? "name-error" : undefined}
                    placeholder="Your name"
                    className="h-12 rounded-xl border-slate-300 focus:ring-teal-600"
                  />
                  <FieldError message={errors.name} id="name-error" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => validateField("email")}
                    aria-invalid={Boolean(errors.email)}
                    aria-describedby={errors.email ? "email-error" : undefined}
                    placeholder="you@example.com"
                    className="h-12 rounded-xl border-slate-300 focus:ring-teal-600"
                  />
                  <FieldError message={errors.email} id="email-error" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="phone">Phone (optional)</Label>
                  <Input
                    id="phone"
                    name="phone"
                    autoComplete="tel"
                    placeholder="9876543210"
                    className="h-12 rounded-xl border-slate-300 focus:ring-teal-600"
                  />
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label htmlFor="password">Password</Label>
                  <PasswordField
                    id="password"
                    name="password"
                    value={password}
                    onChange={setPassword}
                    onBlur={() => validateField("password")}
                    errorId="password-error"
                    hasError={Boolean(errors.password)}
                    autoComplete="new-password"
                  />
                  <FieldError message={errors.password} id="password-error" />
                  <p className="text-xs text-slate-500">
                    At least 6 characters.
                  </p>
                </div>
              </div>
              <div className="border-t border-slate-100 pt-5">
                <RoleCards role={role} onChange={setRole} />
              </div>
              {role === "Doctor" && (
                <DoctorFields
                  errors={errors}
                  onBlurField={() => undefined}
                />
              )}
              <Button
                type="submit"
                disabled={pending}
                className="mt-1 h-12 w-full rounded-xl bg-teal-700 text-base hover:bg-teal-800"
              >
                {pending ? "Creating account…" : "Create account"}
              </Button>
              <p className="text-center text-xs leading-relaxed text-slate-500">
                One account per role — patient or doctor, never both.
              </p>
            </form>
          </div>
        </div>
        <p className="mt-6 text-center text-sm text-slate-600">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-teal-700 underline underline-offset-4 hover:text-teal-800"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export function OAuthRoleForm({
  pending,
}: {
  pending: { email: string; name: string; provider: OAuthProvider };
}) {
  const [state, dispatch, submitting] = useActionState(
    completeOAuthSignupAction,
    {},
  );
  const [role, setRole] = useState<"Patient" | "Doctor">("Patient");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const providerName =
    pending.provider === "google"
      ? "Google"
      : pending.provider === "github"
        ? "GitHub"
        : "Microsoft";

  const handleSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    const form = ev.currentTarget;
    const specialization = (
      form.elements.namedItem("specialization") as HTMLInputElement | null
    )?.value.trim();
    const next: Record<string, string> = {
      specialization:
        role === "Doctor" && !specialization
          ? "Doctors must add their specialization."
          : "",
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) ev.preventDefault();
  };

  return (
    <Card className="mx-auto w-full max-w-md rounded-2xl shadow-xl shadow-slate-900/5">
      <CardHeader className="p-8 pb-2 sm:p-10 sm:pb-2">
        <BrandHeader
          title="Choose your role"
          description={`You signed in with ${providerName} as ${pending.email}. Pick a role to finish creating your account.`}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-6 p-8 pt-6 sm:p-10 sm:pt-6">
        <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">
          Signing up as <strong>{pending.name}</strong> ({pending.email})
          via {providerName}. This creates one CareBook account — patient
          or doctor, never both.
        </p>
        <form
          action={dispatch}
          onSubmit={handleSubmit}
          className="flex flex-col gap-4"
          noValidate
        >
          <FormError message={state.error} />
          <RoleCards role={role} onChange={setRole} />
          {role === "Doctor" && (
            <DoctorFields
              errors={errors}
              onBlurField={() => undefined}
            />
          )}
          <Button
            type="submit"
            disabled={submitting}
            className="mt-1 h-12 w-full rounded-xl text-base"
          >
            {submitting ? "Creating account…" : "Continue"}
          </Button>
        </form>
        <p className="text-center text-sm text-slate-600">
          Wrong account?{" "}
          <Link
            href="/login"
            className="font-medium text-slate-900 underline underline-offset-4"
          >
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
