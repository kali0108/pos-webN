-- =====================================================================
-- 0012_tax_permission.sql
-- Adds tax as its own permission — 'bills.tax' — flowing through the
-- exact same matrix, override, and enforcement machinery that
-- 'bills.discount' already uses. No new UI plumbing was needed for
-- the Admin > Staff permissions matrix itself: it already renders
-- every row from the `permissions` table dynamically, so this new
-- permission just appears there automatically.
-- =====================================================================

insert into permissions (key, label, category) values
  ('bills.tax', 'Apply tax', 'Billing')
on conflict (key) do nothing;

-- Sensible defaults: Branch Manager can apply tax by default, Cashier
-- and Production Staff can't (same shape as the discount permission).
-- The Owner ignores the matrix entirely, as always.
insert into role_template_permissions (role_template_id, permission_key, allowed)
select id, 'bills.tax', true from role_templates where name = 'Branch Manager'
on conflict (role_template_id, permission_key) do nothing;

insert into role_template_permissions (role_template_id, permission_key, allowed)
select rt.id, 'bills.tax', false
from role_templates rt
where rt.name <> 'Owner'
on conflict (role_template_id, permission_key) do nothing;

-- Extend the existing trigger to also gate tax_amount changes,
-- exactly parallel to the discount_amount check already there.
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

  if new.tax_amount > 0
     and (tg_op = 'INSERT' or new.tax_amount is distinct from old.tax_amount)
     and not has_permission('bills.tax') then
    raise exception 'Missing permission: bills.tax';
  end if;

  return new;
end;
$$;
