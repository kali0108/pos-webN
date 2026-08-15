-- =====================================================================
-- 0018_hide_owner_from_managers.sql
-- CRITICAL FIX: a delegated (non-owner) staff.manage holder — e.g. a
-- Branch Manager granted staff management rights — could see the
-- Owner's profile in Admin > Staff, edit the Owner's name, and
-- change which branches the Owner has access to. The existing
-- anti-escalation rule on user_permission_overrides already blocked
-- editing the Owner's PERMISSIONS, but profiles (SELECT + UPDATE) and
-- user_branches had no equivalent protection at all.
--
-- After this migration, a non-owner staff.manage holder simply never
-- sees an Owner-flagged profile row — not in a list, not via a direct
-- API call, nothing to hide client-side because the database itself
-- doesn't return it. The Owner can still see and manage everyone,
-- including (in the rare case of more than one Owner account) another
-- Owner row.
-- =====================================================================

drop policy "profiles: read self or if staff.manage" on profiles;
create policy "profiles: read self, or non-owner staff if staff.manage, or everyone if owner" on profiles
  for select using (
    id = auth.uid()
    or is_owner()
    or (has_permission('staff.manage') and profiles.is_owner = false)
  );

drop policy "profiles: update self (limited) or staff.manage" on profiles;
create policy "profiles: update self, non-owner staff if staff.manage, or everyone if owner" on profiles
  for update using (
    id = auth.uid()
    or is_owner()
    or (has_permission('staff.manage') and profiles.is_owner = false)
  );

drop policy "user_branches: write staff.manage" on user_branches;
create policy "user_branches: write staff.manage, never for an Owner target" on user_branches
  for all using (
    is_owner()
    or (
      has_permission('staff.manage')
      and not exists (select 1 from profiles where id = user_branches.user_id and is_owner = true)
    )
  )
  with check (
    is_owner()
    or (
      has_permission('staff.manage')
      and not exists (select 1 from profiles where id = user_branches.user_id and is_owner = true)
    )
  );
