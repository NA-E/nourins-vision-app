-- Add sort_order to projects so users can reorder items within a category
-- via drag-and-drop in the dashboard.

alter table public.projects
  add column if not exists sort_order int not null default 0;

-- Backfill: assign sequential sort_order within each category, ordered by
-- creation time (so existing data preserves its current order).
update public.projects p
set sort_order = sub.rn
from (
  select id, row_number() over (partition by category_id order by created_at) as rn
  from public.projects
) sub
where p.id = sub.id and p.sort_order = 0;

-- Index for ORDER BY performance + filter by category
create index if not exists idx_projects_sort
  on public.projects (category_id, sort_order)
  where deleted_at is null;
