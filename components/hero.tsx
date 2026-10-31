import Link from "next/link";
import {
  Calendar,
  MessageCircle,
  Search,
  Stethoscope,
} from "lucide-react";

// CareBook hero — Design 6, "Sunrise Motion", built to match the mockup:
// - Warm cream background with LARGE bold mint → peach → pink gradient
//   washes on the right (slow CSS drift, never distracting).
// - Very large elegant serif headline in dark ink, pill CTAs in deep teal.
// - Doctor visual: the real portrait FRAMED in a rounded card, like the
//   mockup — the cutout sits on a mint → cream → peach gradient inside
//   the frame, so it reads as a photo card.
// - Floating elements in the mockup's positions, kept CLEAR OF THE
//   FACE: the real doctor card (Ananya Sharma, General Physician,
//   ₹500 — real listing data, linking to the doctors list) overlaps
//   the frame's bottom-left, 10:30 AM mint pill top-right, 2:00 PM
//   peach pill top-left corner, Consultation card bottom-right. The
//   face sits upper-centre, so no floating element touches it. On
//   mobile every floating element stacks below the frame instead, so
//   nothing can overlap.
// - Step pills (find a doctor / pick a time / visit) sit under the
//   CTAs and link to the doctors list.
// No statistics anywhere, per the standing rule.
export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-[linear-gradient(180deg,#fdf9ec_0%,#fdf3dd_55%,#fdeed3_100%)]">
      {/* Bold gradient blobs — the mockup's washes */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="sunrise-blob absolute -right-40 top-[-6rem] h-[38rem] w-[38rem] rounded-full bg-[#a8dccf] opacity-80 blur-3xl" />
        <div className="sunrise-blob absolute right-[2%] top-[38%] h-[30rem] w-[30rem] rounded-full bg-[#f9cfa8] opacity-80 blur-3xl [animation-delay:-8s]" />
        <div className="absolute -bottom-32 right-[8%] h-[26rem] w-[26rem] rounded-full bg-[#f6c9c0] opacity-60 blur-3xl" />
      </div>

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-28 sm:pt-32 lg:grid-cols-[1.05fr_0.95fr]">
        {/* Copy */}
        <div>
          <h1 className="sunrise-rise font-serif text-6xl font-bold leading-[1.02] tracking-tight text-[#1a2e35] sm:text-7xl lg:text-[7rem]">
            Care, on
            <br />
            your time.
          </h1>
          <p
            className="sunrise-rise mt-6 max-w-md text-base leading-relaxed text-slate-600"
            style={{ animationDelay: "0.1s" }}
          >
            Book appointments easily with trusted doctors. Simple, fast,
            and right when you need care.
          </p>
          <div
            className="sunrise-rise mt-8 flex flex-wrap items-center gap-3"
            style={{ animationDelay: "0.2s" }}
          >
            <Link
              href="/doctors"
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-[#0f5a5e] to-[#0a3d40] px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-teal-900/15 transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 active:scale-[0.98]"
            >
              Book Appointment
              <span aria-hidden="true">→</span>
            </Link>
            <Link
              href="#how-it-works"
              className="inline-flex items-center rounded-full border border-[#0f5a5e]/30 bg-white/60 px-7 py-3.5 text-sm font-semibold text-[#0f5a5e] backdrop-blur transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 active:scale-[0.98]"
            >
              How it works
            </Link>
          </div>

          {/* Step pills */}
          <ul
            id="how-it-works"
            className="mt-10 flex flex-wrap gap-2"
            aria-label="How booking works"
          >
            {[
              { label: "find a doctor", icon: <Search size={15} /> },
              { label: "pick a time", icon: <Calendar size={15} /> },
              { label: "visit", icon: <Stethoscope size={15} /> },
            ].map((step, i) => (
              <li
                key={step.label}
                className="sunrise-rise"
                style={{ animationDelay: `${0.3 + i * 0.1}s` }}
              >
                <Link
                  href="/doctors"
                  className="inline-flex items-center gap-2 rounded-full border border-[#0f5a5e]/20 bg-white/70 px-5 py-2.5 text-sm font-medium text-[#123332] backdrop-blur transition hover:bg-white hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
                >
                  <span className="text-[#0f766e]">{step.icon}</span>
                  {step.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Visual — framed portrait, mockup layout */}
        <div className="relative mx-auto w-full max-w-md">
          {/* Framed portrait: cutout on a mint → cream → peach gradient,
            like the mockup's photo card. */}
          <div
            className="sunrise-rise relative aspect-[4/5] overflow-hidden rounded-[2rem] bg-[linear-gradient(160deg,#cdeae2_0%,#fdf3dd_55%,#f9cfa8_100%)] shadow-xl shadow-slate-900/10"
            style={{ animationDelay: "0.1s" }}
          >
            <img
              src="/images/hero-doctor-cutout-v2.png"
              alt="Doctor smiling in a white coat"
              className="absolute inset-0 h-full w-full object-cover object-top"
            />
          </div>

          {/* Floating time pill, top-right — leads to the doctors list,
            where real slots live. */}
          <Link
            href="/doctors"
            aria-label="Browse doctors and pick a time"
            className="sunrise-float rounded-full border border-white/70 bg-[#cdeae2]/90 px-5 py-2.5 text-sm font-semibold text-[#123332] shadow-xl shadow-slate-900/5 backdrop-blur-md transition hover:bg-[#cdeae2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 max-sm:static max-sm:mt-3 max-sm:block max-sm:w-fit sm:absolute sm:-right-4 sm:top-6"
          >
            10:30 AM
          </Link>

          {/* Floating card: doctor — overlaps the frame's bottom-left on
            desktop, clear of the face; on mobile it sits below the frame
            instead. */}
          <div className="sunrise-float rounded-2xl border border-white/70 bg-white/80 p-4 shadow-xl shadow-slate-900/5 backdrop-blur-md [animation-delay:0.8s] max-sm:static max-sm:mt-3 max-sm:w-full sm:absolute sm:-left-6 sm:bottom-6 sm:w-60">
            <div className="flex items-center gap-3">
              <img
                src="/images/hero-doctor-cutout-v2.png"
                alt=""
                className="h-11 w-11 rounded-full object-cover object-top"
              />
              <span>
                <span className="block text-sm font-semibold text-[#123332]">
                  Dr. Ananya Sharma
                </span>
                <span className="block text-xs text-slate-500">
                  General Physician
                </span>
                <span className="block text-xs font-medium text-[#0e4f52]">
                  ₹500 consultation
                </span>
              </span>
            </div>
            <div className="my-3 border-t border-slate-100" />
            <p className="text-xs text-slate-500">Today, 10:00 AM</p>
            <Link
              href="/doctors"
              className="mt-2 block rounded-full bg-gradient-to-b from-[#0f5a5e] to-[#0a3d40] py-2.5 text-center text-xs font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 active:scale-[0.98]"
            >
              Book Now
            </Link>
          </div>

          {/* Floating time pill, top-left corner — leads to the doctors list. */}
          <Link
            href="/doctors"
            aria-label="Browse doctors and pick a time"
            className="sunrise-float rounded-full border border-white/70 bg-[#fde3c8]/90 px-5 py-2.5 text-sm font-semibold text-[#123332] shadow-xl shadow-slate-900/5 backdrop-blur-md transition hover:bg-[#fde3c8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 [animation-delay:1.2s] max-sm:static max-sm:mt-3 max-sm:block max-sm:w-fit sm:absolute sm:-left-4 sm:top-6"
          >
            2:00 PM
          </Link>

          {/* Floating card: consultation — bottom-right on desktop,
            stacks below the frame on mobile. */}
          <Link
            href="/doctors"
            aria-label="Browse doctors and pick a time"
            className="sunrise-float rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-xl shadow-slate-900/5 backdrop-blur-md transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 [animation-delay:1.6s] max-sm:static max-sm:mt-3 max-sm:block max-sm:w-full sm:absolute sm:-right-4 sm:bottom-6 sm:w-56"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-[#123332]">
              <MessageCircle className="h-4 w-4 text-[#0f766e]" />
              Consultation
            </span>
            <span className="mt-1 block text-xs text-slate-500">
              Today · 2:00 PM
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}
