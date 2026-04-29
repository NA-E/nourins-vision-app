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

-- nourin_app bypasses RLS because the MCP function code unconditionally
-- filters by NOURIN_USER_ID env var on every query. RLS would otherwise
-- block all access since auth.uid() is NULL outside a Supabase Auth JWT
-- session. The role's table grants are still scoped (only 4 data tables
-- + events), so blast radius is bounded.
alter role nourin_app bypassrls;

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
