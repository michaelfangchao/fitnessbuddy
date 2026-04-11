import { NextResponse } from "next/server";
import { requireSession, getUserDate } from "@/lib/auth";
import { db } from "@/db";
import { body_measurements } from "@/db/schema";

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession(request);
  } catch (resp) {
    return resp as Response;
  }

  const userDate = getUserDate(request);
  const body = await request.json();

  if (!body.weight_kg && !body.body_fat_pct) {
    return NextResponse.json({ error: "No measurement data provided" }, { status: 400 });
  }

  try {
    await db.insert(body_measurements).values({
      user_id: session.userId,
      date: body.date ?? userDate,
      weight_kg: body.weight_kg,
      body_fat_pct: body.body_fat_pct,
      notes: body.notes,
    });
    return NextResponse.json({ saved: true });
  } catch (err) {
    console.error("saveMeasurement error:", err);
    return NextResponse.json({ error: "Couldn't save — please retry." }, { status: 500 });
  }
}
