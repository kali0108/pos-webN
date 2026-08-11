# Bakery POS — Multi-Branch, Free-Tier Architecture

A browser-based Point of Sale system for a multi-branch bakery: centralized branch/staff administration, a granular per-user permissions matrix enforced at the database level, and short offline tolerance for billing — built entirely on free/open-source components. See the brief this implements in full at the top of the project conversation, and the point-by-point trade-offs in `docs/`.

## What's here

```
bakery-pos/
├── frontend/            React + Vite PWA (the app every branch uses in a browser)
├── supabase/
│   ├── migrations/       Full SQL schema + RLS policies, numbered and idempotent-safe
│   ├── seed.sql           Starter role templates and permission defaults
│   └── functions/         Edge Functions (creating staff logins, resetting passwords)
└── docs/
    ├── ARCHITECTURE.md         Stack justification, system diagram, offline sync design
    ├── DATABASE_SCHEMA.md      Table-by-table schema outline
    ├── PERMISSIONS_MATRIX.md   Brief's permission list → actual RLS policies
    ├── DEPLOYMENT_GUIDE.md     Step-by-step to a live URL (Netlify + managed Supabase)
    ├── DEPLOYMENT_HOSTINGER.md Step-by-step to a live URL (Hostinger frontend + managed Supabase)
    ├── DEPLOYMENT_HOSTINGER_VPS.md  Fully self-hosted: backend AND frontend both on a Hostinger VPS
    ├── DEPLOYMENT_VERCEL.md    Step-by-step to a live URL (Vercel + managed Supabase)
    ├── CLIENT_HANDOVER.md      Checklist for handing this off to the actual business owner
    ├── GETTING_STARTED_FOR_OWNERS.md  Plain-language guide to leave with a non-technical client
    ├── TAX_COMPLIANCE.md       Honest scope note on FBR/ZATCA-style government e-invoicing
    └── FREE_TIER_LIMITS.md     Real numbers + the backup strategy the free tier needs
```

## Quick start (local development)

```bash
# 1. Backend: create a free Supabase project, then:
supabase link --project-ref YOUR-PROJECT-REF
supabase db push
supabase db execute --file supabase/seed.sql
supabase functions deploy create-staff-user
supabase functions deploy update-staff-password

# 2. Frontend:
cd frontend
npm install
cp .env.example .env.local     # fill in your Supabase project URL + anon key
npm run dev                    # → http://localhost:5173
```

Full first-time setup (bootstrapping the Owner account, deploying the Edge Functions, going live) is in `docs/DEPLOYMENT_GUIDE.md` (Netlify) or `docs/DEPLOYMENT_HOSTINGER.md` (Hostinger).

## What's fully implemented vs. a scaffold

Built out and working end to end, because these are the parts the brief calls out as needing to actually function, not just be planned:

- **Login + the full permission system** — role templates, per-user overrides, enforced by real Row-Level Security (try it: log in as a Cashier-template user and the Refund button simply isn't there, *and* a direct API call attempting a refund is rejected by Postgres, not just hidden by the UI).
- **Offline billing** — the IndexedDB queue, the conflict-free per-branch invoice numbering, and the auto-sync-on-reconnect described in `ARCHITECTURE.md §3`.
- **Self-service branch management**, staff creation with branch assignment, and the permissions matrix UI.
- **Product catalog management** (Admin → Products), with a real category manager (add/rename/delete) — new products auto-provision a zero-stock row at every branch.
- **Multi-country tax and currency** — each branch has its own tax rate/label and currency (Pakistan Sales Tax in PKR, Saudi Arabia VAT in SAR, or any future country — no code change needed), applied automatically on every bill. Cashiers see the tax on the bill; only Owner/Manager (the `bills.tax` permission) can override it per sale. See `docs/TAX_COMPLIANCE.md` for what this does and doesn't cover regarding government e-invoicing (FBR, ZATCA, etc.).
- **Bulk import/export** (Admin → Import/Export) — bring in a product catalog or stock levels from a spreadsheet instead of typing everything by hand, with a downloadable template, clear per-row error reporting, and duplicate-SKU protection; export products, inventory, or customers back out to Excel any time.
- **Live updates across tabs and users** — changes to branches, staff, permissions, stock, bills, custom orders, and the product catalog now show up automatically for everyone else, without a manual refresh (Supabase Realtime).
- **Staff editing and password resets** — an Edit action per staff member (name, role template, and a "set new password" field with a show/hide toggle), backed by a second Edge Function since only the Admin API can change another user's password.
- **Tax** — its own permission (`bills.tax`, allow/deny per user exactly like discounts), a Tax % field on the Billing screen, included in the total and on the printed receipt.
- **New-branch stock fix** — creating a branch now auto-provisions a zero-stock row for every existing product (mirroring what already happened for new products at existing branches). Previously a brand-new branch had no stock rows at all, so Inventory had nothing to adjust and every item showed as out of stock on Billing — a one-click "Add any missing products to this branch" button on Inventory also backfills any branch created before this fix.
- **Availability page** — a product × branch matrix so anyone can check what's in stock at *any* branch without switching the branch selector.
- **Refunds** — a proper Refund action on the Bills page (this was previously a database table with no UI at all).
- **Bill printing and bill history** — every completed bill can be printed (or saved as PDF via the browser's print dialog) right after checkout, and the Bills page lets you find and reprint any past invoice, any time.
- **On-screen calculator and cash/change calculation** on the Billing screen.
- **Stock-aware billing** — Billing shows live stock per item and blocks adding anything with zero stock; Inventory supports typed keyboard quantity entry (not just click-by-click); the offline cache is branch-scoped so switching branches offline never shows another branch's stale numbers.
- **Barcode/QR scanning** — a dedicated scan field for physical USB/Bluetooth barcode scanners (keyboard-emulation style, works with no setup), plus a camera-based scanner using the browser's native `BarcodeDetector` API (Chrome/Edge, no extra library).
- **Activity log**, **PWA installability**, **auto-updating service worker**.

Wired to the real schema and RLS, with a working but intentionally simpler UI (clear extension points, not stubs — the tables, policies, and triggers behind them are complete):

- Inventory (branch + consolidated view, low-stock alerts, manual adjustment)
- Custom orders (create, status progression, deposit tracking)
- Production tracking (plan vs. actual, wastage, auto raw-material deduction)
- Reports (daily/company-wide sales, chart, Excel/PDF export)

If you extend any of these, the pattern is consistent throughout: a Supabase query gated by permission + branch, same as every other page.

## Reliability pass

Beyond features, this codebase has been through a dedicated bug-hunting pass: every write operation now checks and surfaces errors instead of failing silently, the full migration chain (0001–0013) has been verified end to end against a real Postgres with RLS actually simulating different logged-in users (not just checked for SQL syntax), and a real cross-origin bug was found and fixed — Supabase Edge Functions don't get CORS headers automatically (confirmed against current Supabase docs), so `create-staff-user` and `update-staff-password` would have silently failed the moment the frontend was served from a different domain than the Supabase project itself, exactly the situation a Hostinger move creates. Both now handle CORS correctly via `supabase/functions/_shared/cors.ts`.

## The one flagged deviation from the cost constraint

None in the backend. Every layer — frontend framework, database, auth, charts, Excel/PDF export — is free/open-source at this project's scale (see `docs/ARCHITECTURE.md §1` for the full table and trade-offs). If you're hosting the frontend on Hostinger rather than the free Netlify path this project was originally written for, that's a paid-hosting choice you're making deliberately (see `docs/DEPLOYMENT_HOSTINGER.md`) — it doesn't change anything about the backend's cost. The single feature the brief itself flags as commonly needing a paid API — WhatsApp/SMS notifications to customers — is **not implemented**, on purpose; the free fallback is a `wa.me` link that opens WhatsApp Web/App with a pre-filled message for staff to send manually.
