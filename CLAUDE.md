# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

This is **Nourin's vision app** — her personal life dashboard. She has many projects running in parallel across different areas of her life (faith, body, money, home, travel) and wants one place to see them all and update them. This app is that place.

Treat it accordingly. The seed data in `dfd()` is not example/placeholder content — those are her actual goals and the milestones she's chosen for them. Don't rename categories, rewrite project descriptions, or "clean up" the wording without being asked. When she asks for a change, the request is about *her life*, not about a generic todo app.

The five life areas she's organized around:
- **Spiritual** — Quran hifdh (Surah al-Baqarah), Arabic, tajweed
- **Fitness & Health** — body/face/hair care, gym/swim/cycle, makeup
- **Career & Skills** — agency MRR, Serenova Home (her retail brand), French, texture painting
- **Personal & Home** — Umrah savings, Hajj savings (multi-year), home decor, abayas, driving
- **Travel & Experience** — completed and upcoming trips, Umrah trip itself

Anchoring goals: Umrah ($6,300 for 4 — her, parents, son Ibrahim) and Hajj ($26,000 for 4, multi-year). Tagline: "Building the next version of herself · year one of many."

## How to run it

The working app file is `index.html` — a single self-contained HTML file with no build step. Open it in a browser and it works once you've configured the Supabase credentials. See `docs/deployment.md` for the full setup recipe.

The original localStorage-only version is kept as a local backup outside the repo at `E:/1.Claude Code/_vision-app-legacy-backup/index (4).html`. It was excluded from git history before the first push for privacy (it contained personal seed data). After Nourin completes the import flow (Step 9 in `docs/deployment.md`) and verifies her data in Supabase, the local backup can be deleted.

## Repository structure

```
index.html                  — the dashboard, served by GitHub Pages from repo root
supabase/
  migrations/               — Postgres schema, RLS, roles, indexes
  functions/mcp/            — Edge Function MCP server (Deno)
db/
  seed-from-localstorage.md — one-time import recipe
docs/
  deployment.md             — full setup recipe (25 min end-to-end)
  superpowers/specs/        — architecture design spec
  superpowers/plans/        — implementation plan
CLAUDE.md                   — this file
README.md                   — project summary
(legacy index (4).html)     — kept outside the repo at /_vision-app-legacy-backup/
```

**Be careful with the data** — `S.data` is the in-memory state shaped from Supabase reads. On cloud migration, `localStorage` is no longer used; data lives in Postgres with RLS.

## Architecture (all inside the one HTML file)

**State** — a single mutable module-level object `S` holds UI state (`selId`, `collapsed`, transient form-open flags `showEntry` / `showAddMs` / `showEditNum` / `addProjCat`) plus `S.data`, the persisted document.

**Data shape** — `S.data` has `categories[]` (id, name) and `projects[]`. Each project: `{id, catId, name, desc, hasNum, cur, tgt, unit, hasMil, hasLog, mil:[{id,t,d,dt}], log:[{id,date,note,val}], status:'active'|'paused'|'completed'}`.

**Persistence** — `load()` reads from `localStorage`, falls back to `dfd()` on empty/parse-error, and runs inline migrations. `sv()` writes after every mutation. Treat `dfd()` as the canonical seed for new browsers, not a fixture — when she sets up the app on a new device, `dfd()` is what she sees first.

**Rendering** — pure innerHTML rebuilds, no virtual DOM. `render()` calls `renderSidebar()` + `renderMain()` + `bindAll()`. Mutations call `sv()` then `render()` to redraw. Some callsites do partial reruns (`renderMain(); bindAll()`) for transient form toggles to avoid resetting sidebar collapse state.

**Event handling** — single delegated `onclick` and `onchange` on `#app`, dispatched by the `data-act` attribute on the clicked element (e.g. `data-act="toggle-ms"`, `data-act="save-proj"`). To add an action: emit an element with `data-act="..."` in the relevant render function and add a branch in `bindAll()`.

**Styling** — CSS variables in `:root` define the palette (`--g` gold, `--bg` deep purple-black, `--cr` cream, etc.). Per-category accent colors live in the `CC` JS object (`spiritual`, `fitness`, `career`, `personal`, `travel`) and are referenced from inline SVGs (`catSVG`) and inline `style=` attributes in render output. If a category is added, update both `S.data.categories` (via `dfd()`) and `CC`, and add a path in `catSVG`.

**SVG helpers** — `catSVG(id, color, size)`, `starSVG(size, opacity)`, and `sdiv(label)` produce inline strings concatenated into render output.

## Things to know before editing

- IDs are generated with `uid()` (random base-36). Don't collide with the hand-authored seed IDs in `dfd()` (e.g. `baqarah`, `a1`, `ha1`).
- Progress is computed by `getPct(p)`: numeric projects use `cur/tgt`; otherwise it's the fraction of milestones with `d:true`.
- The sidebar's "add project" form is inline in `renderSidebar()` and gated by `S.addProjCat === c.id`. The numeric-target sub-form is shown/hidden via a one-off `onchange` wired in `bindAll()` (`document.getElementById('np-nt')`).
- Dates: stored ISO `YYYY-MM-DD`, displayed via `fmt()` in `en-GB` locale.
