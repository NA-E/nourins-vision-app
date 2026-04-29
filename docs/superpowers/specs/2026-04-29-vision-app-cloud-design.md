# Vision App — Cloud + MCP Design

**Date:** 2026-04-29
**Status:** Design (awaiting user approval)
**Owner:** Nourin

## Purpose

Promote Nourin's existing single-file HTML vision dashboard from a per-browser `localStorage` toy into a real, durable system she can live with for years:

1. Public live URL via **GitHub Pages**.
2. Cross-device persistence — same data on phone and laptop.
3. Conversational write/read access via an **MCP server**, usable from claude.ai (web + mobile), Claude desktop, and Claude Code.
4. Private to her. Zero data loss across years. Loud, recoverable failures.

The seed data in the existing `dfd()` function is not example content — it is her real life (Surah al-Baqarah hifdh, Umrah/Hajj savings for her family, agency MRR, Serenova Home retail brand, etc.). Migration must preserve every byte.

## Architecture

```
┌─────────────────┐         ┌──────────────────────┐
│  Phone/Laptop   │ ─HTTPS─▶│  Static web app on   │
│   browser       │ ◀───────│  GitHub Pages        │
└─────────────────┘         │  (dashboard UI)      │
                            └──────────┬───────────┘
                                       │ Supabase JS SDK
                                       │ (magic-link / OTP login)
                                       ▼
                           ┌────────────────────────┐
                           │   Supabase Postgres    │
                           │   + Auth + Realtime    │
                           │   (her personal proj)  │
                           └──────────▲─────────────┘
                                      │ scoped Postgres role
                                      │ + bearer token auth
┌─────────────────┐                   │
│ claude.ai web   │                   │
│ claude.ai phone │ ──HTTPS+SSE──▶ ┌──┴────────────────┐
│ Claude Code     │  + bearer      │  MCP server as    │
│ Claude desktop  │     token      │  Supabase Edge    │
└─────────────────┘                │  Function         │
                                   └───────────────────┘
```

Three concerns, **two platforms**: GitHub (Pages + repo + future CI) and Supabase (DB + Auth + Edge Functions). No Cloudflare. No Vercel. The MCP server is just another endpoint in the same Supabase project that owns the data — one auth model, one secret rotation flow.

## Database schema (Postgres on Supabase)

All tables live in the `public` schema. Every row carries `user_id uuid` referencing `auth.users.id`. RLS policies on every table: `user_id = auth.uid()`. Public signup is disabled; only Nourin's account exists.

### `categories`
```sql
id          text primary key
name        text not null
sort_order  int not null default 0
user_id     uuid not null references auth.users(id)
```
Five seed rows: `spiritual`, `fitness`, `career`, `personal`, `travel`. Stable IDs because they're referenced by code (color map `CC`, SVG paths in `catSVG`).

### `projects`
```sql
id           text primary key                        -- 'baqarah', 'umrahsave', or random uid()
category_id  text references categories(id)
name         text not null
description  text default ''
has_num      bool not null default false
cur          numeric(12,2) default 0
tgt          numeric(12,2) default 0
unit         text default ''
status       text not null default 'active'         -- active | paused | completed
phase        text                                    -- nullable; for multi-year arcs (saving, booking, travel, completed, etc.)
target_date  date                                    -- nullable
tags         text[] not null default '{}'            -- e.g. {spiritual, travel, career} for Hajj
deleted_at   timestamptz                             -- soft delete
user_id      uuid not null references auth.users(id)
created_at   timestamptz not null default now()
updated_at   timestamptz not null default now()
```

### `milestones`
```sql
id          text primary key
project_id  text not null references projects(id) on delete cascade
title       text not null
done        bool not null default false
done_at     timestamptz                              -- nullable; set when done flips true
sort_order  int not null default 0
deleted_at  timestamptz
user_id     uuid not null references auth.users(id)
created_at  timestamptz not null default now()
```

### `log_entries`
Concrete things she did or observed. "Cycled 30 min." "Saved $200 toward Hajj." "First trip I planned myself."
```sql
id          text primary key
project_id  text not null references projects(id) on delete cascade
date        date not null
note        text not null
val         numeric(12,2)                            -- nullable; set for numeric projects (savings, MRR, sessions)
user_id     uuid not null references auth.users(id)
created_at  timestamptz not null default now()
```

### `reflections`
Different shape from log entries. Open-ended thoughts, weekly/monthly framing, mood, lessons, intentions.
```sql
id          text primary key
project_id  text references projects(id) on delete set null   -- nullable; reflections can be cross-project
date        date not null
title       text                                     -- nullable
body        text not null
mood        text                                     -- nullable; free text or one of {grateful, struggling, focused, ...}
tags        text[] not null default '{}'
user_id     uuid not null references auth.users(id)
created_at  timestamptz not null default now()
```

### `events` (append-only audit log)
Every write performed by the MCP or the web app. Powers `undo_last_write` and answers "what did Claude do last Thursday."
```sql
id           bigserial primary key
at           timestamptz not null default now()
actor        text not null                           -- 'web' | 'mcp'
tool         text                                    -- nullable; MCP tool name when actor='mcp'
op           text not null                           -- 'insert' | 'update' | 'delete' | 'soft_delete' | 'undo'
table_name   text not null
row_id       text                                    -- nullable for batch ops
before       jsonb                                   -- nullable; null on insert
after        jsonb                                   -- nullable; null on delete
user_id      uuid not null references auth.users(id)
```
Append-only by RLS: users may insert + select their own events; no update or delete grant.

### Indexes
```sql
create index on projects (category_id) where deleted_at is null;
create index on milestones (project_id) where deleted_at is null;
create index on log_entries (project_id, date desc);
create index on reflections (date desc);
create index on events (at desc);
-- Full-text search support
create index on log_entries using gin (to_tsvector('english', note));
create index on reflections using gin (to_tsvector('english', coalesce(title,'') || ' ' || body));
create index on projects using gin (to_tsvector('english', name || ' ' || coalesce(description,'')));
```

### Roles & RLS
- `nourin_app` — scoped Postgres role used by the MCP Edge Function. `GRANT SELECT, INSERT, UPDATE` on her four data tables + `INSERT, SELECT` on `events`. No `DELETE` (we soft-delete). No grants outside her tables. **Service-role key is not used by the MCP.**
- RLS policies on every table: `user_id = auth.uid()` for select; same for insert (with `auth.uid()` as default), update, soft-delete.
- The MCP function calls Postgres with a JWT minted for her `auth.users.id`, so `auth.uid()` resolves correctly inside RLS.

## Web app

**Single file: `web/index.html`.** Existing dashboard, surgically modified.

### Changes from current
1. **Storage layer:** `load()` and `sv()` rewritten to call Supabase. Local in-memory cache (`S.data`) stays for instant rendering; reads fetch on login + reactively via subscriptions; writes go optimistic-then-confirm.
2. **Login screen:** simple on-brand view shown when `supabase.auth.getSession()` returns null. Single email field; user receives a magic link **and** a 6-digit OTP fallback (Supabase supports both — link-on-mobile-Safari often orphans the session, OTP is the safety net). Same gold-on-deep-purple aesthetic, same `Cormorant Garamond` italic header, ~30 lines of HTML/CSS.
3. **Optimistic updates with client IDs:** every write generates a client-side UUID. The same UUID is used as the row PK in Postgres. When realtime echoes the row back, we dedupe by ID — no double-apply flicker.
4. **Loud failure UX:** if a write fails, an inline gold-bordered toast says *"Couldn't save — tap to retry."* The optimistic change is preserved with a "pending" visual state, not silently reverted. She sees what didn't sync and chooses.
5. **Realtime sync:** Supabase channels subscribed to `projects`, `milestones`, `log_entries`, `reflections`. When the MCP writes from her phone, her laptop dashboard updates without a refresh. Pure delight moment.
6. **Mobile responsive (≤720px):**
   - Sidebar collapses into a horizontally-scrollable category chip row at the top.
   - Main column takes full width.
   - Tap targets minimum 44×44px.
   - Typography unchanged. The aesthetic does not degrade.
7. **Saving indicator:** small gold star (existing `starSVG` helper) pulses gently near the brand mark while a write is in flight. Replaces any spinner.
8. **One-time import flow:** on first login, if there are no rows in `projects`, show *"Restore my data"* — paste the JSON exported from old `localStorage` (or use a small "Export" button still present on the old version). Maps directly into the new schema.
9. **Settings drawer** (small gear, sidebar bottom): Export data (download JSON), Sign out, Version. Nothing else.
10. **Security headers:** `<meta http-equiv="Content-Security-Policy" ...>` restricting connect-src to Supabase URL only; SRI hashes on the pinned Supabase SDK CDN script; HSTS via GitHub Pages default. Pin SDK to a known version, not `@latest`.

### Out of scope for v1
- PWA / offline-first / IndexedDB queueing. The app degrades to "you can't write right now" on no connection.
- Push notifications.
- Multi-user / sharing.

## MCP server

**Implementation:** Supabase Edge Function (`supabase/functions/mcp/index.ts`). Deno runtime. MCP TypeScript SDK with HTTP+SSE transport.

**Authentication:** static bearer token (`MCP_BEARER_TOKEN`) checked against the `Authorization: Bearer <token>` header on every request. Constant-time comparison. Failed attempts logged to `events`. Token rotated by editing two places: Supabase function env + claude.ai connector config.

**Authorization to data:** the function connects to Postgres as the **scoped `nourin_app` role** (env var holds the connection string). That role has grants only on her four data tables and `events` — no access to any other schema, no DDL, no destructive grants. Every query in the function additionally filters by a hardcoded `NOURIN_USER_ID` env var. So even a coding mistake (forgetting a `where user_id = ...`) is bounded by what `nourin_app` can reach, and a compromised role still can't escape the four tables. We do not use the service-role key at all in the MCP path — that key never leaves the Supabase dashboard.

### Tools (10)

Every write tool inserts a row into `events` and returns the affected project's updated state.

| Tool | Purpose |
|---|---|
| `get_dashboard` | All categories + projects + % progress + status. The "show me everything" tool. |
| `get_project` | One project's full detail: description, milestones, last 20 log entries, last 5 reflections. |
| `recent_activity` | Last N (default 20) log entries + reflections across all projects, descending by date. |
| `search` | Full-text search across project names/descriptions, log entry notes, reflection bodies, and milestone titles. Returns matching rows with project context. |
| `upsert_project` | Create or edit a project. If `id` is provided and exists, update; otherwise insert. Replaces separate add/update tools — LLMs pick wrong between them. |
| `add_milestone` | Append milestone to a project. |
| `set_milestone_status` | Set `done` to true or false. Stamps `done_at` when flipping to true; clears when flipping to false. Replaces `toggle` (idempotency footgun for LLMs). |
| `log_entry` | Add `{date, note, val?}` to a project. For numeric projects, optionally also updates `cur`. |
| `add_reflection` | Add `{date, title?, body, mood?, tags?, project_id?}`. |
| `undo_last_write` | Look up the most recent row in `events` for this user, replay its inverse. Records its own undo event so undo-of-undo is just another undo step. |

### Tool description style
Each tool description tells Claude **when** to reach for it, not just what it does. Example for `log_entry`:

> Use when the user describes something concrete they did, observed, or measured — a workout, a saving, a session, a moment on a trip. Always store the date (default to today if user doesn't specify) and the note in their own words. For numeric projects (savings totals, MRR, session counts), include `val` to update the project's current value.

### Out of scope for v1
- Bulk operations (bulk re-tag, bulk archive). Add when needed.
- Scheduled writes (e.g., "log a weekly reflection every Sunday").
- Multi-step workflows (e.g., a "plan my week" tool that chains many writes). Claude composes these from primitives.

## Repository layout

```
/
├── web/
│   └── index.html                   # the dashboard, single self-contained file
├── supabase/
│   ├── migrations/
│   │   └── 20260429_initial.sql     # schema, RLS, role, indexes, seed categories
│   └── functions/
│       └── mcp/
│           ├── index.ts             # MCP server entrypoint
│           ├── tools.ts             # tool implementations
│           └── deno.json
├── db/
│   └── seed-from-localstorage.md    # one-time import recipe
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-04-29-vision-app-cloud-design.md   # this file
├── CLAUDE.md
└── README.md
```

The original `index (4).html` is moved to `web/index.html` (rename drops the space and parens). Schema lives under `supabase/migrations/` so the Supabase CLI can manage it. MCP function lives under `supabase/functions/mcp/` so `supabase functions deploy mcp` ships it.

## Setup / deployment flow

End-to-end, ~25 minutes:

1. **Create personal Supabase project.** Free tier. Separate from any client work.
2. **Run migration.** `supabase db push` (CLI is already installed on her machine).
3. **Disable public signup** in Supabase Auth settings. Set magic-link TTL to 5 min, single-use, disable email enumeration.
4. **Sign in** via magic link to her email. Capture her `auth.users.id`.
5. **Web app config:** put `SUPABASE_URL` and `SUPABASE_ANON_KEY` into `web/index.html` (these are public-safe). Pin the SDK CDN URL to a specific version with SRI hash.
6. **Push to GitHub.** Enable GitHub Pages from `/web`.
7. **Deploy MCP function:** `supabase functions deploy mcp`. Set function env vars: `SUPABASE_URL`, scoped-role connection details, `MCP_BEARER_TOKEN` (long random string).
8. **Configure claude.ai:** Settings → Connectors → Add custom MCP. Paste function URL + bearer token. Test from a Claude conversation: "show my dashboard."
9. **Restore data:** open the *current* `index (4).html` once more, open browser devtools console, run `copy(localStorage.getItem('nourin_dashboard_v1'))` to put the JSON on the clipboard. Then open the new live web app, sign in, paste into the "Restore my data" flow. The import script preserves seed IDs (`baqarah`, `umrahsave`, `ha1`, etc.) one-for-one. Done.

Future device additions are just "open the URL, sign in via magic link or OTP." No reinstall, no config.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Supabase free tier pauses after 7 days inactivity | She uses it daily; MCP calls also count as activity. If it ever bites: 5-line GitHub Actions cron added then. Data is preserved 90 days regardless. |
| Bearer token leaks (screenshot, clipboard, config export) | Token rotation is documented and easy (two places). Failed-auth attempts are logged. Token is the only credential — losing it doesn't expose Postgres directly because the function holds the DB credentials, not the caller. |
| LLM writes the wrong thing | Append-only `events` table + `undo_last_write` tool. Every change is recoverable. |
| Optimistic + realtime double-apply | Client-generated IDs used as Postgres PKs; dedupe on echo. |
| Mobile Safari magic-link orphaning | OTP fallback enabled. |
| Schema migration loses seed IDs | Seed IDs (`baqarah`, `umrahsave`, `ha1`, etc.) preserved one-for-one in import. Tested before cutover. |
| Categories accidentally renamed | They're seed rows with stable IDs; web app and SVG color map reference the IDs, not the names. |

## Success criteria

- Dashboard loads on phone and laptop, fully populated with her real data, after migration.
- Every interaction in the existing UI continues to work (milestone toggles, log entries, status changes, add project, edit numeric value).
- Real-time: a write on phone visibly updates the laptop dashboard within ~1 second, no refresh.
- MCP: from claude.ai, "log 30 minutes cycling today" results in a new `log_entries` row, `cur` incremented on the fitness session project, and a confirmation reply naming the new totals.
- `undo_last_write` recovers from any single bad MCP write.
- Public signup is disabled — verified by attempting to sign up with a different email address.
- Free tier costs zero dollars per month.

## Out of scope (explicit)

- AI-generated insights (weekly summaries, "what's neglected" reports). Achievable today via Claude using `get_dashboard` + reasoning; no need to bake into MCP.
- Streaks / gamification.
- Sharing / social features / public progress page.
- Mobile native app or PWA.
- Recurring scheduled actions.
- Integration with calendar, banking, fitness trackers.
