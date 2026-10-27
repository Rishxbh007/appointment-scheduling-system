// OAuth callback: verify state, exchange the code, then either sign
// the person in (existing account with this provider) or send them
// to /auth/choose-role (first-time user — role choice comes before
// any account is created). An email that already belongs to a
// different provider's account is refused, never linked or taken over.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { signSession, setSessionCookie } from "@/lib/auth";
import {
  parseOAuthProvider,
  providerLabel,
  exchangeCode,
  signPendingOAuth,
} from "@/lib/oauth";

function loginRedirect(
  request: Request,
  error: string,
  provider: string,
): NextResponse {
  return NextResponse.redirect(
    new URL(`/login?error=${error}&provider=${provider}`, request.url),
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: raw } = await params;
  const provider = parseOAuthProvider(raw);
  if (!provider) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const store = await cookies();
  const search = new URL(request.url).searchParams;

  if (search.get("error")) {
    return loginRedirect(request, "oauth_denied", provider);
  }

  // State check: the state must match the cookie set by the start
  // route, for the same provider. Anything else is rejected.
  const state = search.get("state");
  const code = search.get("code");
  const savedState = store.get("oauth_state")?.value;
  const savedProvider = store.get("oauth_provider")?.value;
  store.delete("oauth_state");
  store.delete("oauth_provider");
  if (
    !state ||
    !code ||
    !savedState ||
    state !== savedState ||
    savedProvider !== provider
  ) {
    return loginRedirect(request, "oauth_state", provider);
  }

  const profile = await exchangeCode(provider, code).catch(() => null);
  if (!profile) {
    return loginRedirect(request, "oauth_failed", provider);
  }

  await ensureDb();
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, profile.email));
  if (existing) {
    if (existing.authProvider !== providerLabel(provider)) {
      // Never link or take over an account from another provider.
      return loginRedirect(request, "account_exists", provider);
    }
    await setSessionCookie(
      signSession(existing.userId, existing.role as "Patient" | "Doctor"),
    );
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // First-time user: seal the verified profile and ask for a role
  // before creating anything.
  const pending = signPendingOAuth(profile);
  const response = NextResponse.redirect(
    new URL("/auth/choose-role", request.url),
  );
  response.cookies.set("oauth_pending", pending, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  });
  return response;
}
