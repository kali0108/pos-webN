-- =====================================================================
-- 0008_client_helpers.sql
-- Read-only convenience RPCs for the frontend. These don't grant any
-- access on their own — has_permission() underneath still applies the
-- exact same rules RLS uses everywhere else. They just batch results
-- into one round trip so the login screen isn't making 12 requests.
-- =====================================================================

create or replace function get_my_permissions()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(p.key, has_permission(p.key)), '{}'::jsonb)
  from permissions p;
$$;

grant execute on function get_my_permissions() to authenticated;

create or replace function get_my_branches()
returns table (id uuid, code text, name text)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.code, b.name
  from branches b
  where b.is_active and (is_owner() or exists (
    select 1 from user_branches ub where ub.user_id = auth.uid() and ub.branch_id = b.id
  ))
  order by b.name;
$$;

grant execute on function get_my_branches() to authenticated;
