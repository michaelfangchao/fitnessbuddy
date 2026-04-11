/**
 * Builds the system prompt context for the current user.
 * Uses Promise.all() for parallel DB queries — reduces fetch time from ~120ms to ~30ms.
 */

import { db } from "@/db";
import {
  users,
  exercise_logs,
  body_measurements,
  meal_logs,
  user_summaries,
  user_streak,
  weekly_plans,
} from "@/db/schema";
import { eq, desc, and, gte } from "drizzle-orm";
import { EXERCISES } from "@/data/exercises";

export async function buildSystemContext(userId: number, userDate: string): Promise<string> {
  const todayStr = userDate;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  // Fetch all context data in parallel
  const [
    userRow,
    recentLogs,
    todayMeals,
    latestMeasurement,
    latestSummary,
    streakRow,
    currentPlan,
  ] = await Promise.all([
    // User profile
    db.select().from(users).where(eq(users.id, userId)).then((r) => r[0] ?? null),

    // Last 5 exercise sessions
    db
      .select()
      .from(exercise_logs)
      .where(eq(exercise_logs.user_id, userId))
      .orderBy(desc(exercise_logs.date), desc(exercise_logs.created_at))
      .limit(15), // up to 15 rows to cover multi-exercise sessions

    // Today's meals
    db
      .select()
      .from(meal_logs)
      .where(and(eq(meal_logs.user_id, userId), eq(meal_logs.date, todayStr))),

    // Latest body measurement (last 30 days)
    db
      .select()
      .from(body_measurements)
      .where(
        and(
          eq(body_measurements.user_id, userId),
          gte(body_measurements.date, thirtyDaysAgo)
        )
      )
      .orderBy(desc(body_measurements.date))
      .limit(1)
      .then((r) => r[0] ?? null),

    // Latest user summary (if exists)
    db
      .select()
      .from(user_summaries)
      .where(eq(user_summaries.user_id, userId))
      .orderBy(desc(user_summaries.week_of))
      .limit(1)
      .then((r) => r[0] ?? null),

    // Streak
    db
      .select()
      .from(user_streak)
      .where(eq(user_streak.user_id, userId))
      .then((r) => r[0] ?? null),

    // Current weekly plan
    db
      .select()
      .from(weekly_plans)
      .where(eq(weekly_plans.user_id, userId))
      .orderBy(desc(weekly_plans.week_of))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  if (!userRow) throw new Error("User not found");

  // Format recent sessions (deduplicate by date, show last 5 distinct sessions)
  const sessionsByDate = new Map<string, typeof recentLogs>();
  for (const log of recentLogs) {
    if (!sessionsByDate.has(log.date)) sessionsByDate.set(log.date, []);
    sessionsByDate.get(log.date)!.push(log);
  }
  const recentSessions = [...sessionsByDate.entries()]
    .slice(0, 5)
    .map(([date, logs]) => {
      const exercises = logs
        .map((l) => {
          const sets = JSON.parse(l.sets_json) as { actual_weight_kg?: number; actual_reps?: number; duration_min?: number; type: string }[];
          if (sets[0]?.type === "cardio") {
            return `${l.exercise_name} (${sets[0].duration_min}min)`;
          }
          return `${l.exercise_name} ${sets.length}×${sets[0]?.actual_reps}@${sets[0]?.actual_weight_kg}kg`;
        })
        .join(", ");
      return `${date}: ${exercises}`;
    })
    .join("\n");

  const todayMealSummary = todayMeals.length > 0
    ? todayMeals
        .map((m) => {
          const items = JSON.parse(m.items_json) as { name: string }[];
          return `${m.meal_type ?? "meal"}: ${items.map((i) => i.name).join(", ")} (~${m.total_calories}kcal)`;
        })
        .join("; ")
    : "Nothing logged yet today";

  const weightInfo = latestMeasurement
    ? `Latest weight: ${latestMeasurement.weight_kg}kg (${latestMeasurement.date})`
    : "No weight logged yet";

  const streakInfo = streakRow?.consecutive_weeks
    ? `Current training streak: ${streakRow.consecutive_weeks} consecutive weeks`
    : "No streak yet";

  const planInfo = currentPlan
    ? `Current weekly plan (week of ${currentPlan.week_of}):\n${currentPlan.plan_json}`
    : "No weekly plan set";

  const summarySection = latestSummary
    ? `\nRecent summary (${latestSummary.week_of}):\n${latestSummary.summary_text}`
    : "";

  return `You are FitChat, a knowledgeable and encouraging AI fitness coach for a private 2-person household app.

## User Profile
Name: ${userRow.name}
Goal: ${userRow.goal ?? "general fitness"}
Experience: ${userRow.experience_level ?? "beginner"}
Gender: ${userRow.gender ?? "not specified"}
Today's date: ${userDate}

## Current Status
${weightInfo}
${streakInfo}

## Recent Training (last 5 sessions)
${recentSessions || "No training logged yet"}

## Today's Food
${todayMealSummary}

## Training Plan
${planInfo}
${summarySection}

## Canonical Exercise List
When extracting exercise names, ALWAYS map to the closest name from this list:
${EXERCISES.join(", ")}

If an exercise isn't in the list, use your best judgment and set is_new_exercise: true.

## Guidelines
- Be concise and gym-practical. No fluff.
- For progressive overload: if all reps completed at target weight → suggest +2.5kg upper / +5kg lower next session.
- If user mentions pain → suggest a swap and "see a physio/doctor".
- Asian food calorie estimates may be 15-20% low — mention this if relevant.
- The confirm card shows the user what you extracted before any data is saved. Be accurate.
- For "same as last time": set same_as_last_time: true — the server will fetch the actual sets from DB.
- For partner sessions: you can share what their partner is doing, but never share meal or body data.
- CRITICAL: After calling log_workout or log_meal, you MUST end your message with "Tap **Confirm & Save** on the card above to log this." NEVER say "I've logged", "I've saved", or "recorded" — the data is NOT saved until the user taps the button. The card is the save action, not your message.
- CRITICAL: After calling generate_weekly_plan, tell the user to tap "Save Plan" on the card. Same rule — not saved until confirmed.`;
}
