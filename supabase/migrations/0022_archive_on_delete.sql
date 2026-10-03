-- =====================================================================
-- 0022_archive_on_delete.sql
-- Deleting a branch, product, or staff member now ALWAYS works — and
-- every historical record that pointed at it (bills, refunds, custom
-- orders, production and stock records) is kept, disconnected from
-- the deleted thing but still carrying its NAME, so history and
-- tracking survive. This deliberately replaces the earlier
-- "RESTRICT: can't delete anything with history" design (0020),
-- per the Owner's requirement: delete means delete, records stay.
--
-- How: (1) each historical table gets *_name snapshot columns, filled
-- automatically by BEFORE INSERT triggers (no app code path can
-- forget) and backfilled once for existing rows below; (2) every
-- foreign key pointing at branches/items/profiles becomes
-- ON DELETE SET NULL, so the row survives with its snapshot text.
-- =====================================================================

-- ---------- 1. snapshot columns ----------
alter table invoices
  add column if not exists branch_code text,
  add column if not exists branch_name text,
  add column if not exists branch_address text,
  add column if not exists branch_phone text,
  add column if not exists currency_symbol text,
  add column if not exists tax_label text,
  add column if not exists created_by_name text;
alter table refunds
  add column if not exists branch_name text,
  add column if not exists processed_by_name text;
alter table custom_orders
  add column if not exists branch_name text,
  add column if not exists created_by_name text;
alter table production_plans
  add column if not exists branch_name text,
  add column if not exists item_name text;
alter table production_actuals
  add column if not exists branch_name text,
  add column if not exists item_name text,
  add column if not exists recorded_by_name text;
alter table stock_movements
  add column if not exists branch_name text,
  add column if not exists item_name text,
  add column if not exists created_by_name text;
alter table invoice_items
  add column if not exists cost_price numeric(12,2) not null default 0;
alter table activity_log
  add column if not exists user_name text,
  add column if not exists branch_name text;

-- ---------- 2. FKs -> ON DELETE SET NULL ----------
create or replace function _bpos_relax_fk(p_table text, p_column text, p_ref_table text)
returns void language plpgsql as $$
declare v_con text;
begin
  select c.conname into v_con
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
  where c.contype = 'f' and c.conrelid = p_table::regclass and a.attname = p_column;
  if v_con is not null then
    execute format('alter table %I drop constraint %I', p_table, v_con);
  end if;
  execute format('alter table %I alter column %I drop not null', p_table, p_column);
  execute format('alter table %I add constraint %I foreign key (%I) references %I(id) on delete set null',
                 p_table, p_table || '_' || p_column || '_fkey', p_column, p_ref_table);
end $$;

select _bpos_relax_fk('invoices', 'branch_id', 'branches');
select _bpos_relax_fk('invoices', 'created_by', 'profiles');
select _bpos_relax_fk('invoice_items', 'item_id', 'items');
select _bpos_relax_fk('refunds', 'branch_id', 'branches');
select _bpos_relax_fk('refunds', 'processed_by', 'profiles');
select _bpos_relax_fk('custom_orders', 'branch_id', 'branches');
select _bpos_relax_fk('custom_orders', 'created_by', 'profiles');
select _bpos_relax_fk('custom_order_status_history', 'changed_by', 'profiles');
select _bpos_relax_fk('production_plans', 'branch_id', 'branches');
select _bpos_relax_fk('production_plans', 'item_id', 'items');
select _bpos_relax_fk('production_plans', 'created_by', 'profiles');
select _bpos_relax_fk('production_actuals', 'branch_id', 'branches');
select _bpos_relax_fk('production_actuals', 'item_id', 'items');
select _bpos_relax_fk('production_actuals', 'recorded_by', 'profiles');
select _bpos_relax_fk('stock_movements', 'branch_id', 'branches');
select _bpos_relax_fk('stock_movements', 'item_id', 'items');
select _bpos_relax_fk('stock_movements', 'raw_material_id', 'raw_materials');
select _bpos_relax_fk('stock_movements', 'created_by', 'profiles');
select _bpos_relax_fk('discount_rules', 'created_by', 'profiles');

drop function _bpos_relax_fk(text, text, text);

-- stock_movements required exactly one of item_id / raw_material_id;
-- once an item is deleted its movements legitimately have neither.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'stock_movements'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%num_nonnulls%'
  loop
    execute format('alter table stock_movements drop constraint %I', r.conname);
  end loop;
end $$;
alter table stock_movements add constraint stock_movements_one_target_check
  check (num_nonnulls(item_id, raw_material_id) <= 1);

-- ---------- 3. auto-fill snapshots on insert ----------
create or replace function bpos_fill_invoice_snapshots() returns trigger
language plpgsql security definer set search_path = public as $$
declare b record;
begin
  if new.branch_id is not null and new.branch_name is null then
    select code, name, address, phone, currency_symbol, tax_label into b from branches where id = new.branch_id;
    new.branch_code := b.code; new.branch_name := b.name; new.branch_address := b.address;
    new.branch_phone := b.phone; new.currency_symbol := b.currency_symbol; new.tax_label := b.tax_label;
  end if;
  if new.created_by is not null and new.created_by_name is null then
    select full_name into new.created_by_name from profiles where id = new.created_by;
  end if;
  return new;
end $$;
create trigger trg_invoices_snapshots before insert on invoices
  for each row execute function bpos_fill_invoice_snapshots();

create or replace function bpos_fill_invoice_item_cost() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.item_id is not null and coalesce(new.cost_price, 0) = 0 then
    select coalesce(cost_price, 0) into new.cost_price from items where id = new.item_id;
  end if;
  return new;
end $$;
create trigger trg_invoice_items_cost before insert on invoice_items
  for each row execute function bpos_fill_invoice_item_cost();

create or replace function bpos_fill_branch_user_snapshots() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_user_col text := tg_argv[0]; v_row jsonb := to_jsonb(new);
begin
  if (v_row->>'branch_id') is not null and (v_row->>'branch_name') is null then
    new := jsonb_populate_record(new, jsonb_build_object('branch_name', (select name from branches where id = (v_row->>'branch_id')::uuid)));
  end if;
  if v_user_col is not null and (v_row->>v_user_col) is not null then
    new := jsonb_populate_record(new, jsonb_build_object(v_user_col || '_name', (select full_name from profiles where id = (v_row->>v_user_col)::uuid)));
  end if;
  if (v_row->>'item_id') is not null and (v_row ? 'item_name') and (v_row->>'item_name') is null then
    new := jsonb_populate_record(new, jsonb_build_object('item_name', (select name from items where id = (v_row->>'item_id')::uuid)));
  end if;
  return new;
end $$;

create trigger trg_refunds_snapshots before insert on refunds
  for each row execute function bpos_fill_branch_user_snapshots('processed_by');
create trigger trg_custom_orders_snapshots before insert on custom_orders
  for each row execute function bpos_fill_branch_user_snapshots('created_by');
create trigger trg_production_plans_snapshots before insert on production_plans
  for each row execute function bpos_fill_branch_user_snapshots('created_by');
create trigger trg_production_actuals_snapshots before insert on production_actuals
  for each row execute function bpos_fill_branch_user_snapshots('recorded_by');
create trigger trg_stock_movements_snapshots before insert on stock_movements
  for each row execute function bpos_fill_branch_user_snapshots('created_by');


-- The activity log keeps WHO and WHERE as plain text too, so a log
-- entry still reads "Ayesha created branch Lahore" after Ayesha's
-- account or the Lahore branch has been deleted.
create or replace function bpos_fill_activity_snapshots() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null and new.user_name is null then
    select full_name into new.user_name from profiles where id = new.user_id;
  end if;
  if new.branch_id is not null and new.branch_name is null then
    select name into new.branch_name from branches where id = new.branch_id;
  end if;
  return new;
end $$;
create trigger trg_activity_log_snapshots before insert on activity_log
  for each row execute function bpos_fill_activity_snapshots();

-- ---------- 4. one-time backfill for rows that already exist ----------
update invoices i set branch_code=b.code, branch_name=b.name, branch_address=b.address, branch_phone=b.phone,
  currency_symbol=b.currency_symbol, tax_label=b.tax_label
  from branches b where b.id = i.branch_id and i.branch_name is null;
update invoices i set created_by_name = p.full_name from profiles p where p.id = i.created_by and i.created_by_name is null;
update invoice_items ii set cost_price = coalesce(it.cost_price, 0) from items it where it.id = ii.item_id and ii.cost_price = 0;
update refunds r set branch_name = b.name from branches b where b.id = r.branch_id and r.branch_name is null;
update refunds r set processed_by_name = p.full_name from profiles p where p.id = r.processed_by and r.processed_by_name is null;
update custom_orders c set branch_name = b.name from branches b where b.id = c.branch_id and c.branch_name is null;
update custom_orders c set created_by_name = p.full_name from profiles p where p.id = c.created_by and c.created_by_name is null;
update production_plans x set branch_name = b.name from branches b where b.id = x.branch_id and x.branch_name is null;
update production_plans x set item_name = i.name from items i where i.id = x.item_id and x.item_name is null;
update production_actuals x set branch_name = b.name from branches b where b.id = x.branch_id and x.branch_name is null;
update production_actuals x set item_name = i.name from items i where i.id = x.item_id and x.item_name is null;
update production_actuals x set recorded_by_name = p.full_name from profiles p where p.id = x.recorded_by and x.recorded_by_name is null;
update stock_movements x set branch_name = b.name from branches b where b.id = x.branch_id and x.branch_name is null;
update stock_movements x set item_name = i.name from items i where i.id = x.item_id and x.item_name is null;
update stock_movements x set created_by_name = p.full_name from profiles p where p.id = x.created_by and x.created_by_name is null;
update activity_log a set user_name = p.full_name from profiles p where p.id = a.user_id and a.user_name is null;
update activity_log a set branch_name = b.name from branches b where b.id = a.branch_id and a.branch_name is null;
