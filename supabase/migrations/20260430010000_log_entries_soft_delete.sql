-- ============================================================================
-- Add soft-delete to log_entries
-- Date: 2026-04-30
-- ============================================================================

alter table public.log_entries add column if not exists deleted_at timestamptz;

create index if not exists idx_log_active
  on public.log_entries (project_id, date desc)
  where deleted_at is null;
