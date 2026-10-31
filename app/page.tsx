import Hero from "@/components/hero";
import BookingCTA from "@/components/booking-cta";
import WhyCareBook from "@/components/why-carebook";

// Landing page — Design 6 (Sunrise Motion) hero, then booking CTA,
// "Healthcare, made simple", footer (from the layout). The hero itself
// carries the find-a-doctor / pick-a-time / visit step pills; there is
// no separate steps section and no doctors preview, and doctors stay
// one click away via Find doctors.
export default function Home() {
  return (
    <>
      <Hero />
      <BookingCTA />
      <WhyCareBook />
    </>
  );
}
