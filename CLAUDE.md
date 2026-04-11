
# FitChat — AI Fitness Assistant

## Project Background

Chat-first AI fitness assistant for 2 users: FC (the developer) and his wife. Both gym beginners, 3-4x/week. Goals: fat loss, muscle gain, progressive overload tracking.

**Core value:** Persistent, queryable training history + AI that remembers progressive overload context across sessions. Not a generic fitness app — built for 2 known users with depth over breadth.

**Secondary features:** Photo-based meal logging with macro estimation, voice input in the gym, Sunday household digest.

## Tech Stack

- **Frontend:** Next.js App Router + Tailwind CSS
- **AI:** Vercel AI SDK + Claude API (`claude-sonnet-4-6`)
- **Database:** Drizzle ORM + Turso (libSQL, SQLite-compatible) — production from day 1, NOT better-sqlite3 on Vercel
- **Local dev:** `DATABASE_URL=file:./dev.db` with `@libsql/client`
- **Charts:** Recharts (rendered post-stream, not during streaming)
- **Voice:** Web Speech API (iOS Safari caveats: 60s timeout, requires user gesture)
- **Auth:** Netflix-style profile selection + 4-digit PIN + JWT session cookie (4hr inactivity expiry)
- **Deploy:** Vercel Hobby (free tier sufficient — weekly crons work on Hobby)

## Decisions That Must Not Change

These were decided deliberately — do not reverse without discussion:

- **Database:** Turso (libSQL) from day 1. Vercel filesystem is ephemeral — SQLite files don't persist across deployments.
- **Auth:** `user_id` ALWAYS read from server-side session cookie (verified JWT). NEVER from AI-extracted payload or client body. Every tool handler must enforce this — use `requireSession(request)` from `src/lib/auth.ts`.
- **Exercise names:** Canonical list in `src/data/exercises.ts`. Claude extraction prompt maps all input to this list. Never store free-text muscle names — use controlled vocabulary: `chest | back | shoulders | arms | legs | core | cardio`.
- **Confirm-before-save:** AI extracts free-text/voice input → confirm card shown to user → user confirms → data saved. Never auto-save workout data without user confirmation. Exception: `log_body_measurement` (body weight) is auto-save — intentional, separate tool call to signal this.
- **Recharts rendering:** Tool calls return structured JSON `{type: "chart", ...}`. `<ChatMessage>` renders charts when tool result arrives in stream — NOT deferred to `onFinish`. Charts only render post-stream to avoid partial states.
- **Photo URL:** NULL for MVP. Process and discard images after Claude vision extraction. No Vercel Blob until v2.
- **PIN library:** `bcryptjs` (pure-JS). NOT `bcrypt` (native module — incompatible with Vercel Edge Runtime).
- **Session JWT:** Contains `{ userId, lastActive }` only. Refreshed on every authenticated request. 4-hour inactivity = 401 + cookie cleared.
- **Timezone at write time:** Client sends `X-User-Date: YYYY-MM-DD` header on every chat/upload request. Server uses this for all `date` column writes (`exercise_logs.date`, `meal_logs.date`, `body_measurements.date`). Do NOT use server UTC date. Users in China logging at 11pm their time would get the wrong date if server-UTC is used.
- **Confirm card double-tap:** Disable "Confirm & Save" button on first tap client-side. Re-enable on success or error. Prevents duplicate `exercise_logs` inserts.
- **Confirm card collapse:** After save, confirm card collapses to a 1-line summary (e.g. "Bench press logged — 3×10 @ 70kg") with PR badge if applicable. Full detail visible on expand. Keeps chat scannable over weeks of use.

## Code Architecture

**Thin handler + service layer pattern** (decided in CEO review Section 1):
- `src/lib/auth.ts` — `requireSession(request)` shared by all tool handlers
- `src/services/workoutService.ts` — `saveWorkout(userId, data)` with all DB writes in one transaction
- `src/services/progressionService.ts` — `queryProgression(userId, exercise, range)`
- `src/services/partnerService.ts` — `getPartnerSessions(userId, days)`
- Tool handlers stay thin: `requireSession()` → service call → return result

**Transaction boundary for `log_workout`:** All three writes in one `db.transaction()`:
1. `exercise_logs` insert
2. `exercise_prs` upsert(s) — PR check re-run inside transaction (preview on confirm card may be stale)
3. `user_streak` upsert

If any step fails, all roll back. User sees "Couldn't save — Retry."

## Key Schema Decisions

- `exercise_logs.primary_muscle_group`: controlled vocabulary (chest|back|shoulders|arms|legs|core|cardio), indexed
- `exercise_logs.sets_json`: JSON TEXT with type discriminator (`type: "strength"` or `type: "cardio"`)
- `exercise_logs.date`: explicit DATE column. Written using `X-User-Date` header (client local date)
- `exercise_prs`: `(user_id, exercise_name, max_weight_kg, updated_at)` — denormalized, weight-only. Rep PRs are v2.
- `user_streak`: `(user_id PK, consecutive_weeks, last_computed_at)` — consecutive-week algo in app code, NOT SQL COUNT. Recomputed when `last_computed_at < Monday of current week`. Streak can decrease.
- `meal_logs.is_asian_cuisine`: BOOLEAN, explicit Claude vision prompt rule (not from confidence score)
- `meal_logs.ai_confidence`: REAL 0.0–1.0; < 0.6 shows amber warning
- `user_summaries`: async weekly cron (Monday midnight). Gracefully empty for first 2-3 months — that's fine.
- `pending_digests`: unique constraint on `(user_id, week_of)` — handles at-least-once cron delivery

**New indexes to define in schema:**
- `exercise_logs (user_id, exercise_name, date)` — covers query_progression + same-as-last-time
- `exercise_logs (user_id, primary_muscle_group)` — context injection filter
- `exercise_prs (user_id, exercise_name)` — unique/PK
- `pending_digests (user_id, shown_at)` — "show on next open" query
- `meal_logs (user_id, date)` — today's meals context injection

## AI Tools

All 7 tools verify `user_id` from JWT (via `requireSession()`). Never trust client-provided user_id.

1. `log_workout` — free-text/voice → confirm card → `workoutService.saveWorkout()`
2. `query_progression` — `json_each()` SQL + Recharts chart payload
3. `generate_weekly_plan` — confirm card before save (NOT auto-save)
4. `log_body_measurement` — auto-save (no confirm card), `X-User-Date` for date
5. `get_body_stats` — `body_measurements` → Recharts chart
6. `log_meal` — photo/text → confirm card
7. `get_partner_sessions` — reads other user's `exercise_logs` only (no meals/body/profile beyond name). Always-on for 2-user household. Returns `{ sessions: [], partner_name: null }` if no partner exists yet.

## Accepted Scope Expansions (CEO review, 2026-04-11)

1. **PR detection:** `exercise_prs` table. Badge on confirm card (preview). Re-checked inside `db.transaction()` at save. Returns array (multi-exercise sessions). Badge persists in collapsed saved-state card.
2. **"Same as last time":** AI passes `same_as_last_time: true, exercise_name` in tool args. Server fetches prior `sets_json` from DB — not AI. If conflict with explicit sets, `same_as_last_time` wins. No prior history = clarifying AI message.
3. **Weekly streak:** `user_streak` table. Consecutive-week computation in application code. User timezone (Asia/Shanghai) used for week boundaries — NOT SQLite `localtime`.
4. **Training Partner Mode:** `get_partner_sessions` tool. `SELECT id, name FROM users WHERE id != $currentUserId LIMIT 1`. Exposes exercise_logs only.
5. **Apple Health screenshot:** `POST /api/upload` routes `{type: "weight"}` → weight confirm card with visible+editable date. Never auto-save. Low confidence (<0.7) shows amber warning.

## Vercel Configuration

`vercel.json` should configure `maxDuration` per route:
- `/api/chat` — longer timeout (streaming + tool calls + DB queries can stack)
- `/api/upload` — **Node.js Runtime** (NOT Edge Runtime). `sharp` uses native Node.js bindings, incompatible with Edge Runtime. Set `export const runtime = "nodejs"` and `export const maxDuration = 60` on this route.

Vercel Hobby is sufficient — weekly crons work on Hobby tier.

## `json_each()` Pattern

`query_progression` and PR detection use SQLite's `json_each()` to unnormalize `sets_json`. Drizzle ORM doesn't generate this natively — use raw `sql` template:

```ts
db.run(sql`SELECT date, MAX(json_extract(s.value, '$.actual_weight_kg')) as peak_weight
  FROM exercise_logs, json_each(sets_json) as s
  WHERE user_id = ${userId} AND exercise_name = ${exercise} AND date >= ${from}
  GROUP BY date ORDER BY date`)
```

Test against local libSQL AND Turso remote before committing. Acceptance: <100ms for 500 rows.

## Error Handling Rules

- Claude API timeout (30s) → error banner + Retry button. Never partial-save.
- Claude API 429 (rate limit) → "Service busy, try again in a moment." (handle explicitly in both `/api/chat` and `/api/upload`)
- Claude API 5xx → "AI service unavailable." (same routes)
- JWT expired/invalid → 401 + clear cookie → redirect to profile selection
- PIN wrong (5th attempt) → lock for 15 minutes, store `pin_locked_until TEXT` on `users` table, show time remaining
- DB transaction failure → rollback all three writes, user sees "Couldn't save — Retry"
- Photo upload unknown type → "I couldn't identify this image" message
- `query_progression` < 2 data points → text response, no chart
- Weekly cron (`user_summaries`): wrap each user's Claude call in `try/catch` — one user failure should NOT prevent the other user's summary from generating

## Context Injection Pattern

Build the system prompt context using `Promise.all()` for all independent DB queries (user profile, weekly plan, last 5 sessions, user summary, today's meals, streak). These are independent — sequential reads waste ~90ms. `Promise.all()` reduces total DB fetch time from ~120ms to ~30ms.

## Testing

Framework: **Vitest** (unit + service layer) + **Playwright** (E2E flows).
- Test plan artifact: `~/.gstack/projects/FitnessBuddy/Yiji-no-branch-eng-review-test-plan-*.md`
- Coverage target: all service layer paths (auth, workoutService, progressionService, partnerService), 7 critical E2E flows, 4 eval paths (LLM extraction quality)

## Design Documents

- Design doc (APPROVED): `~/.gstack/projects/FitnessBuddy/Yiji--design-20260411-083949.md`
- CEO plan (ACTIVE): `~/.gstack/projects/FitnessBuddy/ceo-plans/2026-04-11-fitchat-full-build.md`
- TODOS: `TODOS.md` in project root

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
