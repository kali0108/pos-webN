-- =====================================================================
-- 0011_realtime.sql
-- Adds the shared, multi-user-visible tables to the supabase_realtime
-- publication. Without this, Postgres Changes subscriptions
-- (frontend/src/lib/realtime.js) receive nothing — this is the
-- concrete reason changes made by one user/tab weren't showing up for
-- another without a manual page refresh.
--
-- RLS still applies to what each subscriber actually receives (a
-- cashier's browser won't receive change events for a branch they
-- don't have access to) — this migration only makes the tables
-- eligible to stream changes at all.
--
-- Note: RLS is NOT applied to DELETE events (Postgres can't check
-- access to a row that's already gone) — none of the deletions this
-- app does on these tables are sensitive enough for that to matter
-- here (e.g. removing a category, or a branch assignment).
-- =====================================================================

alter publication supabase_realtime add table
  branches,
  profiles,
  user_branches,
  user_permission_overrides,
  items,
  categories,
  branch_item_stock,
  invoices,
  custom_orders;
