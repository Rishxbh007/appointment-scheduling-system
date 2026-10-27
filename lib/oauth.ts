// Server-side OAuth (Google, GitHub, Microsoft) for CareBook.
//
// Design notes:
// - No client secrets ever reach browser code. The authorisation URL
//   is built here (server) and the code exchange happens in the
//   callback route handler, also server-side.
// - State protection: the start route stores a random state token in
//   an HTTP-only cookie; the callback route only proceeds when the
//   `state` query value matches it exactly, then deletes the cookie.
// - First-time OAuth users do NOT get an account immediately. The
//   callback stores their verified profile (email, name, provider)
//   in a short-lived JWT sealed in an HTTP-only cookie, and sends
//   them to /auth/choose-role. Only the role-choice server action
//   creates the user + exactly one profile row.
// - No new database tables. OAuth users live in the existing users
//   table with auth_provider 'Google' or 'GitHub'. password_hash is
//   NOT NULL in the schema, so OAuth users get a bcrypt hash of a
//   random, never-shared string (see randomUnusablePasswordHash).
//   Nobody can sign in with it, and password sign-in is also
//   refused for non-Email accounts in loginAction.
// - If an OAuth email already belongs to a different provider's
//   account (including an email/password account), the callback
//   refuses with an "account already exists" error and never links
//   or takes over that account.

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export type OAuthProvider = "google" | "github" | "microsoft";

export type OAuthProfile = {
  email: string;
  name: string;
  provider: OAuthProvider;
};

export type PendingOAuth = OAuthProfile & { type: "oauth_pending" };

function jwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) {
    console.warn(
      "JWT_SECRET is not set; using a development-only fallback secret.",
    );
    return "dev-only-secret-change-me";
  }
  return s;
}

/** Public base URL of this deployment, no trailing slash. */
export function getBaseUrl(): string {
  const explicit =
    process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "";
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL || "";
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}

export function getOAuthCallbackUrl(provider: OAuthProvider): string {
  return `${getBaseUrl()}/api/auth/${provider}/callback`;
}

export function isOAuthConfigured(provider: OAuthProvider): boolean {
  if (provider === "google") {
    return Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
    );
  }
  if (provider === "github") {
    return Boolean(
      process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET,
    );
  }
  return Boolean(
    process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET,
  );
}

export function getOAuthAvailability(): {
  google: boolean;
  github: boolean;
  microsoft: boolean;
} {
  return {
    google: isOAuthConfigured("google"),
    github: isOAuthConfigured("github"),
    microsoft: isOAuthConfigured("microsoft"),
  };
}

export const OAUTH_PROVIDERS: OAuthProvider[] = [
  "google",
  "github",
  "microsoft",
];

export function parseOAuthProvider(value: string): OAuthProvider | null {
  return (OAUTH_PROVIDERS as string[]).includes(value)
    ? (value as OAuthProvider)
    : null;
}

export function providerLabel(provider: OAuthProvider): string {
  if (provider === "google") return "Google";
  if (provider === "github") return "GitHub";
  return "Microsoft";
}

export function randomState(): string {
  return randomBytes(32).toString("hex");
}

/** Bcrypt hash of a random string nobody knows — an unusable password. */
export function randomUnusablePasswordHash(): Promise<string> {
  const secret = `oauth-unusable-${randomBytes(32).toString("hex")}`;
  return bcrypt.hash(secret, 10);
}

export function buildGoogleAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function buildGitHubAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "user:email",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export function buildMicrosoftAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  // Converged endpoint: personal Microsoft accounts and work/school
  // accounts. Scope includes User.Read so the Graph profile call works.
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "openid profile email User.Read",
    state,
  });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
}

export function buildAuthorizationUrl(
  provider: OAuthProvider,
  state: string,
): string | null {
  const redirectUri = getOAuthCallbackUrl(provider);
  if (provider === "google") {
    const id = process.env.GOOGLE_CLIENT_ID;
    if (!id) return null;
    return buildGoogleAuthUrl(id, redirectUri, state);
  }
  if (provider === "github") {
    const id = process.env.GITHUB_CLIENT_ID;
    if (!id) return null;
    return buildGitHubAuthUrl(id, redirectUri, state);
  }
  const id = process.env.MICROSOFT_CLIENT_ID;
  if (!id) return null;
  return buildMicrosoftAuthUrl(id, redirectUri, state);
}

/** Seal a verified OAuth profile for the role-choice step (10 min). */
export function signPendingOAuth(profile: OAuthProfile): string {
  const payload: PendingOAuth = { ...profile, type: "oauth_pending" };
  return jwt.sign(payload, jwtSecret(), { expiresIn: "10m" });
}

/** Verify a pending-OAuth token. Returns null when absent/tampered/expired. */
export function verifyPendingOAuth(token: string | undefined): OAuthProfile | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, jwtSecret()) as unknown as PendingOAuth;
    if (payload.type !== "oauth_pending") return null;
    if (
      !(
        payload.provider === "google" ||
        payload.provider === "github" ||
        payload.provider === "microsoft"
      ) ||
      typeof payload.email !== "string" ||
      !payload.email.includes("@") ||
      typeof payload.name !== "string" ||
      payload.name.length === 0
    ) {
      return null;
    }
    return {
      email: payload.email,
      name: payload.name,
      provider: payload.provider,
    };
  } catch {
    return null;
  }
}

async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
): Promise<OAuthProfile | null> {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return null;
  const tokens = (await tokenRes.json()) as { access_token?: string };
  if (!tokens.access_token) return null;
  const profileRes = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    { headers: { Authorization: `Bearer ${tokens.access_token}` } },
  );
  if (!profileRes.ok) return null;
  const info = (await profileRes.json()) as {
    email?: string;
    email_verified?: boolean;
    name?: string;
  };
  if (!info.email || info.email_verified === false) return null;
  const email = info.email.trim().toLowerCase();
  const name = (info.name ?? "").trim() || email.split("@")[0];
  return { email, name, provider: "google" };
}

async function exchangeGitHubCode(
  code: string,
  redirectUri: string,
): Promise<OAuthProfile | null> {
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      code,
      client_id: process.env.GITHUB_CLIENT_ID ?? "",
      client_secret: process.env.GITHUB_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) return null;
  const tokens = (await tokenRes.json()) as { access_token?: string };
  if (!tokens.access_token) return null;
  const headers = {
    Authorization: `Bearer ${tokens.access_token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "CareBook",
  };
  const userRes = await fetch("https://api.github.com/user", { headers });
  if (!userRes.ok) return null;
  const user = (await userRes.json()) as {
    login?: string;
    name?: string | null;
    email?: string | null;
  };
  let email = (user.email ?? "").trim().toLowerCase();
  if (!email) {
    const emailsRes = await fetch("https://api.github.com/user/emails", {
      headers,
    });
    if (!emailsRes.ok) return null;
    const emails = (await emailsRes.json()) as Array<{
      email: string;
      primary: boolean;
      verified: boolean;
    }>;
    const picked =
      emails.find((e) => e.primary && e.verified) ??
      emails.find((e) => e.verified);
    if (!picked) return null;
    email = picked.email.trim().toLowerCase();
  }
  if (!email) return null;
  const name =
    (user.name ?? "").trim() || user.login || email.split("@")[0];
  return { email, name, provider: "github" };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = Buffer.from(
      part.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function exchangeMicrosoftCode(
  code: string,
  redirectUri: string,
): Promise<OAuthProfile | null> {
  const tokenRes = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.MICROSOFT_CLIENT_ID ?? "",
        client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    },
  );
  if (!tokenRes.ok) return null;
  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    id_token?: string;
  };
  // The ID token comes straight from Microsoft's token endpoint over
  // TLS, so its claims are the verified profile for this sign-in.
  if (tokens.id_token) {
    const claims = decodeJwtPayload(tokens.id_token);
    const emailRaw =
      claims?.email ?? claims?.preferred_username ?? claims?.upn;
    const email =
      typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";
    if (email) {
      const nameRaw = claims?.name;
      const name =
        typeof nameRaw === "string" && nameRaw.trim()
          ? nameRaw.trim()
          : email.split("@")[0];
      return { email, name, provider: "microsoft" };
    }
  }
  if (!tokens.access_token) return null;
  const meRes = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!meRes.ok) return null;
  const me = (await meRes.json()) as {
    mail?: string | null;
    userPrincipalName?: string;
    displayName?: string;
  };
  const email = (me.mail ?? me.userPrincipalName ?? "").trim().toLowerCase();
  if (!email) return null;
  const name = (me.displayName ?? "").trim() || email.split("@")[0];
  return { email, name, provider: "microsoft" };
}

/** Exchange an authorisation code for a verified profile, or null. */
export function exchangeCode(
  provider: OAuthProvider,
  code: string,
): Promise<OAuthProfile | null> {
  const redirectUri = getOAuthCallbackUrl(provider);
  if (provider === "google") return exchangeGoogleCode(code, redirectUri);
  if (provider === "github") return exchangeGitHubCode(code, redirectUri);
  return exchangeMicrosoftCode(code, redirectUri);
}
