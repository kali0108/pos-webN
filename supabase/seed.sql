-- =====================================================================
-- seed.sql
-- Starter role templates with sensible defaults. These are only
-- starting points — the Owner can override any individual permission
-- per user afterwards from Admin > Staff > Permissions.
-- Run after all migrations: `supabase db reset` (local) applies this
-- automatically, or run it manually in the SQL editor for a hosted
-- project.
-- =====================================================================

insert into role_templates (name, description) values
  ('Owner',            'Unrestricted Super Admin. In practice this template is never consulted — the profiles.is_owner flag bypasses the matrix entirely.'),
  ('Branch Manager',   'Runs day-to-day operations at one or more branches: billing, discounts, refunds, inventory, reports, custom orders.'),
  ('Cashier',          'Front-counter billing. No discounts, refunds, inventory edits, or report access by default.'),
  ('Production Staff', 'Kitchen/production floor: inventory visibility and production records, no billing.')
on conflict (name) do nothing;

-- Branch Manager: everything except staff/branch structural admin
insert into role_template_permissions (role_template_id, permission_key, allowed)
select id, perm, true
from role_templates, unnest(array[
  'bills.create','bills.discount','bills.refund','bills.tax',
  'inventory.view','inventory.edit',
  'reports.sales.view','reports.financial.view',
  'orders.manage','production.edit','data.export','discounts.manage'
]) as perm
where name = 'Branch Manager'
on conflict do nothing;

insert into role_template_permissions (role_template_id, permission_key, allowed)
select id, perm, false
from role_templates, unnest(array['staff.manage','branches.manage']) as perm
where name = 'Branch Manager'
on conflict do nothing;

-- Cashier: billing only, nothing else
insert into role_template_permissions (role_template_id, permission_key, allowed)
select id, perm, true
from role_templates, unnest(array['bills.create']) as perm
where name = 'Cashier'
on conflict do nothing;

insert into role_template_permissions (role_template_id, permission_key, allowed)
select id, perm, false
from role_templates, unnest(array[
  'bills.discount','bills.refund','inventory.view','inventory.edit',
  'reports.sales.view','reports.financial.view','staff.manage',
  'branches.manage','orders.manage','production.edit','data.export'
]) as perm
where name = 'Cashier'
on conflict do nothing;

-- Production Staff: inventory + production only
insert into role_template_permissions (role_template_id, permission_key, allowed)
select id, perm, true
from role_templates, unnest(array['inventory.view','production.edit']) as perm
where name = 'Production Staff'
on conflict do nothing;

insert into role_template_permissions (role_template_id, permission_key, allowed)
select id, perm, false
from role_templates, unnest(array[
  'bills.create','bills.discount','bills.refund','inventory.edit',
  'reports.sales.view','reports.financial.view','staff.manage',
  'branches.manage','orders.manage','data.export'
]) as perm
where name = 'Production Staff'
on conflict do nothing;

-- Fill in every remaining (role_template, permission) pair not listed
-- above as false, so the matrix always has a definite value.
insert into role_template_permissions (role_template_id, permission_key, allowed)
select rt.id, p.key, false
from role_templates rt
cross join permissions p
where rt.name <> 'Owner'
on conflict (role_template_id, permission_key) do nothing;

-- ---------------------------------------------------------------------
-- BOOTSTRAPPING THE FIRST OWNER ACCOUNT
-- profiles.id is a foreign key into auth.users, so the very first
-- account can't be seeded by SQL alone — it must exist in Supabase
-- Auth first. One-time steps, in the Supabase Dashboard:
--   1. Authentication > Users > Add User (email + password).
--   2. SQL Editor, run:
--      update profiles set is_owner = true, is_active = true
--        where email = 'owner@yourbakery.com';
-- From then on, the Owner creates every other staff account from the
-- app itself (Admin > Staff > New User), which calls the
-- create-staff-user Edge Function — see docs/DEPLOYMENT_GUIDE.md.
-- ---------------------------------------------------------------------
