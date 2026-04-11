import { sql } from "drizzle-orm";
import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

// ─── Users ───────────────────────────────────────────────────────────────────

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  pin_hash: text("pin_hash").notNull(),
  timezone: text("timezone").notNull().default("Asia/Shanghai"),
  goal: text("goal"), // "fat_loss" | "muscle_gain" | "both"
  experience_level: text("experience_level"), // "beginner" | "intermediate" | "advanced"
  gender: text("gender"),
  age: integer("age"),
  height_cm: real("height_cm"),
  pin_locked_until: text("pin_locked_until"), // ISO timestamp, NULL when not locked
  created_at: text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
});

export const pin_attempts = sqliteTable("pin_attempts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  user_id: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  failed_at: text("failed_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  count: integer("count").notNull().default(0),
});

// ─── Weekly Plans ─────────────────────────────────────────────────────────────

export const weekly_plans = sqliteTable(
  "weekly_plans",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    user_id: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    week_of: text("week_of").notNull(), // YYYY-MM-DD (Monday)
    plan_json: text("plan_json").notNull(), // JSON: { days: [{ day, exercises }] }
    created_at: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  },
  (t) => [index("weekly_plans_user_week_idx").on(t.user_id, t.week_of)]
);

// ─── Exercise Logs ────────────────────────────────────────────────────────────
//
// One row per exercise per session. Multi-exercise sessions = multiple rows
// sharing the same date. sets_json shape:
//   Strength: [{ type:"strength", set_number, target_weight_kg, actual_weight_kg, target_reps, actual_reps, rpe? }]
//   Cardio:   [{ type:"cardio", duration_min, distance_km?, notes? }]

export const exercise_logs = sqliteTable(
  "exercise_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    user_id: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD (from X-User-Date header)
    exercise_name: text("exercise_name").notNull(), // canonical from exercises.ts
    primary_muscle_group: text("primary_muscle_group").notNull(), // chest|back|shoulders|arms|legs|core|cardio
    sets_json: text("sets_json").notNull(), // JSON array (see shape above)
    is_new_exercise: integer("is_new_exercise", { mode: "boolean" })
      .notNull()
      .default(false),
    notes: text("notes"),
    created_at: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  },
  (t) => [
    index("exercise_logs_user_exercise_date_idx").on(
      t.user_id,
      t.exercise_name,
      t.date
    ),
    index("exercise_logs_user_muscle_idx").on(t.user_id, t.primary_muscle_group),
  ]
);

// ─── Exercise PRs ─────────────────────────────────────────────────────────────
// Denormalized for O(1) PR lookups. Re-checked inside transaction at save time.

export const exercise_prs = sqliteTable(
  "exercise_prs",
  {
    user_id: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    exercise_name: text("exercise_name").notNull(),
    max_weight_kg: real("max_weight_kg").notNull(),
    updated_at: text("updated_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  },
  (t) => [
    uniqueIndex("exercise_prs_user_exercise_idx").on(t.user_id, t.exercise_name),
  ]
);

// ─── User Streak ──────────────────────────────────────────────────────────────
// Consecutive-week streak. Recomputed in app code (not SQL) when stale.

export const user_streak = sqliteTable("user_streak", {
  user_id: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  consecutive_weeks: integer("consecutive_weeks").notNull().default(0),
  last_computed_at: text("last_computed_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
});

// ─── Body Measurements ────────────────────────────────────────────────────────

export const body_measurements = sqliteTable(
  "body_measurements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    user_id: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD (from X-User-Date header)
    weight_kg: real("weight_kg"),
    body_fat_pct: real("body_fat_pct"),
    notes: text("notes"),
    created_at: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  },
  (t) => [index("body_measurements_user_date_idx").on(t.user_id, t.date)]
);

// ─── Meal Logs ────────────────────────────────────────────────────────────────

export const meal_logs = sqliteTable(
  "meal_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    user_id: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD (from X-User-Date header)
    meal_type: text("meal_type"), // "breakfast" | "lunch" | "dinner" | "snack"
    items_json: text("items_json").notNull(), // JSON: [{ name, calories, protein_g, carbs_g, fat_g }]
    total_calories: integer("total_calories"),
    total_protein_g: real("total_protein_g"),
    total_carbs_g: real("total_carbs_g"),
    total_fat_g: real("total_fat_g"),
    is_asian_cuisine: integer("is_asian_cuisine", { mode: "boolean" })
      .notNull()
      .default(false),
    ai_confidence: real("ai_confidence"), // 0.0–1.0; < 0.6 shows amber warning
    notes: text("notes"),
    created_at: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  },
  (t) => [index("meal_logs_user_date_idx").on(t.user_id, t.date)]
);

// ─── User Summaries ───────────────────────────────────────────────────────────
// Generated by weekly cron (Monday midnight). Gracefully absent for first 2-3 months.

export const user_summaries = sqliteTable(
  "user_summaries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    user_id: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    week_of: text("week_of").notNull(), // YYYY-MM-DD (Monday)
    summary_text: text("summary_text").notNull(),
    created_at: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  },
  (t) => [index("user_summaries_user_week_idx").on(t.user_id, t.week_of)]
);

// ─── Pending Digests ──────────────────────────────────────────────────────────
// At-least-once delivery for Sunday digest. unique constraint prevents duplicates.

export const pending_digests = sqliteTable(
  "pending_digests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    user_id: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    week_of: text("week_of").notNull(), // YYYY-MM-DD
    digest_text: text("digest_text").notNull(),
    shown_at: text("shown_at"), // NULL until shown to user
    created_at: text("created_at")
      .notNull()
      .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`),
  },
  (t) => [
    uniqueIndex("pending_digests_user_week_idx").on(t.user_id, t.week_of),
    index("pending_digests_user_shown_idx").on(t.user_id, t.shown_at),
  ]
);

// ─── TypeScript Types ─────────────────────────────────────────────────────────

export type StrengthSet = {
  type: "strength";
  set_number: number;
  target_weight_kg: number;
  actual_weight_kg: number;
  target_reps: number;
  actual_reps: number;
  rpe?: number;
};

export type CardioSet = {
  type: "cardio";
  duration_min: number;
  distance_km?: number;
  notes?: string;
};

export type SetsJson = StrengthSet[] | CardioSet[];

export type MealItem = {
  name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

export type MuscleGroup =
  | "chest"
  | "back"
  | "shoulders"
  | "arms"
  | "legs"
  | "core"
  | "cardio";
