import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getSession } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";

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
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white">
          <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-xl font-bold tracking-tight">
              CareBook
            </Link>
            <div className="flex items-center gap-2 sm:gap-4">
              <Link
                href="/doctors"
                className="text-sm font-medium hover:underline"
              >
                Doctors
              </Link>
              {session ? (
                <>
                  <Link
                    href="/dashboard"
                    className="text-sm font-medium hover:underline"
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
                    href="/login"
                    className="text-sm font-medium hover:underline"
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
        <footer className="border-t border-slate-200 bg-white py-4">
          <p className="mx-auto max-w-6xl px-4 text-center text-xs text-slate-500">
            CareBook — appointment booking for patients and doctors.
          </p>
        </footer>
      </body>
    </html>
  );
}
