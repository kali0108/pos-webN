# Security Overview

No software is "unhackable" — anyone who promises that is either wrong or lying. What's realistic, and what this document covers, is *defense in depth*: several independent layers, so that one mistake doesn't become a full breach. Here's what's actually true about this system, verified rather than assumed.

## What's already enforced, and tested

- **Every table has Row-Level Security.** Not just "checked in the UI" — verified directly against Postgres, logged in as different simulated users, confirming a cashier's token literally cannot read another branch's data or perform an action their permissions don't allow, even calling the API directly (see the test methodology described throughout this project's build).
- **Passwords are hashed by Supabase Auth (bcrypt with a random salt per user)** — nobody, including the Owner, the developer, or anyone with database access, can ever see a user's actual password. "Resetting" a password only ever sets a new one; there's no way to retrieve an old one, by design.
- **Anti-privilege-escalation rule**: a delegated (non-Owner) staff.manage holder can grant/revoke permissions for other staff, but cannot touch their own permissions or the Owner's — verified in the test suite. **The Owner's profile itself is now hidden entirely from non-Owner users** (`0018_hide_owner_profile.sql`) — a delegated manager can't see or edit the Owner's account at all, at the database level, not just hidden in the UI.
- **Deletion is guarded at the database level, not just the UI**: branches, products, and staff can be permanently deleted, but only when they have no real business history — every foreign key representing an actual transaction (invoices, refunds, production records, stock movements) blocks the delete outright, regardless of who's asking or which code path tries it. The one genuinely destructive bulk action, `reset_all_business_data()` (Danger Zone), is hard-restricted to `is_owner()` with no exceptions — not even a delegated staff.manage holder — and requires typing an exact confirmation phrase, verified server-side, not just client-side.
- **Session idle timeout** (15 minutes of no activity) on shared branch computers, and each browser tab keeps an independent session (one person logging in elsewhere never silently affects another tab).
- **The service-role key never reaches the browser.** It's only used inside the two Edge Functions (`create-staff-user`, `update-staff-password`), which each independently re-check the caller's permission via the same `has_permission()` function RLS uses everywhere else — a stolen anon key alone can't create accounts or reset passwords.
- **Comprehensive activity log** (this update): every meaningful action across the app — branch changes, staff changes, permission changes, product/inventory changes, discount rules, custom orders, production records, bulk imports, billing — is recorded with who, when, and the specific details of what changed. Writable only through `log_activity()`, never a direct table insert, so an entry can't be forged as someone else. Visible only to the Owner and anyone with `staff.manage` — a regular cashier or manager cannot see the activity log at all (the page is permission-gated, and RLS independently restricts a non-`staff.manage` user to only their *own* log entries even via a direct API call).
- **HTTPS enforced** in every deployment path this project documents (Netlify, Vercel, Hostinger's `.htaccess`, and the self-hosted VPS's Caddy config all force HTTP → HTTPS).

## Hardened in this pass

- **Minimum password length raised from 6 to 8 characters**, enforced both in the UI and inside the Edge Function itself (never trust client-side validation alone — the server checks too).
- **Activity logging extended** to cover branches, staff edits, permission/branch-access changes, products, discount rules, inventory adjustments, custom orders, production records, and bulk imports — previously only billing and staff creation were logged, which is what let a manager's "added a branch" action go unrecorded.

## Recommended (needs a decision from you, the Owner — these aren't code changes)

- **Enable "Prevent use of leaked passwords"** — Supabase Dashboard → Authentication → Passwords. This checks new passwords against HaveIBeenPwned's breach database (privacy-preserving — only a partial hash prefix is ever sent, never the password itself). **Only available on Supabase's Pro plan and above**, not the Free tier — if you're still on Free, the 8-character minimum above is the practical stopgap until you upgrade.
- **Enable Multi-Factor Authentication** for the Owner account at minimum (Supabase Dashboard → Authentication → MFA) — the single account with unrestricted access is the highest-value target for anyone trying to compromise the system.
- **Rotate the Supabase service-role key and JWT secret** if you ever suspect they've been exposed (e.g., accidentally committed to a public GitHub repo) — Project Settings → API. This is a "break glass" action, not routine.
- **Review the activity log periodically**, not just when something already looks wrong — the earliest sign of a compromised account is often unusual activity (permission changes at odd hours, a flurry of refunds, etc.), and the log is only useful if someone actually looks at it.

## What "secure" doesn't mean

Being realistic matters more than sounding reassuring:
- If the Owner's own password is weak or reused from another breached site, no amount of RLS protects the business — the Owner account is intentionally unrestricted, which is powerful and also the biggest single point of risk. Guard it accordingly (strong unique password, MFA).
- A phishing email that tricks a staff member into typing their password into a fake login page defeats all of the above — this is a training/awareness problem, not a code problem, and no system can fully code its way out of it.
- Self-hosting the backend (see `docs/DEPLOYMENT_HOSTINGER_VPS.md`) moves responsibility for OS patching, firewall rules, and Docker image updates onto you — the managed Supabase Cloud path has Supabase's own security team handling that layer instead.
