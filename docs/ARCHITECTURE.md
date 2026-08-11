# Architecture

## 1. Stack, and why, including free-tier trade-offs

| Layer | Choice | Why | Free-tier trade-off |
|---|---|---|---|
| Frontend | React 18 + Vite, deployed as a PWA | Open-source; Vite gives fast builds and first-class PWA tooling via `vite-plugin-pwa` (Workbox under the hood) | None — the framework itself has no usage limits, only the host does |
| Hosting (frontend) | Netlify Free | Static hosting explicitly permits commercial projects; deploys straight from a git push | As of Netlify's 2026 credit-based model, the Free plan is 300 credits/month shared across deploys (15 credits each), bandwidth (20 credits/GB), compute (10 credits/GB-hour) and web requests (2 credits/10K) — comfortable for a small internal tool with a handful of branches and infrequent deploys, but worth watching (see `FREE_TIER_LIMITS.md`); the site pauses for the rest of the month if the allowance runs out, it doesn't silently bill you |
| Backend | Supabase (managed Postgres + Auth + auto REST API + Edge Functions + Storage) | One free-tier product covers database, auth, API, file storage and serverless functions, so there's no separate service to wire together or pay for | Free project pauses after 7 days with zero API requests (resume manually from the dashboard, ~1 min); 500 MB database, 1 GB file storage, 5 GB egress/mo, no point-in-time recovery/automatic backups — see `FREE_TIER_LIMITS.md` for what that means day to day and the backup workaround. Also: as of May 2026, new Supabase projects require explicit `GRANT` statements before a table is reachable through the Data API — already handled for you in `supabase/migrations/0009_data_api_grants.sql` |
| Database | Postgres (via Supabase) | Real relational integrity (foreign keys, transactions) for money and stock data, plus native Row-Level Security — exactly what the permissions matrix needs enforced server-side | Same 500 MB cap as above; a multi-branch bakery's transactional data (bills, stock, staff) is text/numbers, not media, so this comfortably lasts years before an upgrade is needed |
| Auth | Supabase Auth | Built into the same free project; handles password hashing, sessions, password reset emails | Free tier's built-in email sender is rate-limited (a few emails/hour) — fine for staff-account resets at bakery scale; if it's ever too slow, point Supabase at a free-tier transactional email provider (e.g. Resend's free plan) instead of paying for anything |
| File storage | Supabase Storage | Same project, same free tier, for cake reference photos | 1 GB free — thousands of compressed photos before this matters |
| Charts | Chart.js (via `react-chartjs-2`) | Open-source, no API key, no usage cap | — |
| Excel export | SheetJS (`xlsx`) | Open-source, generates `.xlsx` entirely client-side | — |
| PDF export | jsPDF + `jspdf-autotable` | Open-source, generates PDFs entirely client-side | — |
| Offline cache | Workbox (via `vite-plugin-pwa`) for the app shell, Dexie.js (IndexedDB wrapper) for bakery data | Both open-source, ship in the bundle, no server component | — |

**No paid services are used anywhere in this design.** The one deliberate optional exception called out in the brief — a paid SMS/WhatsApp gateway for customer notifications (e.g. "your cake is ready") — is **not included**. If the Owner wants that later, the free fallback is a `wa.me/<phone>?text=<message>` link the counter staff clicks to open WhatsApp Web/App with the message pre-filled, which costs nothing and requires no API integration.

## 2. System diagram

```
┌────────────────────────────────────────────────────────────────────┐
│  Any laptop, any branch — Chrome/Edge, no install                  │
│                                                                      │
│   React PWA (static bundle, served by Netlify)                     │
│     ├─ Service Worker → precached app shell (loads with no network)│
│     └─ IndexedDB (Dexie) → item cache + offline bill queue         │
└───────────────────────────┬──────────────────────────────────────┘
                             │ HTTPS (only while online)
                             ▼
┌────────────────────────────────────────────────────────────────────┐
│  Supabase project (single free-tier backend)                       │
│                                                                      │
│   Auth            →  login, password reset, session/JWT            │
│   PostgREST API   →  auto-generated REST endpoints, RLS-enforced   │
│   Postgres        →  branches, staff, permissions, bills, stock,   │
│                       production, custom orders, activity log      │
│   Edge Function   →  create-staff-user (the one place the          │
│                       service-role key is ever used)                │
│   Storage         →  cake reference photos                          │
└───────────────────────────┬──────────────────────────────────────┘
                             │ same Auth + RLS as every branch
                             ▼
┌────────────────────────────────────────────────────────────────────┐
│  Owner's Admin dashboard (same PWA, gated by permissions)           │
│   Branch management · Staff & permission matrix · Company-wide     │
│   dashboard with drill-down · Activity log                          │
└────────────────────────────────────────────────────────────────────┘
```

There is deliberately **one backend for every branch** — branches are a row in the `branches` table, not a separate deployment. Onboarding branch #6 is an INSERT from the Admin Panel, not a release.

## 3. Offline sync design (the interesting part)

The brief's hardest requirement is: *keep billing working through a short outage, and never let two branches collide on the same invoice number.* The design that makes both true at once:

1. **A bill is never lost, because it's written to the browser first.** The instant "Complete bill" is pressed, the full bill (header + line items + payments) is written to IndexedDB via Dexie (`frontend/src/lib/localDb.js`) before anything is sent over the network. That local write always succeeds, in well under the 2-second budget, because it never touches the network.
2. **The browser never assigns an invoice number.** It only generates a random `client_ref` (UUID) locally. This is the idempotency key, not a business-meaningful number.
3. **The server assigns the human-readable number, atomically, per branch.** Each branch owns its own counter row (`branch_invoice_counters`). A trigger (`assign_invoice_number()`) increments that row inside the same database transaction as the insert, so Postgres's normal row-locking serializes any two bills that land at the *same* branch at the *same* instant — and two *different* branches never contend at all, since each has an independent counter and its own prefix (e.g. `GRW-000104` vs `LHR-000058`). Two branches can never produce the same invoice number, by construction, not by luck.
4. **Syncing is idempotent, so retries are free.** `invoices` has a unique constraint on `(branch_id, client_ref)`. The `sync_invoice()` RPC upserts on that constraint, so if a sync attempt is interrupted (tab closed, wifi dropped mid-request) and retried, it updates the same row instead of creating a duplicate — and because the invoice number is only assigned on the *first* successful insert, a retried bill keeps the number it already got.
5. **Online path vs. offline path.** If the browser is online, `Billing.jsx` calls `sync_invoice()` directly and shows the real invoice number within about a second. If that call fails or the browser is offline, the bill (already safe in IndexedDB) stays queued; `syncEngine.js` retries automatically on the browser's `online` event and every 20 seconds as a fallback, until it succeeds — with no user action required.
6. **The app shell itself is precached**, so the PWA opens at all even with zero connection — Workbox precaches the compiled JS/CSS/HTML, while IndexedDB (a separate, purpose-built mechanism) handles the actual bakery data. This split is deliberate: generic HTTP response caching isn't a good fit for POST requests that need custom conflict resolution, so business data goes through the Dexie queue instead of Workbox's request cache.

This is the "few minutes of dropped connection" tolerance the brief asks for — not full multi-hour offline operation, which the brief explicitly doesn't require for this version.

## 4. Permission enforcement — defense in depth

Permissions are checked in three places, each one closing a gap the layer above it can't:

1. **UI (`PermissionGate`, sidebar nav)** — hides controls the user can't use, for a clean interface. Convenience only, not security.
2. **RLS policies** (`supabase/migrations/0005_rls_policies.sql`) — the real boundary. Even a direct call to the auto-generated REST API with a valid but under-permissioned token is blocked at the database level.
3. **Triggers** (`enforce_billing_permissions()` etc.) — for cases RLS alone can't express cheaply, like "editing the discount field on an invoice needs a *different* permission than editing the invoice at all."

See `docs/PERMISSIONS_MATRIX.md` for the full mapping from the brief's matrix to actual policies.
