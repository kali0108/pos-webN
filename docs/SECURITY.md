# Security Overview

No software is "unhackable" — anyone who promises that is either wrong or lying. What's realistic, and what this document covers, is *defense in depth*: several independent layers, so that one mistake doesn't become a full breach. Here's what's actually true about this system, verified rather than assumed.

## What's already enforced, and tested

- **Every table has Row-Level Security.** Not just "checked in the UI" — verified directly against Postgres, logged in as different simulated users, confirming a cashier's token literally cannot read another branch's data or perform an action their permissions don't allow, even calling the API directly (see the test methodology described throughout this project's build).
- **Passwords are hashed by Supabase Auth (bcrypt with a random salt per user)** — nobody, including the Owner, the developer, or anyone with database access, can ever see a user's actual password. "Resetting" a password only ever sets a new one; there's no way to retrieve an old one, by design.
- **Anti-privilege-escalation rule**: a delegated (non-Owner) staff.manage holder can grant/revoke permissions for other staff, but cannot touch their own permissions or the Owner's — verified in the test suite. **The Owner's profile itself is now hidden entirely from non-Owner users** (`0018_hide_owner_profile.sql`) — a delegated manager can't see or edit the Owner's account at all, at the database level, not just hidden in the UI.
- **Destructive actions need your password — checked on the server.** Deleting a branch, product or staff login, and the full system reset, all require the acting person to re-enter their own password. It is verified by the database (`bpos_check_password`) or, for staff deletion, by a real sign-in inside the Edge Function — not just a browser prompt that could be skipped by calling the API directly. Wrong attempts are rate-limited (5 per 15 minutes) so a stolen session can't be used to guess the Owner's password. Direct `DELETE` on branches/products is switched off entirely; the password-checked functions are the only way.
- **Deleting never erases history.** Bills, refunds, orders, production and stock records (and the activity log) keep the branch / product / person's name as text, so deleting something removes the thing but not the record of what happened — see the History page. The one exception is the Owner-only full reset, which is exactly meant to wipe everything (it needs the exact phrase **and** the Owner's password, and the Owner's own login is the only one kept).
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
- **Finished bills are final.** Once a bill is completed, re-sending it (which an offline retry does) returns the existing invoice and changes nothing — it can no longer be used to quietly rewrite a sale's amounts after the fact.
- **Internal stock functions are not callable from the browser.** The helper functions that change stock were open to any logged-in user by default; execute rights are now revoked and only the permission-checked billing/refund functions use them.
- **Refunds can't be abused**: you can't return more than was bought, refund more than the bill total, or refund a bill that isn't completed; an exchange needs billing rights as well as refund rights.
- **Corrections are visible, not silent.** Dashboard figures are fixed with an entry in the Expenses & corrections ledger (who, when, why), never by editing a past bill; only the Owner can remove a wrong entry, and that removal is logged.
