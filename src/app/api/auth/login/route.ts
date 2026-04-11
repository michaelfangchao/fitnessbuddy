import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyPin, createSession } from "@/lib/auth";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  const { userId, pin } = await request.json();

  if (!userId || !pin || typeof pin !== "string" || pin.length !== 4) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const result = await verifyPin(Number(userId), pin);

  if (!result.success) {
    if (result.locked) {
      return NextResponse.json(
        { error: "locked", lockedUntil: result.lockedUntil },
        { status: 423 }
      );
    }
    return NextResponse.json({ error: "Wrong PIN" }, { status: 401 });
  }

  const token = await createSession(Number(userId));
  const cookieStore = await cookies();
  cookieStore.set("fitchat_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 60 * 60,
  });

  // Fetch user name for redirect
  const [user] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, Number(userId)));

  return NextResponse.json({ userId: user.id, name: user.name });
}
