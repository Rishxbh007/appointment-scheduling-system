"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Restrained footer: no bordered panel, no background strip — just the
// wordmark and the supported links, sitting on the page background.
// Auth-flow pages end cleanly at their own background: no footer
// underneath them. Exact matches only (usePathname strips query
// strings, so /login?role=… still matches); /auth/choose-role is
// deliberately NOT in this list.
const HIDDEN_PATHS = ["/login", "/register", "/auth/start", "/auth/consent"];

export function SiteFooter({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  const normalized =
    pathname && pathname.length > 1
      ? pathname.replace(/\/+$/, "")
      : pathname;
  if (normalized && HIDDEN_PATHS.includes(normalized)) return null;

  return (
    <footer className="py-6">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 sm:flex-row">
        <Link
          href="/"
          className="text-sm font-bold tracking-[0.08em] text-ink"
        >
          CAREBOOK
        </Link>
        <nav className="flex items-center gap-5 text-sm text-ink-soft">
          <Link href="/doctors" className="transition-colors hover:text-ink">
            Doctors
          </Link>
          {signedIn ? (
            <Link
              href="/dashboard"
              className="transition-colors hover:text-ink"
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="transition-colors hover:text-ink"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="transition-colors hover:text-ink"
              >
                Register
              </Link>
            </>
          )}
        </nav>
      </div>
    </footer>
  );
}
