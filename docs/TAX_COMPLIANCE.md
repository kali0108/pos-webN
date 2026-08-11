# Tax & Government E-Invoicing Compliance

## What this system does

Every branch has its own configurable tax rate, tax label, and currency (`branches.tax_rate_percent`, `tax_label`, `currency_code`, `currency_symbol` — see `docs/DATABASE_SCHEMA.md`). This is deliberately generic: a Pakistan branch might be "Sales Tax 17%, PKR", a Saudi Arabia branch "VAT 15%, SAR", and a future branch anywhere else just gets its own row with its own numbers — no code change, ever, to support a new country's tax *rate*. Tax is calculated automatically on every bill and printed on the receipt.

## What this system does NOT do

Several countries — including both of the ones this business currently operates in — have moved beyond "just calculate and print tax" toward **mandatory real-time government e-invoicing**, where every sale (or every sale above a threshold) has to be reported to a tax authority's system, often in real time, sometimes with a government-issued QR code or invoice number that has to appear on the printed receipt.

- **Pakistan (FBR):** mandatory real-time POS integration currently applies to **Tier-1 retailers** specifically (broadly: retailers integrated with a national/international chain, operating in an air-conditioned outlet, with electricity bills or business turnover above certain thresholds — the exact criteria are set by FBR and worth confirming with an accountant against your specific business, since they can change). A registered Tier-1 retailer must register each POS with FBR, obtain a POS registration number, and have every invoice reported to FBR's system with a returned invoice number/QR code printed on the receipt.
- **Saudi Arabia (ZATCA "Fatoora"):** e-invoicing is mandatory more broadly, phased in by taxpayer group, and requires invoices to be generated in a specific structured format, include a QR code, and — for later phases — be integrated with ZATCA's systems for real-time or near-real-time clearance/reporting.
- Other countries this business might expand into will have their own equivalent (e.g. many EU countries are moving toward mandatory e-invoicing under EN 16931/Peppol-based standards).

**None of these are implemented here, and no generic open-source POS scaffold honestly can implement them once and for all** — each one requires formally registering the business with that country's tax authority, obtaining real API credentials from them, and integrating against their specific (and sometimes changing) API. That registration can only be done by the business itself, not built in advance without real credentials to test against.

## What's already in place to make adding one later straightforward

The schema doesn't need a redesign to support this later — it needs additive columns:

- `branches` could gain `tax_authority_registration_id` (FBR's POS registration number, ZATCA's equivalent), `tax_authority_id_numbers` (NTN/STRN for Pakistan, VAT number for Saudi Arabia), or similar, per branch.
- `invoices` could gain `authority_invoice_number` and `authority_qr_code` (or similar), populated by a new Edge Function that calls the relevant government API at the moment a bill completes — following the exact same pattern `sync_invoice()` already uses to assign the branch's own sequential invoice number, just with an extra step calling out to the authority's API before (or after) that.
- `Receipt.jsx` would print the extra government-issued QR code/number alongside the invoice's own.

This is genuine future work, not a redesign — flagged here so it isn't a surprise later, and so "is this system FBR/ZATCA compliant" has an honest answer: not yet, and can't be until the business has real registration credentials with each authority to build and test against.
