-- =====================================================================
-- 0018_hide_owner_profile.sql
-- Previously, anyone with staff.manage (including a delegated manager,
-- not just the Owner) could see AND edit the Owner's profile row —
-- staff.manage was meant to let a manager administer other staff, not
-- see or touch the Owner's own account. This closes that at the
-- database level: a non-Owner staff.manage holder can now see and
-- update every profile EXCEPT one where is_owner = true. The Owner
-- themselves (is_owner()) still sees and can update everyone,
-- including their own row, exactly as before.
-- =====================================================================

drop policy if exists "profiles: read self or if staff.manage" on profiles;
create policy "profiles: read self, owner sees all, staff.manage sees non-owner accounts" on profiles
  for select using (
    id = auth.uid()
    or is_owner()
    or (has_permission('staff.manage') and profiles.is_owner = false)
  );

drop policy if exists "profiles: update self (limited) or staff.manage" on profiles;
create policy "profiles: update self, owner updates all, staff.manage updates non-owner accounts" on profiles
  for update using (
    id = auth.uid()
    or is_owner()
    or (has_permission('staff.manage') and profiles.is_owner = false)
  );
