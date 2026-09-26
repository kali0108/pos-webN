-- =====================================================================
-- 0021_delete_and_reset.sql
-- Two things:
--
-- 1. DELETE policies for items and branches. Neither had one before —
--    RLS defaults to deny, so hard-deleting a product or branch was
--    completely blocked regardless of who was asking. (profiles
--    already has no DELETE policy and still won't get one here —
--    deleting a staff login has to go through the delete-staff-user
--    Edge Function, same reason creating one does: only the Admin API
--    can remove an auth.users row, and the profiles row cascades from
--    that automatically.)
--
-- 2. reset_all_business_data(): a single, heavily-guarded RPC that
--    wipes transactional and catalog data to let an Owner start fresh
--    after testing, WITHOUT deleting branches or staff accounts
--    (those are structural setup, not "data" in the sense meant here
--    — losing them would lock everyone out of the system they'd need
--    to rebuild it). Owner-only, no exceptions, not even a delegated
--    staff.manage holder.
-- =====================================================================

create policy "items: delete inventory.edit" on items
  for delete using (has_permission('inventory.edit'));

-- Note: branches already has a DELETE policy from 0005_rls_policies.sql
-- ("branches: delete (owner only)", using is_owner()) — nothing to add
-- here, it already covers exactly what's needed.

create or replace function reset_all_business_data(confirmation_phrase text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_counts jsonb;
begin
  if not is_owner() then
    raise exception 'Only the Owner can reset business data.';
  end if;
  if confirmation_phrase is distinct from 'DELETE ALL DATA' then
    raise exception 'Confirmation phrase did not match. Nothing was deleted.';
  end if;

  -- Children first, in dependency order, so no FK ever blocks this
  -- (this function bypasses nothing security-wise — it just deletes
  -- in the correct order instead of relying on cascades).
  delete from payments;
  delete from refunds;
  delete from invoice_items;
  delete from invoices;
  delete from custom_order_status_history;
  delete from custom_orders;
  delete from production_actuals;
  delete from production_plans;
  delete from stock_movements;
  delete from branch_item_stock;
  delete from branch_raw_material_stock;
  delete from item_recipes;
  delete from discount_rules;
  delete from items;
  delete from categories;
  delete from raw_materials;
  -- Branch invoice sequences restart from 1 for whichever branches remain.
  update branch_invoice_counters set next_number = 1;
  -- activity_log is intentionally NOT cleared — see the log_activity()
  -- call below, which becomes the first entry of the fresh log,
  -- recording that a reset happened and by whom, once this function
  -- returns and the caller's own transaction commits.

  select jsonb_build_object(
    'invoices_deleted', true,
    'catalog_cleared', true,
    'branches_kept', (select count(*) from branches),
    'staff_kept', (select count(*) from profiles)
  ) into v_counts;

  perform log_activity('system.data_reset', null, null, null, v_counts);

  return v_counts;
end;
$$;

grant execute on function reset_all_business_data(text) to authenticated;
