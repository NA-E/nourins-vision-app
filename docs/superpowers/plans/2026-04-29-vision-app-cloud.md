# Vision App — Cloud + MCP Implementation Plan

> **For agentic workers:** This plan implements the design in `docs/superpowers/specs/2026-04-29-vision-app-cloud-design.md`. Read the spec first — it has architecture rationale, schema details, and tool descriptions you'll need. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the current single-file localStorage HTML dashboard into a Supabase-backed app on GitHub Pages with a Supabase Edge Function MCP server callable from claude.ai/Claude Code.

**Architecture:** Two platforms only — GitHub (Pages + repo) and Supabase (Postgres + Auth + Edge Functions). Web app talks to Supabase via JS SDK with magic-link/OTP auth. MCP server is a Supabase Edge Function authenticated by a static bearer token; it connects to Postgres as a scoped `nourin_app` role and always filters by a hardcoded user_id env var.

**Tech Stack:**
- **Web:** plain HTML/JS/CSS (no framework, no bundler), Supabase JS SDK v2 pinned via CDN with SRI
- **DB:** Postgres on Supabase, RLS, scoped role
- **MCP:** Deno + Supabase Edge Functions, MCP TypeScript SDK, HTTP+SSE transport
- **Hosting:** GitHub Pages (web) + Supabase (everything else)

---

## Repo layout (target)

```
/
├── web/
│   └── index.html                   # the dashboard (single file)
├── supabase/
│   ├── migrations/
│   │   └── 20260429000000_initial.sql
│   └── functions/
│       └── mcp/
│           ├── index.ts             # entry: HTTP+SSE handler, bearer auth, tool registry
│           ├── db.ts                # Postgres client wrapper using nourin_app role
│           ├── tools/               # one file per tool, each exports {name, description, schema, handler}
│           │   ├── get_dashboard.ts
│           │   ├── get_project.ts
│           │   ├── recent_activity.ts
│           │   ├── search.ts
│           │   ├── upsert_project.ts
│           │   ├── add_milestone.ts
│           │   ├── set_milestone_status.ts
│           │   ├── log_entry.ts
│           │   ├── add_reflection.ts
│           │   └── undo_last_write.ts
│           ├── events.ts            # helper: log event + return state
│           └── deno.json
├── db/
│   └── seed-from-localstorage.md    # one-time import recipe (browser console + paste)
├── docs/
│   ├── superpowers/
│   │   ├── specs/2026-04-29-vision-app-cloud-design.md
│   │   └── plans/2026-04-29-vision-app-cloud.md
│   └── deployment.md                # the 9-step setup recipe
├── .gitignore
├── CLAUDE.md
├── README.md
└── index (4).html                   # ← keep until cutover; remove after import succeeds
```

---

## Conventions

- **Commit per task.** Every numbered Task ends with a commit. Use `feat:`/`chore:`/`fix:` conventional prefixes.
- **No `npm` for the web app.** It's three static files; Supabase SDK loads from CDN with SRI.
- **`supabase` CLI is already installed** on the machine.
- **Do not deploy or run anything requiring real credentials.** Stop before any `supabase db push` / `functions deploy`. Credential setup is Nourin's manual step; produce code that's ready to deploy.
- **Real-time + optimistic safety:** every row insert from the web uses a client-generated UUID (via `crypto.randomUUID()`) as its PK, so realtime echoes can be deduped.

---

## Phase 1 — Repo scaffold

### Task 1.1: Create directory tree

**Files:**
- Create: `web/`, `supabase/migrations/`, `supabase/functions/mcp/tools/`, `db/`, `docs/deployment.md`, `.gitignore`, `README.md`

- [ ] **Step 1: Create directories**
```bash
mkdir -p web supabase/migrations supabase/functions/mcp/tools db
```

- [ ] **Step 2: Move existing HTML file**
```bash
git mv "index (4).html" web/index.html 2>/dev/null || mv "index (4).html" web/index.html
```
(Repo isn't a git repo yet — we'll `git init` in Task 1.3.)

- [ ] **Step 3: Write `.gitignore`**

```
# Local
.DS_Store
.idea/
.vscode/
*.log

# Supabase CLI
.supabase/
.env
.env.local
*.local

# Deno
deno.lock

# Editor
*.swp
```

- [ ] **Step 4: Write `README.md` skeleton**

Content: Project name, one paragraph what it is (referencing `CLAUDE.md` for full context), pointer to `docs/deployment.md`, and a "Stack" section listing GitHub Pages + Supabase. Keep under 50 lines.

- [ ] **Step 5: Commit**
```bash
git init
git add .
git commit -m "chore: scaffold repo structure for cloud migration"
```

### Task 1.2: Update CLAUDE.md to reflect new structure

**Files:** Modify `CLAUDE.md`

- [ ] **Step 1:** In the "How to run it" section, change references from `index (4).html` (root) to `web/index.html`. Add a paragraph explaining the new structure (web/ for static site, supabase/ for DB + Edge Function MCP, docs/ for spec + plan + deployment recipe). Note the original file is preserved at root until import is verified, then will be deleted.

- [ ] **Step 2: Commit**
```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for new cloud architecture"
```

---

## Phase 2 — Database migration

### Task 2.1: Write the initial migration SQL

**Files:** Create `supabase/migrations/20260429000000_initial.sql`

This is the single source of truth for the schema. Run via `supabase db push` after `supabase link`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- Vision App — initial schema
-- Date: 2026-04-29
-- Owner: Nourin (single-user)
-- ============================================================================

-- Enable extensions
create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;

-- ============================================================================
-- Tables
-- ============================================================================

create table public.categories (
  id          text primary key,
  name        text not null,
  sort_order  int  not null default 0,
  user_id     uuid not null references auth.users(id) on delete cascade
);

create table public.projects (
  id           text primary key,
  category_id  text references public.categories(id) on delete set null,
  name         text not null,
  description  text not null default '',
  has_num      boolean not null default false,
  cur          numeric(12,2) not null default 0,
  tgt          numeric(12,2) not null default 0,
  unit         text not null default '',
  status       text not null default 'active' check (status in ('active','paused','completed')),
  phase        text,
  target_date  date,
  tags         text[] not null default '{}',
  deleted_at   timestamptz,
  user_id      uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.milestones (
  id          text primary key,
  project_id  text not null references public.projects(id) on delete cascade,
  title       text not null,
  done        boolean not null default false,
  done_at     timestamptz,
  sort_order  int not null default 0,
  deleted_at  timestamptz,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table public.log_entries (
  id          text primary key,
  project_id  text not null references public.projects(id) on delete cascade,
  date        date not null,
  note        text not null,
  val         numeric(12,2),
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table public.reflections (
  id          text primary key,
  project_id  text references public.projects(id) on delete set null,
  date        date not null,
  title       text,
  body        text not null,
  mood        text,
  tags        text[] not null default '{}',
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table public.events (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  actor        text not null check (actor in ('web','mcp')),
  tool         text,
  op           text not null check (op in ('insert','update','delete','soft_delete','undo')),
  table_name   text not null,
  row_id       text,
  before       jsonb,
  after        jsonb,
  user_id      uuid not null references auth.users(id) on delete cascade
);

-- ============================================================================
-- Indexes
-- ============================================================================

create index idx_projects_category    on public.projects (category_id) where deleted_at is null;
create index idx_projects_user        on public.projects (user_id) where deleted_at is null;
create index idx_milestones_project   on public.milestones (project_id) where deleted_at is null;
create index idx_log_project_date     on public.log_entries (project_id, date desc);
create index idx_reflections_date     on public.reflections (date desc);
create index idx_events_at            on public.events (at desc);

-- Full-text search
create index idx_projects_fts on public.projects
  using gin (to_tsvector('english', name || ' ' || coalesce(description,'')));
create index idx_log_fts on public.log_entries
  using gin (to_tsvector('english', note));
create index idx_reflections_fts on public.reflections
  using gin (to_tsvector('english', coalesce(title,'') || ' ' || body));
create index idx_milestones_fts on public.milestones
  using gin (to_tsvector('english', title));

-- ============================================================================
-- updated_at trigger for projects
-- ============================================================================

create or replace function public.touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_projects_updated_at
before update on public.projects
for each row execute function public.touch_updated_at();

-- ============================================================================
-- Row-Level Security
-- ============================================================================

alter table public.categories  enable row level security;
alter table public.projects    enable row level security;
alter table public.milestones  enable row level security;
alter table public.log_entries enable row level security;
alter table public.reflections enable row level security;
alter table public.events      enable row level security;

-- Standard "own rows only" policies
create policy own_categories  on public.categories  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_projects    on public.projects    for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_milestones  on public.milestones  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_log         on public.log_entries for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_reflections on public.reflections for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Events: insert + select only (append-only)
create policy own_events_select on public.events for select using (user_id = auth.uid());
create policy own_events_insert on public.events for insert with check (user_id = auth.uid());
-- No update or delete policy → forbidden by default

-- ============================================================================
-- Scoped role for the MCP Edge Function
-- ============================================================================

-- Note: actual password is set out-of-band via `alter role nourin_app password '<...>'`
-- in the Supabase SQL editor during deployment, then the conn string goes into
-- the Edge Function env vars. We cannot put a password in a migration file
-- because migrations are committed to git.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'nourin_app') then
    create role nourin_app login;
  end if;
end$$;

grant usage on schema public to nourin_app;
grant select, insert, update on public.categories  to nourin_app;
grant select, insert, update on public.projects    to nourin_app;
grant select, insert, update on public.milestones  to nourin_app;
grant select, insert, update on public.log_entries to nourin_app;
grant select, insert, update on public.reflections to nourin_app;
grant select, insert         on public.events     to nourin_app;
grant usage, select on sequence events_id_seq to nourin_app;

-- The MCP function will set `request.jwt.claims` so `auth.uid()` resolves
-- correctly inside RLS. Set up a helper to make that explicit:
-- (No-op here — Supabase Edge Function runtime handles JWT propagation.)
```

- [ ] **Step 2: Commit**
```bash
git add supabase/migrations/20260429000000_initial.sql
git commit -m "feat(db): initial schema with RLS, indexes, scoped role"
```

### Task 2.2: Write a seed-categories migration

**Files:** Create `supabase/migrations/20260429000001_seed_categories.sql`

Five fixed categories with stable IDs the web app references in code (color map `CC` and SVG paths in `catSVG`).

- [ ] **Step 1: Write the seed**

Note: this seed runs after Nourin's `auth.users` row exists. Since we don't know her UUID until she signs up, this migration is parameterized via a function rather than hard-coded:

```sql
-- Run after first signup; populates categories for the calling user.
-- Idempotent: skips if categories already exist for this user.

create or replace function public.seed_categories_for_current_user() returns void as $$
begin
  insert into public.categories (id, name, sort_order, user_id) values
    ('spiritual', 'Spiritual',           1, auth.uid()),
    ('fitness',   'Fitness & Health',    2, auth.uid()),
    ('career',    'Career & Skills',     3, auth.uid()),
    ('personal',  'Personal & Home',     4, auth.uid()),
    ('travel',    'Travel & Experience', 5, auth.uid())
  on conflict (id) do nothing;
end;
$$ language plpgsql security invoker;

grant execute on function public.seed_categories_for_current_user() to authenticated;
```

The web app calls `supabase.rpc('seed_categories_for_current_user')` once on first login if `categories` table is empty for the user.

- [ ] **Step 2: Commit**
```bash
git add supabase/migrations/20260429000001_seed_categories.sql
git commit -m "feat(db): seed categories function (per-user idempotent)"
```

### Task 2.3: Document migration usage

**Files:** Create `docs/deployment.md` — initial sketch (full content built up across phases)

- [ ] **Step 1: Write initial deployment doc**

```markdown
# Deployment recipe

End-to-end setup, ~25 minutes. Each step is roughly 2 minutes.

## 1. Create personal Supabase project
- Sign in at https://supabase.com (use your personal email, not a client account).
- Create new project. Region: closest to Bangladesh (e.g., `ap-southeast-1`). Free tier.
- Save the project URL and `anon` key; we'll need them for the web app.

## 2. Apply migrations
```bash
supabase link --project-ref <your-project-ref>
supabase db push
```
This creates all tables, indexes, RLS policies, and the `nourin_app` role.

## 3. Set the nourin_app password
In the Supabase SQL editor:
```sql
alter role nourin_app password '<long-random-string>';
```
Save the password — it's part of the Postgres connection string for the MCP function.

## 4. Configure Auth (UI)
Supabase Dashboard → Authentication → Settings:
- **Disable** new signups.
- **Magic link expiry:** 5 minutes.
- **Email enumeration protection:** ON.
- **OTP enabled:** ON (6-digit fallback for mobile Safari).

## 5. Sign in once
- Open the project → Authentication → Users.
- Add a user manually with your email, OR temporarily re-enable signups, sign in via the live web app, then disable signups again.
- Copy your `auth.users.id` UUID — needed for the MCP function env.

## 6-9. (filled in later phases)
```

- [ ] **Step 2: Commit**
```bash
git add docs/deployment.md
git commit -m "docs(deploy): initial deployment recipe steps 1-5"
```

---

## Phase 3 — Web app refactor

The current `web/index.html` is ~376 lines, single-file, vanilla JS, with a `S` state object and `dfd()` seed factory. We'll modify in place, keeping the single-file philosophy. The script tag's contents grow but stay under ~700 lines.

### Task 3.1: Add Supabase SDK + config block

**Files:** Modify `web/index.html`

- [ ] **Step 1: Replace the existing `<head>` Supabase-config additions**

Just before the closing `</head>`, add (replacing nothing yet — purely additive):

```html
<!-- Pinned Supabase JS SDK v2.46.1 with SRI -->
<script
  src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.46.1/dist/umd/supabase.min.js"
  integrity="sha384-PLACEHOLDER_AGENT_FETCHES_REAL_SRI"
  crossorigin="anonymous"></script>

<!-- Strict CSP: only allow connections to our own Supabase project + jsdelivr CDN -->
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.jsdelivr.net; connect-src 'self' https://YOURPROJECT.supabase.co wss://YOURPROJECT.supabase.co; img-src 'self' data:;">
```

⚠️ **Agent note:** before committing, fetch the real SRI hash for the pinned version: `curl -s https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.46.1/dist/umd/supabase.min.js | openssl dgst -sha384 -binary | openssl base64 -A` and substitute it. Replace `YOURPROJECT.supabase.co` with a deploy-time placeholder noted in `docs/deployment.md`.

- [ ] **Step 2: Add a CONFIG block at the very top of `<script>`**

Insert immediately after `<script>` opens:

```javascript
// ─────────────────────────────────────────────────────────────────
// CONFIG — these two values are public-safe (anon key has no privileged
// access; RLS protects all data). They are filled in at deploy time.
// ─────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://YOURPROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'PLACEHOLDER_ANON_KEY';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});
```

- [ ] **Step 3: Commit**
```bash
git add web/index.html
git commit -m "feat(web): add Supabase SDK + CSP + config block"
```

### Task 3.2: Add login view (gated rendering)

**Files:** Modify `web/index.html`

- [ ] **Step 1: Add login view CSS** (in the existing `<style>` block, just before the closing `</style>`)

```css
/* Login view */
.lv{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;max-width:420px;padding:48px 28px;}
.lv-brand{font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:600;color:var(--g);letter-spacing:.18em;margin-bottom:6px;}
.lv-brand em{font-style:italic;font-weight:300;opacity:.85;}
.lv-tag{font-size:9px;letter-spacing:.24em;text-transform:uppercase;color:var(--ct);margin-bottom:36px;}
.lv-ttl{font-family:'Cormorant Garamond',serif;font-size:26px;font-style:italic;color:var(--cr);line-height:1.2;margin-bottom:20px;text-align:center;}
.lv-fld{width:100%;margin-bottom:14px;}
.lv-fld label{font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--ct);display:block;margin-bottom:5px;}
.lv-fld input{width:100%;background:rgba(255,255,255,.04);border:0.5px solid var(--bdrs);border-radius:8px;color:var(--cr);font-size:15px;padding:11px 14px;font-family:'DM Sans',sans-serif;letter-spacing:.02em;}
.lv-fld input:focus{outline:none;border-color:var(--g);}
.lv-act{width:100%;}
.lv-msg{font-size:11px;color:var(--cs);margin-top:14px;text-align:center;line-height:1.6;font-style:italic;}
.lv-otp{font-size:11px;color:var(--g);margin-top:10px;cursor:pointer;text-align:center;text-decoration:underline;text-decoration-color:rgba(212,175,106,.4);}
.lv-otp:hover{text-decoration-color:var(--g);}
```

- [ ] **Step 2: Add login render function** (in the `<script>`, before `// ── INIT ──`)

```javascript
// ── LOGIN VIEW ──
function renderLogin(){
  const app=document.getElementById('app');
  app.style.maxWidth='420px';app.style.minHeight='auto';app.style.background='var(--bgs)';
  app.innerHTML=`<div class="lv">
    <div class="lv-brand">N O U R I N <em>&</em></div>
    <div class="lv-tag">her vision · year one</div>
    <div class="lv-ttl">Sign in to continue</div>
    <div class="lv-fld"><label>Your email</label><input id="lv-email" type="email" placeholder="you@example.com" autocomplete="email"></div>
    <div id="lv-otp-fld" style="display:none" class="lv-fld"><label>6-digit code</label><input id="lv-code" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="••••••"></div>
    <div class="lv-act"><button id="lv-go" class="btn btng" style="width:100%;padding:11px 14px;font-size:13px">Send magic link</button></div>
    <div id="lv-msg" class="lv-msg"></div>
    <div id="lv-otp-toggle" class="lv-otp">Use 6-digit code instead</div>
  </div>`;
  const email=document.getElementById('lv-email');
  const code=document.getElementById('lv-code');
  const go=document.getElementById('lv-go');
  const msg=document.getElementById('lv-msg');
  const toggle=document.getElementById('lv-otp-toggle');
  const otpFld=document.getElementById('lv-otp-fld');
  let useOtp=false;
  toggle.onclick=()=>{useOtp=!useOtp;otpFld.style.display=useOtp?'block':'none';go.textContent=useOtp?'Verify code':'Send magic link';toggle.textContent=useOtp?'Use magic link instead':'Use 6-digit code instead';msg.textContent='';};
  go.onclick=async()=>{
    const e=email.value.trim();if(!e){msg.textContent='Enter your email.';return;}
    if(useOtp&&code.value.trim().length===6){
      msg.textContent='Verifying…';
      const{error}=await sb.auth.verifyOtp({email:e,token:code.value.trim(),type:'email'});
      if(error){msg.textContent=error.message;return;}
      // session set; main flow takes over
      bootstrap();return;
    }
    msg.textContent='Sending…';
    const{error}=await sb.auth.signInWithOtp({email:e,options:{shouldCreateUser:false}});
    if(error){msg.textContent=error.message;return;}
    msg.textContent=useOtp?'Code sent. Check your email.':'Link sent. Check your email and click to sign in.';
  };
}
```

- [ ] **Step 3: Modify init flow** — replace the current `load();render();` line at the bottom with:

```javascript
// ── INIT ──
async function bootstrap(){
  const{data:{session}}=await sb.auth.getSession();
  if(!session){renderLogin();return;}
  await loadFromCloud();
  render();
  subscribeRealtime();
}
sb.auth.onAuthStateChange((event)=>{if(event==='SIGNED_IN'||event==='SIGNED_OUT')bootstrap();});
bootstrap();
```

- [ ] **Step 4: Commit**
```bash
git add web/index.html
git commit -m "feat(web): on-brand login view with magic link + OTP"
```

### Task 3.3: Replace localStorage with Supabase reads

**Files:** Modify `web/index.html`

- [ ] **Step 1: Remove old `load()` and `sv()`**, replace with cloud variants:

```javascript
// ── CLOUD STORAGE ──
async function loadFromCloud(){
  // Ensure categories exist for this user
  const{data:cats,error:e1}=await sb.from('categories').select('*').order('sort_order');
  if(e1){console.error(e1);return;}
  if(!cats||cats.length===0){
    await sb.rpc('seed_categories_for_current_user');
    return loadFromCloud();
  }

  const[{data:projects},{data:milestones},{data:logEntries}]=await Promise.all([
    sb.from('projects').select('*').is('deleted_at',null).order('created_at'),
    sb.from('milestones').select('*').is('deleted_at',null).order('sort_order'),
    sb.from('log_entries').select('*').order('date',{ascending:true}),
  ]);

  // Reshape into the legacy S.data structure the renderer already understands
  S.data={
    categories:cats.map(c=>({id:c.id,name:c.name})),
    projects:(projects||[]).map(p=>({
      id:p.id,catId:p.category_id,name:p.name,desc:p.description,
      hasNum:p.has_num,cur:Number(p.cur),tgt:Number(p.tgt),unit:p.unit,
      hasMil:true,hasLog:true,
      mil:(milestones||[]).filter(m=>m.project_id===p.id).map(m=>({
        id:m.id,t:m.title,d:m.done,dt:m.done_at?m.done_at.slice(0,10):null
      })),
      log:(logEntries||[]).filter(l=>l.project_id===p.id).map(l=>({
        id:l.id,date:l.date,note:l.note,val:l.val!=null?Number(l.val):null
      })),
      status:p.status
    }))
  };
}

// uid() now uses crypto.randomUUID() for safer cross-device IDs.
function uid(){return crypto.randomUUID();}
```

(The legacy `function uid()` line earlier in the file becomes redundant — delete it.)

- [ ] **Step 2: Commit**
```bash
git add web/index.html
git commit -m "feat(web): replace localStorage reads with Supabase queries"
```

### Task 3.4: Replace mutations with Supabase writes (optimistic + audited)

**Files:** Modify `web/index.html`

- [ ] **Step 1: Add a write helper** above the mutation functions:

```javascript
// ── CLOUD WRITES ──
// Optimistic: caller mutates S.data then calls write(). On failure: showError + revert.
async function write(table, op, payload){
  let res;
  if(op==='insert')res=await sb.from(table).insert(payload).select().single();
  else if(op==='update')res=await sb.from(table).update(payload.values).eq('id',payload.id).select().single();
  else if(op==='upsert')res=await sb.from(table).upsert(payload).select().single();
  if(res.error){showError("Couldn't save — tap to retry.",()=>write(table,op,payload));return null;}
  // Best-effort audit log; non-blocking
  sb.from('events').insert({actor:'web',op,table_name:table,row_id:res.data.id,after:res.data}).then(()=>{});
  return res.data;
}

function showError(msg,onRetry){
  let t=document.getElementById('ftoast');
  if(!t){t=document.createElement('div');t.id='ftoast';t.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--bgf);border:0.5px solid var(--g);border-radius:10px;padding:11px 16px;color:var(--cr);font-size:12.5px;z-index:9999;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.5);';document.body.appendChild(t);}
  t.textContent=msg;t.onclick=()=>{t.remove();if(onRetry)onRetry();};
  setTimeout(()=>{if(t.parentNode)t.style.opacity='.6';},6000);
}
```

- [ ] **Step 2: Rewrite each mutation function** to (a) update `S.data` optimistically, (b) call `render()`, (c) await `write()`. On failure, the error toast shows; do NOT auto-revert (per spec — loud failures, user retries).

Replace `saveProj`, `saveEntry`, `toggleMs`, `saveMs`, `saveNum`, `changeStatus` bodies. Each one needs a UUID generated client-side, an optimistic mutation of `S.data`, an awaited `write()`. Example for `toggleMs`:

```javascript
async function toggleMs(mid){
  const p=S.data.projects.find(x=>x.id===S.selId);
  const m=p.mil.find(x=>x.id===mid);if(!m)return;
  m.d=!m.d;m.dt=m.d?today():null;
  render();
  await write('milestones','update',{id:mid,values:{done:m.d,done_at:m.d?new Date().toISOString():null}});
}
```

For `saveEntry` (creates a row), supply `id: crypto.randomUUID()` so the realtime echo dedupes:

```javascript
async function saveEntry(){
  const p=S.data.projects.find(x=>x.id===S.selId);
  const date=document.getElementById('ef-d')?.value||today();
  const note=document.getElementById('ef-n')?.value?.trim();if(!note)return;
  const id=crypto.randomUUID();
  const entry={id,date,note,val:null};
  if(p.hasNum){
    const v=parseFloat(document.getElementById('ef-v')?.value);
    if(!isNaN(v)){entry.val=v;p.cur=v;}
  }
  p.log.push(entry);
  S.showEntry=false;render();
  await write('log_entries','insert',{id,project_id:p.id,date,note,val:entry.val});
  if(entry.val!=null) await write('projects','update',{id:p.id,values:{cur:entry.val}});
}
```

Apply analogous rewrites to `saveProj`, `toggleMs`, `saveMs`, `saveNum`, `changeStatus`.

- [ ] **Step 3: Remove the legacy `sv()` calls** scattered through `dfd()`/`load()`/etc. Search for `sv()` — every instance should now be unreachable.

- [ ] **Step 4: Commit**
```bash
git add web/index.html
git commit -m "feat(web): optimistic writes to Supabase with loud failure toast"
```

### Task 3.5: Real-time subscriptions + dedupe

**Files:** Modify `web/index.html`

- [ ] **Step 1: Add subscribe function** before `// ── INIT ──`:

```javascript
// ── REALTIME ──
let _channel=null;
function subscribeRealtime(){
  if(_channel)sb.removeChannel(_channel);
  _channel=sb.channel('vision')
    .on('postgres_changes',{event:'*',schema:'public',table:'projects'},  ()=>refreshFromCloud())
    .on('postgres_changes',{event:'*',schema:'public',table:'milestones'},()=>refreshFromCloud())
    .on('postgres_changes',{event:'*',schema:'public',table:'log_entries'},()=>refreshFromCloud())
    .subscribe();
}

// Debounced refresh to avoid render storms during bulk MCP writes
let _refreshT=null;
function refreshFromCloud(){
  clearTimeout(_refreshT);
  _refreshT=setTimeout(async()=>{await loadFromCloud();render();},250);
}
```

Dedupe is implicit: `loadFromCloud()` reads canonical state, then `render()` redraws. Optimistic state in `S.data` is harmlessly overwritten with the same canonical state (same IDs).

- [ ] **Step 2: Commit**
```bash
git add web/index.html
git commit -m "feat(web): realtime sync — phone↔laptop live updates"
```

### Task 3.6: Mobile responsive

**Files:** Modify `web/index.html` (CSS additions)

- [ ] **Step 1: Add a media query** at the end of the `<style>` block:

```css
@media (max-width: 720px){
  body{padding:0;align-items:flex-start;}
  .app{flex-direction:column;border-radius:0;border:none;width:100%;max-width:none;min-height:100vh;}
  .sb{width:100%;max-height:none;border-right:none;border-bottom:0.5px solid var(--bdr);overflow-x:auto;overflow-y:hidden;}
  .sb-hd{padding:14px 14px 12px;min-height:auto;}
  .sb-brand{font-size:16px;}
  /* Hide deep sidebar; show only category chips horizontally */
  .ch{display:inline-flex;padding:8px 12px;border:0.5px solid var(--bdr);border-radius:18px;margin:0 4px 6px 0;}
  .ch:first-child{margin-left:14px;}
  .pi{display:none;} /* projects hidden by default on mobile; tapping a chip will reveal them in v2 */
  .mn{padding:18px 16px;max-height:none;}
  .ov-cats{grid-template-columns:1fr;}
  /* Tap targets ≥44px */
  .mg{width:24px;height:24px;}
  .mg-in{width:11px;height:11px;}
  .btn{padding:10px 16px;font-size:13px;}
  .btns{padding:8px 12px;font-size:12px;}
}
```

(Note for v2: tapping a category chip should expand its projects below. Out of scope for v1 — the overview cards already work on mobile.)

- [ ] **Step 2: Commit**
```bash
git add web/index.html
git commit -m "feat(web): mobile responsive layout (≤720px)"
```

### Task 3.7: Saving indicator + import flow + settings drawer

**Files:** Modify `web/index.html`

- [ ] **Step 1: Add CSS for the saving indicator and settings**

```css
.savi{position:absolute;top:18px;right:18px;width:14px;height:14px;opacity:0;transition:opacity .3s;pointer-events:none;}
.savi.on{opacity:.85;animation:pulse 1.4s ease-in-out infinite;}
@keyframes pulse{0%,100%{transform:scale(.85);opacity:.5}50%{transform:scale(1.15);opacity:1}}
.gear{position:absolute;bottom:14px;left:14px;font-size:14px;color:var(--ct);cursor:pointer;opacity:.6;}
.gear:hover{opacity:1;color:var(--g);}
.drawer{position:fixed;inset:0;background:rgba(6,5,15,.85);display:none;align-items:center;justify-content:center;z-index:9000;}
.drawer.on{display:flex;}
.drawer-c{background:var(--bgf);border:0.5px solid var(--bdrs);border-radius:14px;padding:24px;width:340px;}
.drawer-c h3{font-family:'Cormorant Garamond',serif;color:var(--cr);font-size:20px;font-style:italic;margin-bottom:16px;}
.drawer-c .row{margin-bottom:10px;}
.import-box{width:100%;height:140px;background:rgba(255,255,255,.04);border:0.5px solid var(--bdr);border-radius:8px;color:var(--cr);font-family:monospace;font-size:11px;padding:8px;}
```

- [ ] **Step 2: Add a saving indicator element** to the existing `.app` markup (just inside `<div class="app">`):

```html
<svg class="savi" id="savi" width="14" height="14" viewBox="0 0 20 20"><path d="M10 1L11.8 8.2L19 10L11.8 11.8L10 19L8.2 11.8L1 10L8.2 8.2Z" fill="#D4AF6A"/></svg>
```

- [ ] **Step 3: Toggle savi during writes** by wrapping `write()`:

```javascript
let _writeCount=0;
function _showSaving(on){_writeCount+=on?1:-1;const s=document.getElementById('savi');if(s)s.classList.toggle('on',_writeCount>0);}
```

Wrap the body of `write()`:
```javascript
async function write(table, op, payload){
  _showSaving(true);
  try{
    /* existing body */
  }finally{_showSaving(false);}
}
```

- [ ] **Step 4: Add settings drawer** rendered into the sidebar bottom (modify `renderSidebar()` so the gear and drawer are always emitted at the end of the sidebar HTML):

```javascript
// After existing sidebar h+= chain, append:
h+=`<div class="gear" data-act="open-drawer">⚙</div>`;
// And after the sidebar content is set, ensure the drawer exists once at body level.
```

Add to `bindAll()`:
```javascript
else if(a==='open-drawer'){openDrawer();}
else if(a==='import-data'){importLegacy();}
else if(a==='export-data'){exportData();}
else if(a==='sign-out'){sb.auth.signOut();}
else if(a==='close-drawer'){document.getElementById('drawer').classList.remove('on');}
```

- [ ] **Step 5: Drawer + import implementation**

```javascript
function openDrawer(){
  let d=document.getElementById('drawer');
  if(!d){d=document.createElement('div');d.id='drawer';d.className='drawer';document.body.appendChild(d);}
  d.innerHTML=`<div class="drawer-c">
    <h3>Settings</h3>
    <div class="row"><button class="btn btng btns" data-act="import-data" style="width:100%">Restore my data</button></div>
    <div class="row"><button class="btn btns" data-act="export-data" style="width:100%">Export data (JSON)</button></div>
    <div class="row"><button class="btn btns" data-act="sign-out" style="width:100%">Sign out</button></div>
    <div class="row" style="margin-top:14px;text-align:center"><span data-act="close-drawer" style="font-size:11px;color:var(--ct);cursor:pointer">Close</span></div>
  </div>`;
  d.classList.add('on');
}

async function importLegacy(){
  const c=document.querySelector('.drawer-c');
  c.innerHTML=`<h3>Restore from old localStorage</h3>
    <div class="row" style="font-size:11px;color:var(--cs);line-height:1.6">Paste the JSON you exported from the old dashboard:</div>
    <textarea id="imp-box" class="import-box" placeholder='{"categories":[...],"projects":[...]}'></textarea>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn btng btns" id="imp-go">Import</button><button class="btn btns" data-act="close-drawer">Cancel</button></div>
    <div id="imp-msg" style="margin-top:10px;font-size:11px;color:var(--cs)"></div>`;
  document.getElementById('imp-go').onclick=async()=>{
    const txt=document.getElementById('imp-box').value.trim();
    const msg=document.getElementById('imp-msg');
    let parsed;try{parsed=JSON.parse(txt);}catch{msg.textContent='Invalid JSON.';return;}
    msg.textContent='Importing…';
    try{
      // Insert categories that don't already exist (rare — should be seeded already)
      // Insert projects, milestones, log entries — preserving seed IDs.
      const proj=parsed.projects||[];
      for(const p of proj){
        await sb.from('projects').upsert({id:p.id,category_id:p.catId,name:p.name,description:p.desc||'',has_num:!!p.hasNum,cur:Number(p.cur)||0,tgt:Number(p.tgt)||0,unit:p.unit||'',status:p.status||'active'});
        for(const m of (p.mil||[])) await sb.from('milestones').upsert({id:m.id,project_id:p.id,title:m.t,done:!!m.d,done_at:m.dt?new Date(m.dt+'T00:00:00Z').toISOString():null});
        for(const l of (p.log||[])) await sb.from('log_entries').upsert({id:l.id,project_id:p.id,date:l.date,note:l.note,val:l.val!=null?Number(l.val):null});
      }
      msg.textContent='Imported. Refreshing…';
      await loadFromCloud();render();
      setTimeout(()=>document.getElementById('drawer').classList.remove('on'),700);
    }catch(e){msg.textContent='Failed: '+e.message;}
  };
}

function exportData(){
  const blob=new Blob([JSON.stringify(S.data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`vision-${today()}.json`;a.click();
}
```

- [ ] **Step 6: Commit**
```bash
git add web/index.html
git commit -m "feat(web): saving indicator, settings drawer, import/export flow"
```

### Task 3.8: Disable mock data fallback

**Files:** Modify `web/index.html`

- [ ] **Step 1: Remove `dfd()` (the default-data factory).** It's no longer needed — the database is the source of truth, and a logged-in user with no projects sees an empty dashboard with a clear "Restore my data" affordance in the settings drawer.

Search for and delete the entire `function dfd(){return{...}}` block. Also remove any remaining references to it.

- [ ] **Step 2: Commit**
```bash
git add web/index.html
git commit -m "refactor(web): remove legacy dfd() seed factory"
```

---

## Phase 4 — MCP Edge Function

### Task 4.1: Function scaffold

**Files:** Create `supabase/functions/mcp/deno.json`, `supabase/functions/mcp/index.ts`, `supabase/functions/mcp/db.ts`, `supabase/functions/mcp/events.ts`

- [ ] **Step 1: Write `deno.json`**

```json
{
  "imports": {
    "@modelcontextprotocol/sdk/": "npm:@modelcontextprotocol/sdk@1.0.4/",
    "postgres": "https://deno.land/x/postgresjs@v3.4.4/mod.js"
  }
}
```

- [ ] **Step 2: Write `db.ts`**

```typescript
import postgres from 'postgres';

const PG_URL = Deno.env.get('PG_URL')!;          // postgres://nourin_app:<pwd>@db.<ref>.supabase.co:5432/postgres
const NOURIN_USER_ID = Deno.env.get('NOURIN_USER_ID')!;

export const sql = postgres(PG_URL, {
  max: 5,
  idle_timeout: 20,
  prepare: false,
});

export { NOURIN_USER_ID };

// Helper: ensure every query is filtered by user_id.
// Usage: const rows = await sql`select * from projects where ${ownership()}`;
export const ownership = () => sql`user_id = ${NOURIN_USER_ID}`;
```

- [ ] **Step 3: Write `events.ts`**

```typescript
import { sql, NOURIN_USER_ID } from './db.ts';

export async function logEvent(params: {
  tool: string;
  op: 'insert' | 'update' | 'delete' | 'soft_delete' | 'undo';
  table_name: string;
  row_id?: string;
  before?: unknown;
  after?: unknown;
}) {
  await sql`
    insert into events (actor, tool, op, table_name, row_id, before, after, user_id)
    values ('mcp', ${params.tool}, ${params.op}, ${params.table_name},
            ${params.row_id ?? null}, ${params.before ? sql.json(params.before) : null},
            ${params.after ? sql.json(params.after) : null}, ${NOURIN_USER_ID})
  `;
}
```

- [ ] **Step 4: Write `index.ts` (entry point with bearer auth + tool registry)**

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { tools } from './tools/_registry.ts';

const MCP_BEARER_TOKEN = Deno.env.get('MCP_BEARER_TOKEN')!;

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const server = new Server({ name: 'vision-app-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.schema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = tools.find(t => t.name === req.params.name);
  if (!tool) throw new Error(`Unknown tool: ${req.params.name}`);
  const result = await tool.handler(req.params.arguments ?? {});
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

Deno.serve(async (req) => {
  // Bearer auth
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!constantTimeEqual(token, MCP_BEARER_TOKEN)) {
    return new Response('Unauthorized', { status: 401 });
  }

  // SSE transport
  const url = new URL(req.url);
  if (url.pathname.endsWith('/sse')) {
    const transport = new SSEServerTransport('/mcp/messages', new Response().body!.getWriter());
    await server.connect(transport);
    return new Response(transport.stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  }
  return new Response('Vision App MCP — POST to /sse with Bearer token', { status: 200 });
});
```

⚠️ **Agent note:** the SSE transport boilerplate above is a sketch. The MCP TypeScript SDK's exact SSE transport API may need adapting to Deno; before committing this file, run `deno cache supabase/functions/mcp/index.ts` to verify imports resolve, and consult the SDK docs at https://github.com/modelcontextprotocol/typescript-sdk for the current SSE pattern. If the API differs, adapt this code while keeping the auth + tool registry shape identical.

- [ ] **Step 5: Write `tools/_registry.ts`** (placeholder — populated as tools are added)

```typescript
// Tool registry — each tool exports its definition; this file aggregates them.
// Tools added incrementally in subsequent tasks.
export const tools: Array<{
  name: string;
  description: string;
  schema: unknown;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}> = [];
```

- [ ] **Step 6: Commit**
```bash
git add supabase/functions/mcp/
git commit -m "feat(mcp): scaffold Edge Function with bearer auth + tool registry"
```

### Task 4.2: Read tools

**Files:** Create `supabase/functions/mcp/tools/get_dashboard.ts`, `get_project.ts`, `recent_activity.ts`, `search.ts`. Update `tools/_registry.ts`.

- [ ] **Step 1: `get_dashboard.ts`**

```typescript
import { sql, NOURIN_USER_ID } from '../db.ts';

export const get_dashboard = {
  name: 'get_dashboard',
  description: 'Get a complete overview of all categories and projects with progress percentages and statuses. Use when the user asks "show me everything," "what am I working on," "give me the big picture," or any general status question. Returns categories with their projects nested; each project includes status, % progress, current/target values, milestone counts, and tags.',
  schema: { type: 'object', properties: {}, additionalProperties: false },
  async handler() {
    const cats = await sql`select id, name, sort_order from categories where user_id = ${NOURIN_USER_ID} order by sort_order`;
    const projs = await sql`select * from projects where user_id = ${NOURIN_USER_ID} and deleted_at is null order by created_at`;
    const ms = await sql`select project_id, count(*) filter (where done) as done, count(*) as total from milestones where user_id = ${NOURIN_USER_ID} and deleted_at is null group by project_id`;
    const msMap = new Map(ms.map(r => [r.project_id, { done: Number(r.done), total: Number(r.total) }]));

    return cats.map(c => ({
      id: c.id, name: c.name,
      projects: projs.filter(p => p.category_id === c.id).map(p => {
        const m = msMap.get(p.id) ?? { done: 0, total: 0 };
        const pct = p.has_num && Number(p.tgt) > 0
          ? Math.round((Number(p.cur) / Number(p.tgt)) * 100)
          : (m.total ? Math.round((m.done / m.total) * 100) : 0);
        return {
          id: p.id, name: p.name, description: p.description, status: p.status,
          has_num: p.has_num, cur: Number(p.cur), tgt: Number(p.tgt), unit: p.unit,
          tags: p.tags, phase: p.phase, target_date: p.target_date,
          progress_pct: Math.min(100, pct),
          milestones: m,
        };
      }),
    }));
  },
};
```

- [ ] **Step 2: `get_project.ts`**

```typescript
import { sql, NOURIN_USER_ID } from '../db.ts';

export const get_project = {
  name: 'get_project',
  description: 'Get full details for one project: description, all milestones, last 20 log entries, last 5 reflections. Use when the user asks about a specific goal/project ("how is my Hajj savings going?", "what milestones do I have for Arabic?"). Match by id when known, otherwise by exact name.',
  schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Project ID (e.g., "baqarah", "umrahsave")' },
      name: { type: 'string', description: 'Project name (used if id not given)' },
    },
  },
  async handler(args: { id?: string; name?: string }) {
    let project;
    if (args.id) {
      [project] = await sql`select * from projects where user_id = ${NOURIN_USER_ID} and id = ${args.id} and deleted_at is null`;
    } else if (args.name) {
      [project] = await sql`select * from projects where user_id = ${NOURIN_USER_ID} and name ilike ${args.name} and deleted_at is null limit 1`;
    } else {
      throw new Error('Provide id or name');
    }
    if (!project) throw new Error('Project not found');

    const milestones = await sql`select id, title, done, done_at, sort_order from milestones where project_id = ${project.id} and deleted_at is null order by sort_order, created_at`;
    const log = await sql`select id, date, note, val from log_entries where project_id = ${project.id} order by date desc, created_at desc limit 20`;
    const reflections = await sql`select id, date, title, body, mood, tags from reflections where project_id = ${project.id} order by date desc limit 5`;

    return { ...project, cur: Number(project.cur), tgt: Number(project.tgt), milestones, log_entries: log, reflections };
  },
};
```

- [ ] **Step 3: `recent_activity.ts`**

```typescript
import { sql, NOURIN_USER_ID } from '../db.ts';

export const recent_activity = {
  name: 'recent_activity',
  description: 'Get the most recent log entries and reflections across all projects. Use when the user asks "what have I been up to," "summarize my last week," "what did I log recently," or any time-based reflection question.',
  schema: {
    type: 'object',
    properties: {
      limit: { type: 'number', default: 20, description: 'Max entries to return (default 20)' },
    },
  },
  async handler(args: { limit?: number }) {
    const limit = Math.min(args.limit ?? 20, 100);
    const log = await sql`select 'log' as kind, l.id, l.date, l.note, l.val, l.project_id, p.name as project_name from log_entries l join projects p on p.id = l.project_id where l.user_id = ${NOURIN_USER_ID} order by l.date desc, l.created_at desc limit ${limit}`;
    const ref = await sql`select 'reflection' as kind, r.id, r.date, r.title, r.body, r.mood, r.tags, r.project_id, p.name as project_name from reflections r left join projects p on p.id = r.project_id where r.user_id = ${NOURIN_USER_ID} order by r.date desc limit ${limit}`;
    return [...log, ...ref].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, limit);
  },
};
```

- [ ] **Step 4: `search.ts`**

```typescript
import { sql, NOURIN_USER_ID } from '../db.ts';

export const search = {
  name: 'search',
  description: 'Full-text search across project names/descriptions, milestone titles, log entry notes, and reflection bodies. Use when the user asks "what did I write about X," "find that note where I mentioned Y," "anything about Ibrahim," etc.',
  schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Search query (1-3 keywords work best)' } },
    required: ['query'],
  },
  async handler(args: { query: string }) {
    const q = args.query.trim();
    const tsq = sql`plainto_tsquery('english', ${q})`;
    const projects = await sql`select id, name, description, 'project' as kind from projects where user_id = ${NOURIN_USER_ID} and deleted_at is null and to_tsvector('english', name || ' ' || coalesce(description,'')) @@ ${tsq} limit 10`;
    const ms = await sql`select id, title, project_id, 'milestone' as kind from milestones where user_id = ${NOURIN_USER_ID} and deleted_at is null and to_tsvector('english', title) @@ ${tsq} limit 10`;
    const log = await sql`select id, date, note, project_id, 'log' as kind from log_entries where user_id = ${NOURIN_USER_ID} and to_tsvector('english', note) @@ ${tsq} order by date desc limit 20`;
    const ref = await sql`select id, date, title, body, project_id, 'reflection' as kind from reflections where user_id = ${NOURIN_USER_ID} and to_tsvector('english', coalesce(title,'') || ' ' || body) @@ ${tsq} order by date desc limit 10`;
    return { projects, milestones: ms, log_entries: log, reflections: ref };
  },
};
```

- [ ] **Step 5: Update `tools/_registry.ts`**

```typescript
import { get_dashboard } from './get_dashboard.ts';
import { get_project } from './get_project.ts';
import { recent_activity } from './recent_activity.ts';
import { search } from './search.ts';

export const tools = [get_dashboard, get_project, recent_activity, search];
```

- [ ] **Step 6: Commit**
```bash
git add supabase/functions/mcp/tools/ supabase/functions/mcp/tools/_registry.ts
git commit -m "feat(mcp): read tools — dashboard/project/recent/search"
```

### Task 4.3: Write tools

**Files:** Create `supabase/functions/mcp/tools/upsert_project.ts`, `add_milestone.ts`, `set_milestone_status.ts`, `log_entry.ts`, `add_reflection.ts`. Update `_registry.ts`.

- [ ] **Step 1: `upsert_project.ts`**

```typescript
import { sql, NOURIN_USER_ID } from '../db.ts';
import { logEvent } from '../events.ts';
import { get_project } from './get_project.ts';

export const upsert_project = {
  name: 'upsert_project',
  description: 'Create a new project or edit an existing one. If `id` is provided and exists, update fields you provide (others left untouched). If no id, creates a new project — `category_id` and `name` are required for new projects. For numeric projects (savings, MRR, session counts), set `has_num: true` and provide `tgt` and `unit`.',
  schema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      category_id: { type: 'string', enum: ['spiritual','fitness','career','personal','travel'] },
      name: { type: 'string' },
      description: { type: 'string' },
      has_num: { type: 'boolean' },
      cur: { type: 'number' },
      tgt: { type: 'number' },
      unit: { type: 'string' },
      status: { type: 'string', enum: ['active','paused','completed'] },
      tags: { type: 'array', items: { type: 'string' } },
      phase: { type: 'string' },
      target_date: { type: 'string', description: 'ISO date YYYY-MM-DD' },
    },
  },
  async handler(args: Record<string, any>) {
    const id = args.id ?? crypto.randomUUID();
    const [existing] = args.id
      ? await sql`select * from projects where id = ${id} and user_id = ${NOURIN_USER_ID}`
      : [null];

    if (existing) {
      const fields: Record<string, unknown> = {};
      for (const k of ['category_id','name','description','has_num','cur','tgt','unit','status','tags','phase','target_date']) {
        if (k in args) fields[k] = args[k];
      }
      const [updated] = await sql`update projects set ${sql(fields)} where id = ${id} returning *`;
      await logEvent({ tool: 'upsert_project', op: 'update', table_name: 'projects', row_id: id, before: existing, after: updated });
      return await get_project.handler({ id });
    }

    if (!args.category_id || !args.name) throw new Error('category_id and name required for new projects');
    const [created] = await sql`
      insert into projects (id, category_id, name, description, has_num, cur, tgt, unit, status, tags, phase, target_date, user_id)
      values (${id}, ${args.category_id}, ${args.name}, ${args.description ?? ''}, ${args.has_num ?? false},
              ${args.cur ?? 0}, ${args.tgt ?? 0}, ${args.unit ?? ''}, ${args.status ?? 'active'},
              ${args.tags ?? sql`'{}'::text[]`}, ${args.phase ?? null}, ${args.target_date ?? null}, ${NOURIN_USER_ID})
      returning *
    `;
    await logEvent({ tool: 'upsert_project', op: 'insert', table_name: 'projects', row_id: id, after: created });
    return await get_project.handler({ id });
  },
};
```

- [ ] **Step 2: `add_milestone.ts`**

```typescript
import { sql, NOURIN_USER_ID } from '../db.ts';
import { logEvent } from '../events.ts';
import { get_project } from './get_project.ts';

export const add_milestone = {
  name: 'add_milestone',
  description: 'Append a milestone to a project. Milestones are concrete checkpoints ("First 10 ayahs," "$1,575 — 25%," "Pass driving test"). Order is preserved.',
  schema: {
    type: 'object',
    properties: {
      project_id: { type: 'string' },
      title: { type: 'string' },
    },
    required: ['project_id', 'title'],
  },
  async handler(args: { project_id: string; title: string }) {
    const id = crypto.randomUUID();
    const [{ max_order }] = await sql`select coalesce(max(sort_order),0) as max_order from milestones where project_id = ${args.project_id}`;
    const [m] = await sql`
      insert into milestones (id, project_id, title, sort_order, user_id)
      values (${id}, ${args.project_id}, ${args.title}, ${Number(max_order) + 1}, ${NOURIN_USER_ID})
      returning *
    `;
    await logEvent({ tool: 'add_milestone', op: 'insert', table_name: 'milestones', row_id: id, after: m });
    return await get_project.handler({ id: args.project_id });
  },
};
```

- [ ] **Step 3: `set_milestone_status.ts`**

```typescript
import { sql, NOURIN_USER_ID } from '../db.ts';
import { logEvent } from '../events.ts';
import { get_project } from './get_project.ts';

export const set_milestone_status = {
  name: 'set_milestone_status',
  description: 'Mark a milestone as done or not done. Stamps done_at when flipping to true; clears it when flipping to false. Idempotent — calling with the current value is a safe no-op.',
  schema: {
    type: 'object',
    properties: {
      milestone_id: { type: 'string' },
      done: { type: 'boolean' },
    },
    required: ['milestone_id', 'done'],
  },
  async handler(args: { milestone_id: string; done: boolean }) {
    const [before] = await sql`select * from milestones where id = ${args.milestone_id} and user_id = ${NOURIN_USER_ID}`;
    if (!before) throw new Error('Milestone not found');
    const [after] = await sql`
      update milestones set done = ${args.done}, done_at = ${args.done ? sql`now()` : null}
      where id = ${args.milestone_id} returning *
    `;
    await logEvent({ tool: 'set_milestone_status', op: 'update', table_name: 'milestones', row_id: args.milestone_id, before, after });
    return await get_project.handler({ id: before.project_id });
  },
};
```

- [ ] **Step 4: `log_entry.ts`**

```typescript
import { sql, NOURIN_USER_ID } from '../db.ts';
import { logEvent } from '../events.ts';
import { get_project } from './get_project.ts';

export const log_entry = {
  name: 'log_entry',
  description: 'Add a dated log entry to a project. Use when the user describes something concrete they did, observed, or measured — a workout, a saving, a session, a moment from a trip. Always store the date (default to today if not specified) and the note in their own words. For numeric projects (savings totals, MRR, session counts), include `val` and the project\'s current value will also be updated to that number.',
  schema: {
    type: 'object',
    properties: {
      project_id: { type: 'string' },
      date: { type: 'string', description: 'YYYY-MM-DD; defaults to today' },
      note: { type: 'string' },
      val: { type: 'number', description: 'Optional. New current value for numeric projects.' },
    },
    required: ['project_id', 'note'],
  },
  async handler(args: { project_id: string; date?: string; note: string; val?: number }) {
    const id = crypto.randomUUID();
    const date = args.date ?? new Date().toISOString().slice(0, 10);
    const [entry] = await sql`
      insert into log_entries (id, project_id, date, note, val, user_id)
      values (${id}, ${args.project_id}, ${date}, ${args.note}, ${args.val ?? null}, ${NOURIN_USER_ID})
      returning *
    `;
    await logEvent({ tool: 'log_entry', op: 'insert', table_name: 'log_entries', row_id: id, after: entry });
    if (args.val != null) {
      const [pBefore] = await sql`select cur from projects where id = ${args.project_id}`;
      await sql`update projects set cur = ${args.val} where id = ${args.project_id}`;
      await logEvent({ tool: 'log_entry', op: 'update', table_name: 'projects', row_id: args.project_id, before: pBefore, after: { cur: args.val } });
    }
    return await get_project.handler({ id: args.project_id });
  },
};
```

- [ ] **Step 5: `add_reflection.ts`**

```typescript
import { sql, NOURIN_USER_ID } from '../db.ts';
import { logEvent } from '../events.ts';

export const add_reflection = {
  name: 'add_reflection',
  description: 'Add a reflection — open-ended thought, weekly/monthly framing, mood, lesson, intention. Different from log entries (which are concrete acts). Use when the user is reflecting, journaling, processing, or observing patterns. Reflections can optionally be tied to a project.',
  schema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'YYYY-MM-DD; defaults to today' },
      body: { type: 'string' },
      project_id: { type: 'string', description: 'Optional. Tie to one project.' },
      title: { type: 'string' },
      mood: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['body'],
  },
  async handler(args: any) {
    const id = crypto.randomUUID();
    const date = args.date ?? new Date().toISOString().slice(0, 10);
    const [r] = await sql`
      insert into reflections (id, project_id, date, title, body, mood, tags, user_id)
      values (${id}, ${args.project_id ?? null}, ${date}, ${args.title ?? null}, ${args.body},
              ${args.mood ?? null}, ${args.tags ?? sql`'{}'::text[]`}, ${NOURIN_USER_ID})
      returning *
    `;
    await logEvent({ tool: 'add_reflection', op: 'insert', table_name: 'reflections', row_id: id, after: r });
    return r;
  },
};
```

- [ ] **Step 6: Update `_registry.ts`**

```typescript
import { get_dashboard } from './get_dashboard.ts';
import { get_project } from './get_project.ts';
import { recent_activity } from './recent_activity.ts';
import { search } from './search.ts';
import { upsert_project } from './upsert_project.ts';
import { add_milestone } from './add_milestone.ts';
import { set_milestone_status } from './set_milestone_status.ts';
import { log_entry } from './log_entry.ts';
import { add_reflection } from './add_reflection.ts';

export const tools = [
  get_dashboard, get_project, recent_activity, search,
  upsert_project, add_milestone, set_milestone_status, log_entry, add_reflection,
];
```

- [ ] **Step 7: Commit**
```bash
git add supabase/functions/mcp/tools/
git commit -m "feat(mcp): write tools — upsert/milestones/log/reflection"
```

### Task 4.4: undo_last_write tool

**Files:** Create `supabase/functions/mcp/tools/undo_last_write.ts`. Update `_registry.ts`.

- [ ] **Step 1: Write `undo_last_write.ts`**

```typescript
import { sql, NOURIN_USER_ID } from '../db.ts';
import { logEvent } from '../events.ts';

export const undo_last_write = {
  name: 'undo_last_write',
  description: 'Reverse the most recent write performed by the MCP. Use when the user says "undo," "wait, no," "I didn\'t mean that," or "take that back." Reads the latest event from the audit log and replays its inverse. The undo itself is recorded as a new event, so undo-of-undo is just another step.',
  schema: { type: 'object', properties: {}, additionalProperties: false },
  async handler() {
    const [last] = await sql`
      select * from events
      where user_id = ${NOURIN_USER_ID} and actor = 'mcp' and op != 'undo'
      order by at desc limit 1
    `;
    if (!last) return { undone: null, message: 'Nothing to undo.' };

    const t = last.table_name;
    const id = last.row_id;
    if (!id) return { undone: null, message: `Cannot undo a batch event (id=${last.id}). Manual intervention required.` };

    if (last.op === 'insert') {
      // Inverse: hard delete
      const allowedTables = ['projects','milestones','log_entries','reflections'];
      if (!allowedTables.includes(t)) return { undone: null, message: `Cannot undo insert on ${t}` };
      await sql`delete from ${sql(t)} where id = ${id} and user_id = ${NOURIN_USER_ID}`;
      await logEvent({ tool: 'undo_last_write', op: 'undo', table_name: t, row_id: id, before: last.after });
      return { undone: { event_id: last.id, op: 'insert', table: t, row_id: id }, message: `Undid insert into ${t}.` };
    }

    if (last.op === 'update') {
      const before = last.before as Record<string, unknown>;
      if (!before) return { undone: null, message: 'No before-state recorded; cannot undo.' };
      // Replay the previous values
      await sql`update ${sql(t)} set ${sql(before)} where id = ${id} and user_id = ${NOURIN_USER_ID}`;
      await logEvent({ tool: 'undo_last_write', op: 'undo', table_name: t, row_id: id, before: last.after, after: before });
      return { undone: { event_id: last.id, op: 'update', table: t, row_id: id }, message: `Reverted update on ${t}.` };
    }

    return { undone: null, message: `Op ${last.op} not yet supported by undo.` };
  },
};
```

- [ ] **Step 2: Add to registry**

```typescript
// In tools/_registry.ts, append:
import { undo_last_write } from './undo_last_write.ts';
// ...
export const tools = [..., undo_last_write];
```

- [ ] **Step 3: Commit**
```bash
git add supabase/functions/mcp/tools/undo_last_write.ts supabase/functions/mcp/tools/_registry.ts
git commit -m "feat(mcp): undo_last_write — replay event log inverse"
```

---

## Phase 5 — Deployment recipe completion

### Task 5.1: Finish `docs/deployment.md`

**Files:** Modify `docs/deployment.md`

- [ ] **Step 1: Append steps 6-9**

```markdown
## 6. Configure web app + deploy to GitHub Pages

In `web/index.html`, replace placeholders:
- `SUPABASE_URL = 'https://YOURPROJECT.supabase.co'` → your real URL
- `SUPABASE_ANON_KEY = 'PLACEHOLDER_ANON_KEY'` → your real anon key
- In the `<meta http-equiv="Content-Security-Policy">` tag, replace `YOURPROJECT.supabase.co` with your real subdomain.
- The SRI hash on the Supabase SDK script tag — should already be set; if not, regenerate with:
  ```bash
  curl -s https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.46.1/dist/umd/supabase.min.js | openssl dgst -sha384 -binary | openssl base64 -A
  ```

Push to GitHub. In repo Settings → Pages: source = `main` branch, folder = `/web`. Wait ~1 min for the green check.

## 7. Deploy MCP Edge Function

```bash
supabase functions deploy mcp --no-verify-jwt
```
(`--no-verify-jwt` because we authenticate via our own bearer token, not Supabase's JWT.)

Set function secrets:
```bash
supabase secrets set \
  PG_URL='postgres://nourin_app:<password-from-step-3>@db.<your-project-ref>.supabase.co:5432/postgres?sslmode=require' \
  NOURIN_USER_ID='<your-auth-uid-from-step-5>' \
  MCP_BEARER_TOKEN='<long-random-string-you-generate>'
```

Generate the bearer token:
```bash
openssl rand -hex 32
```

## 8. Connect claude.ai

claude.ai → Settings → Connectors → Add custom MCP:
- **URL:** `https://<your-project-ref>.functions.supabase.co/mcp/sse`
- **Auth:** Bearer token, paste the token from step 7.

Test from a Claude conversation: ask "show my dashboard." You should see all your projects.

## 9. Restore your data

1. Open the *current* `index (4).html` (still in repo root) once more in your browser.
2. Open DevTools console (F12), run:
   ```js
   copy(localStorage.getItem('nourin_dashboard_v1'))
   ```
3. Open the live web app at your GitHub Pages URL, sign in via magic link.
4. Open settings (gear icon, sidebar bottom) → "Restore my data" → paste → Import.
5. Verify all projects, milestones, and log entries appear correctly.
6. Delete the original `index (4).html` from repo root (keep git history): `git rm "index (4).html" && git commit -m "chore: remove legacy localStorage HTML after successful migration"`.

You're done. Use the app on phone, laptop, claude.ai web/mobile, Claude Code, Claude desktop — all sharing the same data.
```

- [ ] **Step 2: Commit**
```bash
git add docs/deployment.md
git commit -m "docs(deploy): full setup recipe steps 6-9"
```

### Task 5.2: Final README polish

**Files:** Modify `README.md`

- [ ] **Step 1:** Make `README.md` have:
  - One-line description ("Personal life dashboard with cloud sync and Claude/MCP integration")
  - Stack list
  - Pointer to `docs/deployment.md` for setup
  - Pointer to `CLAUDE.md` for context
  - Pointer to spec and plan docs

Keep under 60 lines.

- [ ] **Step 2: Commit**
```bash
git add README.md
git commit -m "docs: README pointing to spec, plan, deployment recipe"
```

---

## Self-review checklist

After completing all tasks, verify:

- [ ] Every spec section has a corresponding task (architecture, schema, web app changes, MCP tools, deployment).
- [ ] No placeholders remain in code (search: `TODO`, `PLACEHOLDER`, `TBD`, `YOURPROJECT` outside of `docs/deployment.md`).
- [ ] Tool names match between `_registry.ts`, individual tool files, and the spec.
- [ ] All tables in the schema are referenced by at least one MCP tool or web flow.
- [ ] Every write tool calls `logEvent`.
- [ ] `undo_last_write` covers `insert` and `update`; documents `delete`/`soft_delete` are out of v1 scope.
- [ ] CLAUDE.md updated to reflect new structure.
- [ ] No code references the old localStorage key (`nourin_dashboard_v1`) except in `docs/deployment.md` step 9 (intentional).

## Acceptance test (manual, after Nourin's deployment)

1. Sign up (admin-created via Supabase dashboard, not public signup).
2. Sign in via magic link on laptop. Categories appear (5 of them, empty).
3. Open settings → Restore my data → paste old localStorage → import.
4. Verify all 20 projects, all milestones, all log entries appear correctly.
5. Open the same URL on phone → sign in via OTP. Same data appears.
6. From claude.ai: "show my dashboard." Receives JSON of categories + projects.
7. From claude.ai: "log 30 minutes cycling today." See the new log entry appear *live* on the laptop dashboard within 1-2 seconds.
8. From claude.ai: "actually undo that." `undo_last_write` removes the entry; laptop reflects it live.
9. Reload web app. Same data. No stale state.
10. Confirm public signup is disabled by attempting to sign up with a different email — should fail.

---

**End of plan.**
