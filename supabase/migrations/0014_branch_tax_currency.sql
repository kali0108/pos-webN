-- =====================================================================
-- 0014_branch_tax_currency.sql
-- Tax and currency move from "typed in on every bill" to a per-branch
-- setting — this is what makes the system work the same way for a
-- Pakistan branch (Sales Tax/GST) and a Saudi Arabia branch (VAT), or
-- any future country, without any code change: each branch just gets
-- its own tax label, tax rate, and currency, set once by whoever has
-- branches.manage. Billing then applies it automatically; a cashier
-- sees the resulting tax line on every bill but never edits it —
-- only someone with the existing 'bills.tax' permission can override
-- the calculated amount on a specific bill (e.g. a tax-exempt sale).
-- =====================================================================

alter table branches add column if not exists tax_label text not null default 'Tax';
alter table branches add column if not exists tax_rate_percent numeric(5,2) not null default 0 check (tax_rate_percent >= 0 and tax_rate_percent <= 100);
alter table branches add column if not exists currency_code text not null default 'PKR';
alter table branches add column if not exists currency_symbol text not null default 'Rs';

comment on column branches.tax_label is 'Shown on bills/receipts, e.g. "Sales Tax", "GST", "VAT" — whatever this branch''s country calls it.';
comment on column branches.tax_rate_percent is 'Default tax rate applied automatically on every bill at this branch. A user with bills.tax can still override it per bill.';

-- get_my_branches() now also returns these, so the frontend has
-- everything it needs to bill correctly for whichever branch is
-- selected without a second round trip. The return type is changing
-- (new columns), so the old function must be dropped first — Postgres
-- won't let CREATE OR REPLACE change a function's OUT-parameter shape.
drop function if exists get_my_branches();

create function get_my_branches()
returns table (
  id uuid, code text, name text,
  tax_label text, tax_rate_percent numeric, currency_code text, currency_symbol text
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.code, b.name, b.tax_label, b.tax_rate_percent, b.currency_code, b.currency_symbol
  from branches b
  where b.is_active and (is_owner() or exists (
    select 1 from user_branches ub where ub.user_id = auth.uid() and ub.branch_id = b.id
  ))
  order by b.name;
$$;

grant execute on function get_my_branches() to authenticated;
