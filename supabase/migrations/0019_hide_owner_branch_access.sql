-- =====================================================================
-- 0019_hide_owner_branch_access.sql
-- 0018 stopped a non-Owner staff.manage holder from seeing or editing
-- the Owner's profile — but they could still change which branches
-- the Owner has access to via user_branches, since that policy only
-- checked has_permission('staff.manage') with no Owner-target guard.
-- Same fix pattern as everywhere else in this file: is_owner() always
-- passes; a delegated manager can manage everyone else's branch
-- access but never touches a row where the target is the Owner.
-- =====================================================================

drop policy if exists "user_branches: write staff.manage" on user_branches;
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
