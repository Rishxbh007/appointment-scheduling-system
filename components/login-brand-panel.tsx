// Premium brand panel for the sign-in page (Task 3A).
//
// Pattern adopted from 21st.dev "Sign In Split Screen" (felipemenezes098):
// a branded panel beside a narrow form column — but the treatment here is
// CareBook's own work, not copied component source (21st.dev keeps that
// behind a free account; no account was created). Midnight-teal surfaces,
// layered CSS/SVG depth (one restrained glow, concentric rings, a dot
// grid), no external imagery, no statistics, no testimonials, no fake
// claims. The copy is role-aware but MESSAGING ONLY: it never affects
// authentication, which stays in lib/actions/auth.ts, and the server-side
// account role stays authoritative after sign-in.

export type LoginRole = "Patient" | "Doctor" | null;

type RoleCopy = {
  panelHeading: string;
  panelSub: string;
  panelPoints: string[];
  formHeading: string;
  formSub: string;
};

const COPY: Record<"Patient" | "Doctor" | "Neutral", RoleCopy> = {
  Patient: {
    panelHeading: "Your next appointment is a few taps away.",
    panelSub:
      "Sign in to find doctors, book a real time slot, and follow your visit through.",
    panelPoints: [
      "Find doctors by specialisation",
      "Book a real time slot",
      "Follow your appointment from booking to completion",
    ],
    formHeading: "Sign in as a patient",
    formSub:
      "Find doctors by specialisation, book a real time slot, and follow your appointment from booking to completion.",
  },
  Doctor: {
    panelHeading: "Your practice, in one calm place.",
    panelSub:
      "Sign in to see today's bookings, manage your availability, and confirm appointments.",
    panelPoints: [
      "Receive bookings from patients",
      "Manage your availability",
      "Confirm appointments on your dashboard",
    ],
    formHeading: "Sign in as a doctor",
    formSub:
      "Check today's bookings, manage your availability, and confirm appointments on your dashboard.",
  },
  Neutral: {
    panelHeading: "Welcome back to CareBook.",
    panelSub:
      "Sign in to book appointments as a patient, or manage your practice as a doctor.",
    panelPoints: [
      "Find doctors by specialisation",
      "Book a real time slot",
      "Track appointments from booking to completion",
    ],
    formHeading: "Sign in to CareBook",
    formSub:
      "Book appointments or manage your practice — your account's role decides your dashboard.",
  },
};

/** Role-aware sign-in copy. The role only picks wording; it is never
 *  proof of identity and never changes what the account can do. */
export function loginCopy(role: LoginRole): RoleCopy {
  if (role === "Patient") return COPY.Patient;
  if (role === "Doctor") return COPY.Doctor;
  return COPY.Neutral;
}

function CheckMark() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mt-0.5 shrink-0 text-brand-200"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function Wordmark() {
  return (
    <p className="flex items-center gap-2 text-xl font-bold tracking-tight text-white">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-700 text-base font-bold text-white"
      >
        +
      </span>
      CareBook
    </p>
  );
}

/** Desktop brand panel: full-height left column (lg and up). Depth comes
 *  from layered, static, aria-hidden decoration — a soft glow, concentric
 *  rings, and a dot grid — all inline SVG/CSS, so the page never depends
 *  on an external image. */
export function LoginBrandPanel({ role }: { role: LoginRole }) {
  const copy = loginCopy(role);
  return (
    <div className="relative flex h-full min-h-[calc(100dvh-120px)] flex-col overflow-hidden bg-brand-950 px-12 py-14 text-white">
      {/* Restrained depth: one glow, rings, dot grid. All decorative. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(13,148,136,0.35),transparent_60%)]"
      />
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -bottom-24 h-96 w-96 text-white/10"
        viewBox="0 0 400 400"
        fill="none"
      >
        <circle cx="200" cy="200" r="60" stroke="currentColor" strokeWidth="1" />
        <circle cx="200" cy="200" r="110" stroke="currentColor" strokeWidth="1" />
        <circle cx="200" cy="200" r="160" stroke="currentColor" strokeWidth="1" />
        <circle cx="200" cy="200" r="195" stroke="currentColor" strokeWidth="1" />
      </svg>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute top-10 right-10 h-24 w-24 text-white/15"
        viewBox="0 0 96 96"
        fill="currentColor"
      >
        {Array.from({ length: 25 }, (_, i) => (
          <circle
            key={i}
            cx={8 + (i % 5) * 20}
            cy={8 + Math.floor(i / 5) * 20}
            r="2"
          />
        ))}
      </svg>
      <div className="relative flex h-full flex-col gap-12">
        <Wordmark />
        <div className="flex flex-col gap-4">
          <h2 className="max-w-sm text-4xl leading-tight font-bold tracking-tight">
            {copy.panelHeading}
          </h2>
          <p className="max-w-sm text-base leading-relaxed text-brand-100">
            {copy.panelSub}
          </p>
        </div>
        <ul className="flex flex-col gap-4 text-sm leading-relaxed text-brand-100">
          {copy.panelPoints.map((point) => (
            <li key={point} className="flex gap-3">
              <CheckMark />
              <span>{point}</span>
            </li>
          ))}
        </ul>
        <p className="mt-auto text-xs leading-relaxed text-brand-200/80">
          Appointments are shown in IST, so the time you see is the time
          you get.
        </p>
      </div>
    </div>
  );
}

/** Compact mobile header (below lg): the same midnight-teal identity as
 *  a short strip above the form, so small screens keep the brand without
 *  spending half the viewport on a panel. */
export function LoginBrandMobileHeader({ role }: { role: LoginRole }) {
  const copy = loginCopy(role);
  return (
    <div className="relative overflow-hidden bg-brand-950 px-6 py-7 text-white sm:px-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(13,148,136,0.35),transparent_65%)]"
      />
      <div className="relative flex flex-col gap-2">
        <Wordmark />
        <p className="text-xl leading-snug font-bold tracking-tight">
          {copy.panelHeading}
        </p>
        <p className="text-sm leading-relaxed text-brand-100">
          {copy.panelSub}
        </p>
      </div>
    </div>
  );
}
