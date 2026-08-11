# Getting Started — A Guide for the Business Owner

Welcome to your new point-of-sale system. This guide explains how to use it day to day — no technical background needed.

## Signing in

Open the web address you were given (e.g. `https://pos.yourbakery.com`) in Chrome or Edge, on any computer at any branch. Enter your email and password. That's it — nothing to install.

**Tip:** on a computer you'll use every day, click the install icon in the address bar (or "Add to Home Screen" on a tablet/phone) to make it open like a regular app, with its own icon.

## Your role: Owner

As the Owner, you can see and do everything in the system, and you're the only one who can:
- Add or remove other staff logins
- Decide exactly what each staff member is allowed to do
- Add, edit, or close a branch

Everyone else's access is exactly what you set — nothing more.

## Setting up (do this once, when you start)

1. **Add your branches.** Admin → Branches → New branch. Give each one a short code (used on receipts), a name, and — this is important if you operate in more than one country — its own tax rate and currency (e.g. Pakistan: Sales Tax / PKR, Saudi Arabia: VAT / SAR).
2. **Add your products.** Admin → Products. For a handful of items, add them one at a time. For a full catalog, use Admin → Import/Export → Products, which lets you upload a spreadsheet instead of typing everything by hand — download the template first so the columns match.
3. **Add your staff.** Admin → Staff & Permissions → New staff account. Give them a name, email, and a temporary password (they can't reset this themselves — only you or another manager can, from the same page). Pick a starting role (Cashier, Branch Manager, etc.), then fine-tune exactly what they can do — see below.
4. **Set your stock levels.** Inventory page (per branch) or Admin → Import/Export → Inventory for a bulk upload.

## Understanding staff permissions

Every staff member's access is built from two things:
- A **role template** — a starting point like "Cashier" or "Branch Manager"
- Individual **overrides** you set yourself — e.g. you might give one trusted cashier permission to process refunds, while another cashier doesn't have that

Click **Permissions** next to any staff member's name to see and change exactly what they can do — creating bills, applying discounts, applying tax, viewing inventory, viewing financial reports, managing staff, and more. Changes apply the moment you make them — that staff member doesn't need to log out and back in.

## Daily use: billing

1. **Billing** page → search or scan a product to add it to the bill.
2. If a product shows "Out of stock," it means Inventory shows zero for that item at this branch — restock it first.
3. Enter how much cash the customer hands over, and the system tells the cashier exactly how much change to give back.
4. **Hold bill** saves a bill for later (a customer stepped away, still deciding, etc.) — it'll be waiting under "Held bills" to resume anytime.
5. **Complete bill** finishes the sale and offers to print a receipt immediately.
6. **Bills** page (in the sidebar) has every bill ever made at this branch — searchable, reprintable, any time.

## Checking on your business

- **Dashboard** — today's sales, every branch, at a glance.
- **Reports** — sales over any date range, per branch or all branches together, exportable to Excel or PDF.
- **Availability** — see what's in stock at *every* branch at once, without switching between them — handy when a customer calls asking if another branch has something.
- **Activity Log** — a record of who did what and when, across the whole system.

## If something looks wrong

- **A product won't add to the bill:** it's out of stock at this branch — check Inventory.
- **A staff member says they can't do something:** check their Permissions from the Staff page — it's probably a setting, not a bug.
- **Anything looks genuinely broken**, or a page shows an error message: [your contact / support arrangement goes here — see `docs/CLIENT_HANDOVER.md`].

## A note on multiple browser tabs

If you or a staff member is signed in on more than one browser tab at once (e.g. testing something, or checking the dashboard on a second monitor), each tab keeps its own separate login — signing in as someone else in one tab won't log the other tab out or mix anything up.
