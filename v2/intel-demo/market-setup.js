/* Market setup: Willow Bridge product type and submarket assignment for a market's properties.
   Browser (window.WBSetup) and Node (module.exports, for tests). Pure functions; setup.html does the reading and saving.
   Results land in core.properties.attrs: wbProductType, wbSubmarket. The Demo shows these by default ("Willow Bridge"
   taxonomy); the toggle still shows CoStar's. Hand edits made in the dashboard (WB overrides) still win over both. */
(function (root) {
  'use strict';

  // ---------- product type ----------
  // Willow Bridge standard (Will's table, Nov 2026). Density = units ÷ acres.
  //   Garden     5–45 units/acre, height cap 4 stories (5 on occasion, surface parked); also townhome / single-family / BTR
  //   Mid-Rise   46–115 units/acre, height cap 10 stories (at 5 stories or fewer the density implies structured parking)
  //   High-Rise  116+ units/acre, above the Mid-Rise cap
  const DEFAULT_RULES = { garden: { lo: 5, hi: 45, cap: 4 }, mid: { lo: 46, hi: 115, cap: 10 }, high: { lo: 116, hi: 1000 }, borderline: 3, reviewMin: 100 };
  function normRules(r) {
    const R = JSON.parse(JSON.stringify(DEFAULT_RULES));
    if (!r) return R;
    if (r.gardenMaxDensity != null) R.garden.hi = +r.gardenMaxDensity;   // older saved shape
    if (r.midMaxStories != null) R.mid.cap = +r.midMaxStories;
    for (const k of ['garden', 'mid', 'high']) if (r[k]) Object.assign(R[k], r[k]);
    if (r.borderline != null) R.borderline = +r.borderline;
    if (r.reviewMin != null) R.reviewMin = +r.reviewMin;
    return R;
  }

  const num = (v) => (v == null || v === '' || isNaN(+v) ? null : +v);
  function far(p) {
    const land = num(p.land_sf) || (num(p.acres) ? num(p.acres) * 43560 : null); if (!land) return null;
    const rba = num(p.attrs && p.attrs.rba); if (rba) return rba / land;
    const u = num(p.units), sf = num(p.avg_unit_sf); return u && sf ? (u * sf * 1.15) / land : null;   // rentable SF + ~15% common area
  }
  function density(p) { const u = num(p.units), a = num(p.acres); return u && a && a > 0 ? u / a : null; }

  /** → { type, density, flag (string|null), why }. Flags only cases where the answer could go either way:
      a flag that can't change the type (e.g. a very dense 4-story is Mid-Rise whatever its acreage) is left out. */
  function classify(p, rules) {
    const out = classifyRaw(p, rules), R = normRules(rules), u = num(p.units);
    if (out.flag && u != null && u < R.reviewMin) { out.small = out.flag; out.flag = null; }
    return out;
  }
  function classifyRaw(p, rules) {
    const R = normRules(rules);
    const st = num(p.stories), d = density(p), style = (p.style || '').toLowerCase();
    const D = d == null ? null : Math.round(d);
    const why = `${st == null ? 'stories unknown' : st + (st === 1 ? ' story' : ' stories')}, ${D == null ? 'no acreage' : D + ' units/ac'}`;
    const res = (type, flag, w) => ({ type, density: d, flag: flag || null, why: w || why });
    if (/town|single-family|single family|build-to-rent|btr/.test(style)) return res('Garden', null, p.style);

    // height decides above 5 stories
    if (st != null && st > R.mid.cap) return res('High-Rise');
    if (st != null && st > 5) return res('Mid-Rise');
    if (st == null && d == null && !p.parking) return res(p.style || 'Garden', 'No stories or acreage: kept CoStar\'s style');

    // 5 stories or fewer: Garden vs Mid-Rise (wrap / podium). Each piece of evidence votes; only real disagreement is flagged.
    const G = [], M = []; let g = 0, m = 0;
    const vote = (side, w, txt) => { if (side === 'G') { g += w; G.push(txt); } else { m += w; M.push(txt); } };
    const pk = (p.parking || (p.attrs && p.attrs.rpParking) || '').toLowerCase();
    if (/structure|subterranean|podium|garage deck/.test(pk)) vote('M', 3, 'structured parking (RealPage)');
    else if (pk === 'ground' || pk === 'surface') vote('G', 2, 'surface parking (RealPage)');
    else if (pk === 'individual') vote('G', 1, 'individual garages (RealPage)');
    const badAcres = d != null && d < R.garden.lo;
    if (d != null && !badAcres) {
      const edge = d - (R.garden.hi + 0.5), near = Math.abs(edge) <= R.borderline + 0.5;
      vote(edge < 0 ? 'G' : 'M', near ? 0.5 : 2, `${D} units/ac`);
    }
    const f = far(p);
    if (f != null && !badAcres) { if (f <= 1.1) vote('G', 1, `FAR ${f.toFixed(2)}`); else if (f >= 1.5) vote('M', 1, `FAR ${f.toFixed(2)}`); }
    const el = num(p.attrs && p.attrs.elevators);
    if (el > 0 && (st == null || st >= 3)) vote('M', 1, `${el} elevator${el > 1 ? 's' : ''}`);
    if (st === 5) vote('M', 0.5, 'Garden is rarely 5 stories');
    const ev = [...M, ...G].join(', ');
    const w2 = `${st == null ? 'stories unknown' : st + ' stories'}${ev ? ': ' + ev : ''}`;
    const score = m - g;
    if (!G.length && !M.length) {
      if (badAcres) return res('Garden', `Only ${d.toFixed(1)} units/ac: the acreage is probably wrong, and nothing else settles it`, w2);
      if (st != null && st <= 3) return res('Garden', null, w2 + ' (no other data)');
      return res(st != null && st <= R.garden.cap ? 'Garden' : 'Mid-Rise', `${st} stories with no acreage or parking data: Garden or wrap can't be told apart`, w2);
    }
    let type = score > 0 ? 'Mid-Rise' : 'Garden';
    // physical evidence is thin: let rent break the tie (it's what the YOC comps care about)
    if (Math.abs(score) < 0.5 && !(g >= 2 && m >= 2) && p.rentHint) return res(p.rentHint.side === 'G' ? 'Garden' : 'Mid-Rise', null, `${w2}; ${p.rentHint.txt}`);
    if (badAcres && Math.abs(score) < 1) return res(type, `Only ${d.toFixed(1)} units/ac: the acreage is probably wrong, and nothing else settles it`, w2);
    if (g >= 2 && m >= 2) return res(type, `Evidence disagrees: ${M.join(', ')} vs ${G.join(', ')}`, w2);
    if (Math.abs(score) < 0.5 || g + m < 1) return res(type, d != null && Math.abs(d - (R.garden.hi + 0.5)) <= R.borderline + 0.5 ? `${D} units/ac is right at the Garden / Mid-Rise line, and nothing else settles it` : 'Not enough to call it: confirm', w2);
    return res(type, null, w2);
  }

  /** Classify a whole market. Rent per SF breaks ties: a market-rate 3–5 story whose rent sits clearly
      with one type's median (same submarket, same vintage band) gets one vote toward that type. */
  function classifyAll(props, rules) {
    props.forEach((p) => { delete p.rentHint; });
    const first = props.map((p) => classify(p, rules));
    const rent = (p) => num(p.attrs && p.attrs.avgAskingSF);
    const market = (p) => !/afford/i.test((p.attrs && p.attrs.rentType) || '') && /exist/i.test(p.status || 'Existing');
    const key = (p) => `${(p.attrs && p.attrs.wbSubmarket) || p.costar_submarket || ''}|${num(p.year_built) >= 2010 ? 'new' : 'old'}`;
    const grp = {};
    props.forEach((p, i) => { const r = first[i]; if (r.flag || r.type === 'High-Rise' || !market(p) || !rent(p)) return; (grp[key(p) + '|' + r.type] = grp[key(p) + '|' + r.type] || []).push(rent(p)); });
    const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
    props.forEach((p, i) => {
      const st = num(p.stories); if (st != null && st > 5) return; if (!market(p) || !rent(p)) return;
      const g = grp[key(p) + '|Garden'], m = grp[key(p) + '|Mid-Rise']; if (!g || !m || g.length < 4 || m.length < 4) return;
      const mg = med(g), mm = med(m), r = rent(p); if (Math.abs(mm - mg) / Math.min(mg, mm) < 0.1) return;
      const toG = Math.abs(r - mg) < Math.abs(r - mm);
      p.rentHint = { side: toG ? 'G' : 'M', txt: `$${r.toFixed(2)}/SF rent is closer to ${toG ? 'Garden' : 'Mid-Rise'} here ($${(toG ? mg : mm).toFixed(2)} vs $${(toG ? mm : mg).toFixed(2)})` };
    });
    return props.map((p) => classify(p, rules));
  }

  // ---------- submarkets ----------
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const DIRS = { north: [1, 0], south: [-1, 0], east: [0, 1], west: [0, -1], northeast: [1, 1], northwest: [1, -1], southeast: [-1, 1], southwest: [-1, -1] };
  const CENTRE = new Set(['central', 'downtown', 'midtown', 'city center', 'core', 'urban core']);

  /** Split "Phoenix-Biltmore" → { city: 'phoenix', area: 'biltmore' }; "Tempe" → { city: 'tempe', area: null } */
  function parseName(name) {
    const m = String(name).split(/\s*[-–—]\s*/);
    return m.length > 1 ? { city: norm(m[0]), area: norm(m.slice(1).join(' ')) } : { city: norm(name), area: null };
  }

  /**
   * Best-effort assignment of each property to one of `names` (the region's own submarket list).
   * props: [{ id, name, address, city, lat, lng, costar_submarket, current }]
   * exact: optional Map(costar_id or id → submarket name) from an uploaded property list (wins outright).
   * → Map(id → { submarket, confidence: 'exact'|'high'|'medium'|'low'|'none', why })
   */
  function assignSubmarkets(props, names, exact) {
    const list = [...new Set(names.map((n) => String(n).trim()).filter(Boolean))];
    const parsed = list.map((n) => Object.assign({ name: n, key: norm(n) }, parseName(n)));
    const out = new Map();
    const cities = new Set(props.map((p) => norm(p.city)).filter(Boolean));
    const cityCentre = {};
    for (const p of props) { if (p.lat == null) continue; const c = norm(p.city); const o = (cityCentre[c] = cityCentre[c] || { la: 0, ln: 0, n: 0 }); o.la += p.lat; o.ln += p.lng; o.n++; }
    for (const c in cityCentre) { cityCentre[c].la /= cityCentre[c].n; cityCentre[c].ln /= cityCentre[c].n; }

    for (const p of props) {
      if (exact && (exact.has(String(p.costar_id)) || exact.has(String(p.id)))) {
        const v = exact.get(String(p.costar_id)) || exact.get(String(p.id));
        out.set(p.id, { submarket: v, confidence: 'exact', why: 'From your property list' }); continue;
      }
      const pc = norm(p.city), cs = norm(p.costar_submarket), hay = norm(`${p.name} ${p.address} ${p.costar_submarket}`);
      let pick = null;
      // 1) the name is exactly CoStar's submarket for this property
      const same = parsed.find((x) => x.key === cs);
      if (same) pick = { submarket: same.name, confidence: 'high', why: 'Same name as CoStar\'s submarket' };
      // 2) a "City-Area" name whose area words appear in CoStar's submarket, the property name or address
      if (!pick) {
        const hits = parsed.filter((x) => x.area && x.city === pc && !DIRS[x.area] && !CENTRE.has(x.area) && x.area.split(' ').every((w) => w.length > 2 && hay.includes(w)));
        if (hits.length === 1) pick = { submarket: hits[0].name, confidence: 'high', why: `"${hits[0].area}" matches CoStar's submarket or the property` };
      }
      // 3) a plain city name (no area) for the property's city
      if (!pick) {
        const cityOnly = parsed.filter((x) => !x.area && x.city === pc);
        const cityAreas = parsed.filter((x) => x.area && x.city === pc);
        if (cityOnly.length === 1 && !cityAreas.length) pick = { submarket: cityOnly[0].name, confidence: 'high', why: `Property is in ${p.city}` };
      }
      out.set(p.id, pick || null);
    }
    // 4) learn from the confident matches: CoStar submarkets whose confident properties mostly landed in one of your submarkets
    const learn = {};
    for (const p of props) { const r = out.get(p.id); if (!r || r.confidence === 'low') continue; const k = norm(p.costar_submarket) + '|' + norm(p.city); (learn[k] = learn[k] || {})[r.submarket] = (learn[k][r.submarket] || 0) + 1; }
    for (const p of props) {
      if (out.get(p.id)) continue;
      const t = learn[norm(p.costar_submarket) + '|' + norm(p.city)]; if (!t) continue;
      const tot = Object.values(t).reduce((a, b) => a + b, 0); const [top, n] = Object.entries(t).sort((a, b) => b[1] - a[1])[0];
      if (tot >= 3 && n / tot >= 0.75) out.set(p.id, { submarket: top, confidence: 'low', why: `Suggestion: ${n} of ${tot} matched properties in CoStar's ${p.costar_submarket} are in ${top}` });
    }
    // 5) neighbours: the submarket most of its nearest matched neighbours (same city) are in
    const seeds = props.filter((p) => out.get(p.id) && out.get(p.id).confidence !== 'low' && p.lat != null);
    for (const p of props) {
      if (out.get(p.id) || p.lat == null) continue;
      const near = seeds.filter((s) => norm(s.city) === norm(p.city))
        .map((s) => ({ s, d: Math.hypot(s.lat - p.lat, (s.lng - p.lng) * Math.cos(p.lat * Math.PI / 180)) }))
        .filter((n) => n.d < 0.03).sort((a, b) => a.d - b.d).slice(0, 5);   // within ~2 miles
      if (near.length < 3) continue;
      const tally = {}; near.forEach((n) => { const v = out.get(n.s.id).submarket; tally[v] = (tally[v] || 0) + 1; });
      const [top, n] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
      if (n >= 4) out.set(p.id, { submarket: top, confidence: 'low', why: `Suggestion: ${n} of its ${near.length} nearest matched neighbours are in ${top}` });
    }
    // 6) last resort, flagged for review: direction names within the city ("Phoenix-North"), else the nearest neighbours' pick
    for (const p of props) {
      if (out.get(p.id)) continue;
      const pc = norm(p.city); let pick = null;
      if (p.lat != null && cityCentre[pc]) {
        const opts = parsed.filter((x) => x.city === pc && x.area && (DIRS[x.area] || CENTRE.has(x.area)));
        if (opts.length >= 2) {
          const c = cityCentre[pc]; const dy = p.lat - c.la, dx = (p.lng - c.ln) * Math.cos(c.la * Math.PI / 180); const dist = Math.hypot(dx, dy);
          let best = null, bestScore = -Infinity;
          for (const o of opts) {
            const score = CENTRE.has(o.area) ? (0.02 - dist) * 50 : ((DIRS[o.area][0] * dy + DIRS[o.area][1] * dx) / (Math.hypot(...DIRS[o.area]) * (dist || 1e-9)));
            if (score > bestScore) { bestScore = score; best = o; }
          }
          if (best) pick = { submarket: best.name, confidence: 'low', why: `Suggestion: ${CENTRE.has(best.area) ? 'near the middle' : best.area + ' side'} of ${p.city}` };
        }
      }
      if (!pick && p.lat != null) {
        const near = seeds.map((s) => ({ s, d: Math.hypot(s.lat - p.lat, (s.lng - p.lng) * Math.cos(p.lat * Math.PI / 180)) })).sort((a, b) => a.d - b.d).slice(0, 3);
        if (near.length) pick = { submarket: out.get(near[0].s.id).submarket, confidence: 'low', why: `Suggestion: nearest matched property is in ${out.get(near[0].s.id).submarket}` };
      }
      out.set(p.id, pick || null);
    }
    for (const p of props) if (!out.get(p.id)) out.set(p.id, { submarket: p.current || p.costar_submarket || '', confidence: 'none', why: 'No match: kept the current submarket' });
    return out;
  }

  /** For new properties in a market that already has its own submarkets: nearest classified neighbours. */
  function inheritSubmarket(p, classified) {
    const near = classified.filter((s) => s.lat != null && s.sub).map((s) => ({ s, d: Math.hypot(s.lat - p.lat, (s.lng - p.lng) * Math.cos(p.lat * Math.PI / 180)) })).sort((a, b) => a.d - b.d).slice(0, 5);
    if (!near.length) return null;
    const tally = {}; near.forEach((n) => { tally[n.s.sub] = (tally[n.s.sub] || 0) + 1; });
    return Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
  }

  const api = { DEFAULT_RULES, normRules, classify, classifyAll, density, far, assignSubmarkets, inheritSubmarket, parseName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.WBSetup = api;
})(typeof window !== 'undefined' ? window : globalThis);
