# Permissions Matrix → Database Enforcement

Every function in the brief's matrix maps to one permission key. The Owner (`profiles.is_owner = true`) always passes every check and never consults this table — everyone else's effective value is: **their own override, if one exists → else their role template's default → else denied.**

| Matrix item | Permission key | Enforced by |
|---|---|---|
| Create/edit bills | `bills.create` | RLS on `invoices`, `invoice_items`, `payments` (`0005_rls_policies.sql`) |
| Apply discounts | `bills.discount` | Trigger `enforce_billing_permissions()` on `invoices` (`0006_functions_triggers.sql`) — separate from `bills.create` because a bill can be created without a discount ever being touched |
| Apply tax | `bills.tax` | Tax is applied automatically from the branch's configured rate for everyone (see `branches.tax_rate_percent`). This permission only controls whether the % can be *overridden* on a specific bill — same trigger, extended in `0012_tax_permission.sql` and corrected in `0015_fix_tax_permission_check.sql` — not whether tax is charged at all |
| Manage automatic discounts | `discounts.manage` | RLS on `discount_rules` (`0016_discount_rules.sql`). *Using* an already-configured discount while billing needs no permission at all — it's just the item's price, the same as reading the regular price — only creating/editing the rules themselves is gated |
| Process refunds | `bills.refund` | RLS on `refunds` |
| View inventory | `inventory.view` | RLS on `items` (read), `raw_materials`, `branch_item_stock`, `branch_raw_material_stock`, `stock_movements` |
| Edit/adjust inventory | `inventory.edit` | RLS write policies on the same inventory tables |
| View sales reports | `reports.sales.view` | RLS read policy on `invoices` (also grants read on `production_plans`/`production_actuals` for the reports view) |
| View profit/financial reports | `reports.financial.view` | Separate RLS read policy on `invoices` and `refunds` — deliberately distinct from `reports.sales.view` so a manager can see sales volume without seeing margins/discount totals |
| Manage staff accounts | `staff.manage` | RLS on `profiles`, `user_branches`, `user_permission_overrides`, `role_templates`, `role_template_permissions`; also the authorization check inside the `create-staff-user` Edge Function |
| Add/edit branches | `branches.manage` | RLS on `branches` (insert/update; delete is Owner-only) |
| Manage custom orders | `orders.manage` | RLS on `custom_orders`, `custom_order_status_history` |
| Edit production records | `production.edit` | RLS on `production_plans`, `production_actuals` |
| Export data (Excel/PDF) | `data.export` | Checked client-side to show/hide the export buttons (`PermissionGate` in `Reports.jsx`) — exports run entirely in the browser against data the user's own RLS already allowed them to read, so there's no separate server call to gate |

## How an override actually takes effect

```
has_permission('bills.refund') for user U
  = TRUE                                             if U.is_owner
  = user_permission_overrides row for (U, 'bills.refund'), if one exists
  = role_template_permissions default for U's template, otherwise
  = FALSE                                             if none of the above match
```

This lives in one place — the `has_permission()` SQL function — and every RLS policy and trigger in the project calls it. Change the rule once, and it's correct everywhere, including for direct REST API calls that never go through the React app at all.

## Anti-privilege-escalation rule

A person holding `staff.manage` (e.g. a delegated Branch Manager who isn't the Owner) can edit *other* non-owner staff's permission overrides, but the RLS policy on `user_permission_overrides` specifically blocks two things even for them:

- editing **their own** overrides, and
- editing **the Owner's** row.

Only `is_owner()` can do either. Without this, a manager with staff-management rights could quietly grant themselves (or another manager) more access than the Owner intended — the matrix would still say "beyond a default template," but the person doing the granting and the person receiving the grant would be the same, which defeats the point of an approval boundary. This is a deliberate addition beyond what the brief specified, worth knowing about since it means even the Owner can't casually delegate "grant permissions" as a checkbox without it — the Owner remains the one who can touch the top of the tree.

## Where to look at implementation time

- Master permission list + role template defaults: `supabase/seed.sql`
- The three functions everything is built from: `supabase/migrations/0004_permission_functions.sql`
- Every RLS policy, table by table: `supabase/migrations/0005_rls_policies.sql`
- The Admin Panel matrix UI (per-user override toggles): `frontend/src/pages/admin/Staff.jsx`
