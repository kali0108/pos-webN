-- =====================================================================
-- 0004_permission_functions.sql
-- The three functions every RLS policy in this project is built from.
-- They are SECURITY DEFINER so they can read profiles/permission
-- tables regardless of the caller's own RLS restrictions (the standard
-- Supabase pattern for this — the functions are owned by the
-- migration role, which owns the underlying tables, so they read
-- through without recursing into RLS on those tables).
-- =====================================================================

-- Is the current logged-in user the unrestricted Super Admin/Owner?
create or replace function is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and is_owner = true and is_active = true
  );
$$;

-- Effective permission = per-user override if one exists,
-- else the user's role-template default, else false (deny by default).
-- The Owner always passes, regardless of the matrix.
create or replace function has_permission(perm_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from profiles where id = auth.uid() and is_active = true)
    and (
      is_owner()
      or coalesce(
           (select upo.allowed from user_permission_overrides upo
              where upo.user_id = auth.uid() and upo.permission_key = perm_key),
           (select rtp.allowed from profiles p
              join role_template_permissions rtp on rtp.role_template_id = p.role_template_id
              where p.id = auth.uid() and rtp.permission_key = perm_key),
           false
         )
    );
$$;

-- Does the current user have access to this branch?
-- Owner has implicit access to every branch.
create or replace function has_branch_access(b_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from profiles where id = auth.uid() and is_active = true)
    and (
      is_owner()
      or exists (select 1 from user_branches where user_id = auth.uid() and branch_id = b_id)
    );
$$;

grant execute on function is_owner() to authenticated;
grant execute on function has_permission(text) to authenticated;
grant execute on function has_branch_access(uuid) to authenticated;
