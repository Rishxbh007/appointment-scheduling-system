import Link from "next/link";

// Booking CTA, placed immediately after the hero (before "Healthcare,
// made simple"). Minimal and editorial — an asymmetric two-part layout
// on a soft aqua-to-ivory continuation of the hero background, not a
// generic centered template. No cards, no image tiles: just the heading,
// one supporting sentence, and the two actions.
export default function BookingCTA() {
  return (
    <section className="bg-[linear-gradient(180deg,#fdf8ea_0%,#eaf7f2_50%,#ffffff_100%)]">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 sm:py-24 lg:grid-cols-[1.25fr_1fr]">
        <div>
          <h2 className="font-serif text-4xl font-bold leading-[1.05] tracking-tight text-[#0c3a3d] sm:text-5xl">
            Book an appointment in minutes.
          </h2>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-slate-600">
            Find a doctor by specialization, pick a real time slot, and
            follow your appointment from booking to completion — no phone
            tag, no double-booked slots.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 lg:justify-end">
          <Link
            href="/doctors"
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-[#0f5a5e] to-[#0a3d40] px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-teal-900/15 transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 active:scale-[0.98]"
          >
            Find doctors
            <span aria-hidden="true">→</span>
          </Link>
          <Link
            href="/register"
            className="inline-flex items-center rounded-full border border-[#0e4f52]/25 bg-white/70 px-7 py-3.5 text-sm font-semibold text-[#0c3a3d] transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 active:scale-[0.98]"
          >
            Create an account
          </Link>
        </div>
      </div>
    </section>
  );
}
