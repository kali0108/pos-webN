-- =====================================================================
-- 0002_billing_schema.sql
-- Item catalog + billing/invoicing, designed so the OFFLINE QUEUE +
-- MULTI-BRANCH SYNC never produces a duplicate or colliding invoice
-- number (see notes on `client_ref` and `invoice_number` below, and
-- assign_invoice_number() in 0005_functions_triggers.sql).
-- =====================================================================

-- ---------------------------------------------------------------------
-- ITEMS
-- Shared catalog across branches (a "Chocolate Cake 1kg" is the same
-- product everywhere); stock levels are branch-specific (see 0003).
-- ---------------------------------------------------------------------
create table items (
  id            uuid primary key default gen_random_uuid(),
  sku           text unique,
  name          text not null,
  category      text,
  pricing_mode  text not null default 'unit' check (pricing_mode in ('unit', 'weight')),
  unit_label    text not null default 'pc',   -- 'pc', 'kg', 'box', ...
  unit_price    numeric(12,2) not null check (unit_price >= 0),
  cost_price    numeric(12,2) default 0,
  is_active     boolean not null default true,
  image_path    text,                          -- Supabase Storage path, e.g. cake reference photo
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- INVOICES
--
-- OFFLINE-SAFE DESIGN:
--  - `client_ref` is a UUID generated in the browser the instant a bill
--    is created (works offline). It is the idempotency key: retrying a
--    sync (e.g. after a dropped connection) upserts on (branch_id,
--    client_ref) instead of creating a duplicate row.
--  - `invoice_number` is NEVER chosen by the client. It is assigned by
--    the server, atomically, per branch, only once the row lands in
--    Postgres (see assign_invoice_number() trigger). Two branches
--    billing at the same second simply can't collide, because each
--    branch owns its own sequence and the trigger runs inside the
--    database transaction, not in browser JS.
--  - status='held' implements "hold/resume bill".
-- ---------------------------------------------------------------------
create table invoices (
  id                uuid primary key default gen_random_uuid(),
  branch_id         uuid not null references branches(id),
  client_ref        uuid not null,             -- generated client-side, see lib/localDb.js
  invoice_number    text,                       -- assigned server-side, e.g. 'GRW-000104'
  status            text not null default 'held'
                     check (status in ('held', 'completed', 'refunded', 'void')),
  customer_name     text,
  customer_phone    text,
  subtotal          numeric(12,2) not null default 0,
  discount_amount   numeric(12,2) not null default 0,
  discount_reason   text,
  tax_amount        numeric(12,2) not null default 0,
  total_amount      numeric(12,2) not null default 0,
  created_by        uuid references profiles(id),
  created_at        timestamptz not null default now(),
  completed_at      timestamptz,
  synced_at         timestamptz not null default now(),  -- when this row actually reached the server
  device_created_at timestamptz,                          -- browser-local timestamp, for offline diagnostics
  unique (branch_id, client_ref)
);

create index idx_invoices_branch_created on invoices(branch_id, created_at desc);
create index idx_invoices_status on invoices(status) where status = 'held';

-- ---------------------------------------------------------------------
-- INVOICE LINE ITEMS
-- ---------------------------------------------------------------------
create table invoice_items (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references invoices(id) on delete cascade,
  item_id       uuid references items(id),
  item_name     text not null,        -- snapshot, survives later catalog edits
  quantity      numeric(12,3) not null check (quantity > 0),  -- supports weight (e.g. 0.750 kg)
  unit_price    numeric(12,2) not null,
  line_total    numeric(12,2) not null
);

-- ---------------------------------------------------------------------
-- PAYMENTS
-- Multiple payment modes per bill (e.g. part cash, part card).
-- ---------------------------------------------------------------------
create table payments (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references invoices(id) on delete cascade,
  mode          text not null check (mode in ('cash', 'card', 'mobile_wallet', 'bank_transfer', 'other')),
  amount        numeric(12,2) not null check (amount > 0),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- REFUNDS
-- ---------------------------------------------------------------------
create table refunds (
  id             uuid primary key default gen_random_uuid(),
  invoice_id     uuid not null references invoices(id),
  amount         numeric(12,2) not null check (amount > 0),
  reason         text,
  processed_by   uuid references profiles(id),
  branch_id      uuid not null references branches(id),
  created_at     timestamptz not null default now()
);
