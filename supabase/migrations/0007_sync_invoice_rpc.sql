-- =====================================================================
-- 0007_sync_invoice_rpc.sql
-- sync_invoice(): the one RPC the offline queue calls to push a
-- locally-created bill to the server. It's SECURITY INVOKER
-- (the default) — deliberately NOT definer — so it runs with the
-- calling user's own permissions: RLS on invoices/invoice_items/
-- payments and the bills.discount trigger all still apply exactly as
-- if the browser had made three separate REST calls. The only
-- difference is that all three tables are written in one atomic
-- database transaction, so a dropped connection mid-sync can never
-- leave an invoice with missing line items — either the whole bill
-- lands, or none of it does, and the next retry (same client_ref)
-- picks up cleanly via the upsert.
-- =====================================================================

create or replace function sync_invoice(payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_invoice_id uuid;
  v_invoice_number text;
  v_branch_id uuid := (payload->>'branch_id')::uuid;
  v_client_ref uuid := (payload->>'client_ref')::uuid;
  v_was_already_completed boolean;
  item jsonb;
  pmt jsonb;
begin
  -- One lookup drives two decisions below: whether this is a fresh
  -- invoice (branch to INSERT vs UPDATE) and whether it was already
  -- 'completed' before this call (whether to deduct stock again).
  select id, (status = 'completed') into v_invoice_id, v_was_already_completed
    from invoices where branch_id = v_branch_id and client_ref = v_client_ref;

  -- Explicit exists-check + branch, rather than INSERT ... ON
  -- CONFLICT DO UPDATE: Postgres fires BEFORE INSERT triggers for a
  -- proposed row even when it turns out to conflict and take the DO
  -- UPDATE path — which would make assign_invoice_number() burn a
  -- number on every idempotent retry, leaving gaps in the sequence.
  -- Checking first and branching explicitly means the BEFORE INSERT
  -- trigger only ever fires on a genuinely new invoice.
  if v_invoice_id is null then
    begin
      insert into invoices (
        branch_id, client_ref, status, customer_name, customer_phone,
        subtotal, discount_amount, discount_reason, tax_amount, total_amount,
        created_by, device_created_at
      ) values (
        v_branch_id, v_client_ref, coalesce(payload->>'status', 'completed'),
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
      -- Extremely unlikely (would need two truly concurrent syncs of
      -- the exact same client_ref), but handled defensively: someone
      -- else just inserted it a moment ago, so fall through to it.
      select id, invoice_number into v_invoice_id, v_invoice_number
        from invoices where branch_id = v_branch_id and client_ref = v_client_ref;
    end;
  else
    update invoices set
      status = coalesce(payload->>'status', 'completed'),
      customer_name = payload->>'customer_name',
      customer_phone = payload->>'customer_phone',
      subtotal = coalesce((payload->>'subtotal')::numeric, 0),
      discount_amount = coalesce((payload->>'discount_amount')::numeric, 0),
      discount_reason = payload->>'discount_reason',
      tax_amount = coalesce((payload->>'tax_amount')::numeric, 0),
      total_amount = coalesce((payload->>'total_amount')::numeric, 0),
      -- Only stamp completed_at the FIRST time — keeps it stable
      -- across retries instead of drifting forward on every replay.
      completed_at = case when coalesce(payload->>'status','completed') = 'completed'
                          then coalesce(completed_at, now()) else completed_at end
    where id = v_invoice_id
    returning invoice_number into v_invoice_number;
  end if;

  delete from invoice_items where invoice_id = v_invoice_id;
  for item in select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb)) loop
    insert into invoice_items (invoice_id, item_id, item_name, quantity, unit_price, line_total)
    values (
      v_invoice_id,
      nullif(item->>'item_id','')::uuid,
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

  -- Re-read invoice_number: it may have just been assigned by
  -- assign_invoice_number() on first insert (it was null above).
  select invoice_number into v_invoice_number from invoices where id = v_invoice_id;

  -- Deduct stock exactly once: only when this call is what makes the
  -- bill 'completed' for the first time. A retry of an already-
  -- completed bill (v_was_already_completed = true) skips this, so a
  -- flaky-connection retry can never double-deduct. A bill resumed
  -- from 'held' and completed now (v_was_already_completed = false,
  -- since it existed but wasn't completed) deducts using the final
  -- item list, which is already in place by this point.
  if coalesce(payload->>'status', 'completed') = 'completed' and not coalesce(v_was_already_completed, false) then
    perform deduct_stock_for_completed_invoice(v_invoice_id, v_branch_id, auth.uid());
  end if;

  perform log_activity(
    case when payload->>'status' = 'completed' then 'bill.complete' else 'bill.hold' end,
    v_branch_id, 'invoice', v_invoice_id::text,
    jsonb_build_object('invoice_number', v_invoice_number, 'total_amount', payload->>'total_amount')
  );

  return jsonb_build_object('id', v_invoice_id, 'invoice_number', v_invoice_number);
end;
$$;

grant execute on function sync_invoice(jsonb) to authenticated;
