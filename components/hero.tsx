import Link from "next/link";
import { Calendar, Check } from "lucide-react";

// CareBook hero, following the redesign brief:
// - Full-bleed mint → aqua → ivory gradient, continuous with the
//   transparent header above it (the header floats over this section,
//   so the top padding below clears it).
// - Large serif headline, pill CTA with a subtle teal gradient.
// - Doctor visual: a real photograph with the background removed
//   (transparent PNG), sitting directly on the gradient — NO frame,
//   NO circle, NO border, NO shadow, NO hard-edged cutout. A soft
//   bottom fade dissolves her lower body into the gradient.
// - Floating cards are restrained, translucent product UI — they never
//   cover her face.
// No statistics anywhere, per the standing rule. The doctor card shows
// only real public listing data (name, specialization, fee) and links
// to the real doctors page.
export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-[linear-gradient(115deg,#dff3ef_0%,#eefaf6_45%,#fdf6e3_100%)]">
      {/* Soft blended accents for the washed background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
      >
        <div className="absolute -right-24 top-10 h-96 w-96 rounded-full bg-[#cdeae2] opacity-60 blur-3xl" />
        <div className="absolute -left-24 bottom-0 h-80 w-80 rounded-full bg-[#fbeed3] opacity-70 blur-3xl" />
        <div className="absolute -bottom-20 right-1/4 h-72 w-72 rounded-full bg-[#fbeed3] opacity-60 blur-3xl" />
      </div>

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-28 sm:pt-32 lg:grid-cols-[1.05fr_0.95fr]">
        {/* Copy */}
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-[#0c3a3d]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#0e4f52]" />
            Better Care. Less Waiting.
          </p>
          <h1 className="mt-6 font-serif text-6xl font-bold leading-[1.02] tracking-tight text-[#0c3a3d] sm:text-7xl lg:text-[5.2rem]">
            Your Health,
            <br />
            Our Priority
          </h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-slate-600">
            Book appointments with trusted doctors, manage your health,
            and get the care you deserve — all in one place.
          </p>
          <div className="mt-8">
            <Link
              href="/doctors"
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-[#0f5a5e] to-[#0a3d40] px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-teal-900/15 transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 active:scale-[0.98]"
            >
              Book an appointment
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>

        {/* Visual — blended portrait, no frame */}
        <div className="relative mx-auto w-full max-w-lg">
          {/* Soft glow so the portrait's light background melts into
            the gradient instead of sitting on it. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 scale-90 rounded-full bg-[#d8efe8] opacity-70 blur-3xl"
          />
          <img
            src="/images/hero-doctor-cutout-v2.png"
            alt="Doctor smiling in a white coat"
            className="relative w-full [mask-image:linear-gradient(to_bottom,black_72%,transparent_98%)] [-webkit-mask-image:linear-gradient(to_bottom,black_72%,transparent_98%)]"
          />

          {/* Floating card: consultation */}
          <div className="absolute right-0 top-6 flex items-center gap-3 rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-xl shadow-slate-900/5 backdrop-blur-md sm:right-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e6f4f1] text-[#0e4f52]">
              <Calendar size={18} />
            </span>
            <span>
              <span className="block text-sm font-semibold text-[#0c3a3d]">
                Consultation
              </span>
              <span className="block text-xs text-slate-500">
                In-person or online
              </span>
            </span>
          </div>

          {/* Floating card: doctor — floats bottom-left on desktop;
            on mobile it sits below the portrait instead, so the two
            cards can never stack on top of each other. */}
          <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-xl shadow-slate-900/5 backdrop-blur-md max-sm:static max-sm:mt-3 max-sm:w-full sm:absolute sm:bottom-24 sm:left-0 sm:w-60 sm:-left-4">
            <div className="flex items-center gap-3">
              <img
                src="/images/hero-doctor-cutout-v2.png"
                alt=""
                className="h-11 w-11 rounded-full object-cover object-top"
              />
              <span>
                <span className="block text-sm font-semibold text-[#0c3a3d]">
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

          {/* Floating card: journey — floats bottom-right on desktop;
            on mobile it sits below the portrait instead, so it can
            never cover the doctor card's Book Now button. */}
          <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-xl shadow-slate-900/5 backdrop-blur-md max-sm:static max-sm:mt-3 max-sm:w-full sm:absolute sm:bottom-2 sm:right-0 sm:w-56 sm:-right-2">
            <p className="text-sm font-semibold text-[#0c3a3d]">
              Your Health Journey
            </p>
            <ul className="mt-3 space-y-2">
              {["Book Appointment", "Consult with Doctor", "Get Better"].map(
                (step) => (
                  <li
                    key={step}
                    className="flex items-center gap-2 text-xs text-slate-600"
                  >
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#e6f4f1] text-[#0e4f52]">
                      <Check size={11} strokeWidth={3} />
                    </span>
                    {step}
                  </li>
                ),
              )}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
