import { NextResponse } from "next/server";
import { requireSession, getUserDate } from "@/lib/auth";
import { db } from "@/db";
import { meal_logs } from "@/db/schema";

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession(request);
  } catch (resp) {
    return resp as Response;
  }

  const userDate = getUserDate(request);
  const body = await request.json();

  try {
    await db.insert(meal_logs).values({
      user_id: session.userId,
      date: userDate,
      meal_type: body.meal_type,
      items_json: JSON.stringify(body.items ?? []),
      total_calories: body.total_calories,
      total_protein_g: body.total_protein_g,
      total_carbs_g: body.total_carbs_g,
      total_fat_g: body.total_fat_g,
      is_asian_cuisine: body.is_asian_cuisine ?? false,
      ai_confidence: body.ai_confidence,
      notes: body.notes,
    });
    return NextResponse.json({ saved: true });
  } catch (err) {
    console.error("saveMeal error:", err);
    return NextResponse.json({ error: "Couldn't save — please retry." }, { status: 500 });
  }
}
