"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowRight,
  Bell,
  Home,
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
// stretches toward the item you pick. The pill holds three tabs for every
// role — Home, Doctors (or Dashboard + My profile for doctors), and
// Dashboard / Get started — so it reads as a real nav bar, not a
// two-item switch. Destinations and role rules are the old ones — a
// signed-in doctor is never pushed to browse doctors (Dashboard + his
// own public profile), patients keep Doctors + Dashboard, signed-out
// visitors get Doctors + Get started instead of Dashboard.
// Get started lives in the pill now, so the old standalone link on the
// right is gone (no duplicate). The auth-flow pages (/login, /register,
// /auth/*) keep the classic text links, so the auth pages stay exactly
// as designed. Sign out / Sign in / Register stay outside the pill, and
// the layout still resolves the doctor's profile id server-side.
//
// Navigation is client-side: the pill's onChange routes with
// next/navigation instead of following hrefs, so tapping a tab never
// reloads the page — the nav stays mounted, the drop stretches to the
// new item, and the WebGL water keeps flowing. (The pill still renders
// real anchors, so right-click / middle-click open the href normally.)
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
  const router = useRouter();
  // Optimistic tab: the drop starts stretching toward the tapped item
  // the instant it is tapped, instead of waiting for the navigation
  // round-trip — that wait is what read as "lag". Derived, not synced
  // by effect: the pending tab overrides only while the route still
  // differs from its href, so the moment the route lands, the real
  // active tab (same index) takes over with no jump. A failed
  // navigation reloads the page anyway, resetting state.
  const [pending, setPending] = useState<{
    index: number;
    href: string;
  } | null>(null);
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
  // three tabs for every role.
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
  }

  // Active pill follows the route, so the drop sits on the page you
  // are actually on (doctor profiles highlight Doctors, except a
  // doctor's own profile, which highlights My profile). Get started is
  // never "active" by path — it is an entry point, so the drop stays on
  // Home / Doctors while on it.
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

  // The tab the pill actually shows: the pending tab while its route
  // has not landed yet, otherwise the route's own tab.
  const active =
    pending && pathname !== pending.href ? pending.index : activeIndex;

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
              active={active}
              tone="light"
              sound={false}
              onChange={(_i, item) => {
                if (item.href) {
                  setPending({ index: _i, href: item.href });
                  router.push(item.href);
                }
              }}
            />
          </div>
        )}

        <div className="flex items-center gap-2 sm:gap-4">
          {signedIn && (
            <Link
              href="/dashboard/notifications"
              aria-label="Notifications"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-ink-soft transition-colors hover:text-ink"
            >
              <Bell size={18} strokeWidth={1.8} />
            </Link>
          )}
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
