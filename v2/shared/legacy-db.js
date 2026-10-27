/* Willow Bridge Canopy: legacy table adapter for the Market Intel dashboard.
   The dashboard was written against eight flat public tables (opportunities, custom_comps, property_edits, ...).
   This object answers those same calls (.from(t).select().eq().upsert().delete()) and reads/writes the new
   core / market / pipeline / comps tables underneath, so the dashboard code can stay as it is.
   Requires window.WB (shared/wb.js) and window.__WBD (market data loaded by intel/index.html). */
(function () {
  const sb = WB.sb;
  const S = (schema) => sb.schema(schema);
  const ctx = () => window.__WBD;                         // { market, propByCostar, costarByProp, ... }
  const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
  const num = (v) => (v == null || v === '' || isNaN(+v) ? null : +v);
  const ok = (data) => ({ data, error: null });
  const fail = (error) => ({ data: null, error });

  // ---------- property id translation (CoStar id or legacy custom id <-> property uuid) ----------
  async function propUuid(legacyId) {
    const k = String(legacyId);
    const c = ctx();
    if (c.propByCostar[k]) return c.propByCostar[k];
    if (isUuid(k)) return k;
    const { data } = await S('core').from('properties').select('id').eq('market_id', c.market).contains('attrs', { legacy_id: k }).limit(1);
    if (data && data[0]) { c.propByCostar[k] = data[0].id; c.costarByProp[data[0].id] = k; return data[0].id; }
    return null;
  }
  const legacyPropId = (uuid) => ctx().costarByProp[uuid] || uuid;

  // ---------- stage <-> Intel status ----------
  const TO_STATUS = { prospect: 'Sourcing', screening: 'Screening', underwriting: 'Underwriting', loi: 'LOI', under_contract: 'Under Contract',
    closed: 'Closed', monitor: 'Monitor', passed: 'Passed', lost: 'Lost', dead: 'Dead' };
  const TO_STAGE = { 'Sourcing': 'prospect', 'Screening': 'screening', 'Underwriting': 'underwriting', 'Negotiating': 'underwriting', 'LOI': 'loi',
    'Under Contract': 'under_contract', 'Closed': 'closed', 'Closed - Pre Development': 'closed', 'Monitor': 'monitor', 'Passed': 'passed',
    'Lost': 'lost', 'Dead': 'dead' };

  // deal row -> Intel opportunity object
  function dealToOpp(r, compSetLegacy) {
    const u = r.uw || {};
    const land = r.kind === 'land';
    let status = TO_STATUS[r.stage] || 'Sourcing';
    if (u.intelStatus && TO_STAGE[u.intelStatus] === r.stage) status = u.intelStatus;   // keeps Negotiating / Closed - Pre Development
    const roc = u.yieldOnCost != null ? num(u.yieldOnCost) : (u.roc != null ? num(u.roc) / 100 : null);
    const opp = {
      ...u,
      id: r.legacy?.opportunity_id || r.id,
      _dealId: r.id,
      name: r.name, address: r.address || u.address || '', city: u.city || '', submarket: u.submarket || u.where || '',
      oppType: land ? 'development' : 'investment', status,
      size: land ? num(r.acres) : num(r.units), units: num(r.units ?? u.doors),
      askingPrice: num(u.askingPrice) ?? num(r.guidance), pricingGuidance: num(r.guidance) ?? num(u.pricingGuidance),
      broker: r.broker || '', brokerContact: r.broker_contact || '', seller: r.seller || '',
      notes: r.summary || '',
      lat: num(r.lat), lng: num(r.lng),
      dateAdded: u.dateAdded || (r.created_at || '').slice(0, 10),
      callForOfferDate: r.bid_date || '',
      uwRentsPerSF: num(u.uwRentsPerSF ?? u.rentPsf), yieldOnCost: roc != null && roc > 1 ? roc / 100 : roc,
      productType: u.productType || u.product || '', yearBuilt: num(u.yearBuilt),
      compSetId: compSetLegacy || null,   // comp_sets.deal_id is the one source of truth for which set belongs to a deal
      updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : undefined,
    };
    delete opp.intelStatus;
    return opp;
  }
  // Intel opportunity -> deal columns (+ everything else kept in uw)
  const OPP_COLS = new Set(['id', '_dealId', 'name', 'address', 'status', 'oppType', 'size', 'units', 'askingPrice', 'pricingGuidance', 'broker',
    'brokerContact', 'seller', 'notes', 'lat', 'lng', 'callForOfferDate']);
  function oppToDeal(o, market) {
    const land = (o.oppType || 'development') !== 'investment';
    const uw = {};
    for (const [k, v] of Object.entries(o)) if (!OPP_COLS.has(k) && v !== undefined) uw[k] = v;
    delete uw.compSetId;   // the link lives on market.comp_sets.deal_id, not in the deal's uw
    if (o.askingPrice != null) uw.askingPrice = o.askingPrice;
    uw.intelStatus = o.status;
    return {
      market_id: market, name: o.name || 'Untitled', kind: land ? 'land' : 'asset',
      stage: TO_STAGE[o.status] || 'prospect', address: o.address || null,
      lat: num(o.lat), lng: num(o.lng), guidance: num(o.pricingGuidance) ?? num(o.askingPrice),
      bid_date: o.callForOfferDate || null, broker: o.broker || null, broker_contact: o.brokerContact || null, seller: o.seller || null,
      units: num(o.units), acres: land ? num(o.size) : null, summary: o.notes || null, uw,
    };
  }

  // ---------- sale comps ----------
  function compRowToLegacy(r) {
    const d = {
      id: r.legacy?.legacy_id || r.id, _uuid: r.id, name: r.name, address: r.address, city: r.city, submarket: r.submarket,
      lat: r.lat, lng: r.lng, saleDate: r.sale_date, salePrice: num(r.sale_price), units: num(r.units), proposedUnits: num(r.proposed_units),
      acreage: num(r.acres), yearBuilt: num(r.year_built), productType: r.product_type, constructionType: r.construction_type,
      pricePerUnit: num(r.price_per_unit), pricePerSF: num(r.comp_type === 'land' ? (r.price_per_land_sf ?? r.price_per_sf) : r.price_per_sf),
      pricePerLandSF: num(r.price_per_land_sf), capRate: num(r.cap_rate), buyer: r.buyer, seller: r.seller, broker: r.broker, notes: r.notes,
      source: r.source, sourceUrl: r.source_url, verified: r.verified,
      createdBy: r.created_by, updatedBy: r.updated_by, updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : undefined,
    };
    return { id: d.id, comp_type: r.comp_type, market: r.market_id, data: d, editor_name: r.updated_by, updated_at: r.updated_at };
  }
  function legacyToCompRow(compType, d, market) {
    return {
      market_id: market, comp_type: compType, name: d.name || null, address: d.address || null, city: d.city || null, submarket: d.submarket || null,
      lat: num(d.lat), lng: num(d.lng), sale_date: d.saleDate || null, sale_price: num(d.salePrice), units: num(d.units),
      proposed_units: num(d.proposedUnits), acres: num(d.acreage), year_built: num(d.yearBuilt), product_type: d.productType || null,
      construction_type: d.constructionType || null, price_per_unit: num(d.pricePerUnit),
      price_per_sf: compType === 'investment' ? num(d.pricePerSF) : null,
      price_per_land_sf: compType === 'land' ? (num(d.pricePerLandSF) ?? num(d.pricePerSF)) : null,
      cap_rate: num(d.capRate), buyer: d.buyer || null, seller: d.seller || null, broker: d.broker || null, notes: d.notes || null,
    };
  }

  // ---------- custom properties ----------
  function propRowToLegacy(r) {
    const a = r.attrs || {};
    const id = a.legacy_id || r.id;
    const data = { ...a, id, name: r.name, address: r.address, city: r.city, state: r.state, zip: r.zip, lat: r.lat, lng: r.lng, units: r.units,
      yearBuilt: r.year_built, stories: r.stories, avgUnitSF: r.avg_unit_sf, class: r.class, style: r.style, status: r.status, owner: r.owner,
      propertyManager: r.manager, developer: r.developer, submarket: r.costar_submarket };
    delete data.legacy_id;
    return { id, market: r.market_id, data, updated_at: r.updated_at };
  }
  function legacyToPropRow(d, market) {
    const COLS = ['id', 'name', 'address', 'city', 'state', 'zip', 'lat', 'lng', 'units', 'yearBuilt', 'stories', 'avgUnitSF', 'class', 'style', 'status',
      'owner', 'propertyManager', 'developer', 'submarket'];
    const attrs = {}; for (const [k, v] of Object.entries(d)) if (!COLS.includes(k)) attrs[k] = v;
    attrs.legacy_id = String(d.id);
    const st = d.status || 'Existing';
    return { market_id: market, kind: /under/i.test(st) ? 'under_construction' : /propos|plan/i.test(st) ? 'proposed' : 'existing',
      name: d.name || null, address: d.address || null, city: d.city || null, state: d.state || null, zip: d.zip ? String(d.zip) : null,
      lat: num(d.lat), lng: num(d.lng), units: num(d.units), year_built: num(d.yearBuilt), stories: num(d.stories), avg_unit_sf: num(d.avgUnitSF),
      class: d.class || null, style: d.style || null, status: st, owner: d.owner || null, manager: d.propertyManager || null,
      developer: d.developer || null, costar_submarket: d.submarket || null, source: 'manual', attrs };
  }

  // ---------- table handlers: select(filters) / upsert(rows) / remove(filters) ----------
  const H = {
    async opportunities_select() {
      const c = ctx();
      const [rows, sets] = await Promise.all([
        WB.fetchAll('pipeline', 'deals', '*', (q) => q.eq('market_id', c.market).is('merged_into', null)),
        WB.fetchAll('market', 'comp_sets', 'id,legacy_id,deal_id', (q) => q.eq('market_id', c.market)),
      ]);
      const setByDeal = Object.fromEntries(sets.filter((s) => s.deal_id).map((s) => [s.deal_id, s.legacy_id || s.id]));
      return rows.map((r) => {
        const data = dealToOpp(r, setByDeal[r.id]);
        return { id: data.id, market: c.market, data, editor_name: r.updated_by, updated_at: r.updated_at };
      });
    },
    async opportunities_upsert(row) {
      const c = ctx(), o = row.data || {};
      const patch = oppToDeal(o, c.market);
      const found = await findDeal(row.id);
      if (found) {
        delete patch.market_id;
        patch.uw = { ...(found.uw || {}), ...patch.uw };
        const { error } = await S('pipeline').from('deals').update(patch).eq('id', found.id); if (error) throw error;
        if (found.stage !== patch.stage) await S('pipeline').from('deal_log').insert({ deal_id: found.id, kind: 'stage', body: `Stage set to ${o.status} in Market Intel.` });
      } else {
        patch.legacy = { opportunity_id: String(row.id) };
        const { data, error } = await S('pipeline').from('deals').insert(patch).select('id').single(); if (error) throw error;
        await S('pipeline').from('deal_log').insert({ deal_id: data.id, kind: 'note', body: `Added in Market Intel as ${o.status}.` });
      }
      if (o.compSetId) await linkCompSet(o.compSetId, row.id);   // unlinking is explicit (LegacyDB.linkDealCompSet(deal, null))
    },
    async opportunities_remove(f) {
      const d = await findDeal(f.id); if (!d) return;
      // never a silent hard delete: removing in Market Intel archives the deal as Passed and logs it (delete for good from Opportunities)
      if (!['passed', 'lost', 'dead', 'closed'].includes(d.stage)) {
        const { error } = await S('pipeline').from('deals').update({ stage: 'passed' }).eq('id', d.id); if (error) throw error;
        await S('pipeline').from('deal_log').insert({ deal_id: d.id, kind: 'stage', body: 'Removed in Market Intel; archived as Passed.' });
      }
    },

    async custom_comps_select() {
      const rows = await WB.fetchAll('comps', 'sale_comps', '*', (q) => q.eq('market_id', ctx().market));
      return rows.map(compRowToLegacy);
    },
    async custom_comps_upsert(row) {
      const c = ctx(), patch = legacyToCompRow(row.comp_type, row.data || {}, c.market);
      const found = await findComp(row.id);
      // never move an existing comp to the market this page happens to show (the database sets market from location)
      if (found) { delete patch.market_id; const { error } = await S('comps').from('sale_comps').update(patch).eq('id', found.id); if (error) throw error; }
      else {
        patch.legacy = { legacy_id: String(row.id), origin: 'market-intel' }; patch.source = 'manual'; patch.verified = true;
        const { error } = await S('comps').from('sale_comps').insert(patch); if (error) throw error;
      }
    },
    async custom_comps_remove(f) {
      const found = await findComp(f.id); if (!found) return;
      const { error } = await S('comps').from('sale_comps').delete().eq('id', found.id); if (error) throw error;
    },
    // every comp now lives in sale_comps as an editable record, so there are no built-in comps to diff against
    async sale_comp_edits_select() { return []; },
    async sale_comp_edits_upsert() {},
    async sale_comp_edits_remove() {},

    async property_edits_select() {
      const rows = await WB.fetchAll('market', 'property_overrides', 'property_id,edits,updated_by,updated_at');
      return rows.filter((r) => ctx().costarByProp[r.property_id] || ctx().customProps.has(r.property_id))
        .map((r) => ({ property_id: legacyPropId(r.property_id), market: ctx().market, edits: r.edits, editor_name: r.updated_by, updated_at: r.updated_at }));
    },
    async property_edits_upsert(row) {
      const id = await propUuid(row.property_id); if (!id) throw new Error('Unknown property ' + row.property_id);
      const { error } = await S('market').from('property_overrides').upsert({ property_id: id, edits: row.edits || {} }); if (error) throw error;
    },
    async property_edits_remove(f) {
      const id = await propUuid(f.property_id); if (!id) return;
      const { error } = await S('market').from('property_overrides').delete().eq('property_id', id); if (error) throw error;
    },

    async property_snapshots_select() {
      const rows = await WB.fetchAll('market', 'property_snapshots', 'property_id,period,period_sort,data');
      return rows.filter((r) => ctx().costarByProp[r.property_id])
        .map((r) => ({ property_id: legacyPropId(r.property_id), period: r.period, period_sort: r.period_sort, data: r.data, market: ctx().market }));
    },

    async comp_fees_select() {
      const rows = await WB.fetchAll('market', 'comp_fees', 'property_id,fees,updated_by,updated_at');
      return rows.filter((r) => ctx().costarByProp[r.property_id] || ctx().customProps.has(r.property_id))
        .map((r) => ({ property_id: legacyPropId(r.property_id), market: ctx().market, fees: r.fees, editor_name: r.updated_by, updated_at: r.updated_at }));
    },
    async comp_fees_upsert(row) {
      const id = await propUuid(row.property_id); if (!id) throw new Error('Unknown property ' + row.property_id);
      const { error } = await S('market').from('comp_fees').upsert({ property_id: id, fees: row.fees || {} }); if (error) throw error;
    },

    async custom_properties_select() {
      const rows = await WB.fetchAll('core', 'properties', '*', (q) => q.eq('market_id', ctx().market).eq('source', 'manual').neq('kind', 'land'));
      return rows.map(propRowToLegacy);
    },
    async custom_properties_upsert(row) {
      const c = ctx(), patch = legacyToPropRow(row.data || {}, c.market);
      const id = await propUuid(row.id);
      if (id) { delete patch.market_id; const { error } = await S('core').from('properties').update(patch).eq('id', id); if (error) throw error; }
      else {
        const { data, error } = await S('core').from('properties').insert(patch).select('id').single(); if (error) throw error;
        c.propByCostar[String(row.id)] = data.id; c.costarByProp[data.id] = String(row.id); c.customProps.add(data.id);
      }
    },
    async custom_properties_remove(f) {
      const id = await propUuid(f.id); if (!id) return;
      const { error } = await S('core').from('properties').delete().eq('id', id).eq('source', 'manual'); if (error) throw error;
    },

    async comp_sets_select() {
      const c = ctx();
      const [sets, members] = await Promise.all([
        WB.fetchAll('market', 'comp_sets', '*', (q) => q.eq('market_id', c.market)),
        WB.fetchAll('market', 'comp_set_members', 'comp_set_id,property_id,sort'),
      ]);
      return sets.map((s) => {
        const ids = members.filter((m) => m.comp_set_id === s.id).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map((m) => legacyPropId(m.property_id));
        const id = s.legacy_id || s.id;
        return { id, uuid: s.id, deal_id: s.deal_id || null, market: c.market, name: s.name, description: s.description, property_ids: ids, editor_name: s.updated_by,
          created_at: s.created_at, updated_at: s.updated_at, data: { id, name: s.name, description: s.description || '', propertyIds: ids, dealId: s.deal_id || null } };
      });
    },
    async comp_sets_upsert(row) {
      const c = ctx();
      const found = await findCompSet(row.id);
      let setId;
      if (found) {
        setId = found.id;
        const { error } = await S('market').from('comp_sets').update({ name: row.name, description: row.description || null }).eq('id', setId); if (error) throw error;
        const { error: e2 } = await S('market').from('comp_set_members').delete().eq('comp_set_id', setId); if (e2) throw e2;
      } else {
        const { data, error } = await S('market').from('comp_sets').insert({ market_id: c.market, name: row.name, description: row.description || null, legacy_id: String(row.id) }).select('id').single();
        if (error) throw error; setId = data.id;
      }
      // deal link: written only when the caller says so (undefined = leave as is). One set per deal.
      if (row.deal_id !== undefined) {
        const dealId = row.deal_id || null;
        if (dealId) { const { error: e3 } = await S('market').from('comp_sets').update({ deal_id: null }).eq('deal_id', dealId).neq('id', setId); if (e3) throw e3; }
        const { error: e4 } = await S('market').from('comp_sets').update({ deal_id: dealId }).eq('id', setId); if (e4) throw e4;
      }
      const ids = [];
      for (const pid of row.property_ids || []) { const u = await propUuid(pid); if (u && !ids.includes(u)) ids.push(u); }
      if (ids.length) {
        const { error } = await S('market').from('comp_set_members').insert(ids.map((property_id, i) => ({ comp_set_id: setId, property_id, sort: i + 1 })));
        if (error) throw error;
      }
    },
    async comp_sets_remove(f) {
      const found = await findCompSet(f.id); if (!found) return;
      const { error } = await S('market').from('comp_sets').delete().eq('id', found.id); if (error) throw error;
    },
  };

  async function findDeal(legacyId) {
    const k = String(legacyId);
    if (isUuid(k)) { const { data } = await S('pipeline').from('deals').select('id,stage,uw').eq('id', k).limit(1); if (data && data[0]) return data[0]; }
    const { data } = await S('pipeline').from('deals').select('id,stage,uw').contains('legacy', { opportunity_id: k }).limit(1);
    return data && data[0];
  }
  async function findComp(legacyId) {
    const k = String(legacyId);
    if (isUuid(k)) { const { data } = await S('comps').from('sale_comps').select('id').eq('id', k).limit(1); if (data && data[0]) return data[0]; }
    const { data } = await S('comps').from('sale_comps').select('id').contains('legacy', { legacy_id: k }).limit(1);
    return data && data[0];
  }
  async function findCompSet(legacyId) {
    const k = String(legacyId);
    if (isUuid(k)) { const { data } = await S('market').from('comp_sets').select('id').eq('id', k).limit(1); if (data && data[0]) return data[0]; }
    const { data } = await S('market').from('comp_sets').select('id').eq('legacy_id', k).limit(1);
    return data && data[0];
  }
  // one set per deal: linking clears the deal from any other set; null unlinks the deal from every set
  async function linkCompSet(setLegacyId, oppLegacyId) {
    const [s, d] = await Promise.all([setLegacyId ? findCompSet(setLegacyId) : null, findDeal(oppLegacyId)]);
    if (!d) return;
    let q = S('market').from('comp_sets').update({ deal_id: null }).eq('deal_id', d.id);
    if (s) q = q.neq('id', s.id);
    await q;
    if (s) await S('market').from('comp_sets').update({ deal_id: d.id }).eq('id', s.id);
  }

  // ---------- the query builder the dashboard talks to ----------
  function from(table) {
    let op = 'select', rows = null; const filters = {};
    const q = {
      select() { return q; },
      eq(col, val) { filters[col] = val; return q; },
      order() { return q; }, limit() { return q; },
      upsert(r) { op = 'upsert'; rows = Array.isArray(r) ? r : [r]; return q; },
      insert(r) { op = 'upsert'; rows = Array.isArray(r) ? r : [r]; return q; },
      update(r) { op = 'upsert'; rows = [r]; return q; },
      delete() { op = 'remove'; return q; },
      then(res, rej) { return run().then(res, rej); },
    };
    async function run() {
      const h = H[`${table}_${op}`];
      if (!h) { console.warn('[legacy-db] no handler for', table, op); return ok(op === 'select' ? [] : null); }
      try {
        if (op === 'select') {
          let data = await h(filters);
          for (const [k, v] of Object.entries(filters)) if (k !== 'market') data = data.filter((r) => String(r[k]) === String(v));
          return ok(data);
        }
        if (op === 'upsert') { for (const r of rows) await h(r); return ok(null); }
        await h(filters); return ok(null);
      } catch (e) { console.error('[legacy-db]', table, op, e); return fail({ message: e.message || String(e), code: e.code }); }
    }
    return q;
  }
  const noopChannel = () => { const ch = { on: () => ch, subscribe: () => ch, unsubscribe: () => {} }; return ch; };

  window.LegacyDB = {
    from, channel: noopChannel, removeChannel: () => {},
    auth: sb.auth,
    storage: { from: () => ({ download: async () => fail({ message: 'not available' }), upload: async () => fail({ message: 'not available' }) }) },
    linkDealCompSet: (oppLegacyId, setLegacyId) => linkCompSet(setLegacyId || null, oppLegacyId),
    _internals: { dealToOpp, oppToDeal, compRowToLegacy, legacyToCompRow },
  };
})();
