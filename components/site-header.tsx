"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";

// Site header. On the landing page ("/") it floats transparently over
// the hero gradient — no white bar, no border — so the header and hero
// read as one continuous composition. Everywhere else it renders the
// original white bar, unchanged. Link destinations are identical in
// both variants; only the wordmark (CAREBOOK), the middle navigation
// placement, and the pill buttons are new.
//
// Role-aware navigation: a signed-in doctor is never pushed to browse
// doctors — his middle links are Dashboard and his own public
// profile. Patients keep Doctors + Dashboard; signed-out visitors
// keep Doctors. The header itself stays presentational: the layout
// resolves the doctor's profile id server-side.
export function SiteHeader({
  signedIn,
  role,
  doctorId,
}: {
  signedIn: boolean;
  role: "Patient" | "Doctor" | null;
  doctorId: number | null;
}) {
  const pathname = usePathname();
  const isHome = pathname === "/";

  const wordmarkClass = isHome
    ? "text-xl font-bold tracking-[0.08em] text-[#0c3a3d]"
    : "text-xl font-bold tracking-[0.08em] text-ink";
  const navLinkClass = isHome
    ? "text-sm font-medium text-[#0c3a3d]/80 transition-colors hover:text-[#0c3a3d]"
    : "text-sm font-medium text-ink-soft hover:text-ink hover:underline";

  return (
    <header
      className={
        isHome
          ? "absolute inset-x-0 top-0 z-50"
          : "relative z-10 border-b border-border bg-surface"
      }
    >
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className={wordmarkClass}>
          CAREBOOK
        </Link>

        {/* Middle navigation — always visible, compact on mobile.
          Doctors get Dashboard + their own profile; everyone else
          gets the doctor-browsing list. */}
        <div className="flex items-center gap-4 md:gap-6">
          {role === "Doctor" ? (
            <>
              {signedIn && (
                <Link href="/dashboard" className={navLinkClass}>
                  Dashboard
                </Link>
              )}
              <Link
                href={doctorId ? `/doctors/${doctorId}` : "/dashboard"}
                className={navLinkClass}
              >
                My profile
              </Link>
            </>
          ) : (
            <>
              <Link href="/doctors" className={navLinkClass}>
                Doctors
              </Link>
              {signedIn && (
                <Link href="/dashboard" className={navLinkClass}>
                  Dashboard
                </Link>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          {signedIn ? (
            <form action={logoutAction}>
              <Button
                variant="outline"
                size="sm"
                type="submit"
                className="rounded-full"
              >
                Sign out
              </Button>
            </form>
          ) : (
            <>
              <Link
                href="/auth/start"
                className={`${navLinkClass} hidden sm:inline`}
              >
                Get started
              </Link>
              <Link href="/login" className={navLinkClass}>
                Sign in
              </Link>
              <Link href="/register">
                <Button size="sm" className="rounded-full">
                  Register
                </Button>
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
