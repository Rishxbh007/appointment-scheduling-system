"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowRight,
  Home,
  Info,
  LayoutDashboard,
  Stethoscope,
  User,
} from "lucide-react";
import { logoutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import {
  CareBookNav,
  type CareBookNavItem,
} from "@/components/ui/liquid-glass-navbar";

// Site header. On the landing page ("/") it floats transparently over
// the hero gradient — no white bar, no border — so the header and hero
// read as one continuous composition. Everywhere else it renders the
// original white bar, unchanged.
//
// Middle navigation is the CareBook liquid nav (warm cream + deep teal,
// matched to the Sunrise Motion landing design): a water-drop pill that
// stretches toward the item you pick. The pill holds four tabs for every
// role — Home, Doctors (or Dashboard + My profile for doctors),
// Dashboard / Get started, and How it works — so it reads as a real nav
// bar, not a two-item switch. Destinations and role rules are the old
// ones — a signed-in doctor is never pushed to browse doctors (Dashboard
// + his own public profile), patients keep Doctors + Dashboard,
// signed-out visitors get Doctors + Get started instead of Dashboard.
// Get started lives in the pill now, so the old standalone link on the
// right is gone (no duplicate). The auth-flow pages (/login, /register,
// /auth/*) keep the classic text links, so the auth pages stay exactly
// as designed. Sign out / Sign in / Register stay outside the pill, and
// the layout still resolves the doctor's profile id server-side.
//
// On phones the pill drops to a centred second row, so the wordmark and
// the actions never overflow a 360px screen.
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
  const isAuth =
    pathname === "/login" ||
    pathname === "/register" ||
    pathname.startsWith("/auth");

  const wordmarkClass = isHome
    ? "text-lg font-bold tracking-[0.08em] text-[#123332] sm:text-xl"
    : "text-lg font-bold tracking-[0.08em] text-ink sm:text-xl";
  const navLinkClass = isHome
    ? "text-sm font-medium text-[#123332]/80 transition-colors hover:text-[#123332]"
    : "text-sm font-medium text-ink-soft hover:text-ink hover:underline";

  // Liquid-nav items, built from the same role rules as the old links,
  // four tabs for every role.
  const items: CareBookNavItem[] = [
    {
      label: "Home",
      href: "/",
      icon: <Home size={18} strokeWidth={1.8} />,
      fx: "glow",
    },
  ];
  if (role === "Doctor") {
    items.push(
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: <LayoutDashboard size={18} strokeWidth={1.8} />,
        fx: "wave",
      },
      {
        label: "My profile",
        href: doctorId ? `/doctors/${doctorId}` : "/dashboard",
        icon: <User size={18} strokeWidth={1.8} />,
        fx: "spin",
      },
      {
        label: "How it works",
        href: "/#how-it-works",
        icon: <Info size={18} strokeWidth={1.8} />,
        fx: "pop",
      },
    );
  } else {
    items.push({
      label: "Doctors",
      href: "/doctors",
      icon: <Stethoscope size={18} strokeWidth={1.8} />,
      fx: "spin",
    });
    if (signedIn) {
      items.push({
        label: "Dashboard",
        href: "/dashboard",
        icon: <LayoutDashboard size={18} strokeWidth={1.8} />,
        fx: "wave",
      });
    } else {
      items.push({
        label: "Get started",
        href: "/auth/start",
        icon: <ArrowRight size={18} strokeWidth={1.8} />,
        fx: "pop",
      });
    }
    items.push({
      label: "How it works",
      href: "/#how-it-works",
      icon: <Info size={18} strokeWidth={1.8} />,
      fx: "pop",
    });
  }

  // Active pill follows the route, so the drop sits on the page you
  // are actually on (doctor profiles highlight Doctors, except a
  // doctor's own profile, which highlights My profile). How it works
  // and Get started are never "active" by path — they are anchors and
  // entry points, so the drop stays on Home / Doctors while on them.
  let activeIndex = 0;
  if (pathname === "/") {
    activeIndex = 0;
  } else if (pathname.startsWith("/doctors")) {
    const profileIdx = items.findIndex((i) => i.label === "My profile");
    const doctorsIdx = items.findIndex((i) => i.label === "Doctors");
    activeIndex =
      role === "Doctor" &&
      doctorId &&
      pathname === `/doctors/${doctorId}` &&
      profileIdx >= 0
        ? profileIdx
        : doctorsIdx >= 0
          ? doctorsIdx
          : 0;
  } else if (pathname === "/dashboard") {
    const dashIdx = items.findIndex((i) => i.label === "Dashboard");
    activeIndex = dashIdx >= 0 ? dashIdx : 0;
  }

  return (
    <header
      className={
        isHome
          ? "absolute inset-x-0 top-0 z-50"
          : "relative z-10 border-b border-border bg-surface"
      }
    >
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-3 py-3 sm:gap-4 sm:px-4">
        <Link href="/" className={wordmarkClass}>
          CAREBOOK
        </Link>

        {/* Middle navigation — liquid pill on site pages, classic
          text links on the auth-flow pages. */}
        {isAuth ? (
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
        ) : (
          <div className="order-3 mt-2 flex w-full justify-center sm:order-none sm:mt-0 sm:w-auto">
            <CareBookNav
              items={items}
              active={activeIndex}
              tone="light"
              sound={false}
            />
          </div>
        )}

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
