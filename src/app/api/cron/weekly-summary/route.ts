/**
 * GET /api/cron/weekly-summary
 * Runs every Monday at midnight (Asia/Shanghai time) via Vercel cron.
 * For each user:
 *  1. Generates a weekly summary via Claude (last 7 days of training + meals)
 *  2. Upserts into user_summaries
 *  3. Upserts into pending_digests (unique on user_id + week_of, so at-least-once is safe)
 *
 * Each user's Claude call is wrapped in try/catch — one failure must not block the other.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  users,
  exercise_logs,
  meal_logs,
  body_measurements,
  user_summaries,
  pending_digests,
  user_streak,
} from "@/db/schema";
import { eq, gte, desc } from "drizzle-orm";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

// Vercel cron secret: set CRON_SECRET in environment variables
const CRON_SECRET = process.env.CRON_SECRET;

// Returns the Monday of the current ISO week (Asia/Shanghai) in YYYY-MM-DD
function getMondayOfCurrentWeek(): string {
  // Use UTC+8 offset (Asia/Shanghai doesn't observe DST)
  const now = new Date();
  const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const day = utc8.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
  const daysToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(utc8.getTime() + daysToMonday * 24 * 60 * 60 * 1000);
  return monday.toISOString().split("T")[0];
}

// Returns 7 days ago in YYYY-MM-DD (Asia/Shanghai)
function getSevenDaysAgo(): string {
  const now = new Date();
  const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const ago = new Date(utc8.getTime() - 7 * 24 * 60 * 60 * 1000);
  return ago.toISOString().split("T")[0];
}

async function generateSummaryForUser(userId: number, userName: string): Promise<string> {
  const weekOf = getMondayOfCurrentWeek();
  const sevenDaysAgo = getSevenDaysAgo();

  // Fetch last 7 days of data in parallel
  const [workouts, meals, measurements, streakRow] = await Promise.all([
    db
      .select()
      .from(exercise_logs)
      .where(eq(exercise_logs.user_id, userId))
      .orderBy(desc(exercise_logs.date))
      .then((rows) => rows.filter((r) => r.date >= sevenDaysAgo)),

    db
      .select()
      .from(meal_logs)
      .where(eq(meal_logs.user_id, userId))
      .orderBy(desc(meal_logs.date))
      .then((rows) => rows.filter((r) => r.date >= sevenDaysAgo)),

    db
      .select()
      .from(body_measurements)
      .where(eq(body_measurements.user_id, userId))
      .orderBy(desc(body_measurements.date))
      .limit(3),

    db
      .select()
      .from(user_streak)
      .where(eq(user_streak.user_id, userId))
      .then((r) => r[0] ?? null),
  ]);

  // Format workout data
  const sessionsByDate = new Map<string, typeof workouts>();
  for (const log of workouts) {
    if (!sessionsByDate.has(log.date)) sessionsByDate.set(log.date, []);
    sessionsByDate.get(log.date)!.push(log);
  }

  const workoutSummary =
    sessionsByDate.size === 0
      ? "No workouts logged this week."
      : [...sessionsByDate.entries()]
          .map(([date, logs]) => {
            const exercises = logs
              .map((l) => {
                const sets = JSON.parse(l.sets_json) as {
                  type: string;
                  actual_weight_kg?: number;
                  actual_reps?: number;
                  duration_min?: number;
                }[];
                if (sets[0]?.type === "cardio") {
                  return `${l.exercise_name} (${sets[0].duration_min}min)`;
                }
                return `${l.exercise_name} ${sets.length}×${sets[0]?.actual_reps}@${sets[0]?.actual_weight_kg}kg`;
              })
              .join(", ");
            return `${date}: ${exercises}`;
          })
          .join("\n");

  const mealSummary =
    meals.length === 0
      ? "No meals logged this week."
      : meals
          .slice(0, 10) // cap to 10 meals for prompt length
          .map((m) => {
            const items = JSON.parse(m.items_json) as { name: string }[];
            return `${m.date} ${m.meal_type ?? "meal"}: ${items.map((i) => i.name).join(", ")} (~${m.total_calories}kcal, ${m.total_protein_g}g protein)`;
          })
          .join("\n");

  const weightSummary =
    measurements.length === 0
      ? "No weight logged."
      : measurements.map((m) => `${m.date}: ${m.weight_kg}kg`).join(", ");

  const streakInfo = streakRow?.consecutive_weeks
    ? `Training streak: ${streakRow.consecutive_weeks} consecutive weeks`
    : "No streak yet";

  const { text } = await generateText({
    model: anthropic("claude-haiku-4-5-20251001"),
    maxOutputTokens: 400,
    messages: [
      {
        role: "user",
        content: `Generate a concise weekly fitness summary for ${userName}.

TRAINING THIS WEEK:
${workoutSummary}

NUTRITION (sample):
${mealSummary}

WEIGHT:
${weightSummary}

${streakInfo}

Week: ${weekOf}

Write a 2-3 sentence encouraging summary covering: sessions completed, any notable PRs or progress, nutrition overview, and a brief motivational note for next week. Be specific with numbers. Keep it friendly and direct. No bullet points, just prose.`,
      },
    ],
  });

  return text.trim();
}

export async function GET(request: Request) {
  // Verify cron secret (prevents unauthorized invocations)
  if (CRON_SECRET) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const weekOf = getMondayOfCurrentWeek();

  const allUsers = await db.select({ id: users.id, name: users.name }).from(users);

  const results: { userId: number; status: "ok" | "error"; error?: string }[] = [];

  for (const user of allUsers) {
    try {
      const summaryText = await generateSummaryForUser(user.id, user.name);

      // Upsert user_summary (replace if week already exists)
      const [existing] = await db
        .select({ id: user_summaries.id })
        .from(user_summaries)
        .where(eq(user_summaries.user_id, user.id))
        .orderBy(desc(user_summaries.week_of))
        .limit(1);

      if (existing) {
        // Check if it's for the same week
        const [existingRow] = await db
          .select({ id: user_summaries.id, week_of: user_summaries.week_of })
          .from(user_summaries)
          .where(eq(user_summaries.id, existing.id));
        if (existingRow?.week_of === weekOf) {
          await db
            .update(user_summaries)
            .set({ summary_text: summaryText })
            .where(eq(user_summaries.id, existing.id));
        } else {
          await db.insert(user_summaries).values({
            user_id: user.id,
            week_of: weekOf,
            summary_text: summaryText,
          });
        }
      } else {
        await db.insert(user_summaries).values({
          user_id: user.id,
          week_of: weekOf,
          summary_text: summaryText,
        });
      }

      // Upsert pending_digest — unique constraint handles duplicates
      try {
        await db.insert(pending_digests).values({
          user_id: user.id,
          week_of: weekOf,
          digest_text: summaryText,
        });
      } catch {
        // Duplicate week — update instead
        await db
          .update(pending_digests)
          .set({ digest_text: summaryText, shown_at: null })
          .where(eq(pending_digests.user_id, user.id));
      }

      results.push({ userId: user.id, status: "ok" });
    } catch (err) {
      console.error(`weekly-summary: failed for user ${user.id}:`, err);
      results.push({
        userId: user.id,
        status: "error",
        error: String(err),
      });
    }
  }

  return NextResponse.json({ weekOf, results });
}
