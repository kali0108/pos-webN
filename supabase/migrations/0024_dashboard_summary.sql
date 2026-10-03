-- =====================================================================
-- 0024_dashboard_summary.sql
-- One function that produces everything the Owner's Dashboard shows:
-- sales, refunds, tax, cost of goods, gross/net profit, cash position,
-- payment-mode breakdown, trend, top products, stock value.
--
-- SECURITY INVOKER on purpose — it reads through the caller's own RLS,
-- so a manager only ever sees branches they're assigned to, and the
-- Owner sees everything (including history from branches that have
-- since been deleted, since those bills are kept — see 0022).
-- p_tz is the viewer's own timezone (e.g. 'Asia/Karachi') so "today"
-- and each day's total start and end at THEIR midnight, not UTC's.
-- Requires reports.financial.view: profit and cash figures are
-- exactly what that permission exists to gate.
--
-- Accounting model (kept deliberately simple and explained, since the
-- POS only knows about sales — rent, salaries etc. enter through the
-- manual adjustment ledger, never by editing a past bill):
--   net sales      = completed-bill totals - refunds
--   net sales ex-tax = net sales - tax collected + tax refunded back
--   gross profit   = net sales ex-tax - cost of goods actually sold
--                    (returned items' cost is taken back out)
--   net profit     = gross profit + adjustments (expenses are negative)
--   cash estimate  = cash payments - refunds paid out (+/- exchange
--                    net difference) + cash corrections - expenses
-- =====================================================================

create or replace function dashboard_summary(p_from date, p_to date, p_branch_id uuid default null, p_tz text default 'UTC')
returns jsonb
language plpgsql
stable
as $$
declare
  v_bucket text := case when (p_to - p_from) > 92 then 'month' else 'day' end;
  v_result jsonb;
begin
  if not has_permission('reports.financial.view') then
    raise exception 'Missing permission: reports.financial.view';
  end if;
  if p_to < p_from then
    raise exception 'The end date is before the start date.';
  end if;

  with inv as (
    select * from invoices
    where status in ('completed', 'refunded')
      and (created_at at time zone p_tz)::date between p_from and p_to
      and (p_branch_id is null or branch_id = p_branch_id)
  ),
  refs as (
    select r.*, coalesce(i.tax_amount / nullif(i.total_amount, 0), 0) as tax_ratio
    from refunds r left join invoices i on i.id = r.invoice_id
    where (r.created_at at time zone p_tz)::date between p_from and p_to
      and (p_branch_id is null or r.branch_id = p_branch_id)
  ),
  lines as (
    select ii.* from invoice_items ii join inv on inv.id = ii.invoice_id
  ),
  returned_cogs as (
    select coalesce(sum(ri.quantity * coalesce(ii.cost_price, 0)), 0) as amt
    from refund_items ri
    join refs on refs.id = ri.refund_id
    left join invoice_items ii on ii.id = ri.invoice_item_id
  ),
  adj as (
    select * from financial_adjustments
    where (created_at at time zone p_tz)::date between p_from and p_to
      and (p_branch_id is null or branch_id = p_branch_id)
  ),
  pay_modes as (
    select p.mode, sum(p.amount) as amount
    from payments p join inv on inv.id = p.invoice_id
    group by p.mode
  ),
  trend_buckets as (
    select d::date as bucket_start
    from generate_series(date_trunc(v_bucket, p_from::timestamp), p_to::timestamp, ('1 ' || v_bucket)::interval) d
  ),
  trend as (
    select tb.bucket_start,
      coalesce((select sum(total_amount) from inv where date_trunc(v_bucket, inv.created_at at time zone p_tz)::date = tb.bucket_start), 0) as sales,
      coalesce((select sum(amount) from refs where date_trunc(v_bucket, refs.created_at at time zone p_tz)::date = tb.bucket_start), 0) as refunds,
      coalesce((select sum(amount) from adj where date_trunc(v_bucket, adj.created_at at time zone p_tz)::date = tb.bucket_start), 0) as adjustments
    from trend_buckets tb
  ),
  top_items as (
    select item_name, sum(quantity) as qty, sum(line_total) as revenue
    from lines group by item_name order by revenue desc limit 5
  ),
  totals as (
    select
      (select coalesce(sum(total_amount), 0) from inv) as gross_sales,
      (select coalesce(sum(tax_amount), 0) from inv) as tax_collected,
      (select coalesce(sum(discount_amount), 0) from inv) as discounts,
      (select count(*) from inv) as bill_count,
      (select coalesce(sum(amount), 0) from refs) as refunds_total,
      (select count(*) from refs) as refund_count,
      (select coalesce(sum(amount * tax_ratio), 0) from refs) as tax_refunded,
      (select coalesce(sum(quantity * cost_price), 0) from lines) as cogs_sold,
      (select amt from returned_cogs) as cogs_returned,
      (select coalesce(sum(amount), 0) from adj) as adjustments_total,
      (select coalesce(sum(amount), 0) from adj where category = 'cash_correction') as cash_corrections,
      (select coalesce(sum(amount), 0) from adj where category = 'expense') as expenses
  ),
  cash as (
    select
      (select coalesce(sum(amount), 0) from pay_modes where mode = 'cash') as cash_in,
      (select coalesce(sum(amount), 0) from refs where refund_type <> 'exchange') as cash_refunds,
      (select coalesce(sum(net_amount_due), 0) from refs where refund_type = 'exchange') as exchange_net
  ),
  stock as (
    select coalesce(sum(s.quantity * coalesce(i.cost_price, 0)), 0) as stock_value
    from branch_item_stock s join items i on i.id = s.item_id
    where p_branch_id is null or s.branch_id = p_branch_id
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'bucket', v_bucket),
    'gross_sales', t.gross_sales,
    'refunds_total', t.refunds_total,
    'net_sales', t.gross_sales - t.refunds_total,
    'tax_collected', t.tax_collected,
    'tax_refunded', round(t.tax_refunded, 2),
    'net_sales_ex_tax', (t.gross_sales - t.refunds_total) - (t.tax_collected - round(t.tax_refunded, 2)),
    'discounts_given', t.discounts,
    'cogs', t.cogs_sold - t.cogs_returned,
    'gross_profit', ((t.gross_sales - t.refunds_total) - (t.tax_collected - round(t.tax_refunded, 2))) - (t.cogs_sold - t.cogs_returned),
    'adjustments_total', t.adjustments_total,
    'expenses', t.expenses,
    'net_profit', ((t.gross_sales - t.refunds_total) - (t.tax_collected - round(t.tax_refunded, 2))) - (t.cogs_sold - t.cogs_returned) + t.adjustments_total,
    'bill_count', t.bill_count,
    'refund_count', t.refund_count,
    'avg_bill', case when t.bill_count > 0 then round(t.gross_sales / t.bill_count, 2) else 0 end,
    'cash_in_hand_estimate', c.cash_in - c.cash_refunds + c.exchange_net + t.cash_corrections + t.expenses,
    'payment_modes', coalesce((select jsonb_agg(jsonb_build_object('mode', mode, 'amount', amount) order by amount desc) from pay_modes), '[]'::jsonb),
    'trend', coalesce((select jsonb_agg(jsonb_build_object('bucket', bucket_start, 'sales', sales, 'refunds', refunds, 'adjustments', adjustments) order by bucket_start) from trend), '[]'::jsonb),
    'top_items', coalesce((select jsonb_agg(jsonb_build_object('name', item_name, 'qty', qty, 'revenue', revenue)) from top_items), '[]'::jsonb),
    'stock_value', s.stock_value,
    'low_stock_count', (select count(*) from v_low_stock where p_branch_id is null or branch_id = p_branch_id),
    'held_bills', (select count(*) from invoices where status = 'held' and (p_branch_id is null or branch_id = p_branch_id))
  ) into v_result
  from totals t, cash c, stock s;

  return v_result;
end;
$$;

grant execute on function dashboard_summary(date, date, uuid, text) to authenticated;
