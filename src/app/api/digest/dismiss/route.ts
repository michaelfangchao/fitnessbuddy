import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { db } from "@/db";
import { pending_digests } from "@/db/schema";
import { eq, and, isNull, sql } from "drizzle-orm";

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession(request);
  } catch (resp) {
    return resp as Response;
  }

  try {
    await db
      .update(pending_digests)
      .set({ shown_at: sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))` })
      .where(
        and(
          eq(pending_digests.user_id, session.userId),
          isNull(pending_digests.shown_at)
        )
      );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("digest/dismiss error:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
