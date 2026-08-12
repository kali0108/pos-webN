-- =====================================================================
-- 0016_discount_rules.sql
-- Pre-configured discounts (e.g. "20% off all Cupcakes" or "Rs 50 off
-- Chocolate Cake") that apply automatically the moment an item is
-- added to a bill — the cashier never types a discount for these,
-- they're just the item's effective selling price. This is deliberately
-- SEPARATE from `bills.discount` (the free-text ad-hoc discount field
-- already on the bill): that one stays exactly as it was, for a
-- one-off manual discount a manager types in. These rules are the
-- standing, pre-approved ones.
--
-- Because a rule-based discount is applied to the item's own price
-- (invoice_items.unit_price) rather than added to invoices.discount_amount,
-- no change to sync_invoice() or the billing-permission trigger is
-- needed — applying an already-configured rule isn't a permission a
-- cashier needs, any more than reading the regular price is one.
-- Only CREATING/EDITING the rules themselves is permission-gated
-- (see 'discounts.manage' below).
-- =====================================================================

create table discount_rules (
  id              uuid primary key default gen_random_uuid(),
  label           text not null,
  scope           text not null check (scope in ('category', 'item')),
  category_id     uuid references categories(id) on delete cascade,
  item_id         uuid references items(id) on delete cascade,
  discount_type   text not null check (discount_type in ('percent', 'fixed')),
  discount_value  numeric(12,2) not null check (discount_value > 0),
  is_active       boolean not null default true,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  check (
    (scope = 'category' and category_id is not null and item_id is null) or
    (scope = 'item' and item_id is not null and category_id is null)
  )
);

comment on table discount_rules is 'Standing discounts applied automatically at billing time — item-level rules take precedence over a category-level rule for the same item.';

create index idx_discount_rules_category on discount_rules(category_id) where scope = 'category' and is_active;
create index idx_discount_rules_item on discount_rules(item_id) where scope = 'item' and is_active;

insert into permissions (key, label, category) values
  ('discounts.manage', 'Manage automatic discounts', 'Billing')
on conflict (key) do nothing;

-- NOTE: role template DEFAULTS live in seed.sql, not here — see the
-- identical note in 0012_tax_permission.sql for why an insert here
-- would silently no-op (role_templates doesn't exist yet at the point
-- migrations run, only after seed.sql).

alter table discount_rules enable row level security;

create policy "discount_rules: read if can bill or view inventory" on discount_rules
  for select using (
    has_permission('bills.create') or has_permission('inventory.view') or has_permission('discounts.manage')
  );

create policy "discount_rules: write" on discount_rules
  for all using (has_permission('discounts.manage')) with check (has_permission('discounts.manage'));

grant select, insert, update, delete on discount_rules to authenticated;

alter publication supabase_realtime add table discount_rules;
