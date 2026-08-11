# Deploying the Frontend to Vercel

The backend (Supabase) doesn't change for this — everything in `docs/DEPLOYMENT_GUIDE.md` Parts 1–4 (schema, Owner account, Edge Functions) still applies exactly as written, on the managed Supabase Cloud free tier. This document only replaces Part 6 (where the frontend lives), swapping Netlify for Vercel. If you want the *backend* self-hosted too, see `docs/DEPLOYMENT_HOSTINGER_VPS.md` instead — Vercel and self-hosting aren't mutually exclusive (Vercel could serve the frontend while Supabase runs on your own VPS), but that's a more advanced combination; this guide assumes the common case of Vercel (frontend) + managed Supabase (backend).

Vercel is built specifically for exactly this kind of app (a Vite/React static build), so this is the most hands-off of the three hosting guides in this project — no `.htaccess`, no VPS to patch, deploys finish in under a minute.
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
```

No secrets to configure manually — `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by the platform into every Edge Function.

## Part 5 — Push the code to GitHub

## Part 6 — Push the code to GitHub

```bash
cd bakery-pos
git init
git add .
git commit -m "Initial bakery POS scaffold"
git branch -M main
git remote add origin https://github.com/YOUR-ORG/bakery-pos.git
git push -u origin main
```

*(Skip this if the repo already exists — just make sure the latest code, including `frontend/vercel.json`, is pushed.)*

## Part 7 — Import the project into Vercel

1. [vercel.com](https://vercel.com) → **Add New → Project** → **Import** your GitHub repository (authorize Vercel's GitHub App the first time).
2. Vercel auto-detects the framework once you point it at the right folder — set:
   - **Root Directory:** `frontend` (this repo has the actual app in a subfolder, not the repo root — this is the one setting that's easy to miss)
   - **Framework Preset:** Vite (should auto-select once Root Directory is set correctly)
   - **Build Command:** `npm run build` (default, leave as-is)
   - **Output Directory:** `dist` (default, leave as-is)
3. **Environment Variables** — add both, for the **Production** environment (and Preview, if you want preview deployments to also work against your real Supabase project):
   - `VITE_SUPABASE_URL` = your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` = your Supabase anon/publishable key
4. **Deploy.** Vercel builds and gives you a live `https://your-project.vercel.app` URL, usually within a minute.

From here on, **every `git push` to `main` redeploys automatically** — every other branch/PR gets its own free preview URL, which is a nice bonus for testing a change before it goes live to real branches.

## Part 8 — Custom domain (optional)

**Vercel Dashboard → your project → Settings → Domains** → add `pos.yourbakery.com` (or whichever domain you want). Vercel shows you the exact DNS record to add at your domain registrar; once that record resolves, Vercel provisions free HTTPS automatically — no separate certificate step.

## Part 9 — Why `frontend/vercel.json` matters

This project includes `frontend/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/(index.html|sw.js|registerSW.js|manifest.webmanifest)",
      "headers": [{ "key": "Cache-Control", "value": "no-cache, must-revalidate" }]
    },
    {
      "source": "/assets/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    }
  ]
}
```

Without the `rewrites` rule, refreshing the browser on any route other than `/` (e.g. `/billing`, `/admin/staff`) returns Vercel's 404 page — Vercel serves real files directly (so `/assets/*.js` and friends work fine untouched), but a client-side route like `/billing` isn't a real file, so it needs to fall back to `index.html` and let React Router take over. The `headers` rule is what keeps the PWA's "every branch updates automatically" promise true on Vercel specifically: `index.html` and the service worker are marked non-cacheable so every visit checks for the latest build, while the hashed files under `/assets/` (which get a new filename on every build) are safe to cache aggressively forever.

## Verifying the deploy

- App loads at the Vercel URL (or custom domain).
- Refreshing `/billing` doesn't 404 (confirms the rewrite rule took effect).
- Signing in works (confirms the environment variables were picked up at build time — if this fails, double check they're set for the **Production** environment specifically, not just Preview/Development).
- Creating a staff account works (confirms the Edge Function + CORS setup from `supabase/functions/` is reachable from the new domain).
- "Add to Home Screen" / the install icon in the browser's address bar appears (confirms the PWA manifest and service worker).

## Updating after this point

Just `git push`. No manual redeploy step, no file upload — this is the main advantage of Vercel over the Hostinger manual-upload path. If you ever add a new Supabase migration, that still needs to be run once in the Supabase SQL Editor (Vercel only redeploys the frontend, it has no idea the database exists).
