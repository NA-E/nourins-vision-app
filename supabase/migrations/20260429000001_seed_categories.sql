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
