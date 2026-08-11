# Deploying to a Hostinger VPS — Backend AND Frontend, Fully Self-Hosted

This is the "real business, full control" deployment: no managed Supabase Cloud, no Netlify — both the database/backend and the frontend run on servers you control, on a Hostinger VPS you pay for directly. Every migration, RLS policy, and Edge Function already built for this project works here completely unchanged — self-hosted Supabase is the exact same open-source software the managed platform runs, just installed on your own machine instead of theirs.

**If you'd rather keep the managed Supabase Cloud (free tier) and only move the frontend to Hostinger**, see `docs/DEPLOYMENT_HOSTINGER.md` instead — much less to operate, and still entirely valid for a real business. This document is for when you specifically want the database itself living on infrastructure you control (useful for data-residency requirements across Pakistan/Saudi Arabia/wherever you expand next, and for having zero dependency on a third party's free-tier limits).

**What you're taking on by choosing this path:** security updates, backups, and uptime become your responsibility instead of Supabase's. This guide covers all three, but it's worth being clear-eyed about the trade-off going in.

---

## Prerequisites

- A **Hostinger VPS** — KVM 2 plan or higher (4 GB RAM minimum per Supabase's own system requirements; 8 GB is more comfortable for a live business). Choose an Ubuntu 24.04 LTS template when creating it.
- A domain name, with **two** DNS A records both pointing at your VPS's IP address:
  - `api.yourbakery.com` → the backend (Supabase)
  - `pos.yourbakery.com` → the frontend (the POS app itself)

  (Any subdomain names work — these are just examples. Using two separate subdomains, both on the same VPS, is simpler to reason about than one domain serving both.)
- SSH access to the VPS (Hostinger's hPanel shows the IP and root password when the VPS is created; **hPanel → VPS → your VPS → SSH access** also lets you upload your own SSH key, recommended over password login).

---

## Part 1 — Basic server setup and hardening

SSH into the VPS as root, then:

```bash
apt update && apt upgrade -y

# A non-root user for day-to-day use
adduser deploy
usermod -aG sudo deploy

# Basic firewall: only SSH, HTTP, HTTPS
apt install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# Block repeated failed SSH login attempts
apt install -y fail2ban
systemctl enable --now fail2ban
```

Log out and back in as `deploy` from here on — avoid staying on root for routine work.

---

## Part 2 — Install self-hosted Supabase

Supabase publishes an official one-command installer for Linux that handles Docker installation, configuration, and secret generation:

```bash
curl -fsSL https://supabase.link/setup.sh | sh
```

This will:
- Install Docker if it isn't already present
- Create a `supabase-project` directory with everything needed
- Prompt you for your URLs — enter them as:
  - `SUPABASE_PUBLIC_URL`: `https://api.yourbakery.com`
  - `API_EXTERNAL_URL`: `https://api.yourbakery.com/auth/v1`
  - `SITE_URL`: `https://pos.yourbakery.com` (your frontend's URL, not the API's)
  - `PROXY_DOMAIN`: `api.yourbakery.com`
- Generate every secret and API key automatically, including a random Studio dashboard password
- Pull the Docker images

*(Inspect the script yourself first if you'd like — it's plain shell, linked from the command above.)*

Start the stack:

```bash
cd supabase-project
sh run.sh start
```

Give it a minute, then confirm everything is healthy:

```bash
docker compose ps
```

Every service should show `Up ... (healthy)`.

**Save your credentials** — `sh run.sh secrets` prints them any time, but copy them somewhere safe now:

```bash
sh run.sh secrets
```

You'll need `SUPABASE_PUBLISHABLE_KEY` (this project's frontend `.env` calls it `VITE_SUPABASE_ANON_KEY` — same kind of key, new name), `SUPABASE_SECRET_KEY` (used only by the Edge Functions, same role the old "service_role key" played), `POSTGRES_PASSWORD`, and the `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` for Studio.

---

## Part 3 — HTTPS

```bash
sh run.sh config add caddy
sh run.sh start
```

Caddy automatically provisions and renews a free Let's Encrypt certificate for `api.yourbakery.com` — zero further configuration. Verify:

```bash
curl -I https://api.yourbakery.com/auth/v1/
```

A `401` response means it's working (Auth is up and correctly requiring a key — that's expected here, not an error).

---

## Part 4 — Apply this project's schema

Open **Studio** at `https://api.yourbakery.com` (or the server IP on port 8000 if you haven't set up HTTPS yet) and log in with the `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` from Part 2. This is the *exact same Studio interface* the managed cloud dashboard uses.

From here, the process is identical to `docs/DEPLOYMENT_GUIDE.md` Parts 2–3:

1. **SQL Editor** → run every file in `supabase/migrations/`, in numeric order (0001 through the latest), then `supabase/seed.sql`.
2. **Authentication → Users → Add user** to create the Owner's login, then in SQL Editor:
   ```sql
   update profiles set is_owner = true, is_active = true where email = 'owner@yourbakery.com';
   ```

Nothing about the migrations themselves changes — same RLS policies, same triggers, same permission system, running on the same Postgres engine.

---

## Part 5 — Deploy the Edge Functions

Self-hosted Edge Functions live as files on the server rather than being deployed via the Supabase CLI to the cloud. From your `supabase-project` directory:

```bash
mkdir -p volumes/functions/create-staff-user
mkdir -p volumes/functions/update-staff-password
mkdir -p volumes/functions/_shared
```

Copy the three files from this project's `supabase/functions/` folder to the matching paths above (`scp` from your own machine, or paste the contents directly on the server with `nano`):

- `supabase/functions/create-staff-user/index.ts` → `volumes/functions/create-staff-user/index.ts`
- `supabase/functions/update-staff-password/index.ts` → `volumes/functions/update-staff-password/index.ts`
- `supabase/functions/_shared/cors.ts` → `volumes/functions/_shared/cors.ts`

Then pick up the new functions:

```bash
sh run.sh restart functions
```

Test one:

```bash
curl https://api.yourbakery.com/functions/v1/create-staff-user
# An auth-related error response here is expected (no token supplied) —
# it confirms the function is reachable, which is what this checks.
```

---

## Part 6 — Host the frontend on the same VPS

Build the app locally with your self-hosted project's URL and key:

```bash
cd frontend
npm install
cp .env.example .env.local
```

Edit `.env.local`:
```
VITE_SUPABASE_URL=https://api.yourbakery.com
VITE_SUPABASE_ANON_KEY=<the SUPABASE_PUBLISHABLE_KEY from Part 2>
```

```bash
npm run build
```

Upload the contents of `frontend/dist/` to the server (from your own machine):

```bash
scp -r frontend/dist/* deploy@<your-vps-ip>:/home/deploy/pos-frontend/
```

Back on the server, add a second Caddy site block so the same reverse proxy serves both the API and the frontend, each on its own subdomain. Edit `supabase-project/volumes/proxy/caddy/Caddyfile` and add:

```caddyfile
pos.yourbakery.com {
    root * /home/deploy/pos-frontend
    encode gzip
    file_server

    # React Router: anything that isn't a real file falls back to index.html
    try_files {path} /index.html

    # index.html and the service worker must always be revalidated —
    # this is what makes "every branch updates automatically" true.
    @noCache path /index.html /sw.js /registerSW.js /manifest.webmanifest
    header @noCache Cache-Control "no-cache, must-revalidate"
}
```

Mount your upload folder into the Caddy container and restart it — edit the `caddy` service in `docker-compose.caddy.yml` to add a volume line pointing at `/home/deploy/pos-frontend`, then:

```bash
sh run.sh recreate caddy
```

Caddy issues a second free Let's Encrypt certificate for `pos.yourbakery.com` automatically, the same way it did for the API subdomain.

---

## Part 7 — Backups (now genuinely your responsibility)

Managed Supabase's free-tier backup gap (see `docs/FREE_TIER_LIMITS.md`) doesn't apply here in the same way — but there's no managed anything now, so backups are entirely on you. A nightly cron job dumping the database is the minimum viable setup:

```bash
mkdir -p /home/deploy/backups
crontab -e
```

Add:
```cron
0 2 * * * docker exec supabase-db pg_dump -U postgres postgres | gzip > /home/deploy/backups/backup-$(date +\%F).sql.gz
0 3 * * * find /home/deploy/backups -name "*.sql.gz" -mtime +30 -delete
```

This keeps 30 days of nightly backups on the VPS itself. For real protection, also copy them off the VPS — the free tier of a service like Backblaze B2 or rclone-to-any-cloud-storage works, or simply `scp` the latest file to a second machine periodically. A backup that only ever lived on the server it's backing up isn't a real backup if that server has a hardware failure.

---

## Part 8 — Updating

**Backend:** `supabase-project` isn't a git-cloned copy of your own repo, so `git push` doesn't touch it. To pick up new Supabase platform updates: `cd supabase-project && sh update.sh`. To apply a *new migration file* you've added to this project (e.g. after a future feature), copy its contents into Studio's SQL Editor and run it once, same as Part 4.

**Frontend:** rebuild locally (`npm run build`) and re-upload `dist/` to the server the same way as Part 6. For automatic deploy-on-push, adapt the GitHub Actions example in `docs/DEPLOYMENT_HOSTINGER.md`'s "Optional: auto-deploy" section, swapping the FTP-upload step for an `scp`/`rsync` step to this VPS over SSH (GitHub Actions supports SSH deploy keys the same way it supports FTP credentials).

---

## Verifying everything works

Same checklist as `docs/DEPLOYMENT_HOSTINGER.md`:
- App loads at `https://pos.yourbakery.com`
- Refreshing `/billing` doesn't 404
- Sign-in works
- Creating a staff account works (confirms the Edge Function + CORS are correctly reachable)
- "Add to Home Screen" / install icon appears (confirms the PWA manifest/service worker)
- Two tabs signed in as different users don't interfere with each other, and a change in one shows up live in the other without a refresh (confirms Realtime — check that `supabase_realtime` includes the tables from `0011_realtime.sql` onward; self-hosted Postgres ships with the same base publication as the managed platform, so this should already work identically)
