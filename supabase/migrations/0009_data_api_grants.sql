-- =====================================================================
-- 0009_data_api_grants.sql
-- REQUIRED as of Supabase's 2026 platform default: for any project
-- created on or after 30 May 2026, tables in the `public` schema are
-- NOT automatically reachable through the Data API (PostgREST/
-- supabase-js) anymore — only through a direct Postgres connection.
-- Without the grants below, every supabase-js call in this app
-- (including logging in and loading the item list) would fail with a
-- permissions error even though RLS policies are all correctly in
-- place, because the Data API layer sits in front of RLS, not behind
-- it. If your project predates that change, this file is harmless —
-- it just restates grants you already have.
--
-- Row-Level Security (0005_rls_policies.sql) is still what actually
-- decides which rows a given request can see or touch; the grants
-- below only decide whether the Data API is allowed to reach the
-- table at all. Think of GRANT as the door and RLS as the guard
-- standing just inside it — both have to say yes.
--
-- `branch_invoice_counters` is intentionally NOT granted here: no
-- client ever needs to read or write it directly (only the
-- assign_invoice_number() trigger touches it), so leaving it
-- ungranted keeps it invisible to the Data API entirely — a nice
-- concrete example of the new default working in your favor.
-- =====================================================================

grant usage on schema public to authenticated;

grant select, insert, update, delete on
  branches,
  role_templates,
  permissions,
  role_template_permissions,
  profiles,
  user_branches,
  user_permission_overrides,
  activity_log,
  items,
  invoices,
  invoice_items,
  payments,
  refunds,
  raw_materials,
  item_recipes,
  branch_item_stock,
  branch_raw_material_stock,
  stock_movements,
  production_plans,
  production_actuals,
  custom_orders,
  custom_order_status_history
to authenticated;

grant select on v_low_stock to authenticated;

-- The `anon` role (a browser tab before it has logged in) never
-- reads or writes any of these tables directly — login happens
-- through Supabase Auth, which is a separate system unaffected by
-- this change. No grants to `anon` are needed or given here.
