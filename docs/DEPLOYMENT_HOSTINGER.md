# Deploying to Hostinger

The backend (Supabase) doesn't change at all for this — everything in `docs/DEPLOYMENT_GUIDE.md` Parts 1–4 (schema, Owner account, Edge Functions) still applies exactly as written. This document only replaces **Part 6 (frontend hosting)**, swapping Netlify for Hostinger, while the backend stays on managed Supabase Cloud (free tier).

**Want the backend on Hostinger too, not just the frontend?** See `docs/DEPLOYMENT_HOSTINGER_VPS.md` instead — that's the fully self-hosted path (Supabase itself running on a Hostinger VPS you control), recommended if you specifically need the database on infrastructure you own rather than a managed third-party service.

**Worth knowing up front:** the rest of this project is built entirely on free-tier services by design (see `docs/ARCHITECTURE.md` and `docs/FREE_TIER_LIMITS.md`). Hostinger is a paid host — this guide assumes that's a deliberate choice (e.g. hosting you already pay for), not a cost-saving move. The backend stays exactly as free as before either way; only where the frontend *files* live changes.

## Which Hostinger plan you're on decides the method

| Plan | Method | Auto-deploy on `git push`? |
|---|---|---|
| Business Web Hosting or any Cloud plan | **Method A** — Hostinger's "Web App" panel, connected directly to your GitHub repo | Yes, built in |
| Any plan, including cheapest Shared/Premium | **Method B** — build locally, upload the static files | No, manual re-upload — or set up the optional GitHub Actions workflow below for auto-deploy anyway |

This app is a **static site** after `npm run build` (plain HTML/CSS/JS, no server-side process) — it isn't a persistent Node.js server. Hostinger's own documentation is explicit that static front-end apps built with Vite/React don't run a server process; they're just served as files. That's true of both methods below — Method A just automates the build-and-upload step for you.

---

## Method A — Business/Cloud plans: GitHub-connected, auto-deploying

1. **hPanel → Websites → your site → Web App** (or **Setup Node.js App**, depending on hPanel's current labeling).
2. Choose **Deploy from GitHub**, authorize Hostinger's GitHub App, and pick this repository.
3. When Hostinger asks for framework/build settings (it usually auto-detects Vite, but confirm):
   - **Root directory:** `frontend`
   - **Build command:** `npm install && npm run build`
   - **Output / publish directory:** `dist`
4. **Environment variables** — add these two in the Web App's environment variables section:
   - `VITE_SUPABASE_URL` = your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` = your Supabase anon/publishable key

   These get baked into the build (see "Why env vars must be set at build time" below) — they must be set here, not just in a local `.env` file, since Hostinger runs the build itself.
5. Deploy. Hostinger builds the app and serves the `dist` output.
6. From now on, **every `git push` to your connected branch redeploys automatically** — same behavior as the Netlify setup this project was originally written for.
7. Copy `frontend/public/.htaccess` into the site's document root if Hostinger's Node.js App hosting doesn't already generate SPA-routing rules for you (check by refreshing a route like `/billing` directly — if it 404s, the `.htaccess` is missing).

---

## Method B — Any plan: build locally, upload the static files

### 1. Build the app with your real Supabase credentials

Vite environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) are **compiled into the JavaScript at build time**, not read at runtime — unlike Netlify or Hostinger's Method A, nothing on a plain static host runs your build for you, so you build it yourself, locally, with the right values already in place:

```bash
cd frontend
npm install
cp .env.example .env.local
# edit .env.local: fill in your real Supabase project URL + anon key
npm run build
```

This produces `frontend/dist/` — this folder's *contents* (not the folder itself) are what gets uploaded.

### 2. Create the destination on Hostinger

In hPanel, either:
- Point your domain directly at `public_html`, or
- **Recommended:** create a subdomain (e.g. `pos.yourbakery.com`) via **hPanel → Domains → Subdomains** — this gives the app its own clean document root (e.g. `public_html/pos/`) without interfering with anything else on the main domain, and it's free.

### 3. Upload

Using **hPanel → Files → File Manager** (or an FTP client with the credentials from **hPanel → Files → FTP Accounts**):
- Upload every file **inside** `frontend/dist/` (not the `dist` folder itself) into the destination folder (`public_html` or your subdomain's folder).
- Confirm `.htaccess` made the trip — File Manager sometimes hides dotfiles by default; toggle "Show hidden files" if you don't see it, and upload it explicitly if it's missing (it's in `frontend/dist/.htaccess` after the build, sourced from `frontend/public/.htaccess`).

### 4. Enable HTTPS

**hPanel → Security → SSL** — Hostinger issues a free SSL certificate (Let's Encrypt) for the domain/subdomain; enable it if it isn't already. The `.htaccess` included with this project force-redirects HTTP → HTTPS once SSL is on.

### 5. Redeploying after future changes (manual)

Repeat step 1 (rebuild) and step 3 (re-upload) — replace all files in the destination folder with the new `dist/` contents. There's no `git push`-triggered auto-deploy on this path unless you set up the workflow below.

---

## Optional: auto-deploy on `git push` for Method B (any plan)

If you're on a Shared/Premium plan but still want the "push and it's live" convenience, a free GitHub Actions workflow can build the app and FTP-upload it automatically on every push — no Hostinger plan upgrade needed.

1. **hPanel → Files → FTP Accounts** — note the FTP host, username, and password (or create a dedicated FTP account for this).
2. In your GitHub repo, add three **Actions secrets** (Settings → Secrets and variables → Actions): `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`. Also add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` there — the workflow needs them to build.
3. Add this workflow file:

```yaml
# .github/workflows/deploy-hostinger.yml
name: Deploy to Hostinger
on:
  push:
    branches: [main]
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install and build
        working-directory: frontend
        run: |
          npm install
          npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
      - name: Upload via FTP
        uses: SamKirkland/FTP-Deploy-Action@v4.3.5
        with:
          server: ${{ secrets.FTP_SERVER }}
          username: ${{ secrets.FTP_USERNAME }}
          password: ${{ secrets.FTP_PASSWORD }}
          local-dir: ./frontend/dist/
          server-dir: ./public_html/   # or ./public_html/pos/ for a subdomain folder
```

Push to `main`, and this builds + uploads automatically, same end result as Method A.

---

## After deploying, either method

1. **Supabase Dashboard → Authentication → URL Configuration** — update **Site URL** to your new Hostinger domain (e.g. `https://pos.yourbakery.com`). This is what password-reset and other auth emails link back to; leaving it pointed at an old domain would send staff to the wrong place if that feature is ever used.
2. Open the live URL and confirm:
   - The app loads at all (confirms static files + `.htaccess` MIME/routing are correct).
   - Refreshing a non-root route like `/billing` doesn't 404 (confirms SPA fallback routing works).
   - Signing in works (confirms `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` were baked in correctly at build time).
   - The browser padlock shows a valid certificate (confirms SSL).
3. **"Add to Home Screen"** on a phone or **install icon** in Chrome/Edge's address bar on desktop — confirms the PWA manifest and service worker are being served correctly.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Blank white page, console shows a Supabase URL error | `.env.local` wasn't filled in before `npm run build` (Method B) — env vars are baked in at build time, so this needs a rebuild + re-upload, not a config change after the fact |
| Refreshing `/billing` or any non-root route shows a 404 | `.htaccess` is missing from the upload, or `mod_rewrite` isn't enabled (rare on Hostinger, but check **hPanel → Advanced → PHP Configuration**-adjacent Apache settings if it persists) |
| App loads but login fails with a network/CORS-looking error | Usually not actually CORS — Supabase's Data API allows any origin by default for anon-key requests. Double check the anon key and project URL are correct and the Supabase project isn't paused (**Supabase Dashboard**, resume if so) |
| A new deploy doesn't show up for a branch that already had the app open | Expected for up to one hour on the *very* old build (the service worker's periodic update check), but a hard refresh (Ctrl/Cmd+Shift+R) always picks it up immediately |
