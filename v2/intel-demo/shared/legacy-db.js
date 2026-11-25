/* Market Intel Demo's own copy of v2/shared/legacy-db.js (copied Nov 20 2026). Edit this one for the Demo. */
/* Willow Bridge Canopy: legacy table adapter for the Market Intel dashboard.
   The dashboard was written against flat public tables (custom_comps, property_edits, comp_sets, ...).
   This object answers those same calls (.from(t).select().eq().upsert().delete()) and reads/writes the new
   core / market / comps tables underneath, so the dashboard code can stay as it is.
   Demo copy: nothing here reads or writes Canopy's deals (pipeline schema).
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
    async custom_comps_select() {
      let rows = await WB.fetchAll('comps', 'sale_comps', '*', (q) => q.eq('market_id', ctx().market));
      // Demo copy: same scope as the Sale Comps page (not excluded; investment sales 100+ units, built 1970 or later; unknown stays in)
      if (window.__WB_SALE_SCOPE) rows = rows.filter((c) => !c.excluded && (c.comp_type !== 'investment' || ((c.units == null || +c.units >= 100) && (c.year_built == null || +c.year_built >= 1970))));
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
      if (sets.length && !('settings' in sets[0])) window.__WB_CS_NO_SETTINGS = true;   // column not added yet: per-set settings stay in each browser
      return sets.map((s) => {
        const ids = members.filter((m) => m.comp_set_id === s.id).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map((m) => legacyPropId(m.property_id));
        const id = s.legacy_id || s.id;
        return { id, uuid: s.id, market: c.market, name: s.name, description: s.description, property_ids: ids, editor_name: s.updated_by,
          created_at: s.created_at, updated_at: s.updated_at, data: { id, name: s.name, description: s.description || '', propertyIds: ids, settings: s.settings || {} } };
      });
    },
    async comp_sets_upsert(row) {
      const c = ctx();
      const found = await findCompSet(row.id);
      // resolve members first; never empty a set because its ids belong to another market or failed to resolve
      const ids = [];
      for (const pid of row.property_ids || []) { const u = await propUuid(pid); if (u && !ids.includes(u)) ids.push(u); }
      const asked = (row.property_ids || []).length;
      if (found && found.market_id && found.market_id !== c.market) throw new Error(`Comp set "${row.name}" belongs to ${found.market_id}; not saved while ${c.market} is loaded.`);
      if (asked && ids.length < asked) throw new Error(`Comp set "${row.name}": ${asked - ids.length} of ${asked} properties couldn't be matched, so nothing was saved.`);
      let setId;
      if (found) {
        setId = found.id;
        const { error } = await withSettings(row, (extra) => S('market').from('comp_sets').update({ name: row.name, description: row.description || null, updated_at: new Date().toISOString(), updated_by: (window.__WBD && window.__WBD.user && window.__WBD.user.email) || undefined, ...extra }).eq('id', setId)); if (error) throw error;
        const { error: e2 } = await S('market').from('comp_set_members').delete().eq('comp_set_id', setId); if (e2) throw e2;
      } else {
        const { data, error } = await withSettings(row, (extra) => S('market').from('comp_sets').insert({ market_id: c.market, name: row.name, description: row.description || null, legacy_id: String(row.id), ...extra }).select('id').single());
        if (error) throw error; setId = data.id;
      }
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

  async function findComp(legacyId) {
    const k = String(legacyId);
    if (isUuid(k)) { const { data } = await S('comps').from('sale_comps').select('id').eq('id', k).limit(1); if (data && data[0]) return data[0]; }
    const { data } = await S('comps').from('sale_comps').select('id').contains('legacy', { legacy_id: k }).limit(1);
    return data && data[0];
  }
  // comp_sets.settings arrives with tools/supabase/20261123_comp_sets_settings.sql; until it's run, save without it
  async function withSettings(row, run) {
    if (row.settings === undefined || window.__WB_CS_NO_SETTINGS) return run({});
    const r = await run({ settings: row.settings || {} });
    if (r.error && /settings/i.test(r.error.message || '')) { window.__WB_CS_NO_SETTINGS = true; return run({}); }
    return r;
  }
  async function findCompSet(legacyId) {
    const k = String(legacyId);
    if (isUuid(k)) { const { data } = await S('market').from('comp_sets').select('id,market_id').eq('id', k).limit(1); if (data && data[0]) return data[0]; }
    const { data } = await S('market').from('comp_sets').select('id,market_id').eq('legacy_id', k).limit(1);
    return data && data[0];
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
        // demo copy: never write (the old layer re-pushes cached records on every load, and its browser cache is shared across markets)
        if (op !== 'select' && window.__WB_DEMO_READONLY) { console.info('[legacy-db] demo is read-only; skipped', table, op); return ok(null); }
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
    _internals: { compRowToLegacy, legacyToCompRow },
    // Hand updates (property card Save, fee schedule, comp set Update forms): explicit saves only, straight to the database.
    // The boot-time reconcile that re-pushes browser caches stays blocked by read-only.
    direct: {
      saveEdits: (pid, edits) => H.property_edits_upsert({ property_id: pid, edits: edits || {} }),
      removeEdits: (pid) => H.property_edits_remove({ property_id: pid }),
      saveFees: (pid, fees) => H.comp_fees_upsert({ property_id: pid, fees: fees || {} }),
      // a project added by hand (not in CoStar yet): core.properties, source 'manual'
      saveCustomProp: (rec) => H.custom_properties_upsert({ id: rec.id, data: rec }),
      saveComp: (type, comp) => H.custom_comps_upsert({ id: comp.id, comp_type: type, data: comp }),
      removeComp: (type, id) => H.custom_comps_remove({ id, comp_type: type }),
      // Property card "Remove from the dashboard": a hand-added project is deleted outright;
      // a CoStar property moves to core.properties_removed (restorable, and later uploads skip its CoStar id).
      // Overrides, fees, snapshots and comp set memberships go with it (cascade); linked records elsewhere just unlink.
      async removeProperty(legacyId, reason) {
        const id = await propUuid(legacyId); if (!id) throw new Error('property not found in the database');
        const { data: row, error: e1 } = await S('core').from('properties').select('*').eq('id', id).single(); if (e1) throw e1;
        if (row.source !== 'manual') {
          const who = (window.__WBD && window.__WBD.user && window.__WBD.user.email) || '';
          const x = Object.assign({}, row); delete x.geom;
          x.attrs = Object.assign({}, x.attrs || {}, { _removed: { reason: reason || 'Removed from the property card', by: who, at: new Date().toISOString() } });
          const { error: e2 } = await S('core').from('properties_removed').insert(x);
          if (e2) { const err = new Error(/row-level security/i.test(e2.message || '') ? 'you don’t have edit access in this market' : (e2.message || 'the database refused the change')); err.cause = e2; throw err; }
        }
        const { error: e3 } = await S('core').from('properties').delete().eq('id', id); if (e3) throw e3;
        const c = ctx(); delete c.propByCostar[String(legacyId)]; delete c.costarByProp[id]; if (c.customProps) c.customProps.delete(id);
        return { source: row.source };
      },
    },
    // Comp Sets tab: explicit saves only, so they go straight to the database even in the read-only Demo
    // (read-only exists to stop the old layer re-pushing cached records on load; a button press is not that)
    compSets: {
      async save(set) {
        // set.id is stable (legacy id, or the uuid for sets made elsewhere); findCompSet matches either
        await H.comp_sets_upsert({ id: set.id, name: set.name, description: set.description || '', property_ids: set.propertyIds || [], settings: set.settings || {} });
        const f = await findCompSet(set.id); return f ? f.id : null;
      },
      async remove(set) { await H.comp_sets_remove({ id: set.id }); },
    },
  };
})();
