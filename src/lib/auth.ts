import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "dev-secret-change-in-production"
);

const COOKIE_NAME = "fitchat_session";
const SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours
const PIN_LOCKOUT_ATTEMPTS = 5;
const PIN_LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export type SessionPayload = {
  userId: number;
  lastActive: number; // unix ms
};

// ─── requireSession ────────────────────────────────────────────────────────────
// Call at the top of every authenticated API route / server action.
// Throws a Response with status 401 if session is invalid or expired.

export async function requireSession(request: Request): Promise<SessionPayload> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const token = parseCookie(cookieHeader, COOKIE_NAME);

  if (!token) throw unauthorizedResponse("No session");

  let payload: SessionPayload;
  try {
    const { payload: raw } = await jwtVerify(token, JWT_SECRET);
    payload = raw as unknown as SessionPayload;
  } catch {
    throw unauthorizedResponse("Invalid token");
  }

  const now = Date.now();
  if (now - payload.lastActive > SESSION_TIMEOUT_MS) {
    throw unauthorizedResponse("Session expired");
  }

  // Refresh session (sliding expiry)
  await refreshSession(payload.userId);

  return payload;
}

// ─── requireSessionFromCookies ─────────────────────────────────────────────────
// Server Component / Server Action variant (uses next/headers cookies()).

export async function requireSessionFromCookies(): Promise<SessionPayload> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) throw unauthorizedResponse("No session");

  let payload: SessionPayload;
  try {
    const { payload: raw } = await jwtVerify(token, JWT_SECRET);
    payload = raw as unknown as SessionPayload;
  } catch {
    throw unauthorizedResponse("Invalid token");
  }

  const now = Date.now();
  if (now - payload.lastActive > SESSION_TIMEOUT_MS) {
    throw unauthorizedResponse("Session expired");
  }

  await refreshSession(payload.userId);
  return payload;
}

// ─── verifyPin ────────────────────────────────────────────────────────────────

export async function verifyPin(
  userId: number,
  pin: string
): Promise<{ success: true } | { success: false; locked: boolean; lockedUntil?: string }> {
  const [user] = await db
    .select({
      pin_hash: users.pin_hash,
      pin_locked_until: users.pin_locked_until,
    })
    .from(users)
    .where(eq(users.id, userId));

  if (!user) return { success: false, locked: false };

  // Check lockout
  if (user.pin_locked_until) {
    const lockedUntil = new Date(user.pin_locked_until).getTime();
    if (Date.now() < lockedUntil) {
      return {
        success: false,
        locked: true,
        lockedUntil: user.pin_locked_until,
      };
    }
    // Lock expired — clear it
    await db
      .update(users)
      .set({ pin_locked_until: null })
      .where(eq(users.id, userId));
  }

  const correct = await bcrypt.compare(pin, user.pin_hash);

  if (correct) {
    // Reset failed attempts on success
    await db
      .update(users)
      .set({ pin_locked_until: null })
      .where(eq(users.id, userId));
    return { success: true };
  }

  // Wrong PIN — check attempt count via pin_attempts table
  const { db: dbInstance } = await import("@/db");
  const { pin_attempts } = await import("@/db/schema");
  const { sql } = await import("drizzle-orm");

  // Upsert attempt count (reset if last attempt > 15 min ago)
  const [existing] = await dbInstance
    .select()
    .from(pin_attempts)
    .where(eq(pin_attempts.user_id, userId));

  let newCount = 1;
  if (existing) {
    const lastFailed = new Date(existing.failed_at).getTime();
    newCount =
      Date.now() - lastFailed < PIN_LOCKOUT_DURATION_MS
        ? existing.count + 1
        : 1;

    await dbInstance
      .update(pin_attempts)
      .set({
        count: newCount,
        failed_at: sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`,
      })
      .where(eq(pin_attempts.user_id, userId));
  } else {
    await dbInstance.insert(pin_attempts).values({ user_id: userId, count: 1 });
  }

  if (newCount >= PIN_LOCKOUT_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + PIN_LOCKOUT_DURATION_MS).toISOString();
    await db
      .update(users)
      .set({ pin_locked_until: lockedUntil })
      .where(eq(users.id, userId));
    return { success: false, locked: true, lockedUntil };
  }

  return { success: false, locked: false };
}

// ─── createSession ────────────────────────────────────────────────────────────

export async function createSession(userId: number): Promise<string> {
  const payload: SessionPayload = { userId, lastActive: Date.now() };
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("8h")
    .sign(JWT_SECRET);
}

// ─── refreshSession ───────────────────────────────────────────────────────────

export async function refreshSession(userId: number): Promise<void> {
  const cookieStore = await cookies();
  const token = await createSession(userId);
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 60 * 60, // 8h absolute max
  });
}

// ─── clearSession ─────────────────────────────────────────────────────────────

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseCookie(cookieHeader: string, name: string): string | undefined {
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match?.slice(name.length + 1);
}

function unauthorizedResponse(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── hashPin ──────────────────────────────────────────────────────────────────

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 12);
}

// ─── getUserDate ─────────────────────────────────────────────────────────────
// Extract X-User-Date from request headers. Falls back to today UTC (shouldn't happen).

export function getUserDate(request: Request): string {
  const userDate = request.headers.get("X-User-Date");
  if (userDate && /^\d{4}-\d{2}-\d{2}$/.test(userDate)) return userDate;
  // Fallback — should not happen if client always sends the header
  return new Date().toISOString().split("T")[0];
}
