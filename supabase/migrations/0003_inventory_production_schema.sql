-- =====================================================================
-- 0003_inventory_production_schema.sql
-- Raw materials, branch-wise stock, recipes (for auto-deduction),
-- production plan vs. actual, wastage, and custom cake orders.
-- =====================================================================

-- ---------------------------------------------------------------------
-- RAW MATERIALS (flour, butter, sugar, packaging, ...)
-- ---------------------------------------------------------------------
create table raw_materials (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  unit           text not null,          -- 'kg', 'litre', 'pc', ...
  cost_per_unit  numeric(12,2) default 0,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- RECIPES: how much raw material one unit of a finished item consumes.
-- Powers automatic stock deduction in Production Tracking.
-- ---------------------------------------------------------------------
create table item_recipes (
  item_id           uuid not null references items(id) on delete cascade,
  raw_material_id   uuid not null references raw_materials(id) on delete cascade,
  quantity_required numeric(12,4) not null check (quantity_required > 0),
  primary key (item_id, raw_material_id)
);

-- ---------------------------------------------------------------------
-- BRANCH-WISE STOCK
-- Two pools: finished goods (`items`) and raw materials, both scoped
-- per branch, so "branch-wise and consolidated" reporting is a simple
-- GROUP BY branch_id vs. a query with no branch filter.
-- ---------------------------------------------------------------------
create table branch_item_stock (
  branch_id       uuid not null references branches(id) on delete cascade,
  item_id         uuid not null references items(id) on delete cascade,
  quantity        numeric(12,3) not null default 0,
  reorder_level   numeric(12,3) not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (branch_id, item_id)
);

create table branch_raw_material_stock (
  branch_id         uuid not null references branches(id) on delete cascade,
  raw_material_id   uuid not null references raw_materials(id) on delete cascade,
  quantity          numeric(12,3) not null default 0,
  reorder_level     numeric(12,3) not null default 0,
  updated_at        timestamptz not null default now(),
  primary key (branch_id, raw_material_id)
);

-- Manual/audited stock movements (restock, wastage, correction, sale
-- deduction). Keeping a ledger (instead of only the running total
-- above) means every stock change is traceable to a cause and a user.
create table stock_movements (
  id             bigint generated always as identity primary key,
  branch_id      uuid not null references branches(id),
  item_id        uuid references items(id),
  raw_material_id uuid references raw_materials(id),
  quantity_delta numeric(12,3) not null,     -- positive = in, negative = out
  reason         text not null check (reason in
                   ('restock', 'sale', 'wastage', 'production_consumption', 'correction', 'transfer')),
  reference_id   text,                        -- e.g. invoice id or production_actual id
  created_by     uuid references profiles(id),
  created_at     timestamptz not null default now(),
  check (num_nonnulls(item_id, raw_material_id) = 1)
);

create index idx_stock_movements_branch on stock_movements(branch_id, created_at desc);

-- ---------------------------------------------------------------------
-- PRODUCTION: daily plan vs. actual, with wastage
-- ---------------------------------------------------------------------
create table production_plans (
  id                 uuid primary key default gen_random_uuid(),
  branch_id          uuid not null references branches(id),
  item_id            uuid not null references items(id),
  plan_date          date not null,
  planned_quantity   numeric(12,3) not null check (planned_quantity >= 0),
  created_by         uuid references profiles(id),
  created_at         timestamptz not null default now(),
  unique (branch_id, item_id, plan_date)
);

create table production_actuals (
  id                 uuid primary key default gen_random_uuid(),
  plan_id            uuid references production_plans(id),
  branch_id          uuid not null references branches(id),
  item_id            uuid not null references items(id),
  production_date    date not null,
  actual_quantity    numeric(12,3) not null default 0,
  wastage_quantity   numeric(12,3) not null default 0,
  wastage_reason     text,
  recorded_by        uuid references profiles(id),
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- CUSTOM ORDERS (cake bookings)
-- ---------------------------------------------------------------------
create table custom_orders (
  id               uuid primary key default gen_random_uuid(),
  branch_id        uuid not null references branches(id),
  customer_name    text not null,
  customer_phone   text not null,
  description      text not null,           -- flavor, size, message on cake, etc.
  reference_image  text,                     -- Supabase Storage path
  deposit_amount   numeric(12,2) not null default 0,
  total_amount     numeric(12,2) not null default 0,
  due_date         timestamptz not null,
  status           text not null default 'Placed'
                    check (status in ('Placed', 'In Production', 'Ready', 'Delivered', 'Cancelled')),
  created_by       uuid references profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table custom_order_status_history (
  id           bigint generated always as identity primary key,
  order_id     uuid not null references custom_orders(id) on delete cascade,
  status       text not null,
  changed_by   uuid references profiles(id),
  changed_at   timestamptz not null default now(),
  note         text
);

create index idx_custom_orders_branch_status on custom_orders(branch_id, status);
