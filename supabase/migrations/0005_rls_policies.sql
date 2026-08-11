-- =====================================================================
-- 0005_rls_policies.sql
-- Row-Level Security for every table. With RLS enabled, Postgres
-- denies everything by default; each CREATE POLICY below is an
-- explicit exception. This is what makes the permission matrix a real
-- database-level control instead of a frontend-only convenience —
-- calling the auto-generated REST API directly with a stolen cashier
-- token still can't process a refund if bills.refund isn't granted.
-- =====================================================================

alter table branches enable row level security;
alter table role_templates enable row level security;
alter table permissions enable row level security;
alter table role_template_permissions enable row level security;
alter table profiles enable row level security;
alter table user_branches enable row level security;
alter table user_permission_overrides enable row level security;
alter table activity_log enable row level security;
alter table items enable row level security;
alter table invoices enable row level security;
alter table invoice_items enable row level security;
alter table payments enable row level security;
alter table refunds enable row level security;
alter table raw_materials enable row level security;
alter table item_recipes enable row level security;
alter table branch_item_stock enable row level security;
alter table branch_raw_material_stock enable row level security;
alter table stock_movements enable row level security;
alter table production_plans enable row level security;
alter table production_actuals enable row level security;
alter table custom_orders enable row level security;
alter table custom_order_status_history enable row level security;

-- ---------------------------------------------------------------------
-- BRANCHES — self-service management, gated on 'branches.manage'
-- ---------------------------------------------------------------------
create policy "branches: read accessible" on branches
  for select using (has_branch_access(id) or has_permission('branches.manage'));

create policy "branches: create" on branches
  for insert with check (has_permission('branches.manage'));

create policy "branches: update" on branches
  for update using (has_permission('branches.manage'));

create policy "branches: delete (owner only)" on branches
  for delete using (is_owner());

-- ---------------------------------------------------------------------
-- ROLE TEMPLATES / PERMISSIONS (master lists)
-- ---------------------------------------------------------------------
create policy "role_templates: read" on role_templates for select using (auth.uid() is not null);
create policy "role_templates: write" on role_templates for all
  using (has_permission('staff.manage')) with check (has_permission('staff.manage'));

create policy "permissions: read" on permissions for select using (auth.uid() is not null);

create policy "role_template_permissions: read" on role_template_permissions
  for select using (auth.uid() is not null);
create policy "role_template_permissions: write" on role_template_permissions for all
  using (has_permission('staff.manage')) with check (has_permission('staff.manage'));

-- ---------------------------------------------------------------------
-- PROFILES
-- ---------------------------------------------------------------------
create policy "profiles: read self or if staff.manage" on profiles
  for select using (id = auth.uid() or has_permission('staff.manage'));

create policy "profiles: update self (limited) or staff.manage" on profiles
  for update using (id = auth.uid() or has_permission('staff.manage'));
-- Row insert happens via the handle_new_user() trigger (security
-- definer, see 0006) fired from auth.users — not directly by clients.

-- ---------------------------------------------------------------------
-- USER <-> BRANCH ASSIGNMENT
-- ---------------------------------------------------------------------
create policy "user_branches: read self or staff.manage" on user_branches
  for select using (user_id = auth.uid() or has_permission('staff.manage'));
create policy "user_branches: write staff.manage" on user_branches
  for all using (has_permission('staff.manage')) with check (has_permission('staff.manage'));

-- ---------------------------------------------------------------------
-- PER-USER PERMISSION OVERRIDES
-- Anti-privilege-escalation: a delegated manager with 'staff.manage'
-- can edit *other* non-owner staff, but cannot edit their own
-- overrides and cannot touch the Owner's row. Only the Owner can do
-- either of those. This stops a manager from quietly granting
-- themselves (or another manager) more power than they were given.
-- ---------------------------------------------------------------------
create policy "user_permission_overrides: read self or staff.manage" on user_permission_overrides
  for select using (user_id = auth.uid() or has_permission('staff.manage'));

create policy "user_permission_overrides: write" on user_permission_overrides
  for all using (
    is_owner()
    or (
      has_permission('staff.manage')
      and user_id <> auth.uid()
      and not exists (select 1 from profiles where id = user_id and is_owner = true)
    )
  )
  with check (
    is_owner()
    or (
      has_permission('staff.manage')
      and user_id <> auth.uid()
      and not exists (select 1 from profiles where id = user_id and is_owner = true)
    )
  );

-- ---------------------------------------------------------------------
-- ACTIVITY LOG — Owner/managers can review; writes only via the
-- log_activity() SECURITY DEFINER function in 0006 (no direct INSERT
-- policy exists, so forged log rows aren't possible from the client).
-- ---------------------------------------------------------------------
create policy "activity_log: read own or staff.manage" on activity_log
  for select using (user_id = auth.uid() or has_permission('staff.manage'));

-- ---------------------------------------------------------------------
-- ITEMS (catalog)
-- ---------------------------------------------------------------------
create policy "items: read if billing or inventory or orders access" on items
  for select using (
    has_permission('bills.create') or has_permission('inventory.view') or has_permission('orders.manage')
  );
create policy "items: write inventory.edit" on items
  for all using (has_permission('inventory.edit')) with check (has_permission('inventory.edit'));

-- ---------------------------------------------------------------------
-- INVOICES / INVOICE ITEMS / PAYMENTS
-- Note: discount and refund enforcement beyond "can bill at all" is
-- done in the enforce_billing_permissions() trigger in 0006, since a
-- single UPDATE can carry a discount, and RLS alone can't cheaply
-- express "this column changed and that requires a different
-- permission" without an extra roundtrip.
-- ---------------------------------------------------------------------
create policy "invoices: read" on invoices
  for select using (
    has_branch_access(branch_id)
    and (has_permission('bills.create') or has_permission('reports.sales.view') or has_permission('reports.financial.view'))
  );
create policy "invoices: create" on invoices
  for insert with check (
    has_branch_access(branch_id) and has_permission('bills.create') and created_by = auth.uid()
  );
create policy "invoices: update" on invoices
  for update using (has_branch_access(branch_id) and has_permission('bills.create'));

create policy "invoice_items: read via parent invoice" on invoice_items
  for select using (exists (
    select 1 from invoices i where i.id = invoice_id
      and has_branch_access(i.branch_id)
      and (has_permission('bills.create') or has_permission('reports.sales.view'))
  ));
create policy "invoice_items: write via parent invoice" on invoice_items
  for all using (exists (
    select 1 from invoices i where i.id = invoice_id
      and has_branch_access(i.branch_id) and has_permission('bills.create')
  )) with check (exists (
    select 1 from invoices i where i.id = invoice_id
      and has_branch_access(i.branch_id) and has_permission('bills.create')
  ));

create policy "payments: read via parent invoice" on payments
  for select using (exists (
    select 1 from invoices i where i.id = invoice_id
      and has_branch_access(i.branch_id)
      and (has_permission('bills.create') or has_permission('reports.sales.view'))
  ));
create policy "payments: write via parent invoice" on payments
  for all using (exists (
    select 1 from invoices i where i.id = invoice_id
      and has_branch_access(i.branch_id) and has_permission('bills.create')
  )) with check (exists (
    select 1 from invoices i where i.id = invoice_id
      and has_branch_access(i.branch_id) and has_permission('bills.create')
  ));

-- ---------------------------------------------------------------------
-- REFUNDS — separate permission from ordinary billing
-- ---------------------------------------------------------------------
create policy "refunds: read" on refunds
  for select using (
    has_branch_access(branch_id) and (has_permission('bills.refund') or has_permission('reports.financial.view'))
  );
create policy "refunds: create" on refunds
  for insert with check (
    has_branch_access(branch_id) and has_permission('bills.refund') and processed_by = auth.uid()
  );

-- ---------------------------------------------------------------------
-- INVENTORY: raw materials, recipes, branch stock, movements
-- ---------------------------------------------------------------------
create policy "raw_materials: read" on raw_materials for select using (has_permission('inventory.view'));
create policy "raw_materials: write" on raw_materials for all
  using (has_permission('inventory.edit')) with check (has_permission('inventory.edit'));

create policy "item_recipes: read" on item_recipes for select using (has_permission('inventory.view'));
create policy "item_recipes: write" on item_recipes for all
  using (has_permission('inventory.edit')) with check (has_permission('inventory.edit'));

create policy "branch_item_stock: read" on branch_item_stock
  for select using (has_branch_access(branch_id) and has_permission('inventory.view'));
create policy "branch_item_stock: write" on branch_item_stock
  for all using (has_branch_access(branch_id) and has_permission('inventory.edit'))
  with check (has_branch_access(branch_id) and has_permission('inventory.edit'));

create policy "branch_raw_material_stock: read" on branch_raw_material_stock
  for select using (has_branch_access(branch_id) and has_permission('inventory.view'));
create policy "branch_raw_material_stock: write" on branch_raw_material_stock
  for all using (has_branch_access(branch_id) and has_permission('inventory.edit'))
  with check (has_branch_access(branch_id) and has_permission('inventory.edit'));

create policy "stock_movements: read" on stock_movements
  for select using (has_branch_access(branch_id) and has_permission('inventory.view'));
create policy "stock_movements: create" on stock_movements
  for insert with check (has_branch_access(branch_id) and has_permission('inventory.edit') and created_by = auth.uid());

-- ---------------------------------------------------------------------
-- PRODUCTION
-- ---------------------------------------------------------------------
create policy "production_plans: read" on production_plans
  for select using (has_branch_access(branch_id) and (has_permission('production.edit') or has_permission('reports.sales.view')));
create policy "production_plans: write" on production_plans
  for all using (has_branch_access(branch_id) and has_permission('production.edit'))
  with check (has_branch_access(branch_id) and has_permission('production.edit'));

create policy "production_actuals: read" on production_actuals
  for select using (has_branch_access(branch_id) and (has_permission('production.edit') or has_permission('reports.sales.view')));
create policy "production_actuals: write" on production_actuals
  for all using (has_branch_access(branch_id) and has_permission('production.edit'))
  with check (has_branch_access(branch_id) and has_permission('production.edit'));

-- ---------------------------------------------------------------------
-- CUSTOM ORDERS
-- ---------------------------------------------------------------------
create policy "custom_orders: read" on custom_orders
  for select using (has_branch_access(branch_id) and (has_permission('orders.manage') or has_permission('bills.create')));
create policy "custom_orders: write" on custom_orders
  for all using (has_branch_access(branch_id) and has_permission('orders.manage'))
  with check (has_branch_access(branch_id) and has_permission('orders.manage'));

create policy "custom_order_status_history: read" on custom_order_status_history
  for select using (exists (
    select 1 from custom_orders co where co.id = order_id
      and has_branch_access(co.branch_id) and (has_permission('orders.manage') or has_permission('bills.create'))
  ));
create policy "custom_order_status_history: write" on custom_order_status_history
  for insert with check (exists (
    select 1 from custom_orders co where co.id = order_id
      and has_branch_access(co.branch_id) and has_permission('orders.manage')
  ));
