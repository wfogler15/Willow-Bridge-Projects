/* Willow Bridge Intel: Site Scout adapter.
   Site Scout was written against its own Supabase tables `sites` (one JSON blob per site) and `pois`.
   This object answers those calls and reads/writes the shared tables instead:
     sites -> pipeline.deals + core.parcels (+ deal_parcels, deal_log)     pois -> core.pois
   Requires window.WB (shared/wb.js). */
(function () {
  const sb = WB.sb;
  const S = (schema) => sb.schema(schema);
  const num = (v) => (v == null || v === '' || isNaN(+v) ? null : +v);
  const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
  const ok = (data) => ({ data, error: null });
  const fail = (e) => ({ data: null, error: { message: e.message || String(e) } });

  // ---------- stage <-> Site Scout status ----------
  const TO_SITE = { prospect: 'prospect', screening: 'underwriting', underwriting: 'underwriting', loi: 'loi', under_contract: 'loi',
    closed: 'loi', monitor: 'monitor', passed: 'past', lost: 'past', dead: 'past' };
  function siteToStage(status, current) {
    const ACTIVE = ['screening', 'underwriting'], LATE = ['loi', 'under_contract', 'closed'], OUT = ['passed', 'lost', 'dead'];
    switch (status) {
      case 'monitor': return 'monitor';
      case 'prospect': case 'contacted': return 'prospect';
      case 'underwriting': return ACTIVE.includes(current) ? current : 'underwriting';
      case 'loi': return LATE.includes(current) ? current : 'loi';
      case 'past': return OUT.includes(current) ? current : 'passed';
      default: return current || 'prospect';
    }
  }
  const centroid = (g) => {
    const pts = []; const walk = (c) => { if (typeof c[0] === 'number') pts.push(c); else c.forEach(walk); };
    try { walk(g.coordinates); } catch (e) { return [null, null]; }
    return pts.length ? [pts.reduce((t, p) => t + p[1], 0) / pts.length, pts.reduce((t, p) => t + p[0], 0) / pts.length] : [null, null];
  };

  // ---------- sites ----------
  async function loadAll() {
    const [deals, links, parcels, logs] = await Promise.all([
      WB.fetchAll('pipeline', 'deals', '*', (q) => q.is('merged_into', null)),
      WB.fetchAll('pipeline', 'deal_parcels', 'deal_id,parcel_id'),
      WB.fetchAll('core', 'parcels', 'id,market_id,county,apn,acres,geom,attrs'),
      WB.fetchAll('pipeline', 'deal_log', 'deal_id,logged_on,kind,body,created_at', (q) => q.eq('kind', 'note').order('created_at')),
    ]);
    const pById = new Map(parcels.map((p) => [p.id, p]));
    const linksByDeal = new Map(); links.forEach((l) => (linksByDeal.get(l.deal_id) || linksByDeal.set(l.deal_id, []).get(l.deal_id)).push(l.parcel_id));
    const logsByDeal = new Map(); logs.forEach((l) => (logsByDeal.get(l.deal_id) || logsByDeal.set(l.deal_id, []).get(l.deal_id)).push(l));
    return { deals, pById, linksByDeal, logsByDeal };
  }
  function dealToSite(d, all) {
    const u = d.uw || {};
    const parcels = (all.linksByDeal.get(d.id) || []).map((pid) => all.pById.get(pid)).filter((p) => p && p.geom).map((p) => {
      const a = { ...(p.attrs || {}) }; const overrides = a.overrides; delete a.overrides; delete a.source; delete a.note;
      const [lat, lng] = centroid(p.geom);
      return { _parcelId: p.id, apn: p.apn || '', apnDash: a.APN_DASH || a.apnDash || p.apn || '', acres: num(p.acres), geometry: p.geom,
        _lat: lat, _lng: lng, attrs: a, ...(overrides ? { overrides } : {}) };
    });
    let pinOnly = false;
    if (!parcels.length) {
      // Every pipeline deal shows in Site Scout. A deal with a location but no parcel outline gets a placeholder
      // square sized to its acreage; it is never saved as a parcel, and drawing real parcels replaces it.
      if (d.lat == null || d.lng == null) return null;
      const lat = +d.lat, lng = +d.lng, side = Math.sqrt(Math.max(+d.acres || 2.5, 0.5) * 4046.86), dy = side / 2 / 111320, dx = side / 2 / (111320 * Math.cos(lat * Math.PI / 180));
      parcels.push({ _synthetic: true, apn: '', apnDash: '', acres: num(d.acres), _lat: lat, _lng: lng, attrs: { note: 'Location from Pipeline (no parcel outline yet)' },
        geometry: { type: 'Polygon', coordinates: [[[lng - dx, lat - dy], [lng + dx, lat - dy], [lng + dx, lat + dy], [lng - dx, lat + dy], [lng - dx, lat - dy]]] } });
      pinOnly = true;
    }
    const id = (d.legacy && d.legacy.site_scout_ids && d.legacy.site_scout_ids[0]) || d.id;
    const notes = (all.logsByDeal.get(d.id) || []).map((l) => ({ t: new Date(l.created_at || l.logged_on).getTime(), text: l.body }));
    const status = u.scoutStatus === 'contacted' && d.stage === 'prospect' ? 'contacted' : (TO_SITE[d.stage] || 'prospect');
    const site = { id, _dealId: d.id, name: d.name, status, market: d.market_id, notes, parcels,
      entitlement: d.entitlement || '', flu: u.flu || '', created: new Date(d.created_at).getTime(), updated: new Date(d.updated_at).getTime() };
    const sum = parcels.reduce((t, p) => t + (p.acres || 0), 0);
    if (d.acres != null && (pinOnly || Math.abs(+d.acres - sum) > 0.05)) site.acresOverride = +d.acres;
    return site;
  }
  async function findDeal(siteId, dealId) {
    if (dealId && isUuid(dealId)) { const { data } = await S('pipeline').from('deals').select('*').eq('id', dealId).limit(1); if (data && data[0]) return data[0]; }
    if (isUuid(siteId)) { const { data } = await S('pipeline').from('deals').select('*').eq('id', siteId).limit(1); if (data && data[0]) return data[0]; }
    const { data } = await S('pipeline').from('deals').select('*').contains('legacy', { site_scout_ids: [String(siteId)] }).limit(1);
    return data && data[0];
  }
  async function saveSite(site) {
    const pts = (site.parcels || []).filter((p) => p._lat != null && !p._synthetic);
    const lat = pts.length ? pts.reduce((t, p) => t + p._lat, 0) / pts.length : null;
    const lng = pts.length ? pts.reduce((t, p) => t + p._lng, 0) / pts.length : null;
    const sumAc = (site.parcels || []).reduce((t, p) => t + (+p.acres || 0), 0);
    const acres = site.acresOverride != null && site.acresOverride !== '' ? +site.acresOverride : (sumAc || null);
    const market = site.market || ((site.parcels || []).some((p) => p.attrs && p.attrs._county) ? 'denver' : 'phoenix');
    let d = await findDeal(site.id, site._dealId);
    const uwPatch = { flu: site.flu || null, scoutStatus: site.status === 'contacted' ? 'contacted' : null };
    if (d) {
      const prevStage = d.stage, stage = siteToStage(site.status, d.stage);
      const keepAcres = site.acresOverride == null && d.acres != null && Math.abs(+d.acres - sumAc) < 0.05 ? +d.acres : acres;
      const { error } = await S('pipeline').from('deals').update({ name: site.name, stage, entitlement: site.entitlement || null, acres: keepAcres,
        lat: lat ?? d.lat, lng: lng ?? d.lng, uw: { ...(d.uw || {}), ...uwPatch } }).eq('id', d.id);
      if (error) throw error;
      if (stage !== prevStage) await S('pipeline').from('deal_log').insert({ deal_id: d.id, kind: 'stage', body: `Stage set to ${stage.replace('_', ' ')} in Site Scout.` });
    } else {
      const { data: prop, error: pe } = await S('core').from('properties').insert({ market_id: market, kind: 'land', name: site.name, lat, lng, acres, source: 'manual' }).select('id').single();
      if (pe) throw pe;
      const { data, error } = await S('pipeline').from('deals').insert({ market_id: market, property_id: prop.id, name: site.name || 'Untitled site', kind: 'land',
        stage: siteToStage(site.status, null), lat, lng, acres, entitlement: site.entitlement || null, uw: uwPatch,
        legacy: { site_scout_ids: [String(site.id)] } }).select('*').single();
      if (error) throw error;
      d = data;
      await S('pipeline').from('deal_log').insert({ deal_id: d.id, kind: 'note', body: 'Saved in Site Scout.' });
    }
    // parcels: add new, update changed, unlink removed
    const { data: linked } = await S('pipeline').from('deal_parcels').select('parcel_id').eq('deal_id', d.id);
    const linkedIds = new Set((linked || []).map((l) => l.parcel_id));
    const keep = new Set();
    for (const p of site.parcels || []) {
      if (p._synthetic) continue;   // placeholder square for a deal with no parcel outline; never stored
      const attrs = { ...(p.attrs || {}), ...(p.overrides ? { overrides: p.overrides } : {}) };
      let pid = p._parcelId && linkedIds.has(p._parcelId) ? p._parcelId : null;
      if (!pid && p.apn) {
        const { data: ex } = await S('core').from('parcels').select('id').eq('apn', p.apn).eq('market_id', d.market_id).limit(1);
        if (ex && ex[0]) pid = ex[0].id;
      }
      if (!pid) {
        const { data: newId, error } = await S('pipeline').rpc('add_deal_parcel', { p_deal: d.id, p_apn: p.apn || '', p_geojson: JSON.stringify(p.geometry),
          p_county: attrs._county || (d.market_id === 'phoenix' ? 'Maricopa' : null) });
        if (error) throw error;
        pid = newId;
      } else {
        if (!linkedIds.has(pid)) await S('pipeline').from('deal_parcels').insert({ deal_id: d.id, parcel_id: pid });
        if (p.geometry) await S('core').rpc('set_parcel_geom', { p_parcel: pid, p_geojson: JSON.stringify(p.geometry) });
      }
      await S('core').from('parcels').update({ acres: num(p.acres), attrs, property_id: d.property_id }).eq('id', pid);
      p._parcelId = pid; keep.add(pid);
    }
    for (const id of linkedIds) if (!keep.has(id)) await S('pipeline').from('deal_parcels').delete().eq('deal_id', d.id).eq('parcel_id', id);
    // notes: anything newer than what the deal log already holds
    const { data: logs } = await S('pipeline').from('deal_log').select('body').eq('deal_id', d.id).eq('kind', 'note');
    const have = new Set((logs || []).map((l) => l.body));
    const fresh = (site.notes || []).filter((n) => n && n.text && !have.has(n.text));
    if (fresh.length) await S('pipeline').from('deal_log').insert(fresh.map((n) => ({ deal_id: d.id, kind: 'note', body: n.text,
      logged_on: new Date(n.t || Date.now()).toISOString().slice(0, 10) })));
    site._dealId = d.id;
  }

  // ---------- POIs ----------
  const poiRow = (p) => ({ id: p.id, market_id: p.m || 'denver', category: p.cat || null, name: p.n || null, lat: num(p.la), lng: num(p.lo),
    data: Object.fromEntries(Object.entries(p).filter(([k]) => !['id', 'm', 'cat', 'n', 'la', 'lo'].includes(k))) });
  const poiData = (r) => ({ ...(r.data || {}), id: r.id, m: r.market_id, cat: r.category, n: r.name, la: r.lat, lo: r.lng,
    updated: r.updated_at ? new Date(r.updated_at).getTime() : undefined });

  const H = {
    async sites_select() { const all = await loadAll(); return all.deals.map((d) => dealToSite(d, all)).filter(Boolean).map((s) => ({ id: s.id, data: s, updated: s.updated })); },
    async sites_upsert(row) { await saveSite(row.data || row); },
    // removing a site only takes it off the Site Scout map: the deal (and its underwriting, log, comps) stays in the pipeline
    async sites_remove(f) {
      const d = await findDeal(f.id); if (!d) return;
      const { error } = await S('pipeline').from('deal_parcels').delete().eq('deal_id', d.id); if (error) throw error;
      await S('pipeline').from('deal_log').insert({ deal_id: d.id, kind: 'note', body: 'Removed from Site Scout (parcel outlines detached).' });
    },
    async pois_select() { const rows = await WB.fetchAll('core', 'pois', '*'); return rows.map((r) => ({ id: r.id, data: poiData(r) })); },
    async pois_upsert(row) { const { error } = await S('core').from('pois').upsert(poiRow(row.data || row)); if (error) throw error; },
    async pois_remove(f) { const { error } = await S('core').from('pois').delete().eq('id', f.id); if (error) throw error; },
  };

  function from(table) {
    let op = 'select', rows = null; const filters = {};
    const q = {
      select() { return q; }, eq(c, v) { filters[c] = v; return q; }, order() { return q; }, limit() { return q; },
      upsert(r) { op = 'upsert'; rows = Array.isArray(r) ? r : [r]; return q; }, insert(r) { op = 'upsert'; rows = Array.isArray(r) ? r : [r]; return q; },
      delete() { op = 'remove'; return q; }, then(res, rej) { return run().then(res, rej); },
    };
    async function run() {
      const h = H[`${table}_${op}`];
      if (!h) { console.warn('[scout-db] no handler', table, op); return ok(op === 'select' ? [] : null); }
      try {
        if (op === 'select') return ok(await h(filters));
        if (op === 'upsert') { for (const r of rows) await h(r); return ok(null); }
        await h(filters); return ok(null);
      } catch (e) { console.error('[scout-db]', table, op, e); return fail(e); }
    }
    return q;
  }
  const ch = () => { const c = { on: () => c, subscribe: () => c, unsubscribe() {} }; return c; };

  // CoStar properties in Site Scout's compact comp format (replaces the public comps.json)
  async function loadComps() {
    const rows = await WB.fetchAll('core', 'properties', 'name,address,class,developer,market_id,owner,status,units,year_built,city,lat,lng,costar_submarket,avg_unit_sf,attrs',
      (q) => q.eq('source', 'costar'));
    return rows.map((p) => {
      const a = p.attrs || {}, vac = num(a.vacancy);
      return { a: p.address, c: p.class, d: p.developer, m: p.market_id, n: p.name, o: p.owner, s: p.status, u: p.units, y: p.year_built, ci: p.city,
        la: p.lat, lo: p.lng, oc: vac == null ? null : Math.round((100 - vac) * 10) / 10, sb: p.costar_submarket,
        aps: num(a.avgAskingSF), apu: num(a.avgAskingUnit), eps: num(a.avgEffectiveSF), epu: num(a.avgEffectiveUnit), usf: num(p.avg_unit_sf) };
    });
  }

  window.ScoutDB = { from, channel: ch, removeChannel() {}, auth: sb.auth, loadComps };
})();
