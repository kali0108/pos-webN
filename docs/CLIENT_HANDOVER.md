# Handing This Off to a Client

A checklist for whoever built/deployed this (you) to follow before calling the project "delivered." The goal: the client can run their business on this system even if you, personally, become unreachable tomorrow — that's what "handed off" actually means, not just "it's live."

## 1. Decide the ownership model first

Two honest options — pick one and be explicit with the client about which it is:

- **Full handover:** the client owns every account outright (Supabase, hosting, domain, GitHub). You may still offer paid support/maintenance, but they aren't *dependent* on you — if you disappear, they can hire anyone else to keep going, or do it themselves.
- **Managed service:** you keep ownership of the infrastructure and the client pays you an ongoing fee to operate it. This is a legitimate business model too, but say so plainly — a client who *thinks* they own their data/accounts and later discovers they don't will (rightly) feel misled.

Everything below assumes **full handover**, since that's the more common expectation and the more defensible professional default. If it's a managed-service arrangement instead, skip the ownership-transfer steps and just make sure the client has a written agreement covering what happens to their data if the arrangement ends.

## 2. Accounts to transfer (or create fresh, owned by the client from day one)

| Account | What to do |
|---|---|
| **Supabase** | Either transfer project ownership to an account the client controls (Supabase Dashboard → Project Settings → General → Transfer Project), or — cleaner — have the client create their own Supabase account before you even start, and you work inside *their* project from the beginning. |
| **Hosting** (Vercel / Netlify / Hostinger) | Same principle: transfer the project/site to the client's own account, or build it in an account they created and control from day one. |
| **Domain name** | Must be registered in the client's name/account, full stop — a domain registered under the developer's account is one of the most common ways small businesses lose control of their own website later. |
| **GitHub repository** | Transfer to an organization/account the client owns (**Settings → General → Transfer ownership**), or add them as the Owner and yourself as a Collaborator. |

## 3. Credentials handover

Do **not** send passwords/API keys over plain email, WhatsApp, or chat where they sit in message history forever. Use a password manager's secure-sharing feature (1Password, Bitwarden, etc. all have free tiers that support this) or a one-time-view secret link tool.

Hand over:
- The Owner account login for the app itself (email + password created in `docs/DEPLOYMENT_GUIDE.md` Part 3)
- Supabase project URL + anon key (already in their hosting environment variables, but the client should have a copy)
- Supabase dashboard login (their own account, per above)
- Hosting platform login (their own account, per above)
- Domain registrar login

## 4. Walk them through it live, once

Screen-share (or sit with them in person) and actually do these together, rather than just sending documents:

1. Log in as Owner.
2. Add a second branch (if they have one) — show that no developer involvement is needed for this.
3. Add one staff account, assign a role template, and show the permissions matrix.
4. Add a handful of real products (or better: do the Excel import together — Admin → Import/Export → Products — it's the fastest way to load a real catalog).
5. Complete one real bill start to finish, including printing the receipt.
6. Show them Reports and the Dashboard.

Give them `docs/GETTING_STARTED_FOR_OWNERS.md` (plain-language, written for a non-technical business owner, not a developer) as a leave-behind reference for this same walkthrough.

## 5. Set expectations for what happens next

Be explicit, ideally in writing, about:
- **Who to contact if something breaks**, and how fast to expect a response.
- **Whether you're available for feature requests later**, and roughly what that costs.
- **Who's responsible for backups.** If you set up the nightly backup workflow from `docs/FREE_TIER_LIMITS.md` or `docs/DEPLOYMENT_HOSTINGER_VPS.md` Part 7, tell them it exists and where the backups land — an unmonitored backup nobody knows about is barely better than no backup.
- **What happens if a Supabase/hosting free tier limit is ever hit** (see `docs/FREE_TIER_LIMITS.md`) — a business owner should know upgrading is a dashboard button, not an emergency.

## 6. A short written note beats a long verbal one

Even a two-paragraph email summarizing "here's what you now own, here's your Owner login, here's who to call" gives the client something to point back to later. This single email is often the difference between a client who feels confident and one who feels stranded the first time something looks unfamiliar.
