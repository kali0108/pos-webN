-- =====================================================================
-- 0001_core_schema.sql
-- Branches, staff profiles, role templates, and the permission system.
-- Supabase auth.users is the source of truth for login; `profiles`
-- extends it with bakery-specific fields (1-to-1, id = auth.users.id).
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- BRANCHES
-- Self-service: Owner adds/edits/deactivates branches from the Admin
-- Panel. No code changes or deploys are needed to onboard a branch.
-- ---------------------------------------------------------------------
create table branches (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,          -- short code, e.g. 'GRW', 'LHR2' — used as invoice prefix
  name          text not null,
  address       text,
  phone         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table branches is 'Bakery outlets. Owner manages these directly; deactivating hides a branch without deleting its history.';

-- ---------------------------------------------------------------------
-- ROLE TEMPLATES
-- Starting points only ("Cashier", "Manager", ...). The Owner can then
-- override any individual permission per user (see user_permission_overrides).
-- ---------------------------------------------------------------------
create table role_templates (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,           -- 'Owner', 'Branch Manager', 'Cashier', 'Production Staff'
  description  text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- PERMISSIONS
-- Master list of the granular permission keys from the brief's matrix.
-- Adding a new permission = one INSERT here, no schema change elsewhere.
-- ---------------------------------------------------------------------
create table permissions (
  key          text primary key,               -- e.g. 'bills.create'
  label        text not null,                  -- human-readable, shown in the matrix UI
  category     text not null                   -- groups rows in the matrix UI
);

insert into permissions (key, label, category) values
  ('bills.create',            'Create / edit bills',            'Billing'),
  ('bills.discount',          'Apply discounts',                'Billing'),
  ('bills.refund',            'Process refunds',                'Billing'),
  ('inventory.view',          'View inventory',                 'Inventory'),
  ('inventory.edit',          'Edit / adjust inventory',        'Inventory'),
  ('reports.sales.view',      'View sales reports',             'Reports'),
  ('reports.financial.view',  'View profit / financial reports','Reports'),
  ('staff.manage',            'Manage staff accounts',          'Administration'),
  ('branches.manage',         'Add / edit branches',            'Administration'),
  ('orders.manage',           'Manage custom orders',           'Custom Orders'),
  ('production.edit',         'Edit production records',        'Production'),
  ('data.export',             'Export data (Excel / PDF)',      'Reports');

-- ---------------------------------------------------------------------
-- ROLE TEMPLATE DEFAULTS
-- What a permission is worth "out of the box" for a given template.
-- ---------------------------------------------------------------------
create table role_template_permissions (
  role_template_id  uuid not null references role_templates(id) on delete cascade,
  permission_key    text not null references permissions(key) on delete cascade,
  allowed           boolean not null default false,
  primary key (role_template_id, permission_key)
);

-- ---------------------------------------------------------------------
-- PROFILES
-- 1-to-1 extension of auth.users. is_owner = Super Admin, unrestricted,
-- bypasses the permission matrix entirely (see has_permission() later).
-- ---------------------------------------------------------------------
create table profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  full_name         text not null,
  email             text not null,
  role_template_id  uuid references role_templates(id),
  is_owner          boolean not null default false,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table profiles is 'One row per staff login. is_owner=true is the unrestricted Super Admin account from the brief.';

-- ---------------------------------------------------------------------
-- USER <-> BRANCH ASSIGNMENT (many-to-many)
-- "assign each user to one or more branches"
-- ---------------------------------------------------------------------
create table user_branches (
  user_id     uuid not null references profiles(id) on delete cascade,
  branch_id   uuid not null references branches(id) on delete cascade,
  primary key (user_id, branch_id)
);

-- ---------------------------------------------------------------------
-- PER-USER PERMISSION OVERRIDES
-- "individually enable or disable specific functions per user ...
--  beyond a default role template". A row here always wins over the
-- role template default. No row = fall back to the template.
-- ---------------------------------------------------------------------
create table user_permission_overrides (
  user_id          uuid not null references profiles(id) on delete cascade,
  permission_key   text not null references permissions(key) on delete cascade,
  allowed          boolean not null,
  updated_by       uuid references profiles(id),
  updated_at       timestamptz not null default now(),
  primary key (user_id, permission_key)
);

-- ---------------------------------------------------------------------
-- ACTIVITY LOG
-- "Per-user activity log for every permitted action, with timestamp
--  and branch, visible to the Owner."
-- Written by the app (and by triggers, for DB-level changes) — see
-- 0005_functions_triggers.sql for the log_activity() helper.
-- ---------------------------------------------------------------------
create table activity_log (
  id           bigint generated always as identity primary key,
  user_id      uuid references profiles(id),
  branch_id    uuid references branches(id),
  action       text not null,        -- e.g. 'bill.create', 'refund.process', 'branch.update'
  entity_type  text,                 -- e.g. 'invoice', 'branch', 'user'
  entity_id    text,
  details      jsonb,
  created_at   timestamptz not null default now()
);

create index idx_activity_log_user on activity_log(user_id, created_at desc);
create index idx_activity_log_branch on activity_log(branch_id, created_at desc);
