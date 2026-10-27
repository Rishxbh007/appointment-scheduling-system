// Session handling: JWT in an HTTP-only cookie.
//
// A signed JWT (user id + role, 7-day expiry) is stored in a cookie
// the browser cannot read from JavaScript, so it cannot be stolen by
// page scripts. Every protected page and every server action reads
// the session through getSession() and refuses to proceed without it.
// Passwords are never stored — only bcrypt hashes (see register).

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";

const COOKIE_NAME = "session";

export type Role = "Patient" | "Doctor";
export type Session = { userId: number; role: Role };

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) {
    // Local development fallback. Production (Vercel) MUST set a real
    // JWT_SECRET — see .env.example.
    console.warn(
      "JWT_SECRET is not set; using a development-only fallback secret.",
    );
    return "dev-only-secret-change-me";
  }
  return s;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signSession(userId: number, role: Role): string {
  return jwt.sign({ sub: userId, role }, secret(), { expiresIn: "7d" });
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days, matches the JWT expiry
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/** Read and verify the session cookie. Returns null when absent/invalid. */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, secret()) as unknown as {
      sub: number;
      role: Role;
    };
    if (
      typeof payload.sub !== "number" ||
      (payload.role !== "Patient" && payload.role !== "Doctor")
    ) {
      return null;
    }
    return { userId: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}
