# Database Schema

Full, runnable SQL is the source of truth, in `supabase/migrations/`, applied in order:

| File | Contents |
|---|---|
| `0001_core_schema.sql` | Branches, role templates, permissions master list, staff profiles, user↔branch assignment, activity log |
| `0002_billing_schema.sql` | Item catalog, invoices, invoice line items, payments, refunds |
| `0003_inventory_production_schema.sql` | Raw materials, recipes, branch-wise stock (finished goods + raw materials), stock movement ledger, production plan/actual, custom cake orders |
| `0004_permission_functions.sql` | `is_owner()`, `has_permission()`, `has_branch_access()` — everything RLS is built from |
| `0005_rls_policies.sql` | Row-Level Security policies for every table |
| `0006_functions_triggers.sql` | New-user provisioning, conflict-free invoice numbering, discount permission enforcement, auto stock deduction, activity-log RPC, low-stock view |
| `0007_sync_invoice_rpc.sql` | The atomic RPC the offline queue calls to push a bill |
| `0008_client_helpers.sql` | Batched "my permissions" / "my branches" RPCs for the frontend |
| `0009_data_api_grants.sql` | Explicit `GRANT`s making tables reachable through the Data API at all — **required** on any Supabase project created after May 2026; see the file header for why |
| `0010_categories.sql` | Adds a real `categories` table (replacing the old free-text `items.category` field), with automatic backfill of existing values — additive, safe to run on a database that already has data |
| `0011_realtime.sql` | Adds the shared/multi-user tables to the `supabase_realtime` publication, so changes show up live across tabs and users instead of needing a manual refresh |
| `0012_tax_permission.sql` | Adds the `bills.tax` permission (Owner can allow/deny tax per user, same as discounts) and extends the billing-permission trigger to enforce it |
| `0013_realtime_extra.sql` | Adds production tracking and the activity log to realtime |
| `0014_branch_tax_currency.sql` | Adds per-branch tax rate/label and currency — the system now works the same way for a Pakistan branch, a Saudi Arabia branch, or any future country, with no code change |
| `0015_fix_tax_permission_check.sql` | **Critical fix** — the billing-permission trigger was rejecting every bill from a user without `bills.tax` at a branch with a nonzero tax rate, since tax now applies automatically to everyone. Now it only blocks an actual *override* of the auto-calculated amount |
| `0016_discount_rules.sql` | Adds `discount_rules` — standing category-wide or item-specific discounts that apply automatically at billing time, plus the `discounts.manage` permission |
| `0017_fix_branch_manager_defaults.sql` | Catch-up fix for databases that already ran the (buggy) original `0012`/`0016` — see the file header for why the original inserts silently did nothing |
| `0018_hide_owner_profile.sql` | Hides the Owner's profile from every non-Owner user, even a delegated manager with `staff.manage` — previously any staff.manage holder could see and edit the Owner's account |
| `0019_hide_owner_branch_access.sql` | Closes a related gap: a delegated manager could still change which branches the Owner has access to, even after 0018 hid the Owner's profile itself |
| `0020_relax_log_fks_for_delete.sql` | First step towards deletion: loosens the activity-log / override-attribution foreign keys. (Superseded in spirit by 0022, which makes deletion work for everything while keeping the records.) |
| `0021_delete_and_reset.sql` | First version of delete + reset. Both are replaced by the password-protected versions in 0025 (running 0021 first is still fine — 0025 drops what it created) |
| `0022_archive_on_delete.sql` | **Deleting never destroys history.** Every bill, refund, order, production and stock record (and the activity log) now stores the branch / product / staff **name as plain text**, filled automatically by triggers, and every foreign key to those becomes `ON DELETE SET NULL`. Delete a branch, product or login and its records stay — disconnected, but still named — in History. Also records each sold line's cost price for profit reporting |
| `0023_refund_return_exchange.sql` | Three refund modes via `process_refund()`: money-only, item **return** (stock restocked, refund auto-computed in proportion to the tax/discount actually paid), and **exchange** (stock moves both ways, linked replacement bill, net difference recorded). Guards against refunding more than was bought. Adds `refund_items` and the `financial_adjustments` correction ledger (expenses, cash corrections — never edit past bills) |
| `0024_dashboard_summary.sql` | `dashboard_summary()` — everything the Dashboard shows (sales, refunds, tax, cost of goods, gross/net profit, cash estimate, payment modes, trend, top products, stock value), computed in the viewer's own timezone |
| `0025_password_protected_destructive_actions.sql` | Deleting a branch / product and the full system reset now require the person's own password, **verified on the server** and rate-limited (5 wrong attempts per 15 min). Direct deletes on those tables are removed. The reset is now a true wipe (everything except the Owner running it) |
| `0026_harden_billing_functions.sql` | Locks the internal stock helper functions so they can't be called directly from the browser; `sync_invoice()` runs with explicit permission checks and treats a finished bill as final (a re-sent bill can't rewrite a completed sale); **cashiers can now read stock at their own branch** (without this the Billing screen saw zero stock for every product) |
| `0027_fix_reset_for_safeupdate.sql` | Catch-up fix: Supabase rejects any `DELETE`/`UPDATE` without a `WHERE` clause (the `pg_safeupdate` guard) even inside a function, which made the full reset fail with "DELETE requires a WHERE clause". Every delete in the reset now says `where true`. Only needed if you already ran 0025 before this fix |

This document is the plain-English map of what's in there and why.

## Entity overview

```
branches ──< user_branches >── profiles ──< user_permission_overrides
   │                              │  │
   │                              │  └──< role_template_permissions >── role_templates
   │                              │
   │                              └──< activity_log
   │
   ├──< branch_item_stock >── items ──< item_recipes >── raw_materials ──< branch_raw_material_stock
   │                              │
   │                              └──< invoice_items >── invoices ──< payments
   │                                                         │
   │                                                         └──< refunds
   │
   ├──< production_plans / production_actuals >── items
   │
   └──< custom_orders ──< custom_order_status_history
```

## Table-by-table

**branches** — one row per outlet. `code` doubles as the invoice-number prefix. `is_active` lets the Owner deactivate a branch (hides it, keeps its history) without deleting anything.

**role_templates / role_template_permissions / permissions** — `permissions` is the master list of the twelve functions in the brief's matrix. `role_templates` are named starting points (Owner, Branch Manager, Cashier, Production Staff). `role_template_permissions` is what each template grants by default.

**profiles** — one row per staff login, 1-to-1 with Supabase's `auth.users`. `is_owner = true` marks the single unrestricted Super Admin account.

**user_branches** — many-to-many: which branches a staff member can work at.

**user_permission_overrides** — the "beyond the template" layer. A row here always wins over the role-template default for that one user and that one permission; no row means "use the template." This is what lets the Owner grant one cashier refund rights while withholding it from another, without inventing a whole new role.

**activity_log** — append-only. Every logged action carries who, when, at which branch, and a JSON details blob. Writable only through the `log_activity()` function (see below), never by a direct table insert, so entries can't be forged as someone else.

**items** — the shared product catalog (a cake is the same product at every branch); `pricing_mode` is `unit` or `weight` to support both piece-priced and weight-priced goods.

**invoices / invoice_items / payments / refunds** — the billing core. `status` covers `held` (hold/resume), `completed`, `refunded`, `void`. `client_ref` + the `(branch_id, client_ref)` unique constraint is the offline idempotency key described in `ARCHITECTURE.md`. `invoice_number` is only ever set by the server. `payments` is one-to-many so a single bill can be split across cash + card. `refunds` is its own table with its own permission, separate from ordinary billing.

**raw_materials / item_recipes** — recipes say how much of each raw material one unit of a finished item consumes, which is what makes automatic stock deduction possible.

**branch_item_stock / branch_raw_material_stock** — the current on-hand quantity per branch, for finished goods and raw materials respectively. Both carry a `reorder_level`; `v_low_stock` (a view) surfaces anything at or below it, branch-wise or consolidated.

**stock_movements** — an append-only ledger of every stock change (restock, sale, wastage, production consumption, manual correction), so any quantity is always traceable to a cause, a user, and a timestamp — not just a running total that could silently drift.

**production_plans / production_actuals** — one plan row per branch/item/day; one or more actual rows logged against it through the day, each with its own wastage. Saving an actual is what triggers raw-material deduction and finished-goods stock addition.

**custom_orders / custom_order_status_history** — cake bookings with a deposit, a due date, and a status that only moves forward (`Placed → In Production → Ready → Delivered`, or `Cancelled` at any point). Every status change is appended to the history table rather than just overwritten.

## Key design choices worth calling out

- **Per-branch invoice sequences, not one global sequence.** This is what makes the "same invoice number at two branches" scenario structurally impossible rather than just unlikely (see `ARCHITECTURE.md §3`).
- **Snapshotted item names on invoice lines.** `invoice_items.item_name` is copied at billing time so a historical receipt still reads correctly even if the catalog item is later renamed or deleted.
- **A stock ledger, not just a running total.** `stock_movements` exists specifically so "why is this number what it is" always has an answer.
- **`security_invoker` on `v_low_stock`.** Postgres views normally run with the view owner's privileges; without this flag a cashier querying the view could see stock they otherwise couldn't. Setting it makes the view respect the querying user's own RLS.
