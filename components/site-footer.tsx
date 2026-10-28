"use client";

import { usePathname } from "next/navigation";

// Auth-flow pages end cleanly at their own background: no site footer
// strip underneath them. Every other page keeps the footer. Exact
// matches only (usePathname strips query strings, so /login?role=…
// still matches); /auth/choose-role is deliberately NOT in this list.
const HIDDEN_PATHS = ["/login", "/register", "/auth/start"];

export function SiteFooter() {
  const pathname = usePathname();
  const normalized =
    pathname && pathname.length > 1
      ? pathname.replace(/\/+$/, "")
      : pathname;
  if (normalized && HIDDEN_PATHS.includes(normalized)) return null;

  return (
    <footer className="border-t border-border bg-surface py-4">
      <p className="mx-auto max-w-6xl px-4 text-center text-xs text-ink-faint">
        CareBook — appointment booking for patients and doctors.
      </p>
    </footer>
  );
}
