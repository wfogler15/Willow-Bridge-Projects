# Willow Bridge Intel: project brief

The working context for Claude in Will Fogler's "Willow Bridge Intel" project. Read it before you change anything in the dashboard, its data, or the deal intake process.

## What this is
One dashboard for Willow Bridge acquisitions and development in **Denver** and **Phoenix**. It brings together four tools Will built separately over the past year:

| Page | Path | What it does |
|---|---|---|
| Overview | `v2/index.html` | Active pursuits: underwriting and later, then screening (new on market) |
| Market intel | `v2/intel/` | Will's original Market Intel dashboard (CoStar comps, RealPage trends). Views sit in a left rail (Market / Supply / Underwriting); the page header carries the view title, a one-line filter summary, a Filters button (panel with every filter), Market report and Settings. The shell is built by `buildShell()` in `v2/intel/loader.js`, which moves the legacy controls rather than rebuilding them. The top nav auto-hides. |
| Site scout | `v2/scout/` | Parcel scouting map |
| Pipeline | `v2/pipeline/` | Map mode for the Thursday pipeline meeting, plus a Deal log (searchable, editable modal, Excel export), with comp layers (sale comps and property comps, dots plus parcel outlines) |
| Sale comps | `v2/comps/` | Master sale comp log, split into Investment and Land. Summary shows YTD volume vs last year. Exports to Excel. |

Live site: GitHub Pages for repo `wfogler15/Willow-Bridge-Projects` (public), under `/v2/`.

## Data
- **Supabase project:** `wmydniiakotcliraajaa` (free tier). The browser uses the publishable key via supabase-js 2.45.4.
- **Schemas:**
  - `core`: markets, properties, parcels, POIs, review queue.
  - `market`: RealPage and CoStar snapshots, KPI and strip summaries, comp sets.
  - `pipeline`: deals, deal_log, deal_parcels.
  - `comps`: sale_comps.
- **Deal fields:**
  - Structured columns on `pipeline.deals`: year_built, product_type, avg_unit_sf, building_sf, going_in_yield, uw_rent_psf, uw_rent_mo, uw_yoc, rent_for_target, target_yoc (default 6.5).
  - Also: broker, broker_contact, seller, guidance_note, bid_date, acres, zoning, entitlement, summary, take.
  - `uw` is jsonb; `uw.offer` holds the LOI terms.
  - Investment valuation inputs live in `uw` (T-12 NOI `noi`, `mktRentPsf`/`mktRentMo`, `effRentPsf`/`effRentMo`, `occ`, `concessionWeeks`) plus `going_in_yield`. The deal slide shows price on T-12 NOI at that yield and four steps either side (0.25% apart). Set in the deal editor under "Valuation and rents".
- **deal_log:** offers are logged as `kind='offer'` with a date.
- **Market is set by location.** Triggers on sale_comps, deals and properties set `market_id` using `comps.nearest_market(lat, lng)`. Clients must never write `market_id` on update; `shared/legacy-db.js` strips it.
- **Writes:** schema and data changes go through the Supabase MCP `apply_migration`, with fill-only `coalesce` updates. Never overwrite numbers Will entered.

## Front end conventions
- **Shared files:**
  - `v2/shared/wb-chrome.css`: brand tokens, nav, the `.wb-band` sub-bar, the market toggle.
  - `v2/shared/wb.css`: components.
  - `v2/shared/wb.js`: `WB.ready`, `WB.band`, `WB.marketToggle`, `WB.fetchAll`, `WB.toast`.
- **Market toggle:** each page has its own. There is no master toggle.
- **Labels:** always say "Development" (land) and "Investment" (existing). Always break the two out.
- **Brand and layout (minimal direction, Oct 2026):** white ground, hairline rules, text tabs and toggles, no cards, chips or tinted panels. Midnight `#1D1247` for text and the one filled button; purple `#432890` only for links and "New". Aptos/Inter. Each page leads with a one-line summary, then a few intentional figures. Market intel uses the same minimal direction (Will's call, Oct 20 2026); its styles live in one `wb-minimal` block at the end of `v2/intel/index.html`, as a KPI band and chart cards on a quiet canvas (#f6f6f9), 12-column grid, 16px gaps; it is the one page that uses cards, because it is the densest. Charts and features are unchanged.
- **Deal log table:** fixed column grid, everything left-aligned, tabular numbers.
- **Will's preferences:**
  - Rent/SF is the primary metric, with monthly rent secondary.
  - Concessions in weeks free, never %.
  - Imperial units.
- **Cache-busting:** run `python3 tools/stamp.py` before every commit. It stamps `?v=` on all local css/js.
- **Testing:**
  - Will's screen is about 2000px wide. Check at 2000 and 1440.
  - Check in a real browser render. A preview is not the shipped page.

## Intake: a new site or data room comes in
1. Read everything: OM, LOIs, proformas (.xlsm), site plans, broker emails.
2. **Create or find the deal** in `pipeline.deals`:
   - Set kind: Development (land) or Investment (asset).
   - Set market, address, lat and lng.
3. **Fill the fields:**
   - Broker and contact, seller, guidance, CFO/bid date.
   - Acres, units, zoning, entitlement.
   - A summary of 2 sentences, plus a take.
4. **Underwriting:** pull from the proforma.
   - Units, land price, total cost, rent/SF, yield on cost, rent needed to hit 6.5%.
   - Older proformas keep the sensitivity grid on the Exec sheet.
5. **Offers:** add a `deal_log` row with `kind='offer'` and the LOI date. Put the terms in `uw.offer`: price, deposit, DD days, closing, other terms.
   - Flag drafts as drafts.
   - Flag LOIs issued under LPC entities.
6. **Parcel:** set it in the deal's settings ("Fix the parcel outline").
7. **Report back:** say briefly what was filled, what was missing, and anything uncertain.

## Done (for reference)
- **Archive folder write-back, applied 10/20/26.** It logged 14 offers across 9 deals, filled brokers, summaries and offer terms on the archived deals, and loaded underwriting from six older proformas. `deal_log.kind` now allows `'offer'`.

## Known issue
- Larger database writes from Claude sometimes come back "cancelled" with no approval prompt shown. Reads and short writes work. When that happens, hand Will the SQL as a file to run in the Supabase SQL editor.

## To do
- **Needs-attention list:** first version is live on the Overview: active deals missing a parcel outline, location, CFO date or broker, plus sale comps missing a location. Each count links to a filtered view in Pipeline or Sale comps. Still to add:
  - Comps missing a price.
  - Stale Intel data.
  - Duplicate deals or comps.
  - A one-click fix on each row.
- **Historical investment deals:** Will is sending these for a backfill.
- **Switchover:** move v2 to the root URL, retire the old tables, delete the expired `one-time-loader` edge function.
- **Ideas parked:**
  - "Since last Thursday" changes view.
  - Auto-picked comps per deal.
  - Nearby past offers surfaced on new pursuits.
  - Proforma drop-zone import.
  - Scheduled quarterly Excel snapshot.
