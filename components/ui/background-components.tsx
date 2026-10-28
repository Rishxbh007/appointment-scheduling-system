// Soft yellow glow accent layer for the sign-in page.
//
// Adapted from the supplied background component: the dead useState
// counter (never read, never rendered) was removed, the opacity was
// reduced from 0.6 to 0.45, and the layer was repositioned so its glow
// sits below the form's focal area instead of dead-centre behind it —
// so violet + yellow read as one restrained aurora, not a clash. The
// gradient string and the multiply blend are unchanged. No images and
// no icons: this layer needs neither, so the generic "Unsplash images"
// and "lucide-react icons" integration steps do not apply here.

export const Component = () => {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 top-[60%] h-[70vh] w-[120vw] -translate-x-1/2"
      style={{
        backgroundImage: `
        radial-gradient(circle at center, #FFF991 0%, transparent 70%)
      `,
        opacity: 0.45,
        mixBlendMode: "multiply",
      }}
    />
  );
};
