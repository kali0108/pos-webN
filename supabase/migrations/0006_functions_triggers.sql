-- =====================================================================
-- 0006_functions_triggers.sql
-- Business logic that must run in the database, not the browser:
-- new-staff provisioning, conflict-free invoice numbering (the "same
-- invoice number at two branches at once" scenario from the brief),
-- discount/refund permission enforcement, automatic stock deduction,
-- and the append-only activity log.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. NEW USER -> PROFILE
-- Staff accounts are created by the Owner through an Edge Function
-- (see supabase/functions/create-staff-user) that calls the Supabase
-- Admin API. That API call creates the auth.users row; this trigger
-- mirrors it into `profiles` automatically, pulling full_name out of
-- the metadata the Edge Function attaches.
-- ---------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, full_name, email, role_template_id, is_owner)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    nullif(new.raw_user_meta_data->>'role_template_id', '')::uuid,
    coalesce((new.raw_user_meta_data->>'is_owner')::boolean, false)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------
-- 2. CONFLICT-FREE INVOICE NUMBERING
-- One counter row per branch. The UPDATE below takes a row lock, so
-- two bills hitting the same branch at the same instant are simply
-- serialized by Postgres — the second one waits a few milliseconds
-- for the first, then gets the next number. Two *different* branches
-- never contend at all, since each has its own counter row and its
-- own prefix. The invoice number is only ever produced here, never by
-- the browser, which is what makes this safe under the offline queue.
-- ---------------------------------------------------------------------
create table branch_invoice_counters (
  branch_id    uuid primary key references branches(id) on delete cascade,
  next_number  bigint not null default 1
);

create or replace function provision_branch_counter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- SECURITY DEFINER is required here: branch_invoice_counters is
  -- deliberately not Data-API-granted to `authenticated` (see
  -- 0009_data_api_grants.sql) since no client ever needs to touch it
  -- directly. Without SECURITY DEFINER, a branches.manage-permitted
  -- staff member (not the Postgres superuser) adding a new branch
  -- from the Admin Panel would fail right here, because the trigger
  -- would otherwise run with their own, intentionally narrower,
  -- grants.
  insert into branch_invoice_counters (branch_id) values (new.id);
  return new;
end;
$$;

create trigger on_branch_created_provision_counter
  after insert on branches
  for each row execute function provision_branch_counter();

create or replace function assign_invoice_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next bigint;
  v_code text;
begin
  if new.invoice_number is not null then
    return new; -- already assigned (e.g. re-sync retry hitting the unique constraint upsert path)
  end if;

  select code into v_code from branches where id = new.branch_id;

  update branch_invoice_counters
     set next_number = next_number + 1
   where branch_id = new.branch_id
   returning next_number - 1 into v_next;

  if v_next is null then
    -- Counter row missing (shouldn't happen once trigger #1 is in place) — self-heal.
    insert into branch_invoice_counters (branch_id, next_number) values (new.branch_id, 2)
      on conflict (branch_id) do nothing;
    v_next := 1;
  end if;

  new.invoice_number := v_code || '-' || lpad(v_next::text, 6, '0');
  return new;
end;
$$;

create trigger on_invoice_insert_assign_number
  before insert on invoices
  for each row execute function assign_invoice_number();

-- ---------------------------------------------------------------------
-- 3. DISCOUNT / DISCOUNT-EDIT ENFORCEMENT
-- RLS already gates "can this user touch invoices at all". This
-- trigger adds the finer-grained rule: touching the discount fields
-- requires the separate 'bills.discount' permission, exactly as
-- listed in the matrix, even though discounts live on the same row
-- as ordinary billing fields.
-- ---------------------------------------------------------------------
create or replace function enforce_billing_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.discount_amount > 0
     and (tg_op = 'INSERT' or new.discount_amount is distinct from old.discount_amount)
     and not has_permission('bills.discount') then
    raise exception 'Missing permission: bills.discount';
  end if;
  return new;
end;
$$;

create trigger on_invoice_write_enforce_permissions
  before insert or update on invoices
  for each row execute function enforce_billing_permissions();

-- ---------------------------------------------------------------------
-- 4. AUTO STOCK DEDUCTION ON SALE
--
-- Deliberately NOT a trigger on `invoices`. sync_invoice() (see
-- 0007_sync_invoice_rpc.sql) writes the invoice header first and its
-- line items a few statements later, in the same transaction — an
-- AFTER INSERT/UPDATE trigger on `invoices` would fire before those
-- line items exist yet and silently deduct nothing. Instead,
-- sync_invoice() calls this function explicitly once the line items
-- are in place, exactly once per bill's first completion (it tracks
-- that via invoices.completed_at — see the idempotency note there).
-- ---------------------------------------------------------------------
create or replace function deduct_stock_for_completed_invoice(
  p_invoice_id uuid, p_branch_id uuid, p_created_by uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  li record;
begin
  for li in select item_id, quantity from invoice_items where invoice_id = p_invoice_id and item_id is not null loop
    insert into branch_item_stock (branch_id, item_id, quantity)
      values (p_branch_id, li.item_id, -li.quantity)
      on conflict (branch_id, item_id)
      do update set quantity = branch_item_stock.quantity - li.quantity, updated_at = now();

    insert into stock_movements (branch_id, item_id, quantity_delta, reason, reference_id, created_by)
      values (p_branch_id, li.item_id, -li.quantity, 'sale', p_invoice_id::text, p_created_by);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. AUTO RAW-MATERIAL DEDUCTION ON PRODUCTION
-- Raw materials are consumed for everything actually baked, including
-- wastage (the flour was used even if the loaf was thrown out). Only
-- the good output (actual_quantity) is added to finished-goods stock.
-- ---------------------------------------------------------------------
create or replace function apply_production_actual()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_total_units numeric(12,3);
begin
  v_total_units := new.actual_quantity + new.wastage_quantity;

  for rec in select raw_material_id, quantity_required from item_recipes where item_id = new.item_id loop
    insert into branch_raw_material_stock (branch_id, raw_material_id, quantity)
      values (new.branch_id, rec.raw_material_id, -(rec.quantity_required * v_total_units))
      on conflict (branch_id, raw_material_id)
      do update set quantity = branch_raw_material_stock.quantity - (rec.quantity_required * v_total_units),
                    updated_at = now();

    insert into stock_movements (branch_id, raw_material_id, quantity_delta, reason, reference_id, created_by)
      values (new.branch_id, rec.raw_material_id, -(rec.quantity_required * v_total_units),
              'production_consumption', new.id::text, new.recorded_by);
  end loop;

  if new.actual_quantity > 0 then
    insert into branch_item_stock (branch_id, item_id, quantity)
      values (new.branch_id, new.item_id, new.actual_quantity)
      on conflict (branch_id, item_id)
      do update set quantity = branch_item_stock.quantity + new.actual_quantity, updated_at = now();

    insert into stock_movements (branch_id, item_id, quantity_delta, reason, reference_id, created_by)
      values (new.branch_id, new.item_id, new.actual_quantity, 'production_consumption', new.id::text, new.recorded_by);
  end if;

  return new;
end;
$$;

create trigger on_production_actual_insert_deduct_stock
  after insert on production_actuals
  for each row execute function apply_production_actual();

-- ---------------------------------------------------------------------
-- 6. ACTIVITY LOG RPC
-- The only sanctioned way to write to activity_log. user_id is always
-- taken from the session (auth.uid()), never from client input, so a
-- log entry can't be forged as someone else.
-- ---------------------------------------------------------------------
create or replace function log_activity(
  p_action text,
  p_branch_id uuid default null,
  p_entity_type text default null,
  p_entity_id text default null,
  p_details jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into activity_log (user_id, branch_id, action, entity_type, entity_id, details)
  values (auth.uid(), p_branch_id, p_action, p_entity_type, p_entity_id, p_details);
end;
$$;

grant execute on function log_activity(text, uuid, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 7. updated_at housekeeping
-- ---------------------------------------------------------------------
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_branches_updated_at before update on branches
  for each row execute function touch_updated_at();
create trigger trg_items_updated_at before update on items
  for each row execute function touch_updated_at();
create trigger trg_profiles_updated_at before update on profiles
  for each row execute function touch_updated_at();
create trigger trg_custom_orders_updated_at before update on custom_orders
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------
-- 8. LOW-STOCK VIEW ("low-stock alerts", branch-wise and consolidated)
-- security_invoker means the view runs with the *caller's* RLS, not
-- the view owner's — a cashier querying this still only sees the
-- branches/items their own permissions allow.
-- ---------------------------------------------------------------------
create view v_low_stock
  with (security_invoker = true)
as
  select b.id as branch_id, b.name as branch_name, 'item' as stock_type,
         i.id as stock_item_id, i.name as stock_item_name,
         s.quantity, s.reorder_level
    from branch_item_stock s
    join branches b on b.id = s.branch_id
    join items i on i.id = s.item_id
   where s.quantity <= s.reorder_level
  union all
  select b.id, b.name, 'raw_material',
         rm.id, rm.name,
         s.quantity, s.reorder_level
    from branch_raw_material_stock s
    join branches b on b.id = s.branch_id
    join raw_materials rm on rm.id = s.raw_material_id
   where s.quantity <= s.reorder_level;
