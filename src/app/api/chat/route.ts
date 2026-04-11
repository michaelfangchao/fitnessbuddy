import { streamText, tool, convertToModelMessages } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { requireSession, getUserDate } from "@/lib/auth";
import { buildSystemContext } from "@/lib/context";
import { db } from "@/db";
import { exercise_logs, exercise_prs, user_streak, body_measurements } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { EXERCISE_SET, EXERCISE_MUSCLE_MAP } from "@/data/exercises";

export const maxDuration = 60;

const SetSchema = z.union([
  z.object({
    type: z.literal("strength"),
    set_number: z.number(),
    target_weight_kg: z.number(),
    actual_weight_kg: z.number(),
    target_reps: z.number(),
    actual_reps: z.number(),
    rpe: z.number().optional(),
  }),
  z.object({
    type: z.literal("cardio"),
    duration_min: z.number(),
    distance_km: z.number().optional(),
    notes: z.string().optional(),
  }),
]);

export async function POST(request: Request) {
  // Auth check — throws 401 Response if not authenticated
  let session;
  try {
    session = await requireSession(request);
  } catch (resp) {
    return resp as Response;
  }

  const userDate = getUserDate(request);
  const body = await request.json();
  const messages = await convertToModelMessages(body.messages ?? []);

  // Build system prompt with full context (parallel DB queries)
  const systemPrompt = await buildSystemContext(session.userId, userDate);

  try {
    const result = streamText({
      model: anthropic("claude-sonnet-4-6"),
      system: systemPrompt,
      messages,
      maxOutputTokens: 2048,
      tools: {
        // ── Tool 1: Log Workout ────────────────────────────────────────────────
        log_workout: tool({
          description: `Extract workout data from user input and prepare a confirm card.
            ONLY use same_as_last_time: true when the user wants EXACTLY the same sets as last time.
            If they mention any modification (more weight, fewer reps, different exercise), provide explicit sets.
            Returns confirm card data including PR detection preview.`,
          inputSchema: z.object({
            exercises: z.array(
              z.object({
                exercise_name: z.string().describe("Map to canonical exercise name"),
                same_as_last_time: z.boolean().default(false),
                sets: z.array(SetSchema).optional().describe("Provide if same_as_last_time is false"),
                is_new_exercise: z.boolean().default(false),
              })
            ),
            notes: z.string().optional(),
          }),
          execute: async ({ exercises }) => {
            const userId = session.userId;
            const results = [];

            for (const ex of exercises) {
              let sets = ex.sets ?? [];

              // "Same as last time" — fetch prior session from DB
              if (ex.same_as_last_time) {
                const [prior] = await db
                  .select({ sets_json: exercise_logs.sets_json })
                  .from(exercise_logs)
                  .where(
                    and(
                      eq(exercise_logs.user_id, userId),
                      eq(exercise_logs.exercise_name, ex.exercise_name)
                    )
                  )
                  .orderBy(desc(exercise_logs.date))
                  .limit(1);

                if (prior) {
                  sets = JSON.parse(prior.sets_json);
                } else {
                  return {
                    error: "no_history",
                    exercise: ex.exercise_name,
                    message: `No prior session found for ${ex.exercise_name}. Please provide the sets explicitly.`,
                  };
                }
              }

              // PR detection pre-check
              const strengthSets = sets.filter(
                (s) => s.type === "strength"
              ) as { type: "strength"; actual_weight_kg: number }[];
              let prDetection = {
                is_pr: false,
                exercise: ex.exercise_name,
                new_max_kg: 0,
                prev_max_kg: null as number | null,
              };

              if (strengthSets.length > 0) {
                const newMax = Math.max(...strengthSets.map((s) => s.actual_weight_kg));
                const [existing] = await db
                  .select({ max_weight_kg: exercise_prs.max_weight_kg })
                  .from(exercise_prs)
                  .where(
                    and(
                      eq(exercise_prs.user_id, userId),
                      eq(exercise_prs.exercise_name, ex.exercise_name)
                    )
                  );

                prDetection = {
                  is_pr: !existing || newMax > existing.max_weight_kg,
                  exercise: ex.exercise_name,
                  new_max_kg: newMax,
                  prev_max_kg: existing?.max_weight_kg ?? null,
                };
              }

              results.push({
                exercise_name: ex.exercise_name,
                sets,
                is_new_exercise: !EXERCISE_SET.has(ex.exercise_name),
                pr_detection: prDetection,
              });
            }

            return {
              type: "workout_confirm",
              exercises: results.map((r) => ({
                exercise_name: r.exercise_name,
                sets: r.sets,
                is_new_exercise: r.is_new_exercise,
              })),
              pr_detections: results.map((r) => r.pr_detection),
              date: userDate,
            };
          },
        }),

        // ── Tool 2: Query Progression ─────────────────────────────────────────
        query_progression: tool({
          description: "Query exercise progression history and return a chart",
          inputSchema: z.object({
            exercise_name: z.string(),
            days: z.number().default(90),
          }),
          execute: async ({ exercise_name, days }) => {
            const userId = session.userId;
            const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
              .toISOString()
              .split("T")[0];

            const rows = await db.all(
              sql`SELECT date, MAX(json_extract(s.value, '$.actual_weight_kg')) as peak_weight
                FROM exercise_logs, json_each(sets_json) as s
                WHERE user_id = ${userId}
                  AND exercise_name = ${exercise_name}
                  AND date >= ${fromDate}
                  AND json_extract(s.value, '$.type') = 'strength'
                GROUP BY date
                ORDER BY date`
            );

            if (!rows || rows.length < 2) {
              return {
                type: "text",
                message:
                  rows?.length === 1
                    ? `Only 1 session logged for ${exercise_name}. Keep going — you need at least 2 to show a chart!`
                    : `No data yet for ${exercise_name}.`,
              };
            }

            return {
              type: "chart",
              exercise: exercise_name,
              unit: "kg",
              data: rows as { date: string; peak_weight: number }[],
            };
          },
        }),

        // ── Tool 3: Generate Weekly Plan ──────────────────────────────────────
        generate_weekly_plan: tool({
          description: "Generate a weekly training plan and show confirm card",
          inputSchema: z.object({
            week_of: z.string().describe("YYYY-MM-DD — the Monday of this week"),
            days: z.array(
              z.object({
                day: z.string(),
                focus: z.string(),
                exercises: z.array(z.string()),
              })
            ),
          }),
          execute: async ({ week_of, days }) => {
            return {
              type: "plan_confirm",
              week_of,
              days,
            };
          },
        }),

        // ── Tool 4: Log Body Measurement (auto-save) ──────────────────────────
        log_body_measurement: tool({
          description: "Auto-save body weight or measurement. No confirm card needed.",
          inputSchema: z.object({
            weight_kg: z.number().optional(),
            body_fat_pct: z.number().optional(),
            notes: z.string().optional(),
          }),
          execute: async ({ weight_kg, body_fat_pct, notes }) => {
            const userId = session.userId;
            await db.insert(body_measurements).values({
              user_id: userId,
              date: userDate,
              weight_kg,
              body_fat_pct,
              notes,
            });
            return { saved: true, weight_kg, date: userDate };
          },
        }),

        // ── Tool 5: Get Body Stats ────────────────────────────────────────────
        get_body_stats: tool({
          description: "Get body weight history and return a chart",
          inputSchema: z.object({
            days: z.number().default(90),
          }),
          execute: async ({ days }) => {
            const userId = session.userId;
            const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
              .toISOString()
              .split("T")[0];

            const rows = await db
              .select({
                date: body_measurements.date,
                weight_kg: body_measurements.weight_kg,
              })
              .from(body_measurements)
              .where(
                and(
                  eq(body_measurements.user_id, userId),
                  sql`${body_measurements.date} >= ${fromDate}`,
                  sql`${body_measurements.weight_kg} IS NOT NULL`
                )
              )
              .orderBy(body_measurements.date);

            if (rows.length < 2) {
              return { type: "text", message: "Not enough weight data to show a chart yet." };
            }

            return {
              type: "chart",
              exercise: "Body Weight",
              unit: "kg",
              data: rows.map((r) => ({ date: r.date, peak_weight: r.weight_kg })),
            };
          },
        }),

        // ── Tool 6: Log Meal ──────────────────────────────────────────────────
        log_meal: tool({
          description: "Extract meal data from text and show confirm card. Set is_asian_cuisine based on food type.",
          inputSchema: z.object({
            meal_type: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
            items: z.array(
              z.object({
                name: z.string(),
                calories: z.number(),
                protein_g: z.number(),
                carbs_g: z.number(),
                fat_g: z.number(),
              })
            ),
            is_asian_cuisine: z.boolean().default(false),
            ai_confidence: z.number().min(0).max(1).default(0.8),
            notes: z.string().optional(),
          }),
          execute: async ({ meal_type, items, is_asian_cuisine, ai_confidence, notes }) => {
            const total_calories = items.reduce((s, i) => s + i.calories, 0);
            const total_protein_g = items.reduce((s, i) => s + i.protein_g, 0);
            const total_carbs_g = items.reduce((s, i) => s + i.carbs_g, 0);
            const total_fat_g = items.reduce((s, i) => s + i.fat_g, 0);

            return {
              type: "meal_confirm",
              meal_type,
              items,
              total_calories,
              total_protein_g,
              total_carbs_g,
              total_fat_g,
              is_asian_cuisine,
              ai_confidence,
              notes,
            };
          },
        }),

        // ── Tool 7: Get Partner Sessions ──────────────────────────────────────
        get_partner_sessions: tool({
          description: "Get your training partner's recent sessions",
          inputSchema: z.object({
            days: z.number().default(7).describe("How many days back to look (max 365)"),
          }),
          execute: async ({ days }) => {
            const userId = session.userId;
            const limitedDays = Math.min(days, 365);
            const fromDate = new Date(Date.now() - limitedDays * 24 * 60 * 60 * 1000)
              .toISOString()
              .split("T")[0];

            // Find partner
            const { users: usersTable } = await import("@/db/schema");
            const [partner] = await db
              .select({ id: usersTable.id, name: usersTable.name })
              .from(usersTable)
              .where(sql`${usersTable.id} != ${userId}`)
              .limit(1);

            if (!partner) {
              return { sessions: [], partner_name: null };
            }

            const logs = await db
              .select()
              .from(exercise_logs)
              .where(
                and(
                  eq(exercise_logs.user_id, partner.id),
                  sql`${exercise_logs.date} >= ${fromDate}`
                )
              )
              .orderBy(desc(exercise_logs.date));

            // Group by date
            const sessionMap = new Map<string, typeof logs>();
            for (const log of logs) {
              if (!sessionMap.has(log.date)) sessionMap.set(log.date, []);
              sessionMap.get(log.date)!.push(log);
            }

            const sessions = [...sessionMap.entries()].map(([date, exercises]) => ({
              date,
              exercises: exercises.map((e) => ({
                name: e.exercise_name,
                sets: JSON.parse(e.sets_json),
              })),
            }));

            return { partner_name: partner.name, sessions };
          },
        }),
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    if (err?.status === 429) {
      return new Response(
        JSON.stringify({ error: "Service busy, try again in a moment." }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }
    if (err?.status && err.status >= 500) {
      return new Response(
        JSON.stringify({ error: "AI service unavailable." }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }
    throw error;
  }
}
