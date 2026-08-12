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

-- NOTE: role template DEFAULTS for this permission are set in
-- seed.sql, not here. role_templates rows (Owner, Branch Manager,
-- Cashier, Production Staff) don't exist until seed.sql runs, which
-- happens AFTER every migration in the documented deploy order — an
-- insert here that looks up role_templates by name would silently
-- match zero rows and do nothing, which is exactly the bug this
-- comment is here to prevent reintroducing.

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
