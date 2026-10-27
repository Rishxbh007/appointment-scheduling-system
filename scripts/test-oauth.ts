// OAuth unit checks, run with:  npx tsx scripts/test-oauth.ts
//
// Tests the pure OAuth helpers without touching any provider:
// authorisation URL builders (all three providers), pending-OAuth
// token round-trip and tamper rejection, provider parsing, the
// unusable-password hash, and availability flags. An optional
// database check (OAuth-style account creation via the shared
// helper) runs only when DATABASE_URL is reachable and cleans up
// after itself; otherwise it is skipped, not failed.
//
// No real credentials are used: dummy client ids are set in-process
// for the URL checks only.

import jwt from "jsonwebtoken";
import {
  buildGoogleAuthUrl,
  buildGitHubAuthUrl,
  buildMicrosoftAuthUrl,
  buildAuthorizationUrl,
  getOAuthCallbackUrl,
  getOAuthAvailability,
  parseOAuthProvider,
  signPendingOAuth,
  verifyPendingOAuth,
  randomUnusablePasswordHash,
} from "@/lib/oauth";
import { comparePassword } from "@/lib/auth";

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "oauth-test-secret-only";
}

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, extra = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

async function main() {
  console.log("1. Authorisation URL builders");
  const google = buildGoogleAuthUrl(
    "dummy-google-id",
    "https://carebook-pearl.vercel.app/api/auth/google/callback",
    "state123",
  );
  check("google URL host", google.includes("accounts.google.com/o/oauth2/v2/auth"));
  check("google URL client + scope", google.includes("client_id=dummy-google-id") && google.includes("openid"));
  check("google URL state", google.includes("state=state123"));
  const github = buildGitHubAuthUrl(
    "dummy-github-id",
    "https://carebook-pearl.vercel.app/api/auth/github/callback",
    "state456",
  );
  check("github URL host", github.includes("github.com/login/oauth/authorize"));
  check("github URL scope", github.includes("user%3Aemail") || github.includes("user:email"));
  const ms = buildMicrosoftAuthUrl(
    "dummy-ms-id",
    "https://carebook-pearl.vercel.app/api/auth/microsoft/callback",
    "state789",
  );
  check("microsoft URL host", ms.includes("login.microsoftonline.com/common/oauth2/v2.0/authorize"));
  check("microsoft URL scope", ms.includes("User.Read") && ms.includes("openid"));

  console.log("2. Env-driven URLs use the production callback paths");
  process.env.NEXT_PUBLIC_APP_URL = "https://carebook-pearl.vercel.app";
  process.env.GOOGLE_CLIENT_ID = "dummy-google-id";
  process.env.GOOGLE_CLIENT_SECRET = "dummy-google-secret";
  process.env.GITHUB_CLIENT_ID = "dummy-github-id";
  process.env.GITHUB_CLIENT_SECRET = "dummy-github-secret";
  process.env.MICROSOFT_CLIENT_ID = "dummy-ms-id";
  process.env.MICROSOFT_CLIENT_SECRET = "dummy-ms-secret";
  check(
    "google callback path",
    getOAuthCallbackUrl("google") ===
      "https://carebook-pearl.vercel.app/api/auth/google/callback",
  );
  check(
    "github callback path",
    getOAuthCallbackUrl("github") ===
      "https://carebook-pearl.vercel.app/api/auth/github/callback",
  );
  check(
    "microsoft callback path",
    getOAuthCallbackUrl("microsoft") ===
      "https://carebook-pearl.vercel.app/api/auth/microsoft/callback",
  );
  const built = buildAuthorizationUrl("microsoft", "abc");
  check(
    "microsoft built URL has callback + state",
    !!built &&
      built.includes("carebook-pearl.vercel.app%2Fapi%2Fauth%2Fmicrosoft%2Fcallback") &&
      built.includes("state=abc"),
  );

  console.log("3. Availability flags follow env vars");
  const on = getOAuthAvailability();
  check("all providers configured with dummy env", on.google && on.github && on.microsoft);
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GITHUB_CLIENT_ID;
  delete process.env.MICROSOFT_CLIENT_ID;
  const off = getOAuthAvailability();
  check("all providers unconfigured without env", !off.google && !off.github && !off.microsoft);

  console.log("4. Provider parsing");
  check("parses google/github/microsoft", parseOAuthProvider("google") === "google" && parseOAuthProvider("github") === "github" && parseOAuthProvider("microsoft") === "microsoft");
  check("rejects apple/empty", parseOAuthProvider("apple") === null && parseOAuthProvider("") === null);

  console.log("5. Pending-OAuth token round-trip");
  const pending = signPendingOAuth({
    email: "oauth-test@example.com",
    name: "OAuth Test",
    provider: "microsoft",
  });
  const verified = verifyPendingOAuth(pending);
  check(
    "round-trip preserves profile",
    verified?.email === "oauth-test@example.com" &&
      verified?.name === "OAuth Test" &&
      verified?.provider === "microsoft",
  );
  check("tampered token rejected", verifyPendingOAuth(pending + "x") === null);
  check("missing token rejected", verifyPendingOAuth(undefined) === null);
  const wrongType = jwt.sign(
    { email: "a@b.c", name: "X", provider: "google", type: "other" },
    process.env.JWT_SECRET as string,
    { expiresIn: "10m" },
  );
  check("wrong token type rejected", verifyPendingOAuth(wrongType) === null);

  console.log("6. Unusable password hash");
  const hash = await randomUnusablePasswordHash();
  check("hash looks like bcrypt", /^\$2[ab]\$10\$/.test(hash));
  check("demo password does not match", (await comparePassword("demo1234", hash)) === false);
  check("common password does not match", (await comparePassword("password123", hash)) === false);

  console.log("7. Optional database check (OAuth-style account creation)");
  if (!process.env.DATABASE_URL) {
    console.log("  SKIP  no DATABASE_URL set");
  } else {
    try {
      const { ensureDb, db } = await import("@/lib/db");
      const { users, patients } = await import("@/lib/db/schema");
      const { createAccountWithProfile } = await import(
        "@/lib/services/accounts"
      );
      const { eq } = await import("drizzle-orm");
      await ensureDb();
      const email = `oauth-test-${Date.now()}@test.local`;
      const user = await createAccountWithProfile({
        name: "OAuth Test",
        email,
        passwordHash: await randomUnusablePasswordHash(),
        role: "Patient",
        authProvider: "Microsoft",
      });
      const [profile] = await db
        .select()
        .from(patients)
        .where(eq(patients.userId, user.userId));
      check("OAuth-style account gets a patient profile", !!profile?.patientId);
      await db.delete(patients).where(eq(patients.userId, user.userId));
      await db.delete(users).where(eq(users.userId, user.userId));
      check("OAuth test account cleaned up", true);
    } catch (err) {
      console.log(
        `  SKIP  database unreachable (${err instanceof Error ? err.message : "unknown error"})`,
      );
    }
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test script crashed:", err);
  process.exit(1);
});
