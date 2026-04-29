# Nourin's Vision App

Personal life dashboard with cloud sync and Claude/MCP integration.

Nourin tracks goals across Spiritual, Fitness & Health, Career & Skills, Personal & Home, and Travel & Experience — all in one place, accessible from any device.

See `CLAUDE.md` for full project context and data details.

## Stack

- **Web app:** Plain HTML/CSS/JS, Supabase JS SDK v2 (CDN, SRI-pinned), GitHub Pages
- **Database:** Supabase Postgres with RLS, magic-link + OTP auth, real-time subscriptions
- **MCP server:** Supabase Edge Function (Deno), JSON-RPC over HTTP, bearer-token auth, scoped Postgres role

## Setup

See `docs/deployment.md` for the full step-by-step setup recipe (~25 minutes).

## Docs

- `docs/deployment.md` — deployment recipe
- `docs/superpowers/specs/2026-04-29-vision-app-cloud-design.md` — architecture design spec
- `docs/superpowers/plans/2026-04-29-vision-app-cloud.md` — implementation plan
- `CLAUDE.md` — project context for AI coding assistants
