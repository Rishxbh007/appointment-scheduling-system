// OAuth start: redirect the person to the provider's authorisation
// page. No secrets leave the server — only the client id (public)
// and the callback URL travel in the redirect.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  parseOAuthProvider,
  buildAuthorizationUrl,
  randomState,
} from "@/lib/oauth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: raw } = await params;
  const provider = parseOAuthProvider(raw);
  if (!provider) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const state = randomState();
  const url = buildAuthorizationUrl(provider, state);
  if (!url) {
    // Provider env vars are missing: send the person back with a
    // clear message instead of a broken redirect.
    return NextResponse.redirect(
      new URL(
        `/login?error=oauth_not_configured&provider=${provider}`,
        request.url,
      ),
    );
  }
  const store = await cookies();
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10, // 10 minutes: long enough to sign in, then useless
  };
  store.set("oauth_state", state, options);
  store.set("oauth_provider", provider, options);
  return NextResponse.redirect(url);
}
