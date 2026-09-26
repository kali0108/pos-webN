# Deployment Guide

Everything below uses free tiers only, and takes roughly 30–45 minutes end to end for someone doing it the first time. No dedicated DevOps person is needed — this is a one-time setup, then ongoing changes are just `git push`.

## Prerequisites

- A GitHub (or GitLab) account, to hold the code and connect Netlify's auto-deploy.
- A Supabase account (free) — [supabase.com](https://supabase.com).
- A Netlify account (free) — [netlify.com](https://netlify.com).
- Node.js 18+ installed locally (only needed once, to install the Supabase CLI and run the frontend locally if you want to preview before deploying).
- A registered domain name, if you want `pos.yourbakery.com` instead of the default `*.netlify.app` address — this is the one expected recurring cost in the whole stack.

## Part 1 — Create the Supabase project (the backend)

1. In the Supabase dashboard, click **New project**. Choose a name, a database password (save it somewhere safe — you'll need it for backups), and a region close to your branches.
2. Wait for provisioning (~2 minutes).
3. Note two values from **Project Settings → API**: the **Project URL** and the **anon public key** (Supabase's dashboard may label these "Publishable key" under its newer key-naming; both the legacy `anon` key and the newer publishable key work the same way for this app — use whichever the dashboard shows you as the client-safe key). You'll need both for the frontend's `.env`.

## Part 2 — Apply the database schema

Using the Supabase CLI (recommended, keeps schema changes versioned in git):

```bash
npm install -g supabase
supabase login
cd bakery-pos
supabase link --project-ref YOUR-PROJECT-REF   # found in your project's dashboard URL
supabase db push                                # applies every file in supabase/migrations/, in order
```

Then load the starter role templates and default permissions:

```bash
supabase db execute --file supabase/seed.sql
```

*(No CLI installed? Every file in `supabase/migrations/`, in numeric order, followed by `supabase/seed.sql`, can instead be pasted one at a time into Supabase Dashboard → SQL Editor → New query → Run.)*

## Part 3 — Create the first Owner account

The very first login can't be created by SQL alone (it has to exist in Supabase Auth first):

1. Dashboard → **Authentication → Users → Add user**. Enter the Owner's email and a password.
2. Dashboard → **SQL Editor**, run:
   ```sql
   update profiles set is_owner = true, is_active = true where email = 'owner@yourbakery.com';
   ```
3. That's it — every other staff account from now on is created *inside the app* by this Owner (Admin → Staff → New staff account), not through the Supabase dashboard.

## Part 4 — Deploy the Edge Functions

```bash
supabase functions deploy create-staff-user
supabase functions deploy update-staff-password
supabase functions deploy delete-staff-user
```

No secrets to configure manually — `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the platform into every Edge Function.

## Part 5 — Push the code to GitHub

```bash
cd bakery-pos
git init
git add .
git commit -m "Initial bakery POS scaffold"
git branch -M main
git remote add origin https://github.com/YOUR-ORG/bakery-pos.git
git push -u origin main
```

## Part 6 — Deploy the frontend to Netlify

*(Hosting somewhere else instead — e.g. Hostinger? Skip to `docs/DEPLOYMENT_HOSTINGER.md` for Part 6 onward; Parts 1–4 above are identical either way.)*

1. Netlify dashboard → **Add new site → Import an existing project → GitHub**, pick your repo.
2. Build settings:
   - **Base directory:** `frontend`
   - **Build command:** `npm run build`
   - **Publish directory:** `frontend/dist`
3. Before the first deploy, add environment variables (**Site configuration → Environment variables**):
   - `VITE_SUPABASE_URL` = your Project URL from Part 1
   - `VITE_SUPABASE_ANON_KEY` = your anon/publishable key from Part 1
4. Click **Deploy**. After the build finishes (a minute or two), Netlify gives you a live `https://your-site-name.netlify.app` URL — this is the "publicly accessible URL" every branch will use.
5. *(Optional)* **Domain settings → Add a custom domain** to point your registered domain at the site, and Netlify provisions free HTTPS for it automatically via Let's Encrypt.

From this point on, **every future `git push` to `main` redeploys automatically** — this is what makes "updates instantly for every branch" true: there's no manual step per branch, ever. The service worker (`vite-plugin-pwa`, configured `autoUpdate`) picks up the new build and swaps it in the next time each branch's browser checks, with no install step.

## Part 7 — First-time setup inside the app

1. Open the live URL, sign in as the Owner (Part 3's credentials).
2. **Admin → Branches** — add your first real branch (this is also where you'd add branch #2, #3, etc. later — no redeploy needed).
3. **Admin → Staff & Permissions** — create staff logins, assign them to branches, pick a role template as a starting point, and adjust the permission matrix per person as needed.
4. **Admin → Products** — add your item catalog directly in the app (SKU, category, unit vs. weight pricing, selling price, optional cost price for margin reports). New products automatically get a zero-stock row at every active branch, so they show up in Inventory right away for staff to adjust.
5. Hand a laptop to a branch, open the URL, log in, and start billing.

## Verifying the offline behavior

A quick way to see the offline-tolerance requirement working: with the app open and signed in, turn off Wi-Fi (or use your browser's dev tools → Network → "Offline"), create and complete a bill. The header badge switches to "Offline · 1 bill(s) queued," and the bill is sitting safely in IndexedDB. Turn the network back on — within seconds the badge switches to "Syncing…" then back to "Online," and the bill now has a real server-assigned invoice number.

## Ongoing maintenance (no dedicated DevOps needed)

- **Schema changes:** add a new numbered file to `supabase/migrations/`, run `supabase db push`, commit it.
- **App changes:** normal `git push` — Netlify rebuilds and every branch gets the update automatically.
- **Backups:** see `docs/FREE_TIER_LIMITS.md` for the free nightly-backup workflow — set this up once, early, and forget about it.
- **Monitoring free-tier usage:** Supabase and Netlify both email you as you approach your plan's limits; no separate monitoring tooling needed at this scale.
