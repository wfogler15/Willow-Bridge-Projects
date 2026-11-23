/* Market data upload: parse CoStar / RealPage exports into Canopy's tables, diff against the database, commit.
   Runs in the browser (window.WBUpload, SheetJS as window.XLSX) and in Node (module.exports, for testing).
   File types are recognised from their headers, not their names:
     costar_props  CoStar property export (CSV or Excel; existing, UC and proposed in any mix, any number of slices)
     costar_sales  CoStar sale comps export
     rp_monthly    RealPage "Monthly Property Performance Time Series" workbook
     rp_annual     RealPage "Annual Market Performance" workbook
   Writes go through the signed-in user's Supabase client (RLS: members). */
(function (root) {
  'use strict';
  const XLSX_ = () => root.XLSX || (typeof require === 'function' ? require('xlsx') : null);

  // ---------- small helpers ----------
  const isBlank = (v) => v == null || (typeof v === 'string' && v.trim() === '') || (typeof v === 'number' && isNaN(v));
  const num = (v) => { if (isBlank(v)) return null; if (typeof v === 'number') return v; const n = Number(String(v).replace(/[$,%\s]/g, '')); return isNaN(n) ? null : n; };
  const int = (v) => { const n = num(v); return n == null ? null : Math.round(n); };
  const str = (v) => { if (isBlank(v)) return null; if (v instanceof Date) return isoDate(v); const s = String(v).trim(); return s || null; };
  const idStr = (v) => { if (isBlank(v)) return null; return String(v).trim().replace(/\.0+$/, ''); };
  const pad = (n) => String(n).padStart(2, '0');
  function isoDate(v) {
    if (isBlank(v)) return null;
    if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
    if (typeof v === 'number') { const d = XLSX_().SSF.parse_date_code(v); return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : null; }
    const s = String(v).trim(); let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${pad(m[1])}-${pad(m[2])}`; }
    return null;
  }
  const yyyymm = (v) => { const d = isoDate(v); return d ? Number(d.slice(0, 4) + d.slice(5, 7)) : null; };
  const normAddr = (a) => (a || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[.,#]/g, ' ')
    .replace(/\b(street|st)\b/g, 'st').replace(/\b(avenue|ave)\b/g, 'ave').replace(/\b(road|rd)\b/g, 'rd').replace(/\b(drive|dr)\b/g, 'dr')
    .replace(/\b(boulevard|blvd)\b/g, 'blvd').replace(/\b(parkway|pkwy)\b/g, 'pkwy').replace(/\b(north)\b/g, 'n').replace(/\b(south)\b/g, 's')
    .replace(/\b(east)\b/g, 'e').replace(/\b(west)\b/g, 'w').replace(/\s+/g, ' ').trim();
  const STOP = new Set(['the', 'at', 'apartments', 'apartment', 'apts', 'homes', 'residences', 'of', 'on', 'and', 'luxury', 'living', 'lofts', 'flats']);
  const nameTokens = (n) => new Set((n || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t)));
  const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let i = 0; a.forEach((t) => { if (b.has(t)) i++; }); return i / (a.size + b.size - i); };
  const miles = (la1, lo1, la2, lo2) => { const r = Math.PI / 180, x = (lo2 - lo1) * r * Math.cos((la1 + la2) / 2 * r), y = (la2 - la1) * r; return Math.sqrt(x * x + y * y) * 3958.8; };
  const clean = (o) => { const out = {}; for (const [k, v] of Object.entries(o)) if (!isBlank(v)) out[k] = v; return out; };
  const slug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  // ---------- reading ----------
  /** Read a File / ArrayBuffer / Buffer into a SheetJS workbook. */
  function readWorkbook(data, name) {
    const X = XLSX_();
    const isCsv = /\.csv$/i.test(name || '');
    if (isCsv) {
      const text = typeof data === 'string' ? data : new TextDecoder('utf-8').decode(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
      return X.read(text, { type: 'string', raw: true });   // raw: keep CSV cells as text, we parse numbers and dates ourselves
    }
    return X.read(data instanceof ArrayBuffer ? new Uint8Array(data) : data, { type: 'array', cellDates: true });
  }
  const sheetRows = (wb, name) => XLSX_().utils.sheet_to_json(wb.Sheets[name || wb.SheetNames[0]], { header: 1, raw: true, defval: null, blankrows: false });
  /** Rows as objects, using the first row that contains every one of `must` as the header. */
  function tableFrom(rows, must) {
    const h = rows.findIndex((r) => r && must.every((m) => r.includes(m)));
    if (h < 0) return null;
    const head = rows[h].map((c) => (c == null ? '' : String(c).trim()));
    return rows.slice(h + 1).filter((r) => r && r.some((c) => !isBlank(c))).map((r) => Object.fromEntries(head.map((k, i) => [k, r[i]])));
  }

  /** What kind of file is this? → { type, wb } (type null when unknown) */
  function detect(wb) {
    const names = wb.SheetNames;
    if (names.includes('Property Attributes') && names.includes('Rents')) return 'rp_monthly';
    const rows = sheetRows(wb).slice(0, 8);
    const flat = rows.flat().filter((c) => typeof c === 'string');
    if (flat.some((c) => /Annual Market Performance/i.test(c)) || rows.some((r) => r.includes('Period') && r.includes('Geography Code') && r.includes('Submarket'))) return 'rp_annual';
    if (rows.some((r) => r.includes('Comp ID') && r.includes('Sale Date'))) return 'costar_sales';
    if (rows.some((r) => r.includes('PropertyID') && r.includes('Building Status'))) return 'costar_props';
    return null;
  }

  // ---------- CoStar properties ----------
  const BEDS = [['studio', 'Studio'], ['one', 'One Bedroom'], ['two', 'Two Bedroom'], ['three', 'Three Bedroom']];
  const KIND = (st) => /under|renov/i.test(st || '') ? 'under_construction' : /propos|plan|deferred/i.test(st || '') ? 'proposed' : 'existing';
  /** → { rows: [core.properties row], skipped: [{costar_id, name, reason}], marketName } */
  function parseCostarProps(wb, opts = {}) {
    const t = tableFrom(sheetRows(wb), ['PropertyID', 'Building Status']);
    const asOf = opts.asOf || isoDate(new Date());
    const rows = [], skipped = [], seen = new Set();
    let marketName = null;
    for (const r of t) {
      const id = idStr(r['PropertyID']); if (!id) continue;
      const name = str(r['Property Name']) || str(r['Property Address']);
      if (seen.has(id)) { skipped.push({ costar_id: id, name, reason: 'Duplicate row in the upload' }); continue; }
      seen.add(id);
      const sec = str(r['Secondary Type']) || '', ptype = str(r['Property Type']) || '';
      if (!/multi/i.test(ptype)) { skipped.push({ costar_id: id, name, reason: `Not multifamily (${ptype})` }); continue; }
      if (/manufactured|mobile/i.test(sec)) { skipped.push({ costar_id: id, name, reason: 'Manufactured housing / mobile home park' }); continue; }
      if (/^y/i.test(str(r['Condo']) || '')) { skipped.push({ costar_id: id, name, reason: 'Condo' }); continue; }
      const units = int(r['Number of Units']);
      if (units != null && units < 50) { skipped.push({ costar_id: id, name, reason: `Under 50 units (${units})` }); continue; }
      const lat = num(r['Latitude']), lng = num(r['Longitude']);
      if (lat == null || lng == null) { skipped.push({ costar_id: id, name, reason: 'No latitude/longitude' }); continue; }
      const status = str(r['Building Status']) || 'Existing';
      marketName = marketName || str(r['Market Name']);
      const attrs = {
        market: str(r['Market Name']),
        wbSubmarket: str(r['Submarket Name']),
        vacancy: num(r['Vacancy %']), concessions: num(r['Avg Concessions %']),
        avgAskingUnit: num(r['Avg Asking/Unit']), avgAskingSF: num(r['Avg Asking/SF']),
        avgEffectiveUnit: num(r['Avg Effective/Unit']), avgEffectiveSF: num(r['Avg Effective/SF']),
        unitsStudio: int(r['Number of Studio Units']), units1Bed: int(r['Number of 1 Bedroom Units']), units2Bed: int(r['Number of 2 Bedroom Units']),
        units3Bed: int(r['Number of 3 Bedroom Units']), units4Bed: int(r['Number of 4 Bedroom Units']),
        architect: str(r['Architect Name']), affordable: str(r['Affordable Type']), rentType: str(r['Rent Type']),
        rba: num(r['RBA']), elevators: int(r['Number of Elevators']), parkingSpaces: int(r['Number of Parking Spaces']), parkingRatio: num(r['Parking Ratio']), material: str(r['Construction Material']), floorSF: num(r['Typical Floor Size']), buildings: int(r['Total Buildings']),
        yearRenovated: int(r['Year Renovated']), constructionBegin: str(r['Construction Begin']), preLeasing: num(r['Pre-Leasing']),
        lastSaleDate: isoDate(r['Last Sale Date']) ? isoDate(r['Last Sale Date']) + ' 00:00:00' : null, lastSalePrice: num(r['Last Sale Price']),
        county: str(r['County Name']), costarAsOf: asOf,
      };
      for (const [k, label] of BEDS) {
        attrs[k + 'Rent'] = num(r[`${label} Asking Rent/Unit`]); attrs[k + 'RentSF'] = num(r[`${label} Asking Rent/SF`]);
        attrs[k + 'EffUnit'] = num(r[`${label} Effective Rent/Unit`]); attrs[k + 'EffSF'] = num(r[`${label} Effective Rent/SF`]);
        attrs[k + 'SF'] = num(r[`${label} Avg SF`]);
      }
      if (status !== 'Existing') attrs.constrStatusRaw = str(r['Constr Status']) || status;
      rows.push({
        costar_id: id, kind: KIND(status), status, name, address: str(r['Property Address']), city: str(r['City']), state: str(r['State']),
        zip: idStr(r['Zip']), lat, lng, units, year_built: int(r['Year Built']), month_built: int(r['Month Built']), stories: int(r['Number of Stories']),
        avg_unit_sf: num(r['Avg Unit SF']), acres: num(r['Land Area (AC)']), land_sf: num(r['Land Area (SF)']),
        star_rating: int(r['Star Rating']), class: str(r['Building Class']), style: str(r['Style']),
        owner: str(r['True Owner Name']) || str(r['Owner Name']) || str(r['Recorded Owner Name']), manager: str(r['Property Manager Name']),
        developer: str(r['Developer Name']), costar_submarket: str(r['Submarket Name']), source: 'costar', attrs: clean(attrs),
      });
    }
    return { rows, skipped, marketName };
  }

  // ---------- CoStar sale comps ----------
  /** → { rows: [comps.sale_comps row], skipped } */
  function parseSaleComps(wb, opts = {}) {
    const t = tableFrom(sheetRows(wb), ['Comp ID', 'Sale Date']);
    const asOf = opts.asOf || isoDate(new Date());
    const rows = [], skipped = [], byId = new Map();
    for (const r of t) {
      const compId = idStr(r['Comp ID']); const rawAddr = str(r['Property Address']);
      const name = str(r['Property Name']) || rawAddr;
      if (!/sold/i.test(str(r['Sale Status']) || 'Sold')) { skipped.push({ id: compId, name, reason: `Status ${r['Sale Status']}` }); continue; }
      const sale_date = isoDate(r['Sale Date']); if (!sale_date) { skipped.push({ id: compId, name, reason: 'No sale date' }); continue; }
      const ptype = str(r['Property Type']) || '';
      const isLand = /land/i.test(ptype) || (!int(r['Number of Units']) && !!str(r['Proposed Use']));
      const multi = rawAddr && /\(part of an? .*?(portfolio|sale)\)/i.exec(rawAddr);
      const lat = num(r['Latitude']), lng = num(r['Longitude']);
      const row = {
        comp_type: isLand ? 'land' : 'investment', name, address: rawAddr ? rawAddr.replace(/\s*\(.*?\)\s*/g, ' ').trim() : null,
        city: str(r['Property City']), submarket: str(r['Submarket Name']), lat, lng, sale_date,
        sale_price: num(r['Sale Price']), units: int(r['Number of Units']), year_built: int(r['Year Built']),
        acres: num(r['Land Area AC']), price_per_unit: num(r['Price Per Unit']),
        price_per_sf: isLand ? null : num(r['Price Per SF']), price_per_land_sf: isLand ? num(r['Price Per SF Land']) : null,
        cap_rate: num(r['Actual Cap Rate']), buyer: str(r['Buyer (True) Company']), seller: str(r['Seller (True) Company']),
        broker: str(r['Listing Broker Company']), product_type: isLand ? str(r['Proposed Use']) : str(r['Secondary Type']),
        portfolio: !!multi, source: 'costar',
        notes: [`CoStar export ${asOf}`, [str(r['Building Class']) && `${r['Building Class']} class`, str(r['Star Rating'])].filter(Boolean).join(', '),
          multi ? multi[0].replace(/[()]/g, '') : null, str(r['Sale Condition'])].filter(Boolean).join(' · '),
        legacy: clean({ costar_comp_id: compId, costar_property_id: idStr(r['PropertyID']), asking_price: num(r['Asking Price']), sale_type: str(r['Sale Type']) }),
      };
      // CoStar sometimes lists one sale twice (with and without the price): keep the fuller row per (property, date)
      const key = compId || `${normAddr(row.address)}|${sale_date}`;
      const k2 = `${row.legacy.costar_property_id || normAddr(row.address)}|${sale_date}`;
      const prev = byId.get(k2);
      const filled = (x) => Object.values(x).filter((v) => !isBlank(v)).length;
      if (prev) { if (filled(row) > filled(prev)) rows[rows.indexOf(prev)] = row; skipped.push({ id: key, name, reason: 'Same property and date listed twice; kept the fuller row' }); byId.set(k2, filled(row) > filled(prev) ? row : prev); continue; }
      byId.set(k2, row); rows.push(row);
    }
    return { rows, skipped };
  }

  // ---------- RealPage monthly property time series ----------
  // series keys as the dashboard reads them (market.rp_property_data.data.s)
  const RP_SERIES = [
    ['Rents', 'Effective Rent', 'eR'], ['Rents', 'Effective RPSF', 'eS'], ['Rents', 'Asking Rent', 'aR'],
    ['Concessions', 'Concession ($)', 'cD'], ['Concessions', 'Concession (%', 'cP'],
    ['Occupancy', 'Occupancy', 'oc'], ['Property Status', 'Property Status', 'st'],
    ['Asset Class', 'Asset Class In Market', 'kM'], ['Asset Class', 'Asset Class In Submarket', 'kS'],
  ];
  /** → { props: [{ realpage_id, attrs, data }], asOf, msa } */
  function parseRpMonthly(wb) {
    const attrRows = sheetRows(wb, 'Property Attributes');
    const at = tableFrom(attrRows, ['Property ID', 'Property Status']);
    const title = String((attrRows[0] || [])[0] || ''); const asOfTxt = String((attrRows[1] || [])[0] || '');
    const msa = title.replace(/\s*Monthly Property Performance.*$/i, '').trim() || null;
    const props = new Map();
    for (const r of at) {
      const id = idStr(r['Property ID']); if (!id) continue;
      props.set(id, {
        realpage_id: id,
        attrs: { name: str(r['Name']), address: str(r['Address']), city: str(r['City']), lat: num(r['Latitude']), lng: num(r['Longitude']), units: int(r['Total Units']), submarket: str(r['Submarket']) },
        data: clean({ nm: str(r['Name']), la: num(r['Latitude']), ln: num(r['Longitude']), yr: str(r['Year Built']), un: int(r['Total Units']),
          ow: str(r['Property Owner']), mg: str(r['Management']), st: str(r['Property Style']), sm: str(r['Submarket']), pk: str(r['Parking Type']),
          cM: str(r['Asset Class In Market']), cS: str(r['Asset Class In Submarket']) }),
      });
    }
    for (const [sheet, group, key] of RP_SERIES) {
      if (!wb.Sheets[sheet]) continue;
      const rows = sheetRows(wb, sheet);
      const gRow = rows[2] || [], hRow = rows[3] || [];
      let start = gRow.findIndex((g) => typeof g === 'string' && g.startsWith(group));
      if (start < 0) continue;
      let end = gRow.findIndex((g, i) => i > start && typeof g === 'string' && g.trim()); if (end < 0) end = hRow.length;
      const months = hRow.slice(start, end).map(yyyymm);
      const idCol = hRow.indexOf('Property ID');
      for (const r of rows.slice(4)) {
        const id = idStr(r[idCol]); const p = id && props.get(id); if (!p) continue;
        const vals = r.slice(start, end).map((v) => (isBlank(v) ? null : (typeof v === 'string' && key !== 'st' && key !== 'kM' && key !== 'kS' ? num(v) : v)));
        const first = vals.findIndex((v) => v != null); if (first < 0) continue;
        let last = vals.length - 1; while (last > first && vals[last] == null) last--;
        if (!months[first]) continue;
        (p.data.s = p.data.s || {})[key] = { s: months[first], v: vals.slice(first, last + 1) };
      }
    }
    return { props: [...props.values()].filter((p) => p.data.s), asOf: asOfTxt.replace(/^Data as of\s*/i, '') || null, msa };
  }

  // ---------- RealPage annual market performance ----------
  const RP_ANNUAL = [['Existing Units', 'eu'], ['Annual Supply', 'sp'], ['Annual Demand', 'dm'], ['Annual Effective Rent', 'eR'], ['YOY Effective Rent Change', 'yR'],
    ['Effective  RPSF', 'eS'], ['Effective RPSF', 'eS'], ['Asking Rent', 'aR'], ['Asking RPSF', 'aS'], ['Percent of Units Offering Concessions', 'cP'],
    ['Concession ($)', 'cD'], ['Concession (% of Asking Rent)', 'cR'], ['Occupancy', 'oc'], ['YOY Occupancy Change', 'yO'], ['YOY Revenue Change', 'yV'],
    ['Total Employment', 'em'], ['YOY Employment Change (#)', 'eN'], ['YOY Employment Change (%)', 'eP']];
  /** → { geos: { geography: { year: {...} } }, asOf, msa } */
  function parseRpAnnual(wb) {
    const rows = sheetRows(wb);
    const t = tableFrom(rows, ['Period', 'Submarket']);
    const geos = {}; let msa = null;
    for (const r of t) {
      const year = str(r['Period']); const geo = str(r['Submarket']); if (!year || !geo || !/^\d{4}$/.test(year)) continue;
      msa = msa || str(r['Market']);
      const o = {}; for (const [col, k] of RP_ANNUAL) if (r[col] !== undefined && !isBlank(r[col]) && o[k] == null) o[k] = num(r[col]);
      (geos[geo] = geos[geo] || {})[year] = o;
    }
    return { geos, asOf: String((rows[1] || [])[0] || '').replace(/^Data as of\s*/i, '') || null, msa };
  }

  // ---------- RealPage ↔ CoStar matching ----------
  /** Pair each RealPage property with at most one CoStar property. → Map(realpage_id → costar_id) + list of unsure pairs */
  function matchRealPage(rpProps, costarRows) {
    const cs = costarRows.filter((c) => c.lat != null).map((c) => ({ c, addr: normAddr(c.address), tok: nameTokens(c.name) }));
    const scored = [];
    for (const p of rpProps) {
      const a = p.attrs; if (a.lat == null) continue;
      const pAddr = normAddr(a.address), pTok = nameTokens(a.name);
      for (const x of cs) {
        const d = miles(a.lat, a.lng, x.c.lat, x.c.lng); if (d > 0.3) continue;
        let s = 0;
        if (pAddr && x.addr && (pAddr === x.addr || (pAddr.split(' ')[0] === x.addr.split(' ')[0] && pAddr.split(' ').slice(1, 3).join(' ') === x.addr.split(' ').slice(1, 3).join(' ')))) s += 3;
        const j = jaccard(pTok, x.tok); if (j >= 0.5) s += 2; else if (j > 0) s += 1;
        if (a.units && x.c.units && Math.abs(a.units - x.c.units) / Math.max(a.units, x.c.units) <= 0.1) s += 1;
        if (d < 0.05) s += 1;
        if (s >= 3) scored.push({ rp: p.realpage_id, costar: x.c.costar_id, s, d });
      }
    }
    scored.sort((p, q) => q.s - p.s || p.d - q.d);
    const map = new Map(), used = new Set();
    for (const m of scored) { if (map.has(m.rp) || used.has(m.costar)) continue; map.set(m.rp, m.costar); used.add(m.costar); }
    return map;
  }

  /** wb submarket → [{ rp, weight }] from the matched properties (how the dashboard blends RealPage submarket trends). */
  function buildRpMapping(costarRows, rpProps, match) {
    const rpSub = new Map(rpProps.map((p) => [p.realpage_id, p.attrs.submarket]));
    const byCostar = new Map(costarRows.map((c) => [c.costar_id, c]));
    const counts = {};
    for (const [rp, cid] of match) {
      const c = byCostar.get(cid); const sm = rpSub.get(rp); if (!c || !sm) continue;
      const wb = (c.attrs && c.attrs.wbSubmarket) || c.costar_submarket; if (!wb) continue;
      (counts[wb] = counts[wb] || {})[sm] = (counts[wb][sm] || 0) + 1;
    }
    const out = {};
    for (const [wb, m] of Object.entries(counts)) {
      const tot = Object.values(m).reduce((a, b) => a + b, 0);
      out[wb] = Object.entries(m).sort((a, b) => b[1] - a[1]).map(([rp, n]) => ({ rp, weight: n / tot }));
    }
    return out;
  }

  /** Default config for a brand-new market. */
  function newMarketConfig({ id, label, state, title, msa, costarRows, rpMapping }) {
    const ex = costarRows.filter((c) => c.lat != null);
    const med = (xs) => { const a = xs.slice().sort((p, q) => p - q); return a[a.length >> 1]; };
    const center = ex.length ? [Math.round(med(ex.map((c) => c.lat)) * 100) / 100, Math.round(med(ex.map((c) => c.lng)) * 100) / 100] : null;
    const subs = [...new Set(costarRows.map((c) => (c.attrs && c.attrs.wbSubmarket) || c.costar_submarket).filter(Boolean))].sort();
    return { id, label, title, config: { state, title, active: true, center, eyebrow: `${(label || '').split(',')[0]} · ${state || ''}`.trim(), msa_label: msa ? msa + ' MSA' : title, wb_submarkets: subs, rp_mapping: rpMapping || {} } };
  }

  // ---------- plan + commit ----------
  const chunk = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
  async function all(sb, schema, table, select, build) {
    const out = []; for (let from = 0; ; from += 1000) {
      const { data, error } = await build(sb.schema(schema).from(table).select(select)).range(from, from + 999);
      if (error) throw error; out.push(...data); if (data.length < 1000) break;
    } return out;
  }
  // ---------- quarterly refresh helpers ----------
  const pct = (a, b) => (a && b ? (b - a) / a : null);
  /** What moved since the last upload: deliveries, starts, rent and occupancy moves. */
  function summarizeChanges(updates, inserts) {
    const out = { delivered: [], started: [], newProps: inserts.slice(), rentMoves: [], occMoves: [] };
    for (const u of updates) {
      const b = u.before || {}, ba = b.attrs || {}, na = u.patch.attrs || {};
      const was = b.status || '', now = u.patch.status || '';
      if (/under/i.test(was) && /exist/i.test(now)) out.delivered.push(u);
      else if (/propos|plan/i.test(was) && /under/i.test(now)) out.started.push(u);
      const r = pct(ba.avgAskingSF, na.avgAskingSF); if (r != null && Math.abs(r) >= 0.05) out.rentMoves.push(Object.assign({ change: r, from: ba.avgAskingSF, to: na.avgAskingSF }, u));
      if (ba.vacancy != null && na.vacancy != null && Math.abs(na.vacancy - ba.vacancy) >= 3) out.occMoves.push(Object.assign({ from: 100 - ba.vacancy, to: 100 - na.vacancy }, u));
    }
    return out;
  }
  // hand edits (market.property_overrides) use the dashboard's field names; this maps a parsed CoStar row onto them
  function legacyView(r) {
    return Object.assign({}, r.attrs || {}, { name: r.name, address: r.address, city: r.city, zip: r.zip, units: r.units, yearBuilt: r.year_built, monthBuilt: r.month_built,
      stories: r.stories, avgUnitSF: r.avg_unit_sf, class: r.class, starRating: r.star_rating, developer: r.developer, owner: r.owner, propertyManager: r.manager, status: r.status });
  }
  const KEEP_EDITS = new Set(['submarket', 'style', 'lat', 'lng']);   // Willow Bridge taxonomy and hand-placed map pins: never replaced by an upload
  // asking/effective rent fields: a move of more than RENT_REVIEW either way is held for review instead of replaced
  const RENT_REVIEW = 0.20;
  const RENT_KEYS = ['avgAskingSF', 'avgAskingUnit', 'avgEffectiveSF', 'avgEffectiveUnit'].concat(...['studio', 'one', 'two', 'three'].map((b) => [b + 'Rent', b + 'RentSF', b + 'EffUnit', b + 'EffSF']));
  const PIPE_EDITS = new Set(['monthBuilt', 'yearBuilt', 'dayBuilt']);   // hand-estimated completion, kept while the building is still in the pipeline
  /** Quarterly refresh rule for hand edits (comp set updates and property-card edits):
      - rents and everything else CoStar reports: the new data replaces the hand value
      - occupancy: replaced, unless CoStar's new occupancy is lower than the hand value; those go to review (default keeps the hand value)
      - kept: Willow Bridge taxonomy, fields CoStar has no value for (notes, lease start, unit mix it doesn't report),
        and a hand-estimated completion date while CoStar still has the building under construction or proposed
      → [{ property_id, name, edits (if replaced/accepted), editsKeep (if hand occupancy kept), replaced: [fields], review: {mine, costar} }] */
  async function planOverrides(sb, updates) {
    if (!updates.length) return [];
    const byId = new Map(updates.map((u) => [u.id, u]));
    const rows = (await Promise.all(chunk([...byId.keys()], 300).map((c) => sb.schema('market').from('property_overrides').select('property_id,edits').in('property_id', c))))
      .flatMap((r) => { if (r.error) throw r.error; return r.data; });
    const out = [];
    const clean = (o) => { const m = o._meta && { ...o._meta }; if (m) { Object.keys(m).forEach((k) => { if (!(k in o) && k !== '_phase') delete m[k]; }); o._meta = m; } return Object.keys(o).some((k) => !k.startsWith('_')) || o._phase ? o : null; };
    for (const o of rows) {
      const u = byId.get(o.property_id); if (!u || !o.edits) continue;
      const fresh = legacyView(Object.assign({}, u.patch, { costar_id: u.costar_id }));
      const stillPipe = fresh.status && !/exist/i.test(fresh.status);
      const next = {}, replaced = []; let review = null;
      for (const [k, v] of Object.entries(o.edits)) {
        if (k.startsWith('_')) { next[k] = v; continue; }
        if (KEEP_EDITS.has(k)) { next[k] = v; continue; }
        if (PIPE_EDITS.has(k) && stillPipe) { next[k] = v; continue; }
        if (k === 'status' && /exist/i.test(v) && stillPipe) { next[k] = v; continue; }   // marked delivered by hand before CoStar caught up
        const nv = fresh[k];
        if (nv == null || nv === '') { next[k] = v; continue; }   // CoStar has nothing for it: keep the hand value
        if (k === 'vacancy' && v != null && +v < +nv) { review = { mine: 100 - v, costar: 100 - nv }; continue; }
        replaced.push(k);
      }
      out.hand = out.hand || {}; out.hand[o.property_id] = o.edits;
      if (!replaced.length && !review) continue;
      const editsUse = clean({ ...next });
      const editsKeep = review ? clean({ ...next, vacancy: o.edits.vacancy }) : null;
      out.push({ property_id: o.property_id, name: u.patch.name, edits: editsUse, editsKeep, replaced, review, keptOcc: review, orig: o.edits });
    }
    return out;
  }

  // ---------- hand-added projects that CoStar now has ----------
  const ftBetween = (a, b) => { const R = 20902231, t = (x) => (x * Math.PI) / 180, dl = t(b.lat - a.lat), dn = t(b.lng - a.lng); const h = Math.sin(dl / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const toks = (x) => new Set((x || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['the', 'apartments', 'apartment', 'at', 'and', 'llc', 'inc', 'residences', 'residential', 'company', 'companies'].includes(w)));
  const overlap = (a, b) => { const A = toks(a), B = toks(b); let n = 0; A.forEach((w) => { if (B.has(w)) n++; }); return n; };
  /** → [{ costar_id, name, address, manual: {id, name, address, developer, units}, ft, strong, why }] (each hand-added project claimed at most once) */
  function matchManual(inserts, manual) {
    const cands = [];
    for (const r of inserts) for (const m of manual) {
      const ft = r.lat != null && m.lat != null ? ftBetween(r, m) : null;
      const sameAddr = r.address && m.address && normAddr(r.address) === normAddr(m.address);
      const nameHit = overlap(r.name, m.name) > 0, devHit = r.developer && m.developer && overlap(r.developer, m.developer) > 0;
      const strong = sameAddr || (ft != null && ft <= 400);
      const possible = strong || (ft != null && ft <= 1584 && (nameHit || devHit));
      if (!possible) continue;
      cands.push({ r, m, ft, strong, score: (strong ? 0 : 1e6) + (ft == null ? 5e5 : ft) - (nameHit ? 300 : 0) - (devHit ? 200 : 0),
        why: [sameAddr ? 'same address' : null, ft != null ? Math.round(ft) + ' ft apart' : null, nameHit ? 'name' : null, devHit ? 'developer' : null].filter(Boolean).join(' · ') });
    }
    cands.sort((a, b) => a.score - b.score);
    const usedR = new Set(), usedM = new Set(), out = [];
    for (const c of cands) { if (usedR.has(c.r.costar_id) || usedM.has(c.m.id)) continue; usedR.add(c.r.costar_id); usedM.add(c.m.id);
      out.push({ costar_id: c.r.costar_id, name: c.r.name, address: c.r.address, units: c.r.units, developer: c.r.developer, manual: { id: c.m.id, name: c.m.name, address: c.m.address, developer: c.m.developer, units: c.m.units, status: c.m.status, year_built: c.m.year_built, month_built: c.m.month_built, attrs: c.m.attrs || {} }, ft: c.ft, strong: c.strong, why: c.why }); }
    return out;
  }

  /** Compare parsed files with the database. Reads only. → plan (shown as the preview, then passed to commit). */
  async function plan(sb, { marketId, newMarket, parsed, asOf }) {
    const P = { asOf: asOf || null, marketId, newMarket: newMarket || null, props: null, rp: null, trends: null, sales: null, warnings: [] };
    const costarRows = parsed.costar_props ? parsed.costar_props.rows : [];
    const ids = costarRows.map((r) => r.costar_id);
    // properties
    if (parsed.costar_props) {
      const [existing, removed] = await Promise.all([
        ids.length ? Promise.all(chunk(ids, 300).map((c) => sb.schema('core').from('properties').select('id,costar_id,market_id,realpage_id,owner,status,name,attrs').in('costar_id', c))).then((rs) => rs.flatMap((r) => { if (r.error) throw r.error; return r.data; })) : [],
        ids.length ? Promise.all(chunk(ids, 300).map((c) => sb.schema('core').from('properties_removed').select('costar_id').in('costar_id', c))).then((rs) => rs.flatMap((r) => { if (r.error) throw r.error; return r.data; })) : [],
      ]);
      const ex = new Map(existing.map((e) => [e.costar_id, e])); const rem = new Set(removed.map((r) => r.costar_id));
      const inserts = [], updates = [], removedSkips = [], otherMarket = [];
      for (const r of costarRows) {
        if (rem.has(r.costar_id)) { removedSkips.push(r); continue; }
        const e = ex.get(r.costar_id);
        if (!e) { inserts.push(r); continue; }
        if (e.market_id !== marketId) otherMarket.push({ row: r, market: e.market_id });
        // keep what the dashboard owns: owner after a recorded sale, attrs we don't map (owner_since, hand notes),
        // and the Willow Bridge taxonomy (submarket, product type): a refresh only updates CoStar's own fields
        const attrs = Object.assign({}, e.attrs || {}, r.attrs);
        for (const k of ['wbSubmarket', 'wbProductType']) { if (e.attrs && e.attrs[k] != null) attrs[k] = e.attrs[k]; else if (k === 'wbProductType') delete attrs[k]; }
        const patch = Object.assign({}, r, { attrs });
        if (e.attrs && e.attrs.owner_since) delete patch.owner;
        delete patch.costar_id;
        updates.push({ id: e.id, costar_id: r.costar_id, patch, before: e });
      }
      let notInFile = 0;
      if (!newMarket) {
        const { count } = await sb.schema('core').from('properties').select('id', { count: 'exact', head: true }).eq('market_id', marketId).eq('source', 'costar');
        notInFile = Math.max(0, (count || 0) - updates.length);
      }
      // a market already set up: new properties get its product type rules and their neighbours' Willow Bridge submarket
      if (!newMarket && inserts.length) {
        const { data: mk } = await sb.schema('core').from('markets').select('config').eq('id', marketId).single();
        const S = root.WBSetup || (typeof require === 'function' ? require('./market-setup.js') : null);
        const rules = mk && mk.config && mk.config.product_rules;
        if (S && rules) inserts.forEach((r) => { r.attrs.wbProductType = S.classify(r, rules).type; });
        const known = await all(sb, 'core', 'properties', 'lat,lng,costar_submarket,attrs', (q) => q.eq('market_id', marketId).eq('source', 'costar'));
        const custom = known.filter((k) => k.attrs && k.attrs.wbSubmarket && k.attrs.wbSubmarket !== k.costar_submarket);
        if (S && custom.length) {
          const cl = known.map((k) => ({ lat: k.lat, lng: k.lng, sub: k.attrs && k.attrs.wbSubmarket }));
          // the saved CoStar → Willow Bridge mapping places them exactly; only CoStar submarkets marked as split (or new ones) fall back to neighbours
          const map = (mk && mk.config && mk.config.submarket_map) || {}; let byNb = 0;
          inserts.forEach((r) => { const m = map[r.costar_submarket]; if (m && m !== S.SPLIT) { r.attrs.wbSubmarket = m; return; } const s = S.inheritSubmarket(r, cl); if (s) { r.attrs.wbSubmarket = s; byNb++; } });
          if (byNb) P.warnings.push(`${byNb} new propert${byNb === 1 ? 'y was' : 'ies were'} given a Willow Bridge submarket from the nearest neighbours (their CoStar submarket splits or is new). Check them in Set up submarkets and product types.`);
        }
      }
      // refresh of an existing market: what changed, hand edits the new data replaces, properties missing from this file
      let missing = [], changes = null, overrides = [], rentReview = [];
      if (!newMarket) {
        const idSet = new Set(ids);
        const onFile = await all(sb, 'core', 'properties', 'id,costar_id,name,address,city,status,units,year_built', (q) => q.eq('market_id', marketId).eq('source', 'costar'));
        missing = onFile.filter((x) => !idSet.has(x.costar_id));
        changes = summarizeChanges(updates, inserts);
        overrides = await planOverrides(sb, updates);
        // asking rent moved more than 20% either way (against the hand figure where there is one): review before it replaces anything
        const hand = overrides.hand || {};
        rentReview = updates.map((u) => {
          const ba = (u.before && u.before.attrs) || {}, na = u.patch.attrs || {};
          if (!/exist/i.test(u.patch.status || '') || !/exist/i.test((u.before && u.before.status) || '')) return null;
          const h = hand[u.id] && hand[u.id].avgAskingSF, from = h != null ? +h : ba.avgAskingSF, to = na.avgAskingSF, r = pct(from, to);
          return r != null && Math.abs(r) > RENT_REVIEW ? { id: u.id, name: u.patch.name, from, to, change: r, hand: h != null } : null;
        }).filter(Boolean);
      }
      // a property CoStar shows for the first time may be a project someone added by hand: offer to claim it instead of adding a duplicate
      let claims = [];
      if (!newMarket && inserts.length) {
        const manual = await all(sb, 'core', 'properties', 'id,name,address,developer,units,lat,lng,status,year_built,month_built,attrs', (q) => q.eq('market_id', marketId).eq('source', 'manual').neq('kind', 'land'));
        claims = matchManual(inserts, manual);
      }
      P.props = { inserts, updates, removedSkips, otherMarket, skipped: parsed.costar_props.skipped, notInFile, missing, changes, overrides, rentReview, claims };
      if (otherMarket.length) P.warnings.push(`${otherMarket.length} properties already sit in another market (${[...new Set(otherMarket.map((o) => o.market))].join(', ')}); they'll be updated in place, and their market follows their location.`);
    }
    // RealPage
    if (parsed.rp_monthly) {
      let pool = costarRows;
      if (!pool.length) pool = (await all(sb, 'core', 'properties', 'costar_id,name,address,lat,lng,units,costar_submarket,attrs', (q) => q.eq('market_id', marketId).eq('source', 'costar')));
      const match = matchRealPage(parsed.rp_monthly.props, pool);
      P.rp = { props: parsed.rp_monthly.props, match, matched: match.size, unmatched: parsed.rp_monthly.props.length - match.size, asOf: parsed.rp_monthly.asOf, rpMapping: buildRpMapping(pool, parsed.rp_monthly.props, match) };
    }
    if (parsed.rp_annual) P.trends = { geos: parsed.rp_annual.geos, count: Object.keys(parsed.rp_annual.geos).length, asOf: parsed.rp_annual.asOf };
    // sale comps: skip ones already on file (same CoStar comp id, or same address and date)
    if (parsed.costar_sales) {
      const have = newMarket ? [] : await all(sb, 'comps', 'sale_comps', 'address,sale_date,legacy', (q) => q.eq('market_id', marketId));
      const byComp = new Set(have.map((h) => h.legacy && h.legacy.costar_comp_id).filter(Boolean));
      const byAddr = new Set(have.map((h) => `${normAddr(h.address)}|${h.sale_date}`));
      const inserts = [], dupes = [];
      for (const r of parsed.costar_sales.rows) {
        if ((r.legacy.costar_comp_id && byComp.has(r.legacy.costar_comp_id)) || byAddr.has(`${normAddr(r.address)}|${r.sale_date}`)) dupes.push(r); else inserts.push(r);
      }
      P.sales = { inserts, dupes, skipped: parsed.costar_sales.skipped };
    }
    return P;
  }

  /** Write a plan. onStep(label) reports progress. Returns a summary. */
  async function commit(sb, P, { user, onStep = () => {}, period } = {}) {
    const held = new Set(((P.props && P.props.rentReview) || []).filter((r) => !(P.rentUse && P.rentUse.has(r.id))).map((r) => r.id));   // rent moves held for review
    const S = (s) => sb.schema(s); const who = user || 'upload';
    const out = { inserted: 0, updated: 0, rp: 0, trends: 0, sales: 0 };
    const chk = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
    const asOf = P.asOf || new Date().toISOString().slice(0, 10);
    if (P.newMarket) {
      onStep('Creating the market');
      const cfg = P.newMarket.config; if (P.rp) cfg.rp_mapping = P.rp.rpMapping; if (P.props) { cfg.as_of = asOf; if (period) cfg.costar_period = period.label; }
      chk(await S('core').from('markets').insert({ id: P.newMarket.id, label: P.newMarket.label, title: P.newMarket.title, config: cfg }));
    } else if (P.props || (P.rp && Object.keys(P.rp.rpMapping).length)) {
      // existing market: move its "as of" date forward; fill the RealPage mapping only when it has none (Denver/Phoenix keep their curated ones)
      const m = chk(await S('core').from('markets').select('config').eq('id', P.marketId).single());
      const cfg = Object.assign({}, m.config);
      if (P.props) { cfg.as_of = asOf; if (period) cfg.costar_period = period.label; }   // the Markets home page shows this as the CoStar period
      if (P.rp && Object.keys(P.rp.rpMapping).length && (!cfg.rp_mapping || !Object.keys(cfg.rp_mapping).length)) cfg.rp_mapping = P.rp.rpMapping;
      const subs = P.props ? [...new Set([...(cfg.wb_submarkets || []), ...[...P.props.inserts].map((r) => r.attrs.wbSubmarket).filter(Boolean)])].sort() : cfg.wb_submarkets;
      if (subs) cfg.wb_submarkets = subs;
      chk(await S('core').from('markets').update({ config: cfg }).eq('id', P.marketId));
    }
    const idByCostar = new Map();
    if (P.props) {
      let i = 0;
      // claimed: the hand-added project becomes the CoStar record (same row, so comp sets, hand updates and notes stay attached)
      const claimOn = new Map((P.props.claims || []).filter((c) => P.claimUse ? P.claimUse.has(c.costar_id) : c.strong).map((c) => [c.costar_id, c]));
      for (const r of P.props.inserts.filter((x) => claimOn.has(x.costar_id))) {
        const c = claimOn.get(r.costar_id), ma = c.manual.attrs || {};
        const attrs = Object.assign({}, r.attrs);
        ['notes', 'wbSubmarket', 'wbProductType', 'landCompId', 'constructionBegin', 'acreage'].forEach((k) => { if (ma[k] != null && ma[k] !== '' && (k === 'notes' || k === 'wbSubmarket' || k === 'landCompId' || attrs[k] == null)) attrs[k] = ma[k]; });
        attrs.claimedFrom = { legacy_id: ma.legacy_id || null, name: c.manual.name, at: new Date().toISOString(), by: who };
        const patch = Object.assign({}, r, { attrs, source: 'costar', updated_by: who });
        // still in the pipeline: keep the hand-estimated completion over CoStar's
        if (!/exist/i.test(r.status || '') && c.manual.year_built) {
          const mm = c.manual.month_built || ma.monthBuilt, mi = typeof mm === 'number' ? mm : ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(String(mm || '').slice(0, 3).toLowerCase()) + 1;
          patch.year_built = c.manual.year_built; if (mi > 0) patch.month_built = mi;
        }
        onStep(`Matching ${r.name || 'a new property'} to ${c.manual.name || 'a hand-added project'}`);
        chk(await S('core').from('properties').update(patch).eq('id', c.manual.id));
        idByCostar.set(r.costar_id, c.manual.id); out.claimed = (out.claimed || 0) + 1;
      }
      P.props.inserts = P.props.inserts.filter((x) => !claimOn.has(x.costar_id));
      for (const c of chunk(P.props.inserts, 200)) {
        onStep(`Adding properties ${i + 1}–${i + c.length} of ${P.props.inserts.length}`);
        const rows = c.map((r) => Object.assign({}, r, { market_id: P.marketId, created_by: who, updated_by: who }));
        chk(await S('core').from('properties').insert(rows).select('id,costar_id')).forEach((x) => idByCostar.set(x.costar_id, x.id));
        i += c.length; out.inserted += c.length;
      }
      i = 0;
      for (let u of P.props.updates) {
        if (held.has(u.id)) { const ba = (u.before && u.before.attrs) || {}, keep = {}; RENT_KEYS.forEach((k) => { if (k in ba) keep[k] = ba[k]; }); u = Object.assign({}, u, { patch: Object.assign({}, u.patch, { attrs: Object.assign({}, u.patch.attrs, keep) }) }); }
        if (i % 50 === 0) onStep(`Updating properties ${i + 1}–${Math.min(i + 50, P.props.updates.length)} of ${P.props.updates.length}`);
        chk(await S('core').from('properties').update(Object.assign({}, u.patch, { updated_by: who })).eq('id', u.id));
        idByCostar.set(u.costar_id, u.id); i++; out.updated++;
      }
    }
    if (P.props && P.props.overrides && P.props.overrides.length) {
      onStep('Replacing hand edits with the new data');
      for (let o of P.props.overrides) {
        // occupancy under review: keep the hand value unless the check screen said to use CoStar's
        const useCostar = o.review && P.occUse && P.occUse.has(o.property_id);
        if (o.review && !useCostar) { o = Object.assign({}, o, { edits: o.editsKeep }); }
        if (held.has(o.property_id) && o.orig) {   // rent held for review: the hand rents stay
          const back = {}, meta = {}; RENT_KEYS.forEach((k) => { if (k in o.orig) { back[k] = o.orig[k]; if (o.orig._meta && o.orig._meta[k]) meta[k] = o.orig._meta[k]; } });
          if (Object.keys(back).length) { const e = Object.assign({}, o.edits || {}, back); e._meta = Object.assign({}, (o.edits && o.edits._meta) || {}, meta); o = Object.assign({}, o, { edits: e, replaced: o.replaced.filter((k) => !(k in back)) }); }
        }
        if (!o.replaced.length && !(o.review && useCostar)) continue;
        if (o.edits) chk(await S('market').from('property_overrides').update({ edits: o.edits }).eq('property_id', o.property_id));
        else chk(await S('market').from('property_overrides').delete().eq('property_id', o.property_id));
      }
    }
    if (P.props && P.removeMissing && P.removeMissing.length) {
      // same as the cleanups: the row moves to core.properties_removed (restorable) and future uploads skip its CoStar id
      onStep(`Removing ${P.removeMissing.length} properties that aren't in this upload`);
      for (const c of chunk(P.removeMissing, 100)) {
        const full = chk(await S('core').from('properties').select('*').in('id', c));
        const rows = full.map((r) => { const x = Object.assign({}, r); delete x.geom; x.attrs = Object.assign({}, x.attrs || {}, { _removed: { reason: 'Not in the upload of ' + asOf, by: who, at: new Date().toISOString() } }); return x; });
        chk(await S('core').from('properties_removed').insert(rows));
        chk(await S('core').from('properties').delete().in('id', c));
      }
      out.removed = P.removeMissing.length;
    }
    if (P.rp) {
      // property ids for the matched CoStar ids (covers properties loaded earlier)
      const need = [...new Set(P.rp.match.values())];
      for (const c of chunk(need, 300)) chk(await S('core').from('properties').select('id,costar_id').in('costar_id', c)).forEach((x) => idByCostar.set(x.costar_id, x.id));
      const rows = P.rp.props.map((p) => {
        const cid = P.rp.match.get(p.realpage_id) || null;
        const data = Object.assign({}, p.data); if (cid) data.cId = cid;
        return { market_id: P.marketId, realpage_id: p.realpage_id, property_id: cid ? idByCostar.get(cid) || null : null, data, created_by: who, updated_by: who };
      });
      let i = 0;
      for (const c of chunk(rows, 40)) { onStep(`RealPage properties ${i + 1}–${i + c.length} of ${rows.length}`); chk(await S('market').from('rp_property_data').upsert(c, { onConflict: 'market_id,realpage_id' })); i += c.length; out.rp += c.length; }
      onStep('Linking RealPage ids to properties');
      for (const [rp, cid] of P.rp.match) { const pid = idByCostar.get(cid); if (pid) chk(await S('core').from('properties').update({ realpage_id: rp }).eq('id', pid)); }
    }
    if (P.trends) {
      onStep('RealPage submarket trends');
      const rows = Object.entries(P.trends.geos).map(([geography, data]) => ({ market_id: P.marketId, geography, data, created_by: who, updated_by: who }));
      chk(await S('market').from('rp_trends').upsert(rows, { onConflict: 'market_id,geography' })); out.trends = rows.length;
    }
    if (P.sales && P.sales.inserts.length) {
      let i = 0;
      for (const c of chunk(P.sales.inserts, 100)) {
        onStep(`Sale comps ${i + 1}–${i + c.length} of ${P.sales.inserts.length}`);
        chk(await S('comps').from('sale_comps').insert(c.map((r) => Object.assign({}, r, { market_id: P.marketId, created_by: who, updated_by: who }))));
        i += c.length; out.sales += c.length;
      }
    }
    // dated snapshot of each property as uploaded (history for the property card), and a log line
    if (P.props && period) {
      onStep('Saving this upload as a dated snapshot');
      const src = [...P.props.inserts, ...P.props.updates.map((u) => Object.assign({}, u.patch, { costar_id: u.costar_id }))];
      const map = idByCostar;
      const snaps = src.filter((r) => map.get(r.costar_id)).map((r) => ({ property_id: map.get(r.costar_id), period: period.label, period_sort: period.sort, data: Object.assign({}, r.attrs, { id: r.costar_id, name: r.name, units: r.units, status: r.status, submarket: r.costar_submarket }), created_by: who, updated_by: who }));
      for (const c of chunk(snaps, 100)) chk(await S('market').from('property_snapshots').upsert(c, { onConflict: 'property_id,period_sort' }));
    }
    try {
      await sb.from('refresh_log').insert({ market: P.marketId, period: period ? period.label : null, period_sort: period ? period.sort : null,
        properties_total: P.props ? P.props.inserts.length + P.props.updates.length : 0, properties_matched: P.props ? P.props.updates.length : 0,
        properties_new: P.props ? P.props.inserts.length : 0, properties_retired: 0, edits_archived: 0, editor_name: who,
        notes: `Upload: ${out.inserted} new, ${out.updated} updated properties; ${out.rp} RealPage; ${out.trends} trend geographies; ${out.sales} sale comps` });
    } catch (e) { /* the log is best-effort */ }
    return out;
  }

  /** Quarter label for today: { label: 'Q4 2026', sort: 202604 } */
  function currentPeriod(d = new Date()) { const q = Math.floor(d.getMonth() / 3) + 1; return { label: `Q${q} ${d.getFullYear()}`, sort: d.getFullYear() * 100 + q }; }

  const api = { readWorkbook, detect, parseCostarProps, parseSaleComps, parseRpMonthly, parseRpAnnual, matchRealPage, buildRpMapping, newMarketConfig, plan, commit, currentPeriod, slug, normAddr };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WBUpload = api;
})(typeof window !== 'undefined' ? window : globalThis);
