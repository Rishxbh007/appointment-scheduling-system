import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getSession } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { SiteFooter } from "@/components/site-footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CareBook — Appointment Booking",
  description:
    "Book appointments with doctors, track them from booking to completion.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Reading the session cookie makes the layout dynamic, which also
  // keeps `next build` from trying to prerender session-aware pages.
  const session = await getSession();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-page text-ink">
        {/* relative z-10: the register page's ambient wash is a fixed
          z-0 layer, so the header must sit above it to stay crisp.
          No visual change on any other page (no other page renders a
          fixed background layer). */}
        <header className="relative z-10 border-b border-border bg-surface">
          <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link
              href="/"
              className="text-xl font-bold tracking-tight text-ink"
            >
              CareBook
            </Link>
            <div className="flex items-center gap-2 sm:gap-4">
              <Link
                href="/doctors"
                className="text-sm font-medium text-ink-soft hover:text-ink hover:underline"
              >
                Doctors
              </Link>
              {session ? (
                <>
                  <Link
                    href="/dashboard"
                    className="text-sm font-medium text-ink-soft hover:text-ink hover:underline"
                  >
                    Dashboard
                  </Link>
                  <form action={logoutAction}>
                    <Button variant="outline" size="sm" type="submit">
                      Sign out
                    </Button>
                  </form>
                </>
              ) : (
                <>
                  <Link
                    href="/auth/start"
                    className="hidden text-sm font-medium text-ink-soft hover:text-ink hover:underline sm:inline"
                  >
                    Get started
                  </Link>
                  <Link
                    href="/login"
                    className="text-sm font-medium text-ink-soft hover:text-ink hover:underline"
                  >
                    Sign in
                  </Link>
                  <Link href="/register">
                    <Button size="sm">Register</Button>
                  </Link>
                </>
              )}
            </div>
          </nav>
        </header>
        <main className="flex-1">{children}</main>
        {/* Site footer, hidden on the auth-flow pages (/login,
          /register, /auth/start) so those pages end cleanly at their
          own background with no white strip underneath. */}
        <SiteFooter />
      </body>
    </html>
  );
}
