-- =====================================================================
-- 0023_refund_return_exchange.sql
-- Three refund modes instead of one:
--   'simple'   — money-only refund, no items touched (original behavior)
--   'return'   — customer returns specific item(s); inventory is
--                restocked automatically; refund amount is computed
--                from what's actually being returned, not typed by hand
--   'exchange' — same as 'return', plus the customer takes different
--                item(s) instead; those are deducted from stock via a
--                small linked invoice, and the refund shows the net
--                amount owed either way (store credit back, or extra
--                due from the customer)
--
-- A refund is only marked as fully 'refunded' on the original invoice
-- if the returned/refunded amount covers the whole bill — a small
-- partial refund shouldn't make a mostly-valid bill look voided.
--
-- Also adds `financial_adjustments` — a transparent correction ledger
-- for the Dashboard (see 0024): mistakes get FIXED WITH A VISIBLE
-- ENTRY, never by silently editing a past total. That's what makes
-- "the owner can correct a mistake" safe instead of destroying the
-- audit trail the rest of this system is built around.
-- =====================================================================

alter table refunds
  add column if not exists refund_type text not null default 'simple'
    check (refund_type in ('simple', 'return', 'exchange')),
  add column if not exists exchange_invoice_id uuid references invoices(id) on delete set null,
  add column if not exists net_amount_due numeric(12,2) not null default 0;
comment on column refunds.net_amount_due is 'For exchanges: positive = customer owes this much more, negative = this much is owed back to the customer, zero = even swap.';

create table if not exists refund_items (
  id uuid primary key default gen_random_uuid(),
  refund_id uuid not null references refunds(id) on delete cascade,
  invoice_item_id uuid references invoice_items(id) on delete set null,
  item_id uuid references items(id) on delete set null,
  item_name text not null,
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price numeric(12,2) not null,
  line_total numeric(12,2) not null
);
alter table refund_items enable row level security;
create policy "refund_items: read via parent refund" on refund_items
  for select using (exists (
    select 1 from refunds r where r.id = refund_id
      and has_branch_access(r.branch_id) and (has_permission('bills.refund') or has_permission('reports.financial.view'))
  ));
-- A GRANT only opens the door to the table; RLS still needs an
-- explicit policy for each operation or it denies by default. The
-- INSERT policy mirrors the read policy's parent-row check: you can
-- only add lines to a refund at a branch you have access to, and
-- only with bills.refund.
create policy "refund_items: insert via parent refund" on refund_items
  for insert with check (exists (
    select 1 from refunds r where r.id = refund_id
      and has_branch_access(r.branch_id) and has_permission('bills.refund')
  ));
grant select, insert on refund_items to authenticated;
alter publication supabase_realtime add table refund_items;
alter publication supabase_realtime add table refunds;

create table if not exists financial_adjustments (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id) on delete cascade,
  amount numeric(12,2) not null,
  category text not null default 'other'
    check (category in ('cash_correction', 'inventory_writeoff', 'data_entry_fix', 'other')),
  reason text not null,
  created_by uuid references profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);
comment on table financial_adjustments is 'Visible correction entries for the Dashboard/P&L — a mistake is fixed by adding an adjustment row, never by editing a past bill''s numbers.';
alter table financial_adjustments enable row level security;
create policy "financial_adjustments: read" on financial_adjustments
  for select using (has_branch_access(branch_id) and (has_permission('reports.financial.view') or is_owner()));
create policy "financial_adjustments: write" on financial_adjustments
  for insert with check (has_branch_access(branch_id) and has_permission('reports.financial.view') and created_by = auth.uid());
-- A wrong entry can be removed — but only by the Owner, and the
-- removal itself goes in the activity log (see the Dashboard page), so
-- "fixing a mistake" never means silently making history disappear.
create policy "financial_adjustments: delete (owner only)" on financial_adjustments
  for delete using (is_owner());
grant select, insert, delete on financial_adjustments to authenticated;
alter publication supabase_realtime add table financial_adjustments;


-- Payment modes: add 'exchange_credit' (the replacement item in an
-- exchange is "paid" by the returned item's credit).
do $$
declare r record;
begin
  for r in select conname from pg_constraint
           where conrelid = 'payments'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%mode%'
  loop
    execute format('alter table payments drop constraint %I', r.conname);
  end loop;
end $$;
alter table payments add constraint payments_mode_check
  check (mode in ('cash', 'card', 'mobile_wallet', 'bank_transfer', 'other', 'exchange_credit'));

-- Adjustment categories: real profit needs expenses (rent, salaries,
-- utilities) and other income recorded somewhere — the POS itself
-- only knows about sales.
alter table financial_adjustments drop constraint if exists financial_adjustments_category_check;
alter table financial_adjustments add constraint financial_adjustments_category_check
  check (category in ('expense', 'other_income', 'cash_correction', 'inventory_writeoff', 'data_entry_fix', 'other'));

create or replace function bpos_fill_adjustment_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is not null and new.created_by_name is null then
    select full_name into new.created_by_name from profiles where id = new.created_by;
  end if;
  return new;
end $$;
create trigger trg_financial_adjustments_name before insert on financial_adjustments
  for each row execute function bpos_fill_adjustment_name();


-- stock_movements.reason has a CHECK listing every allowed cause; a
-- returned item coming back onto the shelf needs its own entry
-- ('sale_return') or the ledger insert below is rejected outright.
alter table stock_movements drop constraint if exists stock_movements_reason_check;
alter table stock_movements add constraint stock_movements_reason_check
  check (reason in ('restock', 'sale', 'sale_return', 'wastage', 'production_consumption', 'correction', 'transfer'));

-- Restocking a returned item is a side effect of a REFUND, not a manual
-- inventory edit — a cashier trusted with bills.refund shouldn't need
-- inventory.edit too just for the shelf count to go back up. Same
-- reasoning (and same SECURITY DEFINER pattern) as
-- deduct_stock_for_completed_invoice() for ordinary sales.
create or replace function restock_for_refund(
  p_branch_id uuid, p_item_id uuid, p_quantity numeric, p_refund_id uuid, p_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into branch_item_stock (branch_id, item_id, quantity)
    values (p_branch_id, p_item_id, p_quantity)
    on conflict (branch_id, item_id)
    do update set quantity = branch_item_stock.quantity + excluded.quantity, updated_at = now();
  insert into stock_movements (branch_id, item_id, quantity_delta, reason, reference_id, created_by)
    values (p_branch_id, p_item_id, p_quantity, 'sale_return', p_refund_id::text, p_user_id);
end;
$$;
revoke execute on function restock_for_refund(uuid, uuid, numeric, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- process_refund(): the one entry point for all three refund types.
-- SECURITY INVOKER (default) — runs with the caller's own RLS and
-- permissions, same reasoning as sync_invoice().
-- ---------------------------------------------------------------------
-- SECURITY DEFINER with its own explicit permission / branch / status
-- checks at the top (bills.refund, bills.create for exchanges, branch
-- access, bill must be completed). The first version ran as the
-- caller and quietly lost writes: refunds has no UPDATE policy, and
-- invoices' update policy needs bills.create, so recording the
-- exchange details and marking a bill refunded silently did nothing
-- (RLS filters those rows out without any error) for exactly the
-- people this feature is for. Doing the writes as the function owner,
-- after the checks, removes that whole class of silent failure.
create or replace function process_refund(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice record;
  v_refund_type text := coalesce(payload->>'refund_type', 'simple');
  v_reason text := payload->>'reason';
  v_refund_id uuid;
  v_return_total numeric(12,2) := 0;
  v_new_total numeric(12,2) := 0;
  v_prior_refunded numeric(12,2) := 0;
  v_multiplier numeric := 1;
  v_exchange_invoice_id uuid;
  v_exchange_invoice_number text;
  v_net numeric(12,2) := 0;
  it jsonb;
  v_line_id uuid;
  v_item_id uuid;
  v_item_name text;
  v_unit_price numeric(12,2);
  v_line_qty numeric;
  v_already_returned numeric;
  v_line_total numeric(12,2);
begin
  if not has_permission('bills.refund') then
    raise exception 'Missing permission: bills.refund';
  end if;
  -- An exchange creates a NEW sale (the replacement item going out),
  -- so it needs billing rights too, not just refund rights — checked
  -- up front for a clear message instead of a confusing row-level
  -- security error partway through.
  if v_refund_type = 'exchange' and not has_permission('bills.create') then
    raise exception 'Missing permission: bills.create (needed to hand over the replacement item in an exchange).';
  end if;

  select * into v_invoice from invoices where id = (payload->>'invoice_id')::uuid;
  if v_invoice.id is null then
    raise exception 'Invoice not found.';
  end if;
  if not has_branch_access(v_invoice.branch_id) then
    raise exception 'No access to this branch.';
  end if;
  if v_invoice.status <> 'completed' then
    raise exception 'Only completed bills can be refunded (this one is %).', v_invoice.status;
  end if;

  select coalesce(sum(amount), 0) into v_prior_refunded from refunds where invoice_id = v_invoice.id;

  -- Refund each returned line in proportion to what the customer
  -- ACTUALLY paid for it: a bill with tax added and/or a discount
  -- taken off has total != subtotal, so a bare unit_price x qty would
  -- short-change (tax) or over-refund (discount) the customer.
  if v_invoice.subtotal > 0 then
    v_multiplier := v_invoice.total_amount / v_invoice.subtotal;
  end if;

  if v_refund_type = 'simple' then
    v_return_total := coalesce((payload->>'amount')::numeric, 0);
    if v_return_total <= 0 then
      raise exception 'Refund amount must be greater than 0.';
    end if;
  else
    -- Phase 1: read-only — total computed from the real invoice lines.
    for it in select * from jsonb_array_elements(coalesce(payload->'return_items', '[]'::jsonb)) loop
      v_line_id := nullif(it->>'invoice_item_id', '')::uuid;
      v_line_qty := (it->>'quantity')::numeric;
      select ii.unit_price into v_unit_price from invoice_items ii where ii.id = v_line_id and ii.invoice_id = v_invoice.id;
      if v_unit_price is null then
        raise exception 'Returned line item not found on this invoice.';
      end if;
      if v_line_qty is null or v_line_qty <= 0 then
        raise exception 'Return quantity must be greater than 0.';
      end if;
      select coalesce(sum(quantity), 0) into v_already_returned from refund_items where invoice_item_id = v_line_id;
      if v_already_returned + v_line_qty > (select quantity from invoice_items where id = v_line_id) then
        raise exception 'Cannot return more than was purchased (% already returned).', v_already_returned;
      end if;
      v_return_total := v_return_total + round(v_unit_price * v_line_qty * v_multiplier, 2);
    end loop;
    if v_return_total <= 0 then
      raise exception 'Select at least one item to return.';
    end if;
  end if;

  if v_prior_refunded + v_return_total > v_invoice.total_amount + 0.01 then
    raise exception 'This would refund more than the bill total (already refunded: %).', v_prior_refunded;
  end if;

  insert into refunds (invoice_id, branch_id, amount, reason, processed_by, refund_type)
  values (v_invoice.id, v_invoice.branch_id, v_return_total, v_reason, auth.uid(), v_refund_type)
  returning id into v_refund_id;

  if v_refund_type in ('return', 'exchange') then
    -- Phase 2: record each returned line and put it back on the shelf.
    for it in select * from jsonb_array_elements(coalesce(payload->'return_items', '[]'::jsonb)) loop
      v_line_id := nullif(it->>'invoice_item_id', '')::uuid;
      v_line_qty := (it->>'quantity')::numeric;
      select ii.item_id, ii.item_name, ii.unit_price into v_item_id, v_item_name, v_unit_price
        from invoice_items ii where ii.id = v_line_id and ii.invoice_id = v_invoice.id;

      v_line_total := round(v_unit_price * v_line_qty * v_multiplier, 2);

      insert into refund_items (refund_id, invoice_item_id, item_id, item_name, quantity, unit_price, line_total)
        values (v_refund_id, v_line_id, v_item_id, v_item_name, v_line_qty, v_unit_price, v_line_total);

      -- skipped only if the original product has since been deleted
      if v_item_id is not null then
        perform restock_for_refund(v_invoice.branch_id, v_item_id, v_line_qty, v_refund_id, auth.uid());
      end if;
    end loop;
  end if;

  if v_refund_type = 'exchange' then
    insert into invoices (branch_id, client_ref, status, subtotal, total_amount, created_by)
      values (v_invoice.branch_id, gen_random_uuid(), 'completed', 0, 0, auth.uid())
      returning id, invoice_number into v_exchange_invoice_id, v_exchange_invoice_number;

    for it in select * from jsonb_array_elements(coalesce(payload->'new_items', '[]'::jsonb)) loop
      v_unit_price := (it->>'unit_price')::numeric;
      v_line_total := round(v_unit_price * (it->>'quantity')::numeric, 2);
      v_new_total := v_new_total + v_line_total;
      insert into invoice_items (invoice_id, item_id, item_name, quantity, unit_price, line_total)
        values (v_exchange_invoice_id, nullif(it->>'item_id', '')::uuid, it->>'item_name', (it->>'quantity')::numeric, v_unit_price, v_line_total);
    end loop;
    if v_new_total <= 0 then
      raise exception 'Select at least one replacement item for an exchange.';
    end if;

    update invoices set subtotal = v_new_total, total_amount = v_new_total, completed_at = now() where id = v_exchange_invoice_id;
    -- The replacement is "paid for" by the credit from the returned
    -- item(s) — recorded as its own payment mode so the ledger shows
    -- both legs (refund out, replacement sale in) and the cash drawer
    -- estimate can reduce them to the net difference actually handed
    -- over (see dashboard_summary).
    insert into payments (invoice_id, mode, amount) values (v_exchange_invoice_id, 'exchange_credit', v_new_total);
    perform deduct_stock_for_completed_invoice(v_exchange_invoice_id, v_invoice.branch_id, auth.uid());

    v_net := v_new_total - v_return_total;
    update refunds set exchange_invoice_id = v_exchange_invoice_id, net_amount_due = v_net where id = v_refund_id;
  end if;

  if v_prior_refunded + v_return_total >= v_invoice.total_amount - 0.01 then
    update invoices set status = 'refunded' where id = v_invoice.id;
  end if;

  perform log_activity('bill.refund', v_invoice.branch_id, 'invoice', v_invoice.id::text,
    jsonb_build_object('refund_type', v_refund_type, 'amount', v_return_total, 'reason', v_reason, 'net_amount_due', v_net));

  return jsonb_build_object(
    'refund_id', v_refund_id, 'amount', v_return_total,
    'exchange_invoice_id', v_exchange_invoice_id, 'exchange_invoice_number', v_exchange_invoice_number,
    'net_amount_due', v_net
  );
end;
$$;

grant execute on function process_refund(jsonb) to authenticated;
