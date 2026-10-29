import { Calendar, Heart, Monitor, User } from "lucide-react";

// "Healthcare, made simple" section, following the redesign brief:
// two columns — heading + copy on the left, four feature items on the
// right — with NO bordered cards, NO grid of white rectangles, and NO
// circles behind the icons. The richness comes from typography,
// spacing, and a subtle hover lift on each item.
//
// Honesty adjustments to the reference copy (no invented claims):
// - "Verified" dropped: the app auto-approves new doctors, so no
//   verification claim is made.
// - "records" narrowed to appointment status: the app tracks
//   appointments, not medical records.
// No statistics anywhere, per the standing rule.

const features = [
  {
    icon: User,
    title: "Trusted Doctors",
    text: "Experienced and caring professionals.",
  },
  {
    icon: Calendar,
    title: "Easy Booking",
    text: "Find and book appointments in minutes.",
  },
  {
    icon: Heart,
    title: "Manage Your Health",
    text: "Keep track of your appointments and their status.",
  },
  {
    icon: Monitor,
    title: "Accessible Care",
    text: "In-person or online, at your convenience.",
  },
];

export default function WhyCareBook() {
  return (
    <section className="bg-white">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:py-24 lg:grid-cols-2">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-[#e6f4f1] px-3 py-1 text-xs font-medium text-[#0c3a3d]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#0e4f52]" />
            Why CareBook
          </p>
          <h2 className="mt-5 font-serif text-5xl font-bold leading-[1.05] tracking-tight text-[#0c3a3d] sm:text-6xl">
            Healthcare,
            <br />
            made simple.
          </h2>
          <p className="mt-5 max-w-md text-base leading-relaxed text-slate-600">
            We connect you with qualified doctors, flexible scheduling,
            and a seamless booking experience — so you can focus on what
            matters most: your health.
          </p>
        </div>

        <div className="grid gap-x-10 gap-y-12 sm:grid-cols-2">
          {features.map(({ icon: Icon, title, text }) => (
            <div key={title} className="group">
              <Icon
                size={26}
                strokeWidth={1.8}
                className="text-[#0e4f52] transition-transform duration-300 group-hover:-translate-y-0.5"
              />
              <p className="mt-4 text-base font-semibold text-[#0c3a3d] transition-colors duration-300 group-hover:text-[#0e4f52]">
                {title}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                {text}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
