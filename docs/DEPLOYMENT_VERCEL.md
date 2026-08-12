# Deploying the Frontend to Vercel

The backend (Supabase) doesn't change for this — everything in `docs/DEPLOYMENT_GUIDE.md` Parts 1–4 (schema, Owner account, Edge Functions) still applies exactly as written, on the managed Supabase Cloud free tier. This document only replaces Part 6 (where the frontend lives), swapping Netlify for Vercel. If you want the *backend* self-hosted too, see `docs/DEPLOYMENT_HOSTINGER_VPS.md` instead — Vercel and self-hosting aren't mutually exclusive (Vercel could serve the frontend while Supabase runs on your own VPS), but that's a more advanced combination; this guide assumes the common case of Vercel (frontend) + managed Supabase (backend).

Vercel is built specifically for exactly this kind of app (a Vite/React static build), so this is the most hands-off of the three hosting guides in this project — no `.htaccess`, no VPS to patch, deploys finish in under a minute.

## Part 1 — Push the code to GitHub

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

## Part 2 — Import the project into Vercel

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

## Part 3 — Custom domain (optional)

**Vercel Dashboard → your project → Settings → Domains** → add `pos.yourbakery.com` (or whichever domain you want). Vercel shows you the exact DNS record to add at your domain registrar; once that record resolves, Vercel provisions free HTTPS automatically — no separate certificate step.

## Part 4 — Why `frontend/vercel.json` matters

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
