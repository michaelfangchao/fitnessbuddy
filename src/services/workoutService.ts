/**
 * workoutService — all workout DB writes in one atomic transaction.
 * Includes PR detection re-check inside the transaction (confirm card preview may be stale).
 */

import { db } from "@/db";
import { exercise_logs, exercise_prs, user_streak } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { EXERCISE_MUSCLE_MAP } from "@/data/exercises";
import { computeStreak } from "./streakService";
import type { SetsJson } from "@/db/schema";

type ExerciseInput = {
  exercise_name: string;
  sets: SetsJson;
  is_new_exercise?: boolean;
  notes?: string;
};

export type PRResult = {
  exercise: string;
  is_pr: boolean;
  new_max_kg: number;
  prev_max_kg: number | null;
};

export async function saveWorkout(
  userId: number,
  exercises: ExerciseInput[],
  date: string
): Promise<{ saved: true; pr_results: PRResult[] }> {
  const prResults: PRResult[] = [];

  await db.transaction(async (tx) => {
    for (const ex of exercises) {
      const muscleGroup = EXERCISE_MUSCLE_MAP[ex.exercise_name] ?? "chest";

      // Insert exercise log
      await tx.insert(exercise_logs).values({
        user_id: userId,
        date,
        exercise_name: ex.exercise_name,
        primary_muscle_group: muscleGroup,
        sets_json: JSON.stringify(ex.sets),
        is_new_exercise: ex.is_new_exercise ?? false,
        notes: ex.notes,
      });

      // PR detection — re-run inside transaction (authoritative)
      const strengthSets = (ex.sets as { type: string; actual_weight_kg?: number }[]).filter(
        (s) => s.type === "strength"
      );

      if (strengthSets.length > 0) {
        const newMax = Math.max(
          ...strengthSets.map((s) => s.actual_weight_kg ?? 0)
        );

        const [existing] = await tx
          .select({ max_weight_kg: exercise_prs.max_weight_kg })
          .from(exercise_prs)
          .where(
            and(
              eq(exercise_prs.user_id, userId),
              eq(exercise_prs.exercise_name, ex.exercise_name)
            )
          );

        const isPR = !existing || newMax > existing.max_weight_kg;

        prResults.push({
          exercise: ex.exercise_name,
          is_pr: isPR,
          new_max_kg: newMax,
          prev_max_kg: existing?.max_weight_kg ?? null,
        });

        if (isPR) {
          // Upsert exercise_prs
          if (existing) {
            await tx
              .update(exercise_prs)
              .set({
                max_weight_kg: newMax,
                updated_at: sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`,
              })
              .where(
                and(
                  eq(exercise_prs.user_id, userId),
                  eq(exercise_prs.exercise_name, ex.exercise_name)
                )
              );
          } else {
            await tx.insert(exercise_prs).values({
              user_id: userId,
              exercise_name: ex.exercise_name,
              max_weight_kg: newMax,
            });
          }
        }
      }
    }

    // Update streak (uses application-layer consecutive-week algorithm)
    const newStreak = await computeStreak(userId, date);
    const [existingStreak] = await tx
      .select()
      .from(user_streak)
      .where(eq(user_streak.user_id, userId));

    if (existingStreak) {
      await tx
        .update(user_streak)
        .set({
          consecutive_weeks: newStreak,
          last_computed_at: sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`,
        })
        .where(eq(user_streak.user_id, userId));
    } else {
      await tx.insert(user_streak).values({
        user_id: userId,
        consecutive_weeks: newStreak,
      });
    }
  });

  return { saved: true, pr_results: prResults };
}
