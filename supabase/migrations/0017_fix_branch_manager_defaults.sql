-- =====================================================================
-- 0017_fix_branch_manager_defaults.sql
-- Catch-up fix for any database that already ran 0012_tax_permission.sql
-- and/or 0016_discount_rules.sql before this fix existed. Those files
-- tried to set Branch Manager's default for bills.tax/discounts.manage
-- by looking up role_templates at migration time — but role_templates
-- rows don't exist until seed.sql runs, which happens AFTER every
-- migration in the documented deploy order. The lookup silently
-- matched zero rows, so Branch Manager never actually got these two
-- permissions by default, despite the seed.sql comments claiming
-- otherwise. (seed.sql itself has since been corrected so this isn't
-- a problem for brand-new deployments — this migration exists purely
-- to catch up any database that already went through the old,
-- incomplete version of 0012/0016.)
--
-- This only touches the TEMPLATE default for Branch Manager, never a
-- per-user override — per-user overrides always take priority over
-- the template regardless (see has_permission() in
-- 0004_permission_functions.sql), so nothing here can undo an Owner's
-- deliberate choice for an individual user.
-- =====================================================================

insert into role_template_permissions (role_template_id, permission_key, allowed)
select id, perm, true
from role_templates, unnest(array['bills.tax', 'discounts.manage']) as perm
where name = 'Branch Manager'
on conflict (role_template_id, permission_key) do update
  set allowed = true
  where role_template_permissions.allowed = false;
