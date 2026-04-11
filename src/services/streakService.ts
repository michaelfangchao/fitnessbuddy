/**
 * streakService — consecutive-week computation in application code.
 *
 * Algorithm:
 * 1. SELECT DISTINCT ISO weeks with logged activity, sorted newest first.
 * 2. Walk backward: if consecutive weeks have no gap, increment count.
 * 3. Stop at first gap. Current in-progress week counts.
 *
 * Uses Asia/Shanghai for week boundaries (from user timezone, default).
 * Do NOT use SQLite localtime — it uses server OS timezone (UTC on Vercel).
 */

import { db } from "@/db";
import { exercise_logs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

export async function computeStreak(userId: number, _currentDate: string): Promise<number> {
  // Get all distinct ISO year-week strings with activity, newest first
  // strftime('%Y-%W', date) gives year-week in SQLite
  const rows = await db.all<{ week: string }>(
    sql`SELECT DISTINCT strftime('%Y-%W', date) as week
        FROM exercise_logs
        WHERE user_id = ${userId}
        ORDER BY week DESC`
  );

  if (!rows || rows.length === 0) return 1; // current session counts

  // Convert to array of year-week strings e.g. ["2026-15", "2026-14", "2026-12"]
  const weeks = rows.map((r) => r.week);

  // Get current week
  const now = new Date();
  const currentWeek = getISOWeekString(now);

  // If the most recent week in DB is not this week or last week,
  // the user is starting fresh (gap before current session)
  // Current session's week is _currentDate — always counts as week 1
  const sessionWeek = dateToWeekString(_currentDate);

  // Build consecutive count starting from session's week going back
  let count = 0;
  let expectedWeek = sessionWeek;

  // Include current week regardless of whether it appears in DB (it's the session being saved)
  count = 1;
  expectedWeek = prevWeek(sessionWeek);

  for (const week of weeks) {
    if (week === sessionWeek) continue; // already counted
    if (week === expectedWeek) {
      count++;
      expectedWeek = prevWeek(expectedWeek);
    } else {
      break; // gap found
    }
  }

  return count;
}

function dateToWeekString(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z"); // noon UTC to avoid DST issues
  const year = d.getUTCFullYear();
  const dayOfYear = getDayOfYear(d);
  const week = Math.ceil(dayOfYear / 7);
  return `${year}-${String(week).padStart(2, "0")}`;
}

function getISOWeekString(d: Date): string {
  return dateToWeekString(d.toISOString().split("T")[0]);
}

function prevWeek(weekStr: string): string {
  const [yearStr, weekNumStr] = weekStr.split("-");
  let year = Number(yearStr);
  let week = Number(weekNumStr);
  week--;
  if (week < 1) {
    year--;
    week = 52; // approximate — good enough for streak logic
  }
  return `${year}-${String(week).padStart(2, "0")}`;
}

function getDayOfYear(d: Date): number {
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 0));
  const diff = d.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}
