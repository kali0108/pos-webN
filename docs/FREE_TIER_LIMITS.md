# Free-Tier Limits & Backup Strategy

Figures below were checked against current provider information as of August 2026. Both providers change pricing/limits from time to time — re-check `supabase.com/pricing` and `netlify.com/pricing` before you rely on exact numbers for a real launch.

## Supabase Free tier

| Limit | Value | What it means for this app |
|---|---|---|
| Database storage | 500 MB | Bills, staff, inventory, and orders are small structured rows (no photos in the database itself). A rough guide: hundreds of thousands of invoice rows fit comfortably before this matters. |
| File storage | 1 GB | Cake reference photos live here, not in the database. Compress photos before upload (a phone photo resized to ~1600px wide is a few hundred KB) to get thousands of them in 1 GB. |
| Egress bandwidth | 5 GB/month | Each billing screen load or report pull is a small JSON payload, not a media file — this is unlikely to bind at small-to-medium scale. |
| Monthly active users | 50,000 | Enormous headroom for a handful of staff logins. |
| Active projects | 2 per account | Use one for production; the second is handy for a staging/test copy of the schema. |
| Edge Function invocations | 500,000/month | Only `create-staff-user` runs here, and only when the Owner adds a new staff account — nowhere near this limit. |
| **Auto-pause after 7 days of zero API requests** | — | A branch computer logging in at least once a week keeps the project awake automatically; there's nothing to configure. If a project *does* go a full week untouched (e.g. over a holiday closure) and pauses, un-pausing is one click in the Supabase dashboard and takes under a minute — it isn't data loss, just a nap. |
| **No automatic backups on the free tier** | — | See the backup strategy below — this is the one free-tier gap that needs an explicit answer, not just "it'll probably be fine." |

## Netlify Free tier

Netlify moved to a unified credit model in late 2025. The Free plan gives **300 credits/month**, spent across whatever you actually use:

| Activity | Cost |
|---|---|
| Production deploy | 15 credits each |
| Bandwidth | 20 credits/GB |
| Compute (if you ever add serverless functions here) | 10 credits/GB-hour |
| Web requests | 2 credits per 10,000 |

For this app — a small static bundle, cached aggressively by the service worker after first load, with a handful of branches and infrequent deploys — 300 credits/month is comfortable. If the allowance is ever exhausted mid-month, Netlify pauses serving until the next cycle rather than silently billing you, so there's no surprise charge; you'd simply see it in the dashboard and could either wait for the reset or upgrade. The Free plan explicitly permits commercial projects.

## Backup strategy (the free tier's real gap)

Supabase's free tier has no point-in-time recovery and no automatic daily backup. For a system tracking money, this needs an explicit answer rather than being left implicit. Two free options, in order of how much protection they buy:

**1. Scheduled `pg_dump` via a free CI runner (recommended).** A GitHub Actions workflow, on a nightly cron schedule, runs `pg_dump` against the Supabase connection string and commits/uploads the resulting SQL file — e.g. to a private GitHub repo (free for private repos with generous storage) or as a workflow artifact. This costs nothing beyond a few CI minutes/night and gives a real, restorable, point-in-time snapshot. A minimal workflow:

```yaml
# .github/workflows/nightly-backup.yml
name: Nightly Supabase backup
on:
  schedule:
    - cron: '0 2 * * *'   # 2am daily
  workflow_dispatch: {}
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Dump database
        run: |
          sudo apt-get update && sudo apt-get install -y postgresql-client
          pg_dump "${{ secrets.SUPABASE_DB_URL }}" --no-owner --no-privileges > backup-$(date +%F).sql
      - uses: actions/upload-artifact@v4
        with:
          name: db-backup-${{ github.run_id }}
          path: backup-*.sql
          retention-days: 30
```

`SUPABASE_DB_URL` is the Postgres connection string from Supabase Dashboard → Project Settings → Database, stored as a GitHub Actions secret — never commit it to the repo.

**2. Manual export before anything risky.** Before a schema change or a bulk data operation, Supabase Dashboard → Database → Backups lets you trigger a manual logical backup even on the free tier, downloadable as a `.sql` file. Good as a belt-and-suspenders step before migrations, not a substitute for #1.

If the bakery's transaction volume grows to where losing even a day of data would be a serious problem, that's the natural trigger to upgrade to Supabase Pro ($25/month, at time of writing), which adds automatic daily backups with point-in-time recovery — at that point the business almost certainly justifies the cost. Until then, the nightly GitHub Actions job above is a genuinely adequate free substitute, not just a stopgap.
