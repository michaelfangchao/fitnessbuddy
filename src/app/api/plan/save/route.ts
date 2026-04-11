import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { db } from "@/db";
import { weekly_plans } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession(request);
  } catch (resp) {
    return resp as Response;
  }

  const body = await request.json();
  const { week_of, days } = body;

  if (!week_of || !days) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    // Upsert — replace if plan for this week already exists
    const [existing] = await db
      .select({ id: weekly_plans.id })
      .from(weekly_plans)
      .where(
        and(
          eq(weekly_plans.user_id, session.userId),
          eq(weekly_plans.week_of, week_of)
        )
      );

    if (existing) {
      await db
        .update(weekly_plans)
        .set({ plan_json: JSON.stringify(days) })
        .where(eq(weekly_plans.id, existing.id));
    } else {
      await db.insert(weekly_plans).values({
        user_id: session.userId,
        week_of,
        plan_json: JSON.stringify(days),
      });
    }

    return NextResponse.json({ saved: true });
  } catch (err) {
    console.error("savePlan error:", err);
    return NextResponse.json({ error: "Couldn't save — please retry." }, { status: 500 });
  }
}
