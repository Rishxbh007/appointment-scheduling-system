import Hero from "@/components/hero";
import BookingCTA from "@/components/booking-cta";
import WhyCareBook from "@/components/why-carebook";

// Landing page, per the redesign brief — exactly five parts:
// header (from the layout, floating transparently over the hero),
// hero, booking CTA, "Healthcare, made simple", footer (from the
// layout). No steps cards, no doctors preview, no tide word: the brief
// fixes this order, and doctors stay one click away via Find doctors.
export default function Home() {
  return (
    <>
      <Hero />
      <BookingCTA />
      <WhyCareBook />
    </>
  );
}
