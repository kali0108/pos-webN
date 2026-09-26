-- =====================================================================
-- 0020_relax_log_fks_for_delete.sql
-- Enables safe hard-deletion of branches/staff/items that have never
-- been used for real business (billed, ordered, produced, moved
-- stock) — while keeping every table that represents an actual
-- business transaction fully protective (RESTRICT), so deleting a
-- branch/item/staff member with real history stays impossible, on
-- purpose, at the database level.
--
-- Three columns are purely informational trails, not business
-- records, and were wrongly left at Postgres's default RESTRICT
-- behavior — meaning almost nothing could ever be deleted, since
-- these tables get a row written the instant almost anything happens:
--   - activity_log.branch_id / activity_log.user_id — a log entry
--     shouldn't be the reason a mistakenly-created branch or staff
--     account can't be removed. The log ROW survives (nothing here
--     deletes log history) — only the now-dangling reference is
--     cleared to NULL.
--   - user_permission_overrides.updated_by — records who last
--     changed someone's override. Shouldn't block deleting the
--     person who made that edit.
--
-- Every OTHER foreign key referencing branches/items/profiles
-- (invoices, refunds, custom_orders, production_plans/actuals,
-- stock_movements, invoice_items, etc.) is intentionally left
-- untouched — those represent real transactions and should keep
-- blocking deletion exactly as before.
-- =====================================================================

alter table activity_log
  drop constraint activity_log_branch_id_fkey,
  add constraint activity_log_branch_id_fkey
    foreign key (branch_id) references branches(id) on delete set null;

alter table activity_log
  drop constraint activity_log_user_id_fkey,
  add constraint activity_log_user_id_fkey
    foreign key (user_id) references profiles(id) on delete set null;

alter table user_permission_overrides
  drop constraint user_permission_overrides_updated_by_fkey,
  add constraint user_permission_overrides_updated_by_fkey
    foreign key (updated_by) references profiles(id) on delete set null;
