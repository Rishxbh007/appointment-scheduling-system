import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getSession } from "@/lib/auth";
import { ensureDb } from "@/lib/db";
import { getDoctorIdByUser } from "@/lib/services/accounts";
import { SiteHeader } from "@/components/site-header";
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
  // A doctor's header links to his own public profile, never to the
  // doctor-browsing list — resolving the id here keeps the client
  // header a pure presentational component.
  let doctorId: number | null = null;
  if (session?.role === "Doctor") {
    await ensureDb();
    doctorId = await getDoctorIdByUser(session.userId);
  }

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-page text-ink">
        {/* SiteHeader floats transparently over the landing hero and
          renders the original white bar everywhere else. The register
          page's ambient wash is a fixed z-0 layer, so the header sits
          above it (z-10/z-50) to stay crisp. */}
        <SiteHeader
          signedIn={!!session}
          role={session?.role ?? null}
          doctorId={doctorId}
        />
        <main className="flex-1">{children}</main>
        {/* Site footer, hidden on the auth-flow pages (/login,
          /register, /auth/start, /auth/consent) so those pages end cleanly at their
          own background with no white strip underneath. */}
        <SiteFooter signedIn={!!session} />
      </body>
    </html>
  );
}
