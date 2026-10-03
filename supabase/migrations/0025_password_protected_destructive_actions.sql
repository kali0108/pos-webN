-- =====================================================================
-- 0025_password_protected_destructive_actions.sql
-- Deleting a branch/product and resetting the whole system now
-- require the acting person's own password, checked on the SERVER
-- (not just a client-side prompt anyone could skip by calling the API
-- directly). Direct DELETE on branches/items is removed; the only way
-- to delete them is through the functions below.
--
-- The password check is rate-limited (5 wrong attempts per 15 minutes)
-- so a stolen session token can't be used to brute-force the Owner's
-- password through these functions. Failures are returned as
-- {"ok": false, "error": ...} instead of raised, because a raised
-- exception rolls back the very row that records the failed attempt.
--
-- reset_all_business_data() is now a TRUE reset: everything goes —
-- bills, products, stock, orders, branches, the activity log, and
-- every staff login EXCEPT the Owner who runs it (otherwise nobody
-- could sign back in to set the system up again). Role templates and
-- the permission list are system configuration, not business data,
-- and are kept.
-- =====================================================================

create table if not exists password_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  attempted_at timestamptz not null default now()
);
alter table password_attempts enable row level security;
-- (no policies on purpose: nobody reads or writes this directly,
-- only the SECURITY DEFINER functions below)

-- Returns NULL when the password is right, otherwise a message.
create or replace function bpos_check_password(p_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_recent int;
begin
  if auth.uid() is null then
    return 'Not signed in.';
  end if;
  select count(*) into v_recent from password_attempts
    where user_id = auth.uid() and attempted_at > now() - interval '15 minutes';
  if v_recent >= 5 then
    return 'Too many incorrect attempts. Try again in 15 minutes.';
  end if;
  select encrypted_password into v_hash from auth.users where id = auth.uid();
  if v_hash is null or p_password is null or crypt(p_password, v_hash) <> v_hash then
    insert into password_attempts (user_id) values (auth.uid());
    return 'Incorrect password.';
  end if;
  delete from password_attempts where user_id = auth.uid();
  return null;
end;
$$;
revoke all on function bpos_check_password(text) from public, anon, authenticated;

-- ---------------- delete a branch (Owner only) ----------------
create or replace function delete_branch(p_branch_id uuid, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  v_branch record;
begin
  if not is_owner() then
    return jsonb_build_object('ok', false, 'error', 'Only the Owner can delete a branch.');
  end if;
  v_err := bpos_check_password(p_password);
  if v_err is not null then
    return jsonb_build_object('ok', false, 'error', v_err);
  end if;
  select * into v_branch from branches where id = p_branch_id;
  if v_branch.id is null then
    return jsonb_build_object('ok', false, 'error', 'Branch not found.');
  end if;
  perform log_activity('branch.delete', null, 'branch', p_branch_id::text,
    jsonb_build_object('code', v_branch.code, 'name', v_branch.name));
  delete from branches where id = p_branch_id;  -- its bills/records stay, with the branch name kept (0022)
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function delete_branch(uuid, text) to authenticated;

-- ---------------- delete a product (inventory.edit) ----------------
create or replace function delete_item(p_item_id uuid, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  v_item record;
begin
  if not has_permission('inventory.edit') then
    return jsonb_build_object('ok', false, 'error', 'You don''t have permission to delete products.');
  end if;
  v_err := bpos_check_password(p_password);
  if v_err is not null then
    return jsonb_build_object('ok', false, 'error', v_err);
  end if;
  select * into v_item from items where id = p_item_id;
  if v_item.id is null then
    return jsonb_build_object('ok', false, 'error', 'Product not found.');
  end if;
  perform log_activity('product.delete', null, 'item', p_item_id::text,
    jsonb_build_object('name', v_item.name, 'sku', v_item.sku));
  delete from items where id = p_item_id;  -- past bills keep the product's name (invoice_items.item_name)
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function delete_item(uuid, text) to authenticated;

-- Direct deletes are gone: items' old catch-all write policy covered
-- DELETE too, so split it; branches' delete policy and the one added
-- in 0021 are dropped.
drop policy if exists "items: delete inventory.edit" on items;
drop policy if exists "items: write inventory.edit" on items;
create policy "items: insert inventory.edit" on items
  for insert with check (has_permission('inventory.edit'));
create policy "items: update inventory.edit" on items
  for update using (has_permission('inventory.edit')) with check (has_permission('inventory.edit'));
drop policy if exists "branches: delete (owner only)" on branches;

-- ---------------- full reset (Owner only) ----------------
drop function if exists reset_all_business_data(text);

create or replace function reset_all_business_data(p_confirmation_phrase text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_err text;
  v_staff_removed int;
  v_branches_removed int;
begin
  if not is_owner() then
    return jsonb_build_object('ok', false, 'error', 'Only the Owner can reset the system.');
  end if;
  if p_confirmation_phrase is distinct from 'DELETE ALL DATA' then
    return jsonb_build_object('ok', false, 'error', 'The confirmation phrase did not match. Nothing was deleted.');
  end if;
  v_err := bpos_check_password(p_password);
  if v_err is not null then
    return jsonb_build_object('ok', false, 'error', v_err);
  end if;

  delete from payments;
  delete from refund_items;
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
  delete from financial_adjustments;
  delete from items;
  delete from categories;
  delete from raw_materials;
  delete from activity_log;

  select count(*) into v_branches_removed from branches;
  delete from user_branches;
  delete from branches;  -- invoice counters cascade away with them

  select count(*) into v_staff_removed from profiles where id <> auth.uid();
  -- Removing the login rows also removes each profile + their branch
  -- links + permission overrides (all cascade from auth.users).
  delete from auth.users where id <> auth.uid();

  perform log_activity('system.data_reset', null, null, null,
    jsonb_build_object('branches_removed', v_branches_removed, 'staff_removed', v_staff_removed));

  return jsonb_build_object('ok', true, 'branches_removed', v_branches_removed, 'staff_removed', v_staff_removed);
end;
$$;
grant execute on function reset_all_business_data(text, text) to authenticated;
