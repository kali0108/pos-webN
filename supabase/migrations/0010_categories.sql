-- =====================================================================
-- 0010_categories.sql
-- Turns items.category from free-text into a proper, manageable list.
-- Additive and backward-compatible: existing distinct category values
-- are turned into real category rows and linked automatically, so
-- nothing already in the database is lost. The old `category` text
-- column is left in place (unused going forward) rather than dropped,
-- since dropping a column on a live production database is riskier
-- than just leaving an unused one behind.
-- =====================================================================

create table categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now()
);

alter table items add column if not exists category_id uuid references categories(id) on delete set null;

-- Backfill: turn whatever free-text category values already exist
-- into real rows, then link each item to its new category row.
insert into categories (name)
  select distinct category from items
  where category is not null and category <> ''
on conflict (name) do nothing;

update items set category_id = c.id
  from categories c
  where items.category = c.name and items.category_id is null;

alter table categories enable row level security;

create policy "categories: read" on categories
  for select using (
    has_permission('bills.create') or has_permission('inventory.view') or has_permission('orders.manage')
  );

create policy "categories: write" on categories
  for all using (has_permission('inventory.edit')) with check (has_permission('inventory.edit'));

-- Required for the Data API to reach this table at all (see
-- 0009_data_api_grants.sql's header comment for why this is needed).
grant select, insert, update, delete on categories to authenticated;
