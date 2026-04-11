import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";

// Returns the list of users for the profile selection screen.
// Does NOT expose PIN hash or sensitive fields.
export async function GET() {
  const profiles = await db
    .select({
      id: users.id,
      name: users.name,
      goal: users.goal,
      gender: users.gender,
    })
    .from(users)
    .orderBy(users.id);

  return NextResponse.json({ users: profiles });
}
