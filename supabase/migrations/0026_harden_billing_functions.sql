-- =====================================================================
-- 0026_harden_billing_functions.sql
-- Two real problems found while testing the refund/exchange work:
--
-- 1. The stock helpers (deduct_stock_for_completed_invoice, and the
--    new restock_for_refund) are SECURITY DEFINER and, like every
--    Postgres function, were executable by anyone by default — which
--    on Supabase means callable straight from the browser API with
--    arbitrary ids, letting any logged-in user inflate or drain stock
--    without a bill. They're internal plumbing: execute is revoked,
--    and only the (permission-checked) billing/refund functions call
--    them.
--
-- 2. sync_invoice() therefore now runs as SECURITY DEFINER too (it
--    must be able to call the locked-down helper), so the checks RLS
--    used to do implicitly are written out explicitly: bills.create,
--    access to the branch, signed in. And a bill that is already
--    completed/refunded/void is now FINAL — re-sending it (an offline
--    retry) returns the existing invoice untouched instead of
--    rewriting its lines and totals, which used to let anyone with
--    bills.create quietly alter a finished sale after the fact.
--    (Held bills stay fully editable — resume/complete is unchanged.)
-- =====================================================================

revoke execute on function deduct_stock_for_completed_invoice(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function sync_invoice(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid;
  v_invoice_number text;
  v_existing_status text;
  v_branch_id uuid := (payload->>'branch_id')::uuid;
  v_client_ref uuid := (payload->>'client_ref')::uuid;
  v_status text := coalesce(payload->>'status', 'completed');
  v_was_already_completed boolean;
  item jsonb;
  pmt jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if not has_permission('bills.create') then
    raise exception 'Missing permission: bills.create';
  end if;
  if v_branch_id is null or not has_branch_access(v_branch_id) then
    raise exception 'No access to this branch.';
  end if;
  if v_status not in ('held', 'completed') then
    raise exception 'Invalid bill status.';
  end if;

  select id, status into v_invoice_id, v_existing_status
    from invoices where branch_id = v_branch_id and client_ref = v_client_ref;
  v_was_already_completed := (v_existing_status = 'completed');

  -- Finished bills are final: an offline retry of the same bill is
  -- answered with the invoice that already exists, nothing rewritten.
  if v_existing_status in ('completed', 'refunded', 'void') then
    select invoice_number into v_invoice_number from invoices where id = v_invoice_id;
    return jsonb_build_object('id', v_invoice_id, 'invoice_number', v_invoice_number);
  end if;

  -- Explicit exists-check + branch rather than INSERT .. ON CONFLICT:
  -- BEFORE INSERT triggers fire for a proposed row even when it ends
  -- up taking the DO UPDATE path, which would burn an invoice number
  -- on every retry (see 0007 for the full story).
  if v_invoice_id is null then
    begin
      insert into invoices (
        branch_id, client_ref, status, customer_name, customer_phone,
        subtotal, discount_amount, discount_reason, tax_amount, total_amount,
        created_by, device_created_at
      ) values (
        v_branch_id, v_client_ref, v_status,
        payload->>'customer_name', payload->>'customer_phone',
        coalesce((payload->>'subtotal')::numeric, 0),
        coalesce((payload->>'discount_amount')::numeric, 0),
        payload->>'discount_reason',
        coalesce((payload->>'tax_amount')::numeric, 0),
        coalesce((payload->>'total_amount')::numeric, 0),
        auth.uid(),
        (payload->>'device_created_at')::timestamptz
      )
      returning id, invoice_number into v_invoice_id, v_invoice_number;
    exception when unique_violation then
      select id, invoice_number into v_invoice_id, v_invoice_number
        from invoices where branch_id = v_branch_id and client_ref = v_client_ref;
    end;
  else
    update invoices set
      status = v_status,
      customer_name = payload->>'customer_name',
      customer_phone = payload->>'customer_phone',
      subtotal = coalesce((payload->>'subtotal')::numeric, 0),
      discount_amount = coalesce((payload->>'discount_amount')::numeric, 0),
      discount_reason = payload->>'discount_reason',
      tax_amount = coalesce((payload->>'tax_amount')::numeric, 0),
      total_amount = coalesce((payload->>'total_amount')::numeric, 0),
      completed_at = case when v_status = 'completed' then coalesce(completed_at, now()) else completed_at end
    where id = v_invoice_id
    returning invoice_number into v_invoice_number;
  end if;

  delete from invoice_items where invoice_id = v_invoice_id;
  for item in select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb)) loop
    insert into invoice_items (invoice_id, item_id, item_name, quantity, unit_price, line_total)
    values (
      v_invoice_id,
      nullif(item->>'item_id', '')::uuid,
      item->>'item_name',
      (item->>'quantity')::numeric,
      (item->>'unit_price')::numeric,
      (item->>'line_total')::numeric
    );
  end loop;

  delete from payments where invoice_id = v_invoice_id;
  for pmt in select * from jsonb_array_elements(coalesce(payload->'payments', '[]'::jsonb)) loop
    insert into payments (invoice_id, mode, amount)
    values (v_invoice_id, pmt->>'mode', (pmt->>'amount')::numeric);
  end loop;

  select invoice_number into v_invoice_number from invoices where id = v_invoice_id;

  if v_status = 'completed' and not coalesce(v_was_already_completed, false) then
    perform deduct_stock_for_completed_invoice(v_invoice_id, v_branch_id, auth.uid());
  end if;

  perform log_activity(
    case when v_status = 'completed' then 'bill.complete' else 'bill.hold' end,
    v_branch_id, 'invoice', v_invoice_id::text,
    jsonb_build_object('invoice_number', v_invoice_number, 'total_amount', payload->>'total_amount')
  );

  return jsonb_build_object('id', v_invoice_id, 'invoice_number', v_invoice_number);
end;
$$;

grant execute on function sync_invoice(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Cashiers must be able to SEE stock at their own branch.
-- The Billing screen reads branch_item_stock to show "5 in stock" and
-- to block items that are sold out — but that table's only read policy
-- required inventory.view, which the Cashier template does not have.
-- Result: for a plain cashier the stock query came back empty, every
-- product looked like zero stock, and nothing could be added to a
-- bill. Billing needs to read stock; it doesn't need to EDIT it, so
-- this adds read-only access for anyone who can bill at that branch.
-- (RLS policies are OR'd together, so this just widens who can read.)
-- ---------------------------------------------------------------------
create policy "branch_item_stock: read for billing" on branch_item_stock
  for select using (has_branch_access(branch_id) and has_permission('bills.create'));
