-- Web app inserts have been failing silently because user_id is NOT NULL with
-- no default — the JS SDK calls don't pass user_id, so every INSERT violates
-- the constraint. Optimistic UI updates make it look like the row was added,
-- then the next refresh (real-time or page reload) shows the canonical state
-- without it.
--
-- Fix: default user_id to auth.uid() so any authenticated INSERT auto-fills.
-- The MCP path is unaffected (it always passes NOURIN_USER_ID explicitly).

alter table public.projects     alter column user_id set default auth.uid();
alter table public.milestones   alter column user_id set default auth.uid();
alter table public.log_entries  alter column user_id set default auth.uid();
alter table public.reflections  alter column user_id set default auth.uid();
alter table public.events       alter column user_id set default auth.uid();
alter table public.categories   alter column user_id set default auth.uid();
