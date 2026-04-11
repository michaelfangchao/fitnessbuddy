# FitChat — TODOS

## P3 — Before any public exposure

### MIME type validation on photo upload
**What:** Validate file MIME type via magic bytes before passing to sharp or Claude vision.
**Why:** v1 skips this (private 2-user app). If the Vercel URL is ever shared or the app expands, unvalidated file upload accepts malicious files.
**How:** `file-type` npm package, ~2 lines in `POST /api/upload` before any processing. Reject non-image files with a friendly error.
**Effort:** XS (human: ~30 min | CC: ~5 min)
**Depends on:** Nothing. Can be added at any point.

---

## P3 — Year-2 performance

### query_progression denormalization at scale
**What:** When `query_progression` response time exceeds 300ms (expected at ~2000+ rows per exercise), denormalize a `daily_peak_weight` column directly in `exercise_logs`, or add a `progression_summary` table.
**Why:** `json_each()` scans all sets_json rows per date. At 500 rows: <100ms (MVP target). At 2000+ rows: 300-500ms. Currently the `exercise_prs` table handles PR lookups in O(1) but progression charting still does a full scan.
**How:** Add `daily_peak_kg REAL GENERATED ALWAYS AS (...)` or materialize it at log_workout write time. Remove `json_each()` from `query_progression`. Zero behavior change for the user.
**Effort:** S (human: ~3hr | CC: ~15 min)
**Depends on:** Needs real usage data to know which exercise shows slowdown first. Don't build speculatively.

---

## P3 — UX polish (post-MVP)

### Proactive greeting on app open
**What:** On chat page load, auto-trigger an AI greeting that surfaces recent context — e.g., "Hey FC! Last session was 2 days ago: bench press 70kg ×3. Ready to train?"
**Why:** The chat is ephemeral (no message persistence), so every session opens to a blank chat. The AI knows the user's history via context injection but waits for user to type first. A proactive greeting makes the app feel aware and alive.
**How:** On chat page mount, send a client-side system trigger message (e.g., `role: "user", content: "[session_start]"`) that the system prompt interprets as "greet with recent context." AI responds with a personalized greeting. ~1-2 hours.
**Effort:** XS (human: ~1hr | CC: ~10 min)
**Depends on:** Core chat + context injection (build order Steps 3-4) must work first.

---

## Deferred from design review (for reference)
- Mid-set real-time PR detection — v2, needs continuous voice listening or per-set UI
- Streak calendar heatmap — build after 2+ months of consistent use data
- Rep PR detection (same weight, more reps) — v2, needs `max_reps_at_weight` schema addition
- Proactive "argues back" AI — needs 6+ months of training data
- Apple Watch / Google Fit live sync — requires native app
- Push notifications for Sunday digest — requires PWA service worker
- Offline support (service worker + sync queue) — gym dead zones
- Body composition correlation with training load
- Food database API integration (USDA/FatSecret)
- WeChat Mini Program version
