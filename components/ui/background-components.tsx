// Soft yellow ambient wash for the REGISTER page ONLY.
//
// Full-viewport fixed layer: one even, subtle yellow wash across the
// whole viewport, strongest at the top and fading gently downward —
// no blob, no mid-page edge, no white-top/yellow-bottom split. The
// previous geometry (an absolute 70vh-tall, 120vw-wide blob centred
// at 60% height inside a min-h-dvh wrapper) drew a visible horizontal
// edge straight through the middle of the form on any page taller
// than the viewport; this replaces it. All gradient stops share one
// hue and differ only in alpha, so there is no boundary line anywhere
// through the content — the wash simply thins toward the bottom.
// Yellow only: the violet radial belongs to the login page and is
// never rendered here. The layer is fixed (not absolute) so it cannot
// develop an edge if the page ever grows, sits behind content (z-0;
// page content and the site header are z-10), ignores pointer events,
// and is hidden from assistive tech. No images, no icons, no
// dependencies. This component has exactly one caller (RegisterForm);
// the login page uses the violet snippet instead.

export const Component = () => {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0"
      style={{
        backgroundImage: `
          radial-gradient(130% 100% at 50% 0%, rgba(255, 249, 145, 0.55) 0%, rgba(255, 249, 145, 0.28) 45%, rgba(255, 249, 145, 0.10) 100%)
        `,
      }}
    />
  );
};
