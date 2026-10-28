// Giant CareBook wordmark for the sign-in page.
//
// Design language adapted from the TIDE landing screenshot the user
// supplied: one gigantic bold dark-teal wordmark filling the width,
// generous white space around it, minimal footer cues. Only the
// language is replicated — the word is CareBook's own, and there is no
// "scroll to enter" behaviour: this is a static hero above the card.
// The size scales with the viewport (vw units with a desktop cap) so
// the wordmark fills the width on a phone without ever overflowing
// it, and the text stays on one line at every width.

export function LoginWordmark() {
  return (
    <p
      aria-label="CareBook"
      className="text-center text-[15vw] leading-none font-extrabold tracking-[-0.04em] whitespace-nowrap text-brand-950 sm:text-[12vw] lg:text-[148px]"
    >
      CAREBOOK
    </p>
  );
}
