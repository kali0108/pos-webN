-- =====================================================================
-- 0015_fix_tax_permission_check.sql
-- CRITICAL FIX: since 0014 made tax apply automatically from the
-- branch's configured rate for every biller, the old check in
-- enforce_billing_permissions() — which rejected ANY tax_amount > 0
-- from a user without bills.tax — was wrong. It meant a cashier
-- (who normally doesn't have bills.tax) could no longer complete ANY
-- bill at a branch with a nonzero tax rate, since tax is now applied
-- automatically to every bill regardless of who's billing.
--
-- The fix: only require bills.tax when the submitted tax_amount is
-- something OTHER than what the branch's own default rate would have
-- produced — i.e. only when someone actually overrode it. The
-- automatic default always passes, for everyone, which is the
-- intended design.
-- =====================================================================

create or replace function enforce_billing_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_rate numeric;
  v_expected_tax numeric;
begin
  if new.discount_amount > 0
     and (tg_op = 'INSERT' or new.discount_amount is distinct from old.discount_amount)
     and not has_permission('bills.discount') then
    raise exception 'Missing permission: bills.discount';
  end if;

  if new.tax_amount > 0
     and (tg_op = 'INSERT' or new.tax_amount is distinct from old.tax_amount)
     and not has_permission('bills.tax') then
    select tax_rate_percent into v_branch_rate from branches where id = new.branch_id;
    v_expected_tax := round((new.subtotal - new.discount_amount) * coalesce(v_branch_rate, 0) / 100, 2);
    -- Small tolerance for floating-point rounding, not a security gap:
    -- anything beyond a cent difference means an actual override.
    if abs(new.tax_amount - v_expected_tax) > 0.01 then
      raise exception 'Missing permission: bills.tax';
    end if;
  end if;

  return new;
end;
$$;
