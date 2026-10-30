// Doctor card for the doctors list — the WHOLE card is the way
// in, not just a small button. Clicking (or Enter/Space with the
// card focused) navigates to the doctor's profile, where booking
// happens. The Save toggle is the one exception: it stops
// propagation, so saving a doctor never navigates away.
//
// Valid HTML by construction: the card is a plain div with a
// click handler, not a link — so the Save button inside it is
// never an interactive element nested inside another one, and
// the "View & book" affordance is a styled span, not a button.

"use client";

import { useRouter } from "next/navigation";
import { FavoriteToggle } from "@/components/favorite-toggle";

/** Rotating avatar tints, so the grid reads colourful at a
 * glance. Deterministic by position — never random. */
const AVATAR_TINTS = [
  "bg-teal-100 text-teal-800",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-800",
  "bg-violet-100 text-violet-800",
];

function initialsOf(displayName: string): string {
  const withoutPrefix = displayName.replace(/^Dr\.\s*/i, "");
  const words = withoutPrefix.split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "");
  return letters.join("") || "Dr";
}

export function DoctorCard({
  doctorId,
  name,
  specializationNames,
  qualification,
  experienceYears,
  consultationFee,
  isFavorite,
  showFavorite,
  accentIndex = 0,
}: {
  doctorId: number;
  name: string;
  specializationNames: string[];
  qualification: string | null;
  experienceYears: number | null;
  consultationFee: string | null;
  isFavorite: boolean;
  showFavorite: boolean;
  accentIndex?: number;
}) {
  const router = useRouter();
  const href = `/doctors/${doctorId}`;
  const go = () => router.push(href);
  const tint = AVATAR_TINTS[accentIndex % AVATAR_TINTS.length];

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`View ${name} and book an appointment`}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      }}
      className="cursor-pointer rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-brand-300 hover:shadow-xl hover:shadow-brand-600/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold ${tint}`}
        >
          {initialsOf(name)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-lg font-bold text-slate-900">
            {name}
          </p>
          {specializationNames.length > 0 ? (
            <span className="mt-1 flex flex-wrap gap-1.5">
              {specializationNames.map((s) => (
                <span
                  key={s}
                  className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-800"
                >
                  {s}
                </span>
              ))}
            </span>
          ) : (
            <p className="mt-1 text-xs text-slate-500">
              General practice
            </p>
          )}
        </div>
      </div>

      <p className="mt-4 text-sm text-slate-600">
        {qualification ?? "—"}
        {experienceYears !== null &&
          ` · ${experienceYears} yrs experience`}
      </p>
      <p className="mt-3">
        <span className="rounded-full bg-warning-soft px-3 py-1.5 text-xs font-bold text-warning-strong">
          {consultationFee !== null
            ? `₹${consultationFee} consultation`
            : "Fee on request"}
        </span>
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
        <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand-700 px-4 text-sm font-semibold text-white shadow-sm">
          View &amp; book →
        </span>
        {showFavorite && (
          // Save must not navigate: stop both click and key
          // propagation here, so the card's handlers never fire
          // from inside the toggle.
          <span
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <FavoriteToggle
              doctorId={doctorId}
              doctorName={name}
              isFavorite={isFavorite}
            />
          </span>
        )}
      </div>
    </div>
  );
}
