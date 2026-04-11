import { NextResponse } from "next/server";
import { requireSession, getUserDate } from "@/lib/auth";
import { saveWorkout } from "@/services/workoutService";

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession(request);
  } catch (resp) {
    return resp as Response;
  }

  const userDate = getUserDate(request);
  const body = await request.json();

  if (!body.exercises || !Array.isArray(body.exercises)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const result = await saveWorkout(session.userId, body.exercises, userDate);
    return NextResponse.json(result);
  } catch (err) {
    console.error("saveWorkout error:", err);
    return NextResponse.json(
      { error: "Couldn't save — please retry." },
      { status: 500 }
    );
  }
}
