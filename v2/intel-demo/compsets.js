/* Market Intel Demo — Comp Sets tab.
   One home for comp sets: a library of every saved set, and a workspace to build, edit and analyse one.
   Opening a set makes it the active set, which scopes every tab (pill in the page header, × to clear).
   Saves go straight to the database (LegacyDB.compSets), even though the rest of the Demo's old sync layer is read-only.
   Loaded after app.js; uses its globals (compSets, state, RAW_DATA, applyUserEdits, activateCompSet, exitCompSet, …). */
(function compSetsTab() {
  const view = document.getElementById('view-compsets');
  if (!view || typeof compSets === 'undefined') return;
  const E = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const all = () => RAW_DATA.map(applyUserEdits);
  const byId = () => new Map(all().map((p) => [String(p.id), p]));
  const occOf = (p) => (p.vacancy == null ? null : 100 - p.vacancy);
  const wksOf = (p) => { try { const c = concessionStats(p); if (c && c.weeksFree != null) return c.weeksFree; } catch (e) {} return p.concessions == null ? null : (p.concessions / 100) * 52; };
  const membersOf = (cs, map) => (cs.propertyIds || []).map((id) => (map || byId()).get(String(id))).filter(Boolean);
  const UI = { upd: null, open: null, q: '', creating: false, from: 'empty', add: '', near: null, radius: 1, nearExisting: true, nearYear: '', save: {}, confirmDel: false };
  const mi = (a, b) => { const R = 3958.8, t = (x) => (x * Math.PI) / 180; const dl = t(b.lat - a.lat), dn = t(b.lng - a.lng); const h = Math.sin(dl / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const money = (v) => (v == null ? '—' : '$' + v.toFixed(2));
  const pct = (v) => (v == null ? '—' : v.toFixed(1) + '%');
  const wks = (v) => (v == null ? '—' : v.toFixed(1));
  const day = (t) => (t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
  const who = (s) => (s ? String(s).split('@')[0].replace(/^./, (c) => c.toUpperCase()) : '');

  function stats(ps) {
    const wa = (f) => { let s = 0, w = 0; ps.forEach((p) => { const v = f(p); if (v != null && !isNaN(v) && p.units) { s += v * p.units; w += p.units; } }); return w ? s / w : null; };
    const yrs = ps.map((p) => p.yearBuilt).filter(Boolean).sort((a, b) => a - b);
    const ex = ps.filter((p) => p.status === 'Existing');
    return { n: ps.length, units: ps.reduce((s, p) => s + (p.units || 0), 0), ask: wa((p) => p.avgAskingSF), askU: wa((p) => p.avgAskingUnit), eff: wa((p) => p.avgEffectiveSF),
      occ: (() => { let s = 0, w = 0; ex.forEach((p) => { const o = occOf(p); if (o != null && p.units) { s += o * p.units; w += p.units; } }); return w ? s / w : null; })(),
      sf: wa((p) => p.avgUnitSF), wks: wa(wksOf), yr: yrs.length ? (yrs[0] === yrs[yrs.length - 1] ? String(yrs[0]) : `${yrs[0]}–${yrs[yrs.length - 1]}`) : '—',
      uc: ps.filter((p) => p.status !== 'Existing').length };
  }

  // ---------- saving ----------
  const timers = {};
  function touch(cs) { cs.updatedAt = Date.now(); cs.updatedBy = (window.WB && WB.user && WB.user.email) || cs.updatedBy; try { saveCompSets(); } catch (e) {} queueSave(cs); }
  function queueSave(cs) { UI.save[cs.id] = 'pending'; paintSave(cs); clearTimeout(timers[cs.id]); timers[cs.id] = setTimeout(() => saveNow(cs), 700); }
  // one save at a time per set, so quick edits can't race and insert the set twice
  const chain = {};
  function saveNow(cs) { chain[cs.id] = (chain[cs.id] || Promise.resolve()).then(() => saveOnce(cs)); return chain[cs.id]; }
  async function saveOnce(cs) {
    if (!compSets[cs.id]) return;
    if (!window.LegacyDB || !LegacyDB.compSets) { UI.save[cs.id] = 'error:Saving isn’t available'; paintSave(cs); return; }
    UI.save[cs.id] = 'saving'; paintSave(cs);
    try { const uuid = await LegacyDB.compSets.save(cs); if (uuid) cs.uuid = uuid; try { saveCompSets(); } catch (e) {} UI.save[cs.id] = 'saved'; }
    catch (e) { UI.save[cs.id] = 'error:' + (e.message || e); }
    paintSave(cs); if (!UI.open) render();
  }
  function saveLabel(cs) {
    const s = UI.save[cs.id];
    if (s === 'pending' || s === 'saving') return '<span class="csx-save">Saving…</span>';
    if (s && s.startsWith('error:')) return `<span class="csx-save bad">Not saved: ${E(s.slice(6))} <button type="button" class="csx-retry">Retry</button></span>`;
    if (!cs.uuid) return '<span class="csx-save warn">Only in this browser <button type="button" class="csx-retry">Save to database</button></span>';
    return `<span class="csx-save ok">Saved${cs.updatedAt ? ' · ' + day(cs.updatedAt) : ''}</span>`;
  }
  function paintSave(cs) {
    const el = view.querySelector('.csx-savebox'); if (!el || UI.open !== cs.id) return;
    el.innerHTML = saveLabel(cs); const r = el.querySelector('.csx-retry'); if (r) r.onclick = () => saveNow(cs);
  }

  // ---------- open / close ----------
  function openSet(id) {
    UI.open = id; UI.add = ''; UI.near = null; UI.confirmDel = false; UI.menu = false; UI.creating = false;
    if (state.activeCompSetId !== id || state.compSetMode !== 'viewing') activateCompSet(id); else render();
    goTab();
  }
  function goTab() { const t = document.querySelector('.tab[data-view="compsets"]'); if (t && !t.classList.contains('active')) t.click(); else render(); window.scrollTo({ top: 0 }); }
  window.wbOpenCompSets = (opts) => { if (opts && opts.create) { UI.open = null; UI.creating = true; UI.from = opts.from || 'empty'; } else if (opts && opts.id) { return openSet(opts.id); } goTab(); };

  // ---------- library ----------
  function library() {
    const map = byId();
    const q = UI.q.trim().toLowerCase();
    const sets = Object.values(compSets).filter((s) => !q || (s.name + ' ' + (s.description || '')).toLowerCase().includes(q))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const total = Object.keys(compSets).length;
    const rows = sets.map((cs) => {
      const ps = membersOf(cs, map), s = stats(ps), active = state.compSetMode === 'viewing' && state.activeCompSetId === cs.id;
      return `<tr data-id="${E(cs.id)}" class="csx-row">
        <td><div class="csx-nm">${E(cs.name)}${active ? '<span class="csx-tag on">In use</span>' : ''}${!cs.uuid ? '<span class="csx-tag warn">This browser only</span>' : ''}</div>${cs.description ? `<div class="csx-addr">${E(cs.description)}</div>` : ''}</td>
        <td class="num">${s.n}</td><td class="num">${s.units.toLocaleString()}</td><td class="num">${s.yr}</td><td class="num">${money(s.ask)}</td><td class="num">${money(s.eff)}</td>
        <td class="num">${pct(s.occ)}</td><td class="num">${wks(s.wks)}</td>
        <td title="${E(cs.updatedBy || cs.createdBy || '')}">${day(cs.updatedAt)}</td></tr>`;
    }).join('');
    return `
      ${UI.creating ? creator() : ''}
      <div class="panel">
        <div class="panel-header">
          <div><div class="panel-title">Saved comp sets</div><div class="panel-sub">${total ? `${total} for ${E((window.__WBD && window.__WBD.title) || 'this market')} · open one to edit it and run the dashboard on it` : 'One set per deal you underwrite · the YOC matrix and every tab can then run on just those comps'}</div></div>
          <div class="csx-acts">${total > 6 ? `<input class="csx-in csx-q" placeholder="Search sets…" value="${E(UI.q)}">` : ''}${UI.creating ? '' : '<button type="button" class="yx-btn yx-btn-primary csx-new">New comp set</button>'}</div>
        </div>
        ${total ? `<div class="panel-body tight"><div class="table-scroll"><table class="csx-table">
          <thead><tr><th>Set</th><th class="num">Properties</th><th class="num">Units</th><th class="num">Built</th><th class="num">Asking $/SF</th><th class="num">Effective $/SF</th><th class="num">Occupancy</th><th class="num">Weeks free</th><th>Updated</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="9" class="csx-none">No sets match "${E(UI.q)}"</td></tr>`}</tbody></table></div></div>`
        : `<div class="csx-empty"><b>No comp sets yet</b><span>Start one from scratch, from the properties near a site, or from your Property Index results.</span>${UI.creating ? '' : '<button type="button" class="yx-btn yx-btn-primary csx-new">New comp set</button>'}</div>`}
      </div>`;
  }

  // ---------- new set ----------
  function idxRows() { try { return (window.__pxLast && window.__pxLast.length) ? window.__pxLast : (typeof window.pxApply === 'function' ? window.pxApply(getFiltered()) : []); } catch (e) { return []; } }
  function creator() {
    const n = idxRows().length;
    const opt = (k, t, s) => `<label class="csx-opt${UI.from === k ? ' on' : ''}"><input type="radio" name="csx-from" value="${k}" ${UI.from === k ? 'checked' : ''}><span><b>${t}</b><small>${s}</small></span></label>`;
    return `<div class="panel csx-create">
      <div class="panel-header"><div><div class="panel-title">New comp set</div><div class="panel-sub">Name it, choose where to start, then add or remove properties</div></div></div>
      <div class="panel-body">
        <div class="csx-form">
          <label class="csx-f"><span>Name</span><input class="csx-in csx-nm-in" placeholder="e.g. Littleton Equine" maxlength="80"></label>
          <label class="csx-f"><span>Deal or site <em>optional</em></span><input class="csx-in csx-ds" placeholder="e.g. 8025 S Santa Fe Dr · 393 units" maxlength="120"></label>
        </div>
        <div class="csx-opts">
          ${opt('empty', 'Start empty', 'Add properties by search or radius next')}
          ${opt('near', 'Properties near a site', 'Pick a property or site, then a radius')}
          ${opt('index', `Property Index results${n ? ` (${n})` : ''}`, n ? 'Everything your current Index filters show' : 'Set filters in the Property Index first')}
        </div>
        <div class="csx-bar"><button type="button" class="yx-btn yx-btn-primary csx-make">Create comp set</button><button type="button" class="yx-btn csx-cancel">Cancel</button><span class="csx-msg"></span></div>
      </div>
    </div>`;
  }
  function create() {
    const name = (view.querySelector('.csx-nm-in').value || '').trim(), msg = view.querySelector('.csx-msg');
    if (!name) { msg.textContent = 'Name the set first.'; view.querySelector('.csx-nm-in').focus(); return; }
    if (Object.values(compSets).some((s) => s.name.toLowerCase() === name.toLowerCase())) { msg.textContent = 'A set with that name already exists.'; return; }
    const from = (view.querySelector('input[name=csx-from]:checked') || {}).value || 'empty';
    if (from === 'index' && !idxRows().length) { msg.textContent = 'The Property Index has no results to start from.'; return; }
    const id = 'cs-' + Date.now();
    compSets[id] = { id, name, description: (view.querySelector('.csx-ds').value || '').trim(), propertyIds: from === 'index' ? idxRows().map((p) => p.id) : [],
      createdBy: (window.WB && WB.user && WB.user.email) || '', createdAt: Date.now(), updatedAt: Date.now() };
    touch(compSets[id]);
    openSet(id);
    if (from === 'near') { UI.add = 'near'; render(); setTimeout(() => { const i = view.querySelector('.csx-near-q'); if (i) i.focus(); }, 50); }
    else if (from === 'empty') { setTimeout(() => { const i = view.querySelector('.csx-add-q'); if (i) i.focus(); }, 50); }
  }

  // ---------- phases: existing (stabilized), lease-up, pipeline ----------
  const STAB = 0.95;   // same stabilization line as the Absorption panel
  const BEDS = [['studio', 'Studio', 'unitsStudio'], ['one', '1 Bed', 'units1Bed'], ['two', '2 Bed', 'units2Bed'], ['three', '3 Bed', 'units3Bed']];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ed = (p) => (typeof userEdits !== 'undefined' && userEdits[p.id]) || {};
  const isStalled = (p) => /stall/i.test(ed(p).pipelineStage || p.pipelineStage || '');
  const isProposed = (p) => !isStalled(p) && typeof isPlannedProposed === 'function' && isPlannedProposed(p);
  const leaseStartOf = (p) => (p.preLeaseStart ? new Date(p.preLeaseStart + 'T12:00:00') : (typeof monthYearToDate === 'function' ? monthYearToDate(p.monthBuilt, p.yearBuilt, p.dayBuilt) : null));
  const asOfOf = (p) => { try { return occAsOf(p); } catch (e) { return new Date(); } };
  const moBetween = (a, b) => (b - a) / 86400000 / 30.44;
  function phaseOf(p) {
    if (p.status !== 'Existing') return 'pipe';
    const f = ed(p)._phase; if (f === 'lease') return 'lease'; if (f === 'exist') return 'exist';
    const d = leaseStartOf(p), o = occOf(p); if (!d) return 'exist';
    const m = moBetween(d, asOfOf(p));
    return m <= 12 || (m <= 30 && o != null && o < STAB * 100) ? 'lease' : 'exist';
  }
  // velocity = units leased so far / months since leasing started (delivery unless a lease start is entered)
  function leaseOf(p) {
    const d = leaseStartOf(p), asOf = asOfOf(p), o = occOf(p), r = { d, asOf, o };
    if (!d || o == null || !p.units) return r;
    r.mo = Math.max(1, moBetween(d, asOf)); r.leased = (p.units * o) / 100; r.v = r.leased / r.mo; r.target = p.units * STAB;
    r.done = r.leased >= r.target;
    if (!r.done && r.v > 0) { r.left = (r.target - r.leased) / r.v; r.stab = new Date(+asOf + r.left * 30.44 * 86400000); }
    return r;
  }
  const monYr = (d) => (d ? MON[d.getMonth()] + ' ' + d.getFullYear() : '—');
  const deliveryOf = (p) => { const d = typeof monthYearToDate === 'function' ? monthYearToDate(p.monthBuilt, p.yearBuilt, p.dayBuilt) : null; return d; };
  // when the row's figures were last touched by hand, else the CoStar load date
  function lastUpd(p) {
    const m = ed(p)._meta || {}, f = (typeof compFees !== 'undefined' && compFees[p.id] && compFees[p.id]._meta) || {};
    let best = null; [m, f].forEach((o) => Object.values(o).forEach((x) => { if (x && x.at && (!best || x.at > best.at)) best = x; }));
    if (!best && ed(p)._updatedAt) best = { at: ed(p)._updatedAt, by: ed(p)._updatedBy, src: 'Hand entry' };
    if (!best && p._addedAt) best = { at: p._addedAt, by: p._addedBy, src: 'Added by hand' };
    return best;
  }
  function updCell(p) {
    const u = lastUpd(p);
    if (!u) return `<td class="csx-upd-c src-cs" title="CoStar figures, not checked by hand yet">CoStar</td>`;
    const old = Date.now() - u.at > 92 * 86400000, d = new Date(u.at);
    const short = MON[d.getMonth()] + ' ' + d.getDate() + (d.getFullYear() !== new Date().getFullYear() ? ', ' + d.getFullYear() : '');
    return `<td class="csx-upd-c${old ? ' old' : ''}" title="${E((u.src || 'Hand entry') + ' · ' + day(u.at) + (u.by ? ' · ' + who(u.by) : '') + (old ? ' · due for an update' : ''))}"><i></i>${short}</td>`;
  }
  const PEN = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.3 2.3a1.6 1.6 0 0 1 2.3 2.3L5.4 12.8 2.5 13.5l.7-2.9z"/></svg>';
  const updBtn = (p) => `<button type="button" class="csx-updbtn${UI.upd === String(p.id) ? ' on' : ''}" title="${UI.upd === String(p.id) ? 'Close' : 'Update this property'}" aria-label="Update ${E(p.name || '')}">${UI.upd === String(p.id) ? '×' : PEN}</button>`;
  const nameCell = (p, sub) => `<td><button type="button" class="csx-pname">${E(p.name || p.address)}</button><div class="csx-addr">${E(p.address || '')}${sub ? ' · ' + sub : ''}</div></td>`;
  const rmCell = (p) => `<td class="csx-x"><button type="button" class="csx-rm" title="Remove from set" aria-label="Remove ${E(p.name)}">×</button></td>`;
  const n0 = (v) => (v == null || isNaN(v) ? '' : String(Math.round(v * 100) / 100));
  // concessions as the website quotes them, converted to weeks free on a 12-month lease
  const CTYPES = [['weeks', 'Weeks free'], ['months', 'Months free'], ['onetime', '$ off at move-in'], ['monthly', '$ off monthly rent'], ['none', 'No concession']];
  const conOf = (p) => ((typeof compFees !== 'undefined' && compFees[p.id] && compFees[p.id].concession) || null);
  const handWks = (p) => { const f = typeof compFees !== 'undefined' && compFees[p.id]; return f && f.weeksFree != null && f.weeksFree !== '' ? +f.weeksFree : null; };
  function toWeeks(type, amt, term, rent) {
    if (type === 'none') return 0;
    if (amt == null) return null;
    const L = term || 12;
    if (type === 'weeks') return (amt * 12) / L;
    if (type === 'months') return (amt * 52 / 12) * (12 / L);
    if (!rent) return null;
    if (type === 'onetime') return (amt / (rent * 12 / 52)) * (12 / L);
    if (type === 'monthly') return (amt / rent) * 52;
    return null;
  }
  const conText = (c) => { if (!c) return ''; if (c.type === 'none') return 'No concession'; const a = c.amount; const t = c.type === 'weeks' ? `${a} wk${a == 1 ? '' : 's'} free` : c.type === 'months' ? `${a} mo free` : c.type === 'onetime' ? `$${Math.round(a).toLocaleString()} off move-in` : `$${Math.round(a).toLocaleString()}/mo off`; return t + (c.term && c.term != 12 ? ` on ${c.term}-mo lease` : '') + (c.text ? ` · ${c.text}` : ''); };
  const wksCell = (p) => { const h = handWks(p), c = conOf(p); return h != null ? `<td class="num" title="${E(conText(c) || 'Entered by hand')}">${wks(h)}</td>` : `<td class="num csx-cs" title="CoStar concession, not checked yet">${wks(wksOf(p))}</td>`; };
  const SRCS = ['Property website', 'CoStar', 'Call / tour', 'Drive-by', 'Other'];

  function updForm(p, ph, cols) {
    const e = ed(p), fees = (typeof getFees === 'function' ? getFees(p.id) : {}) || {}, today = new Date().toISOString().slice(0, 10);
    const head = `<div class="csx-uf-head"><b>Update ${E(p.name || p.address)}</b>
      <label>As of <input type="date" class="csx-in csx-uf-asof" value="${today}"></label>
      <label>Source <select class="csx-in csx-uf-src">${SRCS.map((x) => `<option${x === (((lastUpd(p) || {}).src) || (ph === 'pipe' ? 'Drive-by' : '')) ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
      ${lastUpd(p) ? `<span class="csx-uf-last">Last updated ${day(lastUpd(p).at)}${lastUpd(p).by ? ' by ' + E(who(lastUpd(p).by)) : ''}</span>` : '<span class="csx-uf-last">Showing CoStar figures</span>'}</div>`;
    const notes = `<label class="csx-uf-notes"><span>Notes</span><textarea class="csx-in csx-uf-f" data-f="notes" rows="2" placeholder="${ph === 'pipe' ? 'Site visit: framing on level 3, cranes down…' : 'Specials, renovation, management change…'}">${E(e.notes || p.notes || '')}</textarea></label>`;
    const loc = `<div class="csx-uf-loc"><span class="csx-uf-loch">Map location</span>
      <input class="csx-in csx-uf-ll" value="${p.lat != null ? (+p.lat).toFixed(6) + ', ' + (+p.lng).toFixed(6) : ''}" placeholder="lat, lng (paste from Google Maps)" aria-label="Latitude, longitude">
      <button type="button" class="yx-btn csx-uf-pin">Move pin on map</button>${ed(p).lat != null ? '<small>Moved by hand</small>' : ''}
      <div class="csx-uf-map" hidden></div></div>`;
    const bar = `<div class="csx-bar"><button type="button" class="yx-btn yx-btn-primary csx-uf-save">Save update</button><button type="button" class="yx-btn csx-uf-x">Cancel</button><span class="csx-msg"></span></div>`;
    let body;
    if (ph === 'pipe') {
      const d = deliveryOf(p), mv = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
      body = `<div class="csx-uf-grid">
        <label><span>Stage</span><select class="csx-in csx-uf-f csx-uf-stage" data-f="pipelineStage"><option value="UC"${!isProposed(p) && !isStalled(p) ? ' selected' : ''}>Under construction</option><option value="Proposed"${isProposed(p) ? ' selected' : ''}>Proposed</option><option value="Stalled"${isStalled(p) ? ' selected' : ''}>Stalled</option><option value="Delivered">Delivered</option></select></label>
        <label><span>Developer</span><input class="csx-in csx-uf-f" data-f="developer" value="${E(p.developer || '')}" maxlength="80"></label>
        <label><span>Product type</span><input class="csx-in csx-uf-f" data-f="style" value="${E(p.style || '')}" list="csx-styles" maxlength="40"></label>
        <label><span>Acres</span><input type="number" class="csx-in csx-uf-f" data-f="acreage" value="${p.acreage || p.acres || ''}" min="0" step="0.01"></label>
        <label><span>Construction start</span><input type="month" class="csx-in csx-uf-f" data-f="startMonth" value="${(() => { const d = begunOf(p); return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : ''; })()}"></label>
        <label><span class="csx-uf-dl">Estimated completion</span><input type="month" class="csx-in csx-uf-f" data-f="estDelivery" value="${mv}"></label>
        <label class="csx-uf-dv" hidden><span>Occupancy % now <em>optional</em></span><input type="number" class="csx-in csx-uf-f" data-f="occ" min="0" max="100" step="0.1"></label>
        <label><span>Units</span><input type="number" class="csx-in csx-uf-f" data-f="units" value="${p.units || ''}" min="0"></label>
      </div>${notes}<datalist id="csx-styles">${[...new Set(all().map((x) => x.style).filter(Boolean))].sort().map((x) => `<option value="${E(x)}">`).join('')}</datalist>`;
    } else {
      const rows = BEDS.map(([k, l, uk]) => {
        const sf = p[k + 'SF'];
        return `<tr data-b="${k}"><td>${l}</td><td><input type="number" class="csx-in csx-uf-f" data-f="${uk}" value="${p[uk] == null ? '' : p[uk]}" min="0"></td><td class="num">${sf ? Math.round(sf).toLocaleString() : '—'}</td>
          <td><input type="number" class="csx-in csx-uf-f csx-uf-rent" data-f="${k}Rent" value="${n0(p[k + 'Rent'])}" min="0" step="1" placeholder="$/mo"></td><td class="num csx-uf-psf">${sf && p[k + 'Rent'] ? '$' + (p[k + 'Rent'] / sf).toFixed(2) : '—'}</td></tr>`;
      }).join('');
      const ls = leaseStartOf(p), lsv = ls ? `${ls.getFullYear()}-${String(ls.getMonth() + 1).padStart(2, '0')}` : '';
      body = `<div class="csx-uf-cols">
        <div><table class="csx-uf-mix"><thead><tr><th>Unit type</th><th>Units</th><th class="num">Avg SF</th><th>Asking $/mo</th><th class="num">$/SF</th></tr></thead><tbody>${rows}</tbody></table>
          <div class="csx-uf-avg">Average asking <b class="csx-uf-avgv">${money(p.avgAskingSF)}/SF · ${p.avgAskingUnit ? '$' + Math.round(p.avgAskingUnit).toLocaleString() + '/mo' : '—'}</b> <small>mix-weighted; effective rents are recalculated from weeks free</small></div></div>
        <div class="csx-uf-grid">
          <label><span>Occupancy %</span><input type="number" class="csx-in csx-uf-f" data-f="occ" value="${n0(occOf(p))}" min="0" max="100" step="0.1"></label>
          <div class="csx-uf-con">
            <label><span>Concession offered</span><select class="csx-in csx-uf-ct">${CTYPES.map(([k, l]) => `<option value="${k}"${(conOf(p) ? conOf(p).type : 'weeks') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
            <label><span>Amount</span><input type="number" class="csx-in csx-uf-ca" value="${conOf(p) ? n0(conOf(p).amount) : (handWks(p) != null ? n0(handWks(p)) : '')}" min="0" step="0.5" placeholder="${handWks(p) == null && wksOf(p) != null ? 'CoStar: ' + wks(wksOf(p)) + ' wks' : ''}"></label>
            <label><span>Lease term (mo)</span><input type="number" class="csx-in csx-uf-cl" value="${conOf(p) && conOf(p).term ? conOf(p).term : 12}" min="1" step="1"></label>
            <label class="csx-uf-cx"><span>As advertised</span><input class="csx-in csx-uf-cd" value="${E(conOf(p) ? conOf(p).text || '' : '')}" placeholder="e.g. select 2 beds, 13+ mo leases" maxlength="140"></label>
            <div class="csx-uf-cw">= <b>${handWks(p) != null ? wks(handWks(p)) : '—'}</b> weeks free on a 12-month lease</div>
          </div>
          ${ph === 'lease' ? `<label><span>Leasing started</span><input type="month" class="csx-in csx-uf-f" data-f="leaseStart" value="${lsv}"><small>Delivery date unless you change it</small></label>` : ''}
          <label><span>Treat as</span><select class="csx-in csx-uf-f" data-f="_phase"><option value="">Automatic</option><option value="lease"${e._phase === 'lease' ? ' selected' : ''}>Lease-up</option><option value="exist"${e._phase === 'exist' ? ' selected' : ''}>Stabilized</option></select></label>
        </div>
      </div>
      <details class="csx-uf-fees"><summary>Fees</summary><div class="csx-uf-grid">${(typeof FEE_SCHEMA !== 'undefined' ? FEE_SCHEMA : []).map((f) => `<label><span>${E(f.label)} <em>${f.kind === 'monthly' ? '/mo' : 'one-time'}</em></span><input type="number" class="csx-in csx-uf-fee" data-k="${f.key}" value="${fees[f.key] == null ? '' : E(fees[f.key])}" min="0" step="1"></label>`).join('')}</div></details>
      ${notes}`;
    }
    return `<tr class="csx-uf-row"><td colspan="${cols}"><div class="csx-uf" data-pid="${E(p.id)}" data-ph="${ph}">${head}${body}${loc}${bar}</div></td></tr>`;
  }
  const num = (v) => { if (v === '' || v == null) return null; const n = parseFloat(v); return isNaN(n) ? null : n; };
  function saveUpdate(box, cs) {
    const pid = box.dataset.pid, ph = box.dataset.ph, p = byId().get(String(pid)); if (!p) return;
    const raw = RAW_DATA.find((x) => String(x.id) === String(pid)) || {};
    const at = new Date((box.querySelector('.csx-uf-asof').value || new Date().toISOString().slice(0, 10)) + 'T12:00:00').getTime();
    const src = box.querySelector('.csx-uf-src').value, by = (window.WB && WB.user && WB.user.email) || (typeof syncState !== 'undefined' && syncState.editorName) || '';
    const v = {}; box.querySelectorAll('.csx-uf-f').forEach((i) => { v[i.dataset.f] = i.value; });
    const edits = { ...ed(p) }, ch = [], set = (k, val) => {
      const cur = p[k]; if (val === cur || (val == null && cur == null)) return;
      if (typeof val === 'number' && typeof cur === 'number' && Math.abs(val - cur) < 1e-9) return;
      if (val === (raw[k] == null ? null : raw[k])) delete edits[k]; else edits[k] = val; ch.push(k);
    };
    const llm = (box.querySelector('.csx-uf-ll').value || '').match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
    if (llm) { const la = +llm[1], ln = +llm[2]; if (Math.abs(la) <= 90 && Math.abs(ln) <= 180 && (p.lat == null || Math.abs(la - p.lat) > 1e-6 || Math.abs(ln - p.lng) > 1e-6)) { set('lat', la); set('lng', ln); } }
    if (ph === 'pipe') {
      if (v.pipelineStage === 'Delivered') {
        // seen delivered before CoStar caught up: it becomes existing and moves to Lease-up, leasing from the delivery month
        if (!v.estDelivery) { box.querySelector('.csx-msg').textContent = 'Enter the month it delivered.'; return; }
        set('status', 'Existing'); set('pipelineStage', 'UC');
        const o = num(v.occ); if (o != null) set('vacancy', Math.round((100 - o) * 100) / 100);
      } else set('pipelineStage', v.pipelineStage || null);
      if ((v.developer || '') !== (p.developer || '')) set('developer', v.developer.trim() || null);
      if ((v.style || '') !== (p.style || '') && v.style.trim()) set('style', v.style.trim());
      const ac = num(v.acreage); if (ac !== (p.acreage == null ? null : +p.acreage)) set('acreage', ac);
      if (v.startMonth) { const [y, m] = v.startMonth.split('-').map(Number), sm = MON[m - 1] + ' ' + y, cur = begunOf(p); if (!cur || cur.getFullYear() !== y || cur.getMonth() !== m - 1) set('constructionBegin', sm); }
      if (v.estDelivery) { const [y, m] = v.estDelivery.split('-').map(Number); set('yearBuilt', y); set('monthBuilt', MON[m - 1]); }
      set('units', num(v.units));
    } else {
      const ct = box.querySelector('.csx-uf-ct').value, ca = num(box.querySelector('.csx-uf-ca').value), cl = num(box.querySelector('.csx-uf-cl').value) || 12, cd = box.querySelector('.csx-uf-cd').value.trim();
      let rentNow = p.avgAskingUnit; { let n = 0, r = 0; BEDS.forEach(([k, , uk]) => { const u = num(v[uk]), rr = num(v[k + 'Rent']); if (u && rr) { n += u; r += u * rr; } }); if (n) rentNow = r / n; }
      const wkIn = toWeeks(ct, ca, cl, rentNow);
      const wk = wkIn == null ? (ct === 'none' ? 0 : null) : Math.round(wkIn * 100) / 100;
      const conNew = (ca == null && ct !== 'none') ? null : { type: ct, amount: ct === 'none' ? null : ca, term: cl, text: cd };
      let n = 0, rent = 0, sfw = 0, cnt = 0;
      BEDS.forEach(([k, , uk]) => {
        const u = num(v[uk]), r = num(v[k + 'Rent']), sf = p[k + 'SF'];
        set(uk, u);
        if (r !== (p[k + 'Rent'] == null ? null : Math.round(p[k + 'Rent'] * 100) / 100)) { set(k + 'Rent', r); if (sf) set(k + 'RentSF', r == null ? null : r / sf); }
        const rr = r != null ? r : p[k + 'Rent'];
        if (rr != null && wk != null) { set(k + 'EffUnit', rr * (1 - wk / 52)); if (sf) set(k + 'EffSF', (rr * (1 - wk / 52)) / sf); }
        if (rr != null && u) { n += u; rent += rr * u; if (sf) { sfw += sf * u; cnt += u; } }
      });
      const rentChanged = ch.some((k) => /Rent$|^units/.test(k));
      let askU = p.avgAskingUnit, askSF = p.avgAskingSF;
      if (rentChanged && n) { askU = rent / n; set('avgAskingUnit', askU); if (sfw && cnt === n) { askSF = rent / sfw; set('avgAskingSF', askSF); } else if (p.avgUnitSF) { askSF = askU / p.avgUnitSF; set('avgAskingSF', askSF); } }
      if (wk != null && (rentChanged || wk !== handWks(p))) { if (askU != null) set('avgEffectiveUnit', askU * (1 - wk / 52)); if (askSF != null) set('avgEffectiveSF', askSF * (1 - wk / 52)); }
      const o = num(v.occ); if (o != null && (occOf(p) == null || Math.abs(o - occOf(p)) > 1e-6)) set('vacancy', Math.round((100 - o) * 100) / 100);
      if (v.leaseStart) { const cur = leaseStartOf(p), cv = cur ? `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}` : ''; if (v.leaseStart !== cv) set('preLeaseStart', v.leaseStart + '-01'); }
      if ((v._phase || '') !== (edits._phase || '')) { if (v._phase) edits._phase = v._phase; else delete edits._phase; ch.push('_phase'); }
      // fees + weeks free live in the fee record (same as the fee schedule)
      const fr = { ...((typeof compFees !== 'undefined' && compFees[pid]) || {}) }, fch = [];
      box.querySelectorAll('.csx-uf-fee').forEach((i) => { const nv = num(i.value), ov = num(fr[i.dataset.k]); if (nv !== ov) { if (nv == null) delete fr[i.dataset.k]; else fr[i.dataset.k] = nv; fch.push(i.dataset.k); } });
      const hw = handWks(p);
      if (wk !== (hw == null ? null : Math.round(hw * 100) / 100) || JSON.stringify(conNew) !== JSON.stringify(fr.concession || null)) {
        if (wk == null) { delete fr.weeksFree; delete fr.concession; } else { fr.weeksFree = wk; fr.concession = conNew; }
        fch.push('weeksFree');
      }
      if (fch.length) {
        fr._meta = { ...(fr._meta || {}) }; fch.forEach((k) => { fr._meta[k] = { at, by, src }; });
        compFees[pid] = fr; try { saveCompFees(); } catch (e) {}
        wbDirectSave('fees', (d) => d.saveFees(pid, fr));
      }
      if (!ch.length && !fch.length && (v.notes || '') === (edits.notes || p.notes || '')) { box.querySelector('.csx-msg').textContent = 'Nothing changed.'; return; }
    }
    if ((v.notes || '') !== (edits.notes || p.notes || '')) { edits.notes = v.notes || ''; ch.push('notes'); }
    if (ch.length) {
      edits._meta = { ...(edits._meta || {}) }; ch.forEach((k) => { edits._meta[k] = { at, by, src }; });
      edits._updatedAt = at; edits._updatedBy = by;
      userEdits[pid] = edits; try { saveUserEdits(); } catch (e) {}
      wbDirectSave('update', (d) => d.saveEdits(pid, edits));
    } else if (ph === 'pipe') { box.querySelector('.csx-msg').textContent = 'Nothing changed.'; return; }
    UI.upd = null; refresh();
  }

  // ---------- baseline submarket: inventory for the pipeline ratio, and the RealPage section ----------
  const BLKEY = 'wb_cs_baseline_v1';
  const blLocal = () => { try { return JSON.parse(localStorage.getItem(BLKEY) || '{}'); } catch (e) { return {}; } };
  function smOptions() { const c = {}; all().forEach((p) => { if (p.submarket) c[p.submarket] = (c[p.submarket] || 0) + 1; }); return Object.keys(c).sort(); }
  function autoBaseline(ps) { const c = {}; ps.forEach((p) => { if (p.submarket) c[p.submarket] = (c[p.submarket] || 0) + (p.units || 1); }); return Object.entries(c).sort((a, b) => b[1] - a[1]).map((x) => x[0])[0] || null; }
  function baselineOf(cs, ps) { const b = (cs.settings && cs.settings.baseline) || blLocal()[cs.id]; return { name: b || autoBaseline(ps), picked: !!b }; }
  function setBaseline(cs, name) {
    cs.settings = { ...(cs.settings || {}), baseline: name || undefined }; if (!name) delete cs.settings.baseline;
    const m = blLocal(); if (name) m[cs.id] = name; else delete m[cs.id]; try { localStorage.setItem(BLKEY, JSON.stringify(m)); } catch (e) {}
    touch(cs); render();
  }
  // RealPage for the baseline submarket (same blend the Trends tab uses); also feeds the page summary
  function rpFor(name) {
    const f = name && typeof getRpForecastForWbSubmarket === 'function' ? getRpForecastForWbSubmarket(name) : null;
    const Y = typeof CURRENT_YEAR !== 'undefined' ? CURRENT_YEAR : new Date().getFullYear();
    if (!f || !f[Y]) return null;
    const fy = [1, 2, 3].map((i) => f[Y + i] || {}), fg = fy.map((r) => r.yR).filter((x) => x != null);
    const cum = fg.length ? fg.reduce((a, x) => a * (1 + x), 1) - 1 : null, avg = fg.length ? Math.pow(1 + cum, 1 / fg.length) - 1 : null;
    return { f, Y, c: f[Y], fy, cum, avg, s3: fy.reduce((a, r) => a + (r.sp || 0), 0), d3: fy.reduce((a, r) => a + (r.dm || 0), 0) };
  }
  const gPct = (x) => (x == null ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1) + '%');
  const gCls = (x) => (x == null ? '' : x >= 0 ? 'up' : 'dn');
  // ---------- submarket: four story cards (supply pressure, rent, occupancy, supply vs demand) + year table on demand ----------
  // charts are drawn at the card's real width after render (no stretching), and redrawn on resize
  function spark(pts, Y, opt) {
    const v = pts.filter((x) => x[1] != null); if (v.length < 2) return '';
    return `<div class="csx-sparkbox" data-k="line" data-sp="${E(JSON.stringify({ v, Y, ref: opt && opt.ref, refLabel: opt && opt.refLabel }))}"></div><div class="csx-spax"><span>${v[0][0]}</span><span>${v[v.length - 1][0]}</span></div>`;
  }
  function sdBars(f, Y, yrs) {
    const rows = yrs.map((y) => [y, (f[y] || {}).sp || 0, (f[y] || {}).dm || 0]);
    return `<div class="csx-sparkbox" data-k="bars" data-sp="${E(JSON.stringify({ rows, Y }))}"></div><div class="csx-spax"><span>${rows[0][0]}</span><span class="cy">${Y} now</span><span>${rows[rows.length - 1][0]}</span></div>`;
  }
  function drawSparks() {
    document.querySelectorAll('#view-compsets .csx-sparkbox').forEach((box) => {
      const W = Math.max(120, box.clientWidth), H = 84, P = 6; let d; try { d = JSON.parse(box.dataset.sp); } catch (e) { return; }
      if (box.dataset.k === 'line') {
        const { v, Y, ref, refLabel } = d, xs = v.map((x) => x[0]), ys = v.map((x) => x[1]).concat(ref != null ? [ref] : []);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), lo = Math.min(...ys), hi = Math.max(...ys), pad = (hi - lo) * 0.15 || 1;
        const X = (x) => P + ((x - x0) / (x1 - x0 || 1)) * (W - P * 2), Yv = (y) => H - P - ((y - (lo - pad)) / (hi - lo + pad * 2)) * (H - P * 2);
        const path = (a) => a.map((x, k) => (k ? 'L' : 'M') + X(x[0]).toFixed(1) + ',' + Yv(x[1]).toFixed(1)).join('');
        const hist = v.filter((x) => x[0] <= Y), fc = v.filter((x) => x[0] >= Y), cur = v.find((x) => x[0] === Y);
        const area = hist.length > 1 ? path(hist) + `L${X(hist[hist.length - 1][0]).toFixed(1)},${H}L${X(hist[0][0]).toFixed(1)},${H}Z` : '';
        box.innerHTML = `<svg class="csx-spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
          ${ref != null ? `<line x1="${P}" x2="${W - P}" y1="${Yv(ref).toFixed(1)}" y2="${Yv(ref).toFixed(1)}" class="ref"/><text x="${W - P}" y="${(Yv(ref) - 4).toFixed(1)}" text-anchor="end" class="reft">${E(refLabel || '')}</text>` : ''}
          ${area ? `<path d="${area}" class="area"/>` : ''}<path d="${path(hist)}" class="hist"/>${fc.length > 1 ? `<path d="${path(fc)}" class="fc"/>` : ''}
          ${cur ? `<circle cx="${X(cur[0]).toFixed(1)}" cy="${Yv(cur[1]).toFixed(1)}" r="3.5" class="dot"/>` : ''}</svg>`;
      } else {
        const { rows, Y } = d, mx = Math.max(1, ...rows.map((r) => Math.max(r[1], r[2]))), bw = (W - P * 2) / rows.length, Hh = (n) => (Math.max(0, n) / mx) * (H - 8);
        const bwi = Math.min(18, bw * 0.34);
        box.innerHTML = `<svg class="csx-spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${rows.map(([y, sp, dm], k) => {
          const cx = P + k * bw + bw / 2, f2 = y > Y ? ' f' : '';
          return `<rect x="${(cx - bwi - 1).toFixed(1)}" y="${(H - Hh(sp)).toFixed(1)}" width="${bwi.toFixed(1)}" height="${Hh(sp).toFixed(1)}" rx="2" class="sp${f2}"><title>${y}: ${intC(sp)} delivered</title></rect><rect x="${(cx + 1).toFixed(1)}" y="${(H - Hh(dm)).toFixed(1)}" width="${bwi.toFixed(1)}" height="${Hh(dm).toFixed(1)}" rx="2" class="dm${f2}"><title>${y}: ${intC(dm)} absorbed</title></rect>`;
        }).join('')}</svg>`;
      }
    });
  }
  if (!window.__csxSparkRz) { window.__csxSparkRz = true; let t; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(drawSparks, 120); }); }
  function baselineBlock(cs, ps) {
    const bl = baselineOf(cs, ps); if (!bl.name) return '';
    const inSm = all().filter((p) => p.submarket === bl.name), u = (a) => a.reduce((x, p) => x + (p.units || 0), 0);
    const exP = inSm.filter((p) => p.status === 'Existing'), exU = u(exP);
    const ucU = u(inSm.filter((p) => p.status !== 'Existing' && !isProposed(p) && !isStalled(p))), prU = u(inSm.filter((p) => p.status !== 'Existing' && isProposed(p))), stU = u(inSm.filter((p) => p.status !== 'Existing' && isStalled(p)));
    const luU = u(exP.filter((p) => phaseOf(p) === 'lease'));
    const pc = (n) => (exU ? (n / exU) * 100 : 0), worst = pc(ucU + prU + stU);
    const scale = Math.max(10, Math.ceil((worst * 1.15) / 5) * 5);   // bar axis in % of inventory
    const seg = (n, cls, label) => (n ? `<i class="${cls}" style="width:${((pc(n) / scale) * 100).toFixed(2)}%" title="${E(label)}: ${intC(n)} units, ${pc(n).toFixed(1)}% of inventory"></i>` : '');
    const outside = ps.filter((p) => p.submarket !== bl.name).length;
    const cardSupply = `<div class="csx-sc2">
      <div class="csx-sc2-h"><span>Supply pressure</span><i class="csx-srctag cs">CoStar</i></div>
      <div class="csx-sc2-v">${pc(ucU).toFixed(1)}<u>%</u></div>
      <div class="csx-sc2-s">of ${E(bl.name)}’s ${intC(exU)} units are under construction</div>
      <div class="csx-sbar"><div class="trk">${seg(ucU, 'uc', 'Under construction')}${seg(prU, 'pr', 'Proposed')}${seg(stU, 'st', 'Stalled')}</div><div class="ticks"><span>0%</span><span>${scale / 2}%</span><span>${scale}%</span></div></div>
      <div class="csx-sc2-k"><span><i class="uc"></i>${intC(ucU)} UC</span><span><i class="pr"></i>${intC(prU)} proposed</span>${stU ? `<span><i class="st"></i>${intC(stU)} stalled</span>` : ''}</div>
      <div class="csx-sc2-f">Worst case <b>${worst.toFixed(1)}%</b> of inventory${luU ? ` · ${intC(luU)} units leasing up now` : ''}</div>
    </div>`;
    const R = rpFor(bl.name);
    let cards = cardSupply, table = '';
    if (R) {
      const { f, Y, c, fy, cum, avg, s3, d3 } = R, avgSf = stats(exP).sf;
      const yrsAll = Object.keys(f).map(Number).filter((y) => y >= Y - 7 && y <= Y + 4).sort((a, b) => a - b);
      const rentPts = yrsAll.map((y) => [y, (f[y] || {}).eR]), occPts = yrsAll.map((y) => [y, (f[y] || {}).oc != null ? f[y].oc * 100 : null]);
      const tag = '<i class="csx-srctag rp">RealPage</i>';
      cards += `<div class="csx-sc2">
          <div class="csx-sc2-h"><span>Effective rent</span>${tag}</div>
          <div class="csx-sc2-v">${c.eR && avgSf ? '$' + (c.eR / avgSf).toFixed(2) + '<u>/SF</u>' : '$' + intC(c.eR) + '<u>/mo</u>'}</div>
          <div class="csx-sc2-s">${c.eR && avgSf ? '$' + intC(c.eR) + '/mo at ' + intC(avgSf) + ' SF avg · ' : ''}<b class="${gCls(c.yR)}">${gPct(c.yR)}</b> in ${Y}</div>
          ${spark(rentPts, Y)}
          <div class="csx-sc2-f">Forecast <b class="${gCls(avg)}">${gPct(avg)}/yr</b> ${Y + 1}–${Y + 3}${cum != null ? ` · ${gPct(cum)} cumulative` : ''}</div>
        </div>
        <div class="csx-sc2">
          <div class="csx-sc2-h"><span>Occupancy</span>${tag}</div>
          <div class="csx-sc2-v">${c.oc != null ? (c.oc * 100).toFixed(1) + '<u>%</u>' : '—'}</div>
          <div class="csx-sc2-s">${(f[Y - 1] || {}).oc != null && c.oc != null ? `${((c.oc - f[Y - 1].oc) * 10000 >= 0 ? '+' : '−')}${Math.abs(Math.round((c.oc - f[Y - 1].oc) * 10000))} bps vs ${Y - 1}` : '&nbsp;'}</div>
          ${spark(occPts, Y, { ref: 95, refLabel: '95% stabilized' })}
          <div class="csx-sc2-f">${fy[2].oc != null ? `<b>${(fy[2].oc * 100).toFixed(1)}%</b> forecast for ${Y + 3}` : '&nbsp;'}</div>
        </div>
        <div class="csx-sc2">
          <div class="csx-sc2-h"><span>Supply vs demand</span>${tag}</div>
          <div class="csx-sc2-v">${d3 && s3 ? (d3 / s3).toFixed(2) + '<u>×</u>' : '—'}</div>
          <div class="csx-sc2-s">${s3 ? `${intC(d3)} absorbed vs ${intC(s3)} delivered, ${Y + 1}–${Y + 3}` : '&nbsp;'}</div>
          ${sdBars(f, Y, yrsAll.filter((y) => y >= Y - 3))}
          <div class="csx-sc2-k"><span><i class="sp"></i>Delivered</span><span><i class="dm"></i>Absorbed</span><span class="lt">lighter = forecast</span></div>
        </div>`;
      const yrs = [Y - 3, Y - 2, Y - 1, Y, Y + 1, Y + 2, Y + 3, Y + 4].filter((y) => f[y]);
      const row = (l, fn) => `<tr><th>${l}</th>${yrs.map((y) => { const v = fn(f[y] || {}); return `<td class="${y > Y ? 'fc' : y === Y ? 'cy' : ''} ${v.c || ''}">${v.t}</td>`; }).join('')}</tr>`;
      table = `<details class="csx-stalled csx-smyrs"${UI.smYrs ? ' open' : ''}><summary>Year by year · RealPage ${E((typeof getRpBlendInfo === 'function' && getRpBlendInfo(bl.name)) || '')} <i>▾</i></summary>
        <div class="table-scroll"><table class="csx-rpt"><thead><tr><th></th>${yrs.map((y) => `<th class="${y > Y ? 'fc' : y === Y ? 'cy' : ''}">${y}${y > Y ? '<i>F</i>' : ''}</th>`).join('')}</tr></thead><tbody>
          ${row('Effective rent', (r) => ({ t: r.eR ? '$' + intC(r.eR) : '—' }))}
          ${row('Occupancy', (r) => ({ t: r.oc != null ? (r.oc * 100).toFixed(1) + '%' : '—' }))}
          ${row('Rent growth', (r) => ({ t: gPct(r.yR), c: gCls(r.yR) }))}
          ${row('Supply', (r) => ({ t: r.sp != null ? intC(r.sp) : '—' }))}
          ${row('Demand', (r) => ({ t: r.dm != null ? intC(r.dm) : '—' }))}
        </tbody></table></div></details>`;
    } else cards += `<div class="csx-sc2 csx-sc2-none"><div class="csx-sc2-h"><span>RealPage</span><i class="csx-srctag rp">RealPage</i></div><div class="csx-sc2-s">No RealPage coverage mapped to ${E(bl.name)}.</div></div>`;
    return `<section class="panel csx-sec csx-bl csx-bl2">
      <div class="csx-sech" id="csx-s-sm"><div class="csx-sect"><i></i><b>Submarket</b><select class="csx-in csx-blsel" aria-label="Submarket">${smOptions().map((o) => `<option value="${E(o)}"${o === bl.name ? ' selected' : ''}>${E(o)}${o === bl.name && !bl.picked ? ' (auto)' : ''}</option>`).join('')}</select></div>
        <span class="csx-fresh">${outside ? `${outside} of the set’s properties sit outside ${E(bl.name)}` : `All of the set’s properties are in ${E(bl.name)}`}</span></div>
      <div class="csx-sc2grid">${cards}</div>
      ${table}
      ${window.__WB_CS_NO_SETTINGS ? '<div class="csx-hint warn">The submarket choice is kept in this browser until the database update (comp_sets.settings) is run.</div>' : ''}
    </section>`;
  }


  // ---------- pipeline auto-pulled from the set's submarkets (removable per set) ----------
  const PXKEY = 'wb_cs_pipeex_v1';
  const pxLocal = () => { try { return JSON.parse(localStorage.getItem(PXKEY) || '{}'); } catch (e) { return {}; } };
  const pipeExcl = (cs) => new Set(((cs.settings && cs.settings.pipeExcluded) || pxLocal()[cs.id] || []).map(String));
  function setPipeExcl(cs, ids) {
    cs.settings = { ...(cs.settings || {}), pipeExcluded: ids };
    const m = pxLocal(); m[cs.id] = ids; try { localStorage.setItem(PXKEY, JSON.stringify(m)); } catch (e) {}
    touch(cs);
  }
  const setSubs = (ps) => [...new Set(ps.filter((p) => phaseOf(p) !== 'pipe').map((p) => p.submarket).filter(Boolean))];
  function autoPipe(cs, ps) {
    const subs = new Set(setSubs(ps)), mem = new Set(ps.map((p) => String(p.id))), ex = pipeExcl(cs);
    if (!subs.size) return [];
    return all().filter((p) => p.status !== 'Existing' && subs.has(p.submarket) && !mem.has(String(p.id)) && !ex.has(String(p.id))).map((p) => Object.assign(p, { _auto: true }));
  }

  // ---------- section panels ----------
  const hero = (l, v, sub, tone) => `<div class="csx-hc${tone ? ' ' + tone : ''}"><span>${l}</span><b>${v}</b><small>${sub || '&nbsp;'}</small></div>`;
  const fresh = (p) => { const u = lastUpd(p); return u && Date.now() - u.at <= 92 * 86400000; };
  const velOf = (cs) => +((cs.settings && cs.settings.vel) || (typeof state !== 'undefined' && state.leaseVelocity) || 25);
  const addMo = (d, m) => new Date(+d + m * 30.44 * 86400000);
  const begunOf = (p) => { const b = ed(p).constructionBegin || p.constructionBegin; if (!b) return null; const d = typeof monthYearToDate === 'function' ? monthYearToDate(String(b).split(' ')[0], +String(b).split(' ').pop()) : null; return d; };
  const intC = (v) => (v == null || isNaN(v) ? '—' : Math.round(v).toLocaleString());
  const wa = (ps, f) => { let a = 0, w = 0; ps.forEach((p) => { const v = f(p); if (v != null && !isNaN(v) && p.units) { a += v * p.units; w += p.units; } }); return w ? a / w : null; };
  const colg = (w) => `<colgroup>${w.map((x) => `<col style="width:${typeof x === 'number' ? x + '%' : x}">`).join('')}</colgroup>`;
  const sumLine = (items) => `<span class="csx-sum">${items.map(([v, l]) => `<span><b>${v}</b> ${l}</span>`).join('')}</span>`;
  function panelHead(id, key, title, count, note, cards, extra) {
    return `<div class="csx-sech" id="${id}"><div class="csx-sect"><i></i><b>${title}</b>${count != null ? `<em>${count}</em>` : ''}</div>${extra || ''}</div>${note ? `<div class="csx-secline">${note}</div>` : ''}
      ${cards ? `<div class="csx-hcs">${cards}</div>` : ''}`;
  }
  // lease-up: properties leasing now plus under-construction buildings, projected at their own pace and at an assumed pace
  function outlook(cs, lu, pi) {
    const V = velOf(cs), now = new Date();
    const cur = lu.map((p) => { const l = leaseOf(p); const atV = l.target && !l.done ? addMo(l.asOf, (l.target - l.leased) / V) : null; return { p, l, atV, start: l.d, end: l.done ? null : (l.stab || atV), kind: 'now' }; });
    const fut = [];   // under-construction buildings stay in Pipeline; the outlook is properties leasing now
    if (!cur.length && !fut.length) return null;
    const all2 = cur.concat(fut);
    const vNow = cur.reduce((a, x) => a + (x.l.v || 0), 0), uNow = cur.reduce((a, x) => a + (x.p.units || 0), 0), uNext = fut.reduce((a, x) => a + (x.p.units || 0), 0);
    const leased = cur.reduce((a, x) => a + (x.l.leased || 0), 0);
    const lastOwn = all2.map((x) => x.kind === 'now' ? (x.l.done ? null : x.l.stab || x.atV) : x.atV).filter(Boolean).sort((a, b) => b - a)[0];
    const lastV = all2.map((x) => (x.kind === 'now' && x.l.done ? null : x.atV)).filter(Boolean).sort((a, b) => b - a)[0];
    return { V, now, cur, fut, all2, vNow, uNow, uNext, leased, lastOwn, lastV };
  }
  function leaseOutlook(cs, lu, pi) {
    const O = outlook(cs, lu, pi);
    if (!O) return `<section class="panel csx-sec csx-sec-lu">${panelHead('csx-s-lu', 'lu', 'Lease-up outlook', 0, '<span class="csx-none2">None. Nothing in this set is leasing up.</span>', null)}</section>`;
    const { V, now, cur, fut, all2, vNow, uNow, uNext, leased, lastOwn, lastV } = O;
    const cardsUnused = hero('Leasing now', intC(uNow) + '<u> units</u>', cur.length ? `${cur.length} ${cur.length === 1 ? 'property' : 'properties'} · ${uNow ? ((leased / uNow) * 100).toFixed(0) + '% occupied' : ''}` : 'None in this set')
      + hero('Coming', intC(uNext) + '<u> units</u>', fut.length ? `${fut.length} under construction` : 'Nothing under construction')
      + hero('Pace now', vNow ? vNow.toFixed(0) + '<u> leases/mo</u>' : '—', cur.length ? 'Combined, since leasing began' : '')
      + hero('All stabilized · own pace', lastOwn ? monYr(lastOwn) : '—', 'Pipeline at ' + V + '/mo (no pace yet)')
      + hero(`All stabilized · ${V}/mo`, lastV ? monYr(lastV) : '—', 'Every property at the assumed pace');
    // timeline
    const t0 = new Date(Math.min(...all2.map((x) => +(x.start || now)), +now)), t1 = new Date(Math.max(...all2.map((x) => +(x.end || x.atV || now)), +addMo(now, 6)));
    const span = (t1 - t0) * 1.12 || 1, X = (d) => (((+d - t0) / span) * 100).toFixed(2) + '%';
    const years = []; for (let y = t0.getFullYear() + 1; y <= t1.getFullYear(); y++) { const d = new Date(y, 0, 1); if (d > t0 && d < t1) years.push(d); }
    const bar = (x) => { const s = x.start || now, e = x.kind === 'now' ? (x.l.done ? now : (x.l.stab || x.atV || now)) : (x.end || now);
      return `<div class="csx-tl-row"><div class="csx-tl-n" title="${E(x.p.name)}">${E(x.p.name)}<small>${intC(x.p.units)} units</small></div><div class="csx-tl-track">
        <i class="csx-tl-bar ${x.kind}" style="left:${X(s)};width:calc(${X(e)} - ${X(s)})"></i>
        <span class="csx-tl-lab" style="left:${X(e)}">${x.kind === 'now' && x.l.done ? 'Stabilized' : monYr(e)}</span></div></div>`; };
    const tl = `<div class="csx-tl"><div class="csx-tl-axis"><div class="csx-tl-n"></div><div class="csx-tl-track">${years.filter((d) => Math.abs(d - now) > span * 0.035).map((d) => `<span style="left:${X(d)}">${d.getFullYear()}</span>`).join('')}<b class="csx-tl-today" style="left:${X(now)}">Today</b></div></div>
      ${all2.sort((a, b) => (a.start || now) - (b.start || now)).map(bar).join('')}
      <div class="csx-tl-key"><span><i class="now"></i>Leasing now, to 95% at its own pace</span><span>The table has each property’s date at the assumed pace too</span></div></div>`;
    const rows = cur.map(({ p, l, atV }) => `<tr data-pid="${E(p.id)}"${UI.upd === String(p.id) ? ' class="csx-open"' : ''}>${nameCell(p, E(p.style || ''))}<td class="num">${intC(p.units)}</td><td>${monYr(l.d)}</td><td class="num">${pct(l.o)}${l.o != null ? `<span class="csx-bar1"><i style="width:${Math.min(100, l.o)}%"></i></span>` : ''}</td><td class="num csx-k">${l.v ? l.v.toFixed(1) : '—'}</td><td>${l.done ? '<span class="csx-ok">Stabilized</span>' : l.stab ? monYr(l.stab) : '—'}</td><td>${l.done ? '' : atV ? monYr(atV) : '—'}</td><td class="num">${money(p.avgAskingSF)}</td>${wksCell(p)}${updCell(p)}<td class="csx-ub">${updBtn(p)}</td>${rmCell(p)}</tr>${UI.upd === String(p.id) ? updForm(p, 'lease', 12) : ''}`).join('')
      + (fut.length ? `<tr class="csx-grp"><td colspan="12">Under construction · projected from completion at ${V}/mo</td></tr>` + fut.map(({ p, start, end }) => `<tr data-pid="${E(p.id)}" class="csx-fut">${nameCell(p, E(p.style || ''))}<td class="num">${intC(p.units)}</td><td>${monYr(start)} <small>est.</small></td><td class="num">—</td><td class="num">—</td><td>—</td><td>${monYr(end)}</td><td class="num">—</td><td class="num">—</td>${updCell(p)}<td></td><td></td></tr>`).join('') : '');
    const velSel = `<label class="csx-velsel">Assumed pace <select class="csx-in csx-vel">${[10, 15, 20, 25, 30, 35, 40].map((v) => `<option value="${v}"${v === V ? ' selected' : ''}>${v} leases/mo</option>`).join('')}</select></label>`;
    const line = sumLine([[intC(uNow), 'units leasing now' + (uNow ? ` · ${((leased / uNow) * 100).toFixed(0)}% occupied` : '')], [vNow ? vNow.toFixed(0) : '—', 'leases/mo now'], [lastOwn ? monYr(lastOwn) : '—', 'all at 95%, own pace'], [lastV ? monYr(lastV) : '—', `all at 95%, ${V}/mo`]]);
    return `<section class="panel csx-sec csx-sec-lu">${panelHead('csx-s-lu', 'lu', 'Lease-up outlook', cur.length + fut.length, line, null, velSel)}
      ${tl}
      <div class="table-scroll"><table class="csx-table csx-dense csx-fixed csx-even">${colg([20, 8, 8, 8, 8, 8, 8, 8, 8, 8, '40px', '32px'])}<thead><tr><th class="csx-pc">Property</th><th class="num">Units</th><th>Leasing since</th><th class="num">Occ.</th><th class="num">Leases/mo</th><th>95% · own pace</th><th>95% · ${V}/mo</th><th class="num">Asking $/SF</th><th class="num">Wks free</th><th>Updated</th><th></th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }
  // rent comps sort: newest delivery first unless a header is clicked
  const RC_COLS = [['name', 'Property', 'csx-pc', (p) => (p.name || '').toLowerCase()], ['owner', 'Owner', 'csx-o', (p) => (p.owner || '').toLowerCase()], ['style', 'Type', '', (p) => p.style || ''],
    ['stories', 'Stories', 'num csx-o', (p) => p.stories], ['units', 'Units', 'num', (p) => p.units], ['built', 'Built', 'num', (p) => { const d = deliveryOf(p); return d ? +d : p.yearBuilt ? +new Date(p.yearBuilt, 5, 1) : null; }],
    ['ask', 'Asking $/SF', 'num', (p) => p.avgAskingSF], ['mo', '$/mo', 'num', (p) => p.avgAskingUnit], ['eff', 'Eff. $/SF', 'num', (p) => p.avgEffectiveSF], ['occ', 'Occ.', 'num', (p) => occOf(p)], ['wks', 'Wks free', 'num', (p) => wksOf(p)],
    ['upd', 'Updated', '', (p) => { const u = lastUpd(p); return u ? u.at : 0; }]];
  function rcSort(a) {
    const st = UI.rcSort || { k: 'built', d: -1 }, col = RC_COLS.find((c) => c[0] === st.k) || RC_COLS[5], f = col[3];
    return [...a].sort((x, y) => { const A = f(x), B = f(y); if (A == null && B == null) return 0; if (A == null) return 1; if (B == null) return -1; return (A < B ? -1 : A > B ? 1 : 0) * st.d; });
  }
  function rcHead() {
    const st = UI.rcSort || { k: 'built', d: -1 };
    return `<thead><tr>${RC_COLS.map(([k, l, cls]) => `<th class="${cls} csx-sortable${st.k === k ? ' on' : ''}" data-sk="${k}" title="Sort by ${l.toLowerCase()}">${l}<i>${st.k === k ? (st.d < 0 ? '↓' : '↑') : ''}</i></th>`).join('')}<th></th><th></th></tr></thead>`;
  }
  const checked = (a) => `${a.filter(fresh).length} of ${a.length} updated in the last 90 days`;

  function addProjForm(cs) {
    const ps = membersOf(cs), bl = baselineOf(cs, ps).name, pf = UI.apPrefill || {}, vq = (k) => (pf[k] == null ? '' : E(pf[k]));
    const styles = [...new Set(all().map((x) => x.style).filter(Boolean))].sort();
    return `<div class="csx-uf csx-ap"><div class="csx-uf-head"><b>${pf.landCompId ? `New project from the ${E(pf.saleLabel || 'land')} sale` : 'Add a project CoStar doesn’t have yet'}</b><span class="csx-uf-last">Saved to the database for ${E((window.__WBD && window.__WBD.title) || 'this market')} and added to this set</span></div>
      <div class="csx-uf-grid">
        <label><span>Name *</span><input class="csx-in csx-ap-f" data-f="name" maxlength="80" value="${vq('name')}"></label>
        <label><span>Address</span><input class="csx-in csx-ap-f" data-f="address" maxlength="120" value="${vq('address')}"></label>
        <label><span>City</span><input class="csx-in csx-ap-f" data-f="city" maxlength="60" value="${pf.city ? vq('city') : E((ps[0] && ps[0].city) || '')}"></label>
        <label><span>Units *</span><input type="number" class="csx-in csx-ap-f" data-f="units" min="1" value="${vq('units')}"></label>
        <label><span>Developer</span><input class="csx-in csx-ap-f" data-f="developer" maxlength="80" value="${vq('developer')}"></label>
        <label><span>Product type</span><select class="csx-in csx-ap-f" data-f="style">${styles.map((x) => `<option${x === 'Garden' ? ' selected' : ''}>${E(x)}</option>`).join('')}</select></label>
        <label><span>Stage</span><select class="csx-in csx-ap-f" data-f="stage"><option value="UC">Under construction</option><option value="Proposed">Proposed</option><option value="Stalled">Stalled</option></select></label>
        <label><span>Construction start</span><input type="month" class="csx-in csx-ap-f" data-f="start" value="${vq('start')}"></label>
        <label><span>Est. completion</span><input type="month" class="csx-in csx-ap-f" data-f="done"></label>
        <label><span>Acres</span><input type="number" class="csx-in csx-ap-f" data-f="acres" min="0" step="0.01" value="${vq('acres')}"></label>
        <label><span>Stories</span><input type="number" class="csx-in csx-ap-f" data-f="stories" min="1"></label>
        <label><span>Submarket</span><select class="csx-in csx-ap-f" data-f="submarket">${smOptions().map((o) => `<option${o === bl ? ' selected' : ''}>${E(o)}</option>`).join('')}</select></label>
      </div>
      <label class="csx-uf-notes"><span>Notes</span><textarea class="csx-in csx-ap-f" data-f="notes" rows="2" placeholder="Broke ground Nov 2026…">${vq('notes')}</textarea></label>
      <div class="csx-uf-loc"><span class="csx-uf-loch">Map location *</span><input class="csx-in csx-uf-ll" placeholder="lat, lng (paste from Google Maps) or drop the pin" value="${pf.lat != null ? (+pf.lat).toFixed(6) + ', ' + (+pf.lng).toFixed(6) : ''}"><button type="button" class="yx-btn csx-uf-pin">Drop pin on map</button><div class="csx-uf-map" hidden></div></div>
      <div class="csx-bar"><button type="button" class="yx-btn yx-btn-primary csx-ap-save">Add project</button><button type="button" class="yx-btn csx-ap-x">Cancel</button><span class="csx-msg"></span></div></div>`;
  }
  async function saveProject(box, cs) {
    const v = {}; box.querySelectorAll('.csx-ap-f').forEach((i) => { v[i.dataset.f] = i.value.trim(); });
    const msg = box.querySelector('.csx-msg'), m = (box.querySelector('.csx-uf-ll').value || '').match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
    if (!v.name) { msg.textContent = 'Name it first.'; return; }
    if (!num(v.units)) { msg.textContent = 'Enter the unit count.'; return; }
    if (!m) { msg.textContent = 'Place it on the map (drop the pin or paste coordinates).'; return; }
    const ym = (x) => (x ? x.split('-').map(Number) : null), dn = ym(v.done), stt = ym(v.start);
    const by = (window.WB && WB.user && WB.user.email) || (typeof syncState !== 'undefined' && syncState.editorName) || '';
    const rec = { id: 'wb-' + Date.now(), name: v.name, address: v.address || null, city: v.city || null, units: num(v.units), developer: v.developer || null, style: v.style || null,
      status: v.stage === 'Proposed' || v.stage === 'Stalled' ? 'Under Construction' : 'Under Construction', pipelineStage: v.stage === 'UC' ? 'UC' : v.stage,
      yearBuilt: dn ? dn[0] : null, monthBuilt: dn ? MON[dn[1] - 1] : null, constructionBegin: stt ? MON[stt[1] - 1] + ' ' + stt[0] : null,
      acreage: num(v.acres), stories: num(v.stories), submarket: v.submarket || null, notes: v.notes || '', lat: +m[1], lng: +m[2],
      landCompId: (UI.apPrefill && UI.apPrefill.landCompId) || null, _addedBy: by, _addedAt: Date.now() };
    const btn = box.querySelector('.csx-ap-save'); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (!window.LegacyDB || !LegacyDB.direct || !LegacyDB.direct.saveCustomProp) throw new Error('saving isn’t available');
      await LegacyDB.direct.saveCustomProp(rec);
    } catch (e) { btn.disabled = false; btn.textContent = 'Add project'; msg.textContent = 'Couldn’t save: ' + (e.message || e); return; }
    try { customProperties[rec.id] = rec; saveCustomProps(); RAW_DATA.push(hydrateWbDeal(rec)); } catch (e) { console.error(e); }
    cs.propertyIds = [...(cs.propertyIds || []), rec.id]; UI.addProj = false; UI.apPrefill = null; touch(cs); refresh();
    try { wbSaveNote('Added ' + rec.name); } catch (e) {}
  }
  function sections(cs, ps) {
    const ex = ps.filter((p) => phaseOf(p) === 'exist'), lu = ps.filter((p) => phaseOf(p) === 'lease'), pi = ps.filter((p) => phaseOf(p) === 'pipe').concat(autoPipe(cs, ps));
    const rowWith = (p, cells, cols, cls) => `<tr data-pid="${E(p.id)}" class="${cls || ''}${UI.upd === String(p.id) ? ' csx-open' : ''}">${cells}</tr>${UI.upd === String(p.id) ? updForm(p, phaseOf(p), cols) : ''}`;
    const tail = (p) => `${updCell(p)}<td class="csx-ub">${updBtn(p)}</td>${rmCell(p)}`;
    let out = '';
    if (ex.length) {
      const s = stats(ex), hw = ex.filter((p) => handWks(p) != null).length, yrs = ex.map((p) => p.yearBuilt).filter(Boolean);
      const cards = hero('Asking rent', s.ask == null ? '—' : '$' + s.ask.toFixed(2) + '<u>/SF</u>', s.askU ? '$' + Math.round(s.askU).toLocaleString() + '/mo · unit-weighted' : '')
        + hero('Effective rent', s.eff == null ? '—' : '$' + s.eff.toFixed(2) + '<u>/SF</u>', s.ask && s.eff ? `${(((s.ask - s.eff) / s.ask) * 100).toFixed(1)}% below asking` : 'Net of concessions')
        + hero('Occupancy', s.occ == null ? '—' : s.occ.toFixed(1) + '<u>%</u>', `${ex.filter((p) => occOf(p) != null && occOf(p) < 90).length} below 90%`)
        + hero('Concessions', s.wks == null ? '—' : s.wks.toFixed(1) + '<u> wks free</u>', `${hw} of ${ex.length} checked on websites`)
        + hero('Comps', intC(s.units) + '<u> units</u>', `${ex.length} properties · built ${yrs.length ? Math.min(...yrs) + '–' + Math.max(...yrs) : '—'}`);
      const foot = `<tfoot><tr><td>Total / unit-weighted average</td><td class="csx-o"></td><td></td><td class="csx-o"></td><td class="num">${intC(s.units)}</td><td class="num">${yrs.length ? Math.round(wa(ex, (p) => p.yearBuilt)) : '—'}</td><td class="num csx-k">${money(s.ask)}</td><td class="num">${s.askU ? '$' + Math.round(s.askU).toLocaleString() : '—'}</td><td class="num">${money(s.eff)}</td><td class="num">${pct(s.occ)}</td><td class="num">${wks(s.wks)}</td><td colspan="3"></td></tr></tfoot>`;
      const line = sumLine([[money(s.ask), '/SF asking' + (s.askU ? ` ($${Math.round(s.askU).toLocaleString()}/mo)` : '')], [money(s.eff), '/SF effective'], [pct(s.occ), 'occupied'], [wks(s.wks), 'wks free'], [intC(s.units), 'units']]) + `<span class="csx-fresh">${checked(ex)}${ex.some((p) => handWks(p) == null) ? ' · gray weeks free are CoStar’s' : ''}</span>`;
      out += `<section class="panel csx-sec csx-sec-ex">${panelHead('csx-s-ex', 'ex', 'Rent comps', ex.length, line, null)}
        <div class="table-scroll"><table class="csx-table csx-dense csx-fixed">${colg([21, 13, 7, 5, 5, 5, 7, 7, 7, 6, 6, 7, '40px', '32px'])}${rcHead()}
        <tbody>${rcSort(ex).map((p) => rowWith(p, `${nameCell(p, E(p.submarket || ''))}<td class="csx-dev csx-o">${E(p.owner || '—')}</td><td>${E(p.style || '')}</td><td class="num csx-o">${p.stories || '—'}</td><td class="num">${intC(p.units)}</td><td class="num">${p.yearBuilt || '—'}</td><td class="num csx-k">${money(p.avgAskingSF)}</td><td class="num">${p.avgAskingUnit ? '$' + Math.round(p.avgAskingUnit).toLocaleString() : '—'}</td><td class="num">${money(p.avgEffectiveSF)}</td><td class="num${occOf(p) != null && occOf(p) < 90 ? ' csx-lo' : ''}">${pct(occOf(p))}</td>${wksCell(p)}${tail(p)}`, 14)).join('')}</tbody>${foot}</table></div></section>`;
    }
    out += leaseOutlook(cs, lu, pi);
    const addBtn = `<button type="button" class="yx-btn csx-addproj">${UI.addProj ? 'Close' : '+ Add a project'}</button>`;
    if (!pi.length) out += `<section class="panel csx-sec csx-sec-pi">${panelHead('csx-s-pi', 'pi', 'Pipeline', 0, '<span class="csx-none2">None in this set. Add one from the search above, or add a project CoStar doesn’t have yet.</span>', null, addBtn)}${UI.addProj ? addProjForm(cs) : ''}</section>`;
    if (pi.length) {
      const uc = pi.filter((p) => !isProposed(p) && !isStalled(p)), pr = pi.filter(isProposed), st = pi.filter(isStalled), u = (a) => a.reduce((s2, p) => s2 + (p.units || 0), 0);
      const bl = baselineOf(cs, ps).name, base = bl ? all().filter((p) => p.submarket === bl && p.status === 'Existing').reduce((s2, p) => s2 + (p.units || 0), 0) : 0;
      const rel = (n) => (base ? `${((n / base) * 100).toFixed(1)}% of ${E(bl)} inventory` : '');
      const yr = new Date(Date.now() + 365 * 86400000), in12 = u(uc.filter((p) => { const d = deliveryOf(p); return d && d <= yr; }));
      const next = [...uc].filter((p) => deliveryOf(p) && deliveryOf(p) >= new Date(Date.now() - 31 * 86400000)).sort((a, b) => deliveryOf(a) - deliveryOf(b))[0];
      const cards = hero('Under construction', intC(u(uc)) + '<u> units</u>', rel(u(uc)) || `${uc.length} buildings`)
        + hero('Proposed', intC(u(pr)) + '<u> units</u>', rel(u(pr)) || `${pr.length} buildings`)
        + hero('Delivering in 12 months', intC(in12) + '<u> units</u>', rel(in12))
        + hero('Next delivery', next ? monYr(deliveryOf(next)) : '—', next ? E(next.name) : '')
        + hero('Stalled', intC(u(st)) + '<u> units</u>', st.length ? `${st.length} not counted above` : 'None marked');
      const acres = (p) => p.acreage || p.acres, den = (p) => (acres(p) && p.units ? p.units / acres(p) : null);
      const prow = (p) => rowWith(p, `${nameCell(p, E(p.submarket || '') + (p._auto ? ' <span class="csx-chip area" title="Pulled in because it is in one of the set’s submarkets">In area</span>' : ''))}<td class="csx-dev">${E(p.developer || '—')}</td><td>${E(p.style || '')}</td><td class="num">${intC(p.units)}</td><td class="num csx-o">${acres(p) ? (+acres(p)).toFixed(1) : '—'}</td><td class="num csx-o">${den(p) ? den(p).toFixed(0) : '—'}</td><td>${monYr(begunOf(p))}</td><td>${monYr(deliveryOf(p))}</td><td class="csx-note">${E(ed(p).notes || p.notes || '')}</td>${tail(p)}`, 12);
      const head = colg([20, 14, 7, 7, 7, 7, 7, 7, 15, 7, '40px', '32px']) + '<thead><tr><th class="csx-pc">Property</th><th class="csx-left">Developer</th><th>Type</th><th class="num">Units</th><th class="num csx-o">Acres</th><th class="num csx-o">Units/ac</th><th>Start</th><th>Est. completion</th><th class="csx-left">Notes</th><th>Updated</th><th></th><th></th></tr></thead>';
      const grp = (label, a) => (a.length ? `<tr class="csx-grp"><td colspan="12">${label} · ${a.length} · ${intC(u(a))} units</td></tr>${a.sort((x, y) => (deliveryOf(x) || 0) - (deliveryOf(y) || 0)).map(prow).join('')}` : '');
      const worst = u(uc) + u(pr) + u(st);
      const line = sumLine([[intC(u(uc)), 'units under construction' + (base ? ` (${((u(uc) / base) * 100).toFixed(1)}% of ${E(bl)})` : '')], [intC(in12), 'delivering in 12 mo'], [next ? monYr(deliveryOf(next)) : '—', 'next delivery' + (next ? ` · ${E(next.name)}` : '')], [intC(worst), 'worst case with proposed + stalled' + (base ? ` (${((worst / base) * 100).toFixed(1)}%)` : '')]]) + `<span class="csx-fresh">${checked(pi)}</span>`;
      const nEx = pipeExcl(cs).size;
      const how = `<span class="csx-fresh">${checked(pi)} · new projects in ${setSubs(ps).map(E).join(', ')} are added automatically${nEx ? ` · ${nEx} removed <button type="button" class="csx-link csx-pxreset">Add back</button>` : ''}</span>`;
      out += `<section class="panel csx-sec csx-sec-pi">${panelHead('csx-s-pi', 'pi', 'Pipeline', uc.length + pr.length, line.replace(/<span class="csx-fresh">[\s\S]*?<\/span>$/, '') + how, null, addBtn)}${UI.addProj ? addProjForm(cs) : ''}
        ${uc.length ? `<div class="table-scroll"><table class="csx-table csx-dense csx-fixed csx-even">${head}<tbody>${uc.sort((x, y) => (deliveryOf(x) || 0) - (deliveryOf(y) || 0)).map(prow).join('')}</tbody></table></div>` : '<div class="csx-none3">Nothing under construction in this set’s area.</div>'}
        ${pr.length ? `<details class="csx-stalled csx-prop"${UI.propOpen ? ' open' : ''}><summary>Proposed · ${pr.length} project${pr.length === 1 ? '' : 's'} · ${intC(u(pr))} units${base ? ` (${((u(pr) / base) * 100).toFixed(1)}% of inventory)` : ''} · not counted as supply <i>▾</i></summary><div class="table-scroll"><table class="csx-table csx-dense csx-fixed csx-even">${head}<tbody>${pr.sort((x, y) => (y.units || 0) - (x.units || 0)).map(prow).join('')}</tbody></table></div></details>` : ''}
        ${st.length ? `<details class="csx-stalled csx-stl"${UI.stalledOpen ? ' open' : ''}><summary>Stalled · ${st.length} project${st.length === 1 ? '' : 's'} · ${intC(u(st))} units · not counted as supply <i>▾</i></summary><div class="table-scroll"><table class="csx-table csx-dense csx-fixed csx-even">${head}<tbody>${st.map(prow).join('')}</tbody></table></div></details>` : ''}</section>`;
    }
    return out;
  }

  // ---------- sale comps: an automatic list for the set, saved as the user's own the first time they edit it ----------
  const SALE_COLS = 'id,property_id,comp_type,name,address,city,submarket,lat,lng,sale_date,sale_price,units,proposed_units,acres,year_built,price_per_unit,price_per_sf,price_per_land_sf,cap_rate,cap_rate_t12,buyer,seller,excluded,portfolio';
  const SC = { pool: null, loading: false, err: null, links: {}, linkLoad: {} };
  async function salePool() {
    if (SC.pool || SC.loading) return; SC.loading = true;
    try {
      const mk = (window.__WBD && window.__WBD.market) || '';
      const out = []; for (let f = 0; ; f += 1000) { const { data, error } = await WB.sb.schema('comps').from('sale_comps').select(SALE_COLS).eq('market_id', mk).range(f, f + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break; }
      SC.pool = out.filter((x) => !x.excluded);
    } catch (e) { SC.err = e.message || String(e); SC.pool = []; }
    SC.loading = false; if (UI.open) render();
  }
  async function saleLinks(cs) {
    if (!cs.uuid || SC.links[cs.id] || SC.linkLoad[cs.id]) return; SC.linkLoad[cs.id] = true;
    try { const { data, error } = await WB.sb.schema('market').from('comp_set_sales').select('sale_comp_id,sort').eq('comp_set_id', cs.uuid).order('sort'); if (error) throw error; SC.links[cs.id] = (data || []).map((r) => r.sale_comp_id); }
    catch (e) { SC.links[cs.id] = []; SC.err = e.message || String(e); }
    SC.linkLoad[cs.id] = false; if (UI.open === cs.id) render();
  }
  const sNum = (v) => (v == null || v === '' || isNaN(+v) || +v === 0 ? null : +v);
  const perUnit = (x) => { const un = sNum(x.units) || sNum(x.proposed_units); return sNum(x.price_per_unit) ?? (sNum(x.sale_price) && un ? x.sale_price / un : null); };
  const capOf = (x) => sNum(x.cap_rate) ?? sNum(x.cap_rate_t12);
  const kUSD = (n) => (n == null ? '—' : '$' + Math.round(n / 1000).toLocaleString() + 'K');
  const mUSD = (n) => (n == null ? '—' : n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : '$' + Math.round(n).toLocaleString());
  const sMon = (d) => { if (!d) return '—'; const [y, m] = String(d).split('-'); return MON[+m - 1] + ' ' + y; };
  function setGeo(ps) {
    const q = ps.filter((p) => p.lat != null); if (!q.length) return null;
    const c = { lat: q.reduce((a, p) => a + p.lat, 0) / q.length, lng: q.reduce((a, p) => a + p.lng, 0) / q.length };
    const r = Math.min(5, Math.max(2, Math.max(...q.map((p) => mi(c, p))) + 1));
    return { c, r };
  }
  function autoSales(ps) {
    const g = setGeo(ps); if (!g || !SC.pool) return [];
    const W = window.__WBD || {}, mine = new Set(ps.map((p) => String((W.propByCostar && W.propByCostar[p.id]) || p.id)));
    const now = Date.now(), yrs = (d) => (now - new Date(d + 'T12:00:00')) / (365.25 * 86400000);
    const pick = (type, maxYrs, n, ok) => SC.pool.filter((x) => x.comp_type === type && x.sale_date && yrs(x.sale_date) <= maxYrs && (ok ? ok(x) : true))
      .map((x) => ({ x, d: x.lat != null ? mi(g.c, x) : null, own: mine.has(String(x.property_id)) }))
      .filter((o) => o.own || (o.d != null && o.d <= g.r)).sort((a, b) => (b.own - a.own) || a.d - b.d).slice(0, n).map((o) => o.x.id);
    return pick('investment', 3, 12, (x) => (sNum(x.units) || 0) >= 50).concat(pick('land', 4, 10));
  }
  function saleList(cs, ps) {
    const curated = !!(cs.settings && cs.settings.salesCurated) || (SC.links[cs.id] && SC.links[cs.id].length > 0);
    const ids = curated ? (SC.links[cs.id] || []) : autoSales(ps);
    const byIdS = new Map((SC.pool || []).map((x) => [x.id, x]));
    return { curated, ids, rows: ids.map((id) => byIdS.get(id)).filter(Boolean) };
  }
  async function saveSales(cs, ids) {
    if (!cs.uuid) { wbSaveNote('Save the comp set first', true); return false; }
    const by = (window.WB && WB.user && WB.user.email) || null;
    try {
      const old = SC.links[cs.id] || [];
      const drop = old.filter((id) => !ids.includes(id));
      if (drop.length) { const { error } = await WB.sb.schema('market').from('comp_set_sales').delete().eq('comp_set_id', cs.uuid).in('sale_comp_id', drop); if (error) throw error; }
      if (ids.length) { const { error } = await WB.sb.schema('market').from('comp_set_sales').upsert(ids.map((id, i) => ({ comp_set_id: cs.uuid, sale_comp_id: id, sort: i + 1, created_by: by })), { onConflict: 'comp_set_id,sale_comp_id' }); if (error) throw error; }
      SC.links[cs.id] = ids.slice();
      cs.settings = { ...(cs.settings || {}), salesCurated: true }; touch(cs);
      try { Object.keys(csSalesCache).forEach((k) => { if (k.startsWith(cs.id + ':')) delete csSalesCache[k]; }); } catch (e) {}
      wbSaveNote('Saved sale comps'); return true;
    } catch (e) { wbSaveNote('Couldn’t save sale comps: ' + (e.message || e), true); return false; }
  }
  async function resetSales(cs) {
    try { if (cs.uuid) { const { error } = await WB.sb.schema('market').from('comp_set_sales').delete().eq('comp_set_id', cs.uuid); if (error) throw error; } } catch (e) { wbSaveNote('Couldn’t reset: ' + (e.message || e), true); return; }
    SC.links[cs.id] = []; cs.settings = { ...(cs.settings || {}) }; delete cs.settings.salesCurated; touch(cs); render();
  }
  // buyer/seller as people say it: drop the entity in parentheses and anything after ';' or ' / '
  const shortCo = (x) => String(x || '').replace(/\s*\(.*?\)\s*/g, ' ').split(/;|\s\/\s/)[0].replace(/,?\s+(LLC|L\.L\.C\.|Inc\.?|LP|L\.P\.)$/i, '').trim() || '—';
  function salesSection(cs, ps) {
    if (!SC.pool) salePool(); saleLinks(cs);
    const head = (extra, line) => `<section class="panel csx-sec csx-sec-sc">${panelHead('csx-s-sc', 'sc', 'Sale comps', null, /Loading/.test(line || '') ? line : '', null, extra)}`;
    if (!SC.pool || SC.linkLoad[cs.id]) return head('', '<span class="csx-none2">Loading sales…</span>') + '</section>';
    const L = saleList(cs, ps), g = setGeo(ps);
    const inv = L.rows.filter((x) => x.comp_type === 'investment'), land = L.rows.filter((x) => x.comp_type === 'land');
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const W = window.__WBD || {}, mine = new Set(ps.map((p) => String((W.propByCostar && W.propByCostar[p.id]) || p.id)));
    const dist = (x) => (g && x.lat != null ? mi(g.c, x).toFixed(1) + ' mi' : '—');
    const tag = (x) => (mine.has(String(x.property_id)) ? ' <span class="csx-chip in">In set</span>' : '') + (x.portfolio ? ' <span class="csx-chip pr" title="Portfolio allocation">Portfolio</span>' : '');
    const buyerTd = (x) => `<td class="csx-dev" title="${E(x.buyer || '')}">${E(shortCo(x.buyer))}</td>`;
    const cols = '<colgroup><col style="width:24%"><col style="width:8%"><col style="width:6%"><col style="width:6%"><col style="width:7%"><col style="width:8%"><col style="width:7%"><col style="width:7%"><col style="width:15%"><col style="width:7%"><col style="width:42px"></colgroup>';
    const rmB = (x) => `<td class="csx-x"><button type="button" class="csx-rm csx-srm" data-sid="${E(x.id)}" title="Remove from this set" aria-label="Remove ${E(x.name || '')}">×</button></td>`;
    const lnum = (x) => sNum(x.proposed_units) || sNum(x.units);
    const L_ = { units: avg(land.map(lnum).filter(Boolean)), ac: avg(land.map((x) => sNum(x.acres)).filter(Boolean)), price: avg(land.map((x) => sNum(x.sale_price)).filter(Boolean)),
      pu: avg(land.map(perUnit).filter((v) => v != null)), lsf: avg(land.map((x) => sNum(x.price_per_land_sf)).filter(Boolean)), den: avg(land.map((x) => (lnum(x) && sNum(x.acres) ? lnum(x) / sNum(x.acres) : null)).filter(Boolean)) };
    const I_ = { pu: avg(inv.map(perUnit).filter((v) => v != null)), psf: avg(inv.map((x) => sNum(x.price_per_sf)).filter(Boolean)), cap: avg(inv.map(capOf).filter(Boolean)), units: avg(inv.map((x) => sNum(x.units)).filter(Boolean)), yr: avg(inv.map((x) => sNum(x.year_built)).filter(Boolean)) };
    const strip = (title, n, items) => `<div class="csx-sstrip"><b>${title}</b><em>${n}</em>${sumLine(items)}</div>`;
    const invT = inv.length ? `<table class="csx-table csx-dense csx-salet">${cols}<thead><tr><th class="csx-pc">Property</th><th>Date</th><th class="num">Units</th><th class="num">Built</th><th class="num">Price</th><th class="num">$/unit</th><th class="num">$/SF</th><th class="num">Cap</th><th>Buyer</th><th class="num">Distance</th><th></th></tr></thead><tbody>
      ${inv.sort((a, b) => String(b.sale_date).localeCompare(String(a.sale_date))).map((x) => `<tr class="csx-srow" data-sid="${E(x.id)}"><td><span class="csx-pname2">${E(x.name || x.address || '(unnamed)')}</span>${tag(x)}<div class="csx-addr">${E([x.address, x.submarket || x.city].filter(Boolean).join(' · '))}</div></td><td>${sMon(x.sale_date)}</td><td class="num">${intC(sNum(x.units))}</td><td class="num">${x.year_built || '—'}</td><td class="num">${mUSD(sNum(x.sale_price))}</td><td class="num csx-k">${kUSD(perUnit(x))}</td><td class="num">${sNum(x.price_per_sf) ? '$' + Math.round(x.price_per_sf) : '—'}</td><td class="num">${capOf(x) ? capOf(x).toFixed(2) + '%' : '—'}</td>${buyerTd(x)}<td class="num">${dist(x)}</td>${rmB(x)}</tr>`).join('')}
      </tbody><tfoot><tr><td>Average</td><td></td><td class="num">${intC(avg(inv.map((x) => sNum(x.units)).filter(Boolean)))}</td><td class="num">${I_.yr ? Math.round(I_.yr) : '—'}</td><td class="num">${mUSD(avg(inv.map((x) => sNum(x.sale_price)).filter(Boolean)))}</td><td class="num csx-k">${kUSD(avg(inv.map(perUnit).filter((v) => v != null)))}</td><td class="num">${(() => { const v = avg(inv.map((x) => sNum(x.price_per_sf)).filter(Boolean)); return v ? '$' + Math.round(v) : '—'; })()}</td><td class="num">${(() => { const v = avg(inv.map(capOf).filter(Boolean)); return v ? v.toFixed(2) + '%' : '—'; })()}</td><td colspan="3"></td></tr></tfoot></table>` : '<div class="csx-none3">No investment sales in the list</div>';
    const landT = land.length ? `<table class="csx-table csx-dense csx-salet">${cols}<thead><tr><th class="csx-pc">Property</th><th>Date</th><th class="num">Units</th><th class="num">Acres</th><th class="num">Price</th><th class="num">$/door</th><th class="num">$/land SF</th><th class="num">Units/ac</th><th>Buyer</th><th class="num">Distance</th><th></th></tr></thead><tbody>
      ${land.sort((a, b) => String(b.sale_date).localeCompare(String(a.sale_date))).map((x) => { const un = sNum(x.proposed_units) || sNum(x.units), ac = sNum(x.acres); return `<tr class="csx-srow" data-sid="${E(x.id)}"><td><span class="csx-pname2">${E(x.name || x.address || '(unnamed)')}</span>${tag(x)}<div class="csx-addr">${E([x.address, x.submarket || x.city].filter(Boolean).join(' · '))}</div></td><td>${sMon(x.sale_date)}</td><td class="num">${intC(un)}</td><td class="num">${ac ? ac.toFixed(2) : '—'}</td><td class="num">${mUSD(sNum(x.sale_price))}</td><td class="num csx-k">${kUSD(perUnit(x))}</td><td class="num">${sNum(x.price_per_land_sf) ? '$' + (+x.price_per_land_sf).toFixed(2) : '—'}</td><td class="num">${un && ac ? (un / ac).toFixed(0) : '—'}</td>${buyerTd(x)}<td class="num">${dist(x)}</td>${rmB(x)}</tr>`; }).join('')}
      </tbody><tfoot><tr><td>Average</td><td></td><td class="num">${intC(L_.units)}</td><td class="num">${L_.ac ? L_.ac.toFixed(2) : '—'}</td><td class="num">${mUSD(L_.price)}</td><td class="num csx-k">${kUSD(L_.pu)}</td><td class="num">${L_.lsf ? '$' + L_.lsf.toFixed(2) : '—'}</td><td class="num">${L_.den ? L_.den.toFixed(0) : '—'}</td><td colspan="3"></td></tr></tfoot></table>` : '<div class="csx-none3">No land sales in the list</div>';
    const ipu = avg(inv.map(perUnit).filter((v) => v != null)), cap = avg(inv.map(capOf).filter(Boolean)), lpu = avg(land.map(perUnit).filter((v) => v != null));
    const line = sumLine([[String(inv.length), inv.length === 1 ? 'investment sale' : 'investment sales'], [String(land.length), land.length === 1 ? 'land sale' : 'land sales']])
      + `<span class="csx-fresh">${L.curated ? 'Your list' : `Auto-picked: within ${g ? g.r.toFixed(1) : '—'} mi of the set, investment in the last 3 years (50+ units), land in the last 4 · add or remove one to keep it as yours`}</span>`;
    const extra = `<div class="csx-scacts">${L.curated ? '<button type="button" class="csx-link csx-sreset">Reset to auto</button>' : `<span class="csx-autonote" title="Within ${g ? g.r.toFixed(1) : '—'} mi of the set: investment sales in the last 3 years (50+ units), land in the last 4. Add or remove one to keep the list as yours.">Auto-picked</span>`}<button type="button" class="yx-btn csx-sbrowse">+ Add</button><div class="csx-ta csx-sadd"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg><input class="csx-in csx-sadd-q" placeholder="Add a sale by name or address…" aria-label="Add a sale"><div class="csx-ta-list" hidden></div></div></div>`;
    return head(extra, line) + strip('Investment sales', inv.length, [[kUSD(I_.pu), '/unit'], [I_.psf ? '$' + Math.round(I_.psf) : '—', '/SF'], [I_.cap ? I_.cap.toFixed(2) + '%' : '—', 'avg cap'], [intC(I_.units), 'avg units'], [I_.yr ? Math.round(I_.yr) : '—', 'avg vintage']]) + `<div class="table-scroll">${invT}</div>`
      + strip('Land sales', land.length, [[kUSD(L_.pu), '/door'], [L_.lsf ? '$' + L_.lsf.toFixed(2) : '—', '/land SF'], [L_.ac ? L_.ac.toFixed(2) : '—', 'avg acres'], [L_.den ? L_.den.toFixed(0) : '—', 'avg units/ac'], [mUSD(L_.price), 'avg price']]) + `<div class="table-scroll">${landT}</div>${SC.err ? `<div class="csx-hint warn">${E(SC.err)}</div>` : ''}</section>`;
  }
  function openSale(id) {
    const x = (SC.pool || []).find((y) => y.id === id); if (!x || typeof openSaleCompDetail !== 'function') return;
    const type = x.comp_type === 'land' ? 'land' : 'investment';
    let c = (customComps[type] || []).find((k) => k._uuid === x.id || k.id === x.id);
    if (!c) {   // outside the Sale Comps tab's own filter (small or old deals): load it for the modal
      c = { id: x.id, _uuid: x.id, name: x.name, address: x.address, city: x.city, submarket: x.submarket, lat: x.lat, lng: x.lng, saleDate: x.sale_date, salePrice: sNum(x.sale_price), units: sNum(x.units), proposedUnits: sNum(x.proposed_units), acreage: sNum(x.acres), yearBuilt: sNum(x.year_built), pricePerUnit: sNum(x.price_per_unit), pricePerSF: sNum(type === 'land' ? (x.price_per_land_sf ?? x.price_per_sf) : x.price_per_sf), pricePerLandSF: sNum(x.price_per_land_sf), capRate: sNum(x.cap_rate), buyer: x.buyer, seller: x.seller };
      (customComps[type] = customComps[type] || []).push(c);
    }
    openSaleCompDetail(type, { customId: c.id });
  }
  window.wbCsOpenSet = () => !!(UI.open && compSets[UI.open]);
  // for the analysis map: phase colours, and the pipeline projects this tab pulls in from the set's submarkets
  window.wbCsPhase = (p) => { const ph = phaseOf(p); return ph === 'pipe' ? (isStalled(p) ? 'stalled' : isProposed(p) ? 'proposed' : 'uc') : ph; };
  window.wbCsMapExtras = (cs) => { try { return cs ? autoPipe(cs, membersOf(cs)) : []; } catch (e) { return []; } };
  window.wbCsRefreshSales = () => { SC.pool = null; if (UI.open && getActiveView() === 'compsets') render(); };
  window.wbCsStartProject = (id) => {
    const x = (SC.pool || []).find((y) => y.id === id); if (!x) return;
    const d = x.sale_date ? String(x.sale_date).slice(0, 7) : '';
    UI.apPrefill = { landCompId: x.id, saleLabel: sMon(x.sale_date) + ' land', name: x.name || '', address: x.address || '', city: x.city || '', units: sNum(x.proposed_units) || sNum(x.units) || '', developer: shortCo(x.buyer) === '—' ? '' : shortCo(x.buyer), acres: sNum(x.acres) || '', start: d, lat: x.lat, lng: x.lng,
      notes: `Land bought ${sMon(x.sale_date)}${sNum(x.sale_price) ? ' for ' + mUSD(sNum(x.sale_price)) : ''}${x.seller ? ' from ' + shortCo(x.seller) : ''}.` };
    UI.addProj = true; render();
    const t = document.getElementById('csx-s-pi'); if (t) window.scrollTo({ top: t.getBoundingClientRect().top + scrollY - 110, behavior: 'smooth' });
  };
  // ---------- sale comp browser: map + search over every sale in the market ----------
  const SB = { type: 'all', yrs: 3, rad: 5, minU: 0, q: '', pick: new Set(), map: null, layer: null };
  function openSaleBrowser(cs, ps) {
    const old = document.getElementById('csx-sbm'); if (old) old.remove();
    SB.pick = new Set(); SB.q = ''; const g = setGeo(ps); SB.rad = g ? Math.max(3, Math.ceil(g.r)) : 0;
    const m = document.createElement('div'); m.id = 'csx-sbm'; m.className = 'csx-modal';
    m.innerHTML = `<div class="csx-modal-box"><div class="csx-modal-head"><div><b>Add sale comps</b><span>${E(cs.name)}</span></div><button type="button" class="csx-modal-x" aria-label="Close">×</button></div>
      <div class="csx-sbf">
        <div class="csx-ta csx-sadd csx-sbq"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg><input class="csx-in" placeholder="Search name, address, buyer or seller…"></div>
        <div class="toggle-group csx-sbtype">${[['all', 'All'], ['investment', 'Investment'], ['land', 'Land']].map(([k, l]) => `<button type="button" class="toggle-btn${SB.type === k ? ' active' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
        <select class="csx-in csx-sbyrs">${[[1, 'Last year'], [2, 'Last 2 years'], [3, 'Last 3 years'], [5, 'Last 5 years'], [0, 'Any date']].map(([v, l]) => `<option value="${v}"${SB.yrs === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <select class="csx-in csx-sbrad">${[[1, 'Within 1 mi'], [2, 'Within 2 mi'], [3, 'Within 3 mi'], [5, 'Within 5 mi'], [10, 'Within 10 mi'], [0, 'Anywhere']].map(([v, l]) => `<option value="${v}"${SB.rad === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <select class="csx-in csx-sbmin">${[[0, 'Any size'], [50, '50+ units'], [100, '100+ units'], [200, '200+ units']].map(([v, l]) => `<option value="${v}"${SB.minU === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      <div class="csx-sbbody"><div class="csx-sblist"></div><div class="csx-sbmap"></div></div>
      <div class="csx-modal-foot"><span class="csx-sbcount"></span><button type="button" class="yx-btn csx-sbcancel">Cancel</button><button type="button" class="yx-btn yx-btn-primary csx-sbadd" disabled>Add selected</button></div></div>`;
    document.body.appendChild(m);
    const close = () => { try { if (SB.map) SB.map.remove(); } catch (e) {} SB.map = null; m.remove(); };
    m.querySelector('.csx-modal-x').onclick = close; m.querySelector('.csx-sbcancel').onclick = close;
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { document.removeEventListener('keydown', esc); close(); } });
    const have = () => new Set(saleList(cs, ps).ids);
    const draw = () => {
      const now = Date.now(), H = have(), q = SB.q.toLowerCase();
      const rows = (SC.pool || []).filter((x) => (SB.type === 'all' || x.comp_type === SB.type)
        && (!SB.yrs || (x.sale_date && (now - new Date(x.sale_date + 'T12:00:00')) / (365.25 * 86400000) <= SB.yrs))
        && (!SB.minU || (sNum(x.units) || sNum(x.proposed_units) || 0) >= SB.minU)
        && (!q || [x.name, x.address, x.buyer, x.seller, x.city, x.submarket].join(' ').toLowerCase().includes(q)))
        .map((x) => ({ x, d: g && x.lat != null ? mi(g.c, x) : null }))
        .filter((o) => !SB.rad || (o.d != null && o.d <= SB.rad))
        .sort((a, b) => (a.d == null) - (b.d == null) || (a.d - b.d) || String(b.x.sale_date).localeCompare(String(a.x.sale_date))).slice(0, 300);
      const list = m.querySelector('.csx-sblist');
      list.innerHTML = rows.length ? rows.map(({ x, d }) => { const inn = H.has(x.id), on = SB.pick.has(x.id); return `<label class="csx-sbrow${inn ? ' in' : ''}${on ? ' on' : ''}" data-sid="${E(x.id)}">
          <input type="checkbox" ${inn ? 'checked disabled' : on ? 'checked' : ''}>
          <span class="csx-sbt"><b>${E(x.name || x.address || '(unnamed)')}</b><small>${x.comp_type === 'land' ? 'Land' : 'Investment'} · ${sMon(x.sale_date)} · ${mUSD(sNum(x.sale_price))}${perUnit(x) ? ' · ' + kUSD(perUnit(x)) + (x.comp_type === 'land' ? '/door' : '/unit') : ''}${x.comp_type === 'land' && sNum(x.acres) ? ' · ' + (+x.acres).toFixed(1) + ' ac' : sNum(x.units) ? ' · ' + intC(sNum(x.units)) + ' units' : ''}</small><small>${E(shortCo(x.buyer))}${d != null ? ' · ' + d.toFixed(1) + ' mi' : ''}${inn ? ' · already in the set' : ''}</small></span></label>`; }).join('')
        : '<div class="csx-none3">No sales match these filters.</div>';
      list.querySelectorAll('.csx-sbrow:not(.in)').forEach((r) => (r.querySelector('input').onchange = (e) => { const id = r.dataset.sid; if (e.target.checked) SB.pick.add(id); else SB.pick.delete(id); r.classList.toggle('on', e.target.checked); mark(); foot(); }));
      list.querySelectorAll('.csx-sbrow').forEach((r) => (r.onmouseenter = () => { const mk = SB.mk && SB.mk[r.dataset.sid]; if (mk) mk.openTooltip(); }));
      // map
      if (typeof L === 'undefined') return;
      if (!SB.map) {
        SB.map = L.map(m.querySelector('.csx-sbmap'), { zoomControl: true, attributionControl: false });
        try { (typeof wbLightLayer === 'function' ? wbLightLayer() : L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png')).addTo(SB.map); } catch (e) {}
        SB.map.setView(g ? [g.c.lat, g.c.lng] : ((window.__WBD && window.__WBD.center) || [39.74, -104.99]), 13);
        ps.filter((p) => p.lat != null).forEach((p) => L.circleMarker([p.lat, p.lng], { radius: 4, color: '#8a859b', weight: 1, fillColor: '#c9c3dc', fillOpacity: 1 }).bindTooltip(E(p.name || '')).addTo(SB.map));
        setTimeout(() => SB.map && SB.map.invalidateSize(), 60);
      }
      if (SB.layer) SB.layer.remove(); SB.layer = L.layerGroup().addTo(SB.map); SB.mk = {};
      if (g && SB.rad) L.circle([g.c.lat, g.c.lng], { radius: SB.rad * 1609.34, color: '#432890', weight: 1, dashArray: '4 4', fill: false }).addTo(SB.layer);
      rows.forEach(({ x }) => { if (x.lat == null) return;
        const mk = L.circleMarker([x.lat, x.lng], { radius: 7, weight: 2 }).bindTooltip(`<b>${E(x.name || x.address || '')}</b><br>${x.comp_type === 'land' ? 'Land' : 'Investment'} · ${sMon(x.sale_date)} · ${mUSD(sNum(x.sale_price))}`).addTo(SB.layer);
        mk.on('click', () => { if (H.has(x.id)) return; if (SB.pick.has(x.id)) SB.pick.delete(x.id); else SB.pick.add(x.id); const r = list.querySelector(`[data-sid="${CSS.escape(x.id)}"]`); if (r) { r.querySelector('input').checked = SB.pick.has(x.id); r.classList.toggle('on', SB.pick.has(x.id)); r.scrollIntoView({ block: 'nearest' }); } mark(); foot(); });
        SB.mk[x.id] = mk; });
      mark(); foot();
    };
    const mark = () => { const H = have(); Object.entries(SB.mk || {}).forEach(([id, mk]) => { const x = (SC.pool || []).find((y) => y.id === id), land = x && x.comp_type === 'land', inn = H.has(id), on = SB.pick.has(id);
      mk.setStyle({ color: inn ? '#2d7a4b' : on ? '#1d1247' : land ? '#c07a12' : '#432890', fillColor: inn ? '#8bd3a8' : on ? '#432890' : land ? '#f1c27b' : '#b6a8e6', fillOpacity: on || inn ? 1 : 0.75 }); }); };
    const foot = () => { const n = SB.pick.size, b = m.querySelector('.csx-sbadd'); b.disabled = !n; b.textContent = n ? `Add ${n} to the set` : 'Add selected'; m.querySelector('.csx-sbcount').textContent = `${m.querySelectorAll('.csx-sbrow').length} shown · green = already in the set`; };
    const qi = m.querySelector('.csx-sbq input'); let t; qi.oninput = () => { clearTimeout(t); t = setTimeout(() => { SB.q = qi.value.trim(); draw(); }, 150); };
    m.querySelectorAll('.csx-sbtype button').forEach((b) => (b.onclick = () => { SB.type = b.dataset.t; m.querySelectorAll('.csx-sbtype button').forEach((x) => x.classList.toggle('active', x === b)); draw(); }));
    m.querySelector('.csx-sbyrs').onchange = (e) => { SB.yrs = +e.target.value; draw(); };
    m.querySelector('.csx-sbrad').onchange = (e) => { SB.rad = +e.target.value; draw(); };
    m.querySelector('.csx-sbmin').onchange = (e) => { SB.minU = +e.target.value; draw(); };
    m.querySelector('.csx-sbadd').onclick = async () => { const ids = saleList(cs, ps).ids.concat([...SB.pick]); const b = m.querySelector('.csx-sbadd'); b.disabled = true; b.textContent = 'Saving…'; if (await saveSales(cs, ids)) { close(); render(); } else { b.disabled = false; foot(); } };
    draw(); setTimeout(() => qi.focus(), 30);
  }
  function wireSales(cs, ps) {
    const sbb = view.querySelector('.csx-sbrowse'); if (sbb) sbb.onclick = () => openSaleBrowser(cs, ps);
    const box = view.querySelector('.csx-sec-sc'); if (!box) return;
    const cur = () => saleList(cs, ps).ids;
    box.querySelectorAll('.csx-srm').forEach((b) => (b.onclick = async (e) => { e.stopPropagation(); const ids = cur().filter((id) => id !== b.dataset.sid); if (await saveSales(cs, ids)) render(); }));
    const rs = box.querySelector('.csx-sreset'); if (rs) rs.onclick = () => resetSales(cs);
    box.querySelectorAll('.csx-srow').forEach((tr) => (tr.onclick = (e) => { if (e.target.closest('.csx-rm')) return; openSale(tr.dataset.sid); }));
    const q = box.querySelector('.csx-sadd-q'); if (!q) return;
    const list = q.parentElement.querySelector('.csx-ta-list');
    const run = () => {
      const t = q.value.trim().toLowerCase(); if (t.length < 2) { list.hidden = true; return; }
      const have = new Set(cur()), g = setGeo(ps);
      const hits = (SC.pool || []).filter((x) => !have.has(x.id) && ((x.name || '') + ' ' + (x.address || '') + ' ' + (x.buyer || '')).toLowerCase().includes(t)).slice(0, 10);
      list.innerHTML = hits.map((x) => `<button type="button" data-sid="${E(x.id)}"><b>${E(x.name || x.address || '(unnamed)')}</b><small>${x.comp_type === 'land' ? 'Land' : 'Investment'} · ${sMon(x.sale_date)} · ${mUSD(sNum(x.sale_price))}${g && x.lat != null ? ' · ' + mi(g.c, x).toFixed(1) + ' mi' : ''}</small></button>`).join('') || '<div class="csx-none">No match</div>';
      list.hidden = false;
      list.querySelectorAll('button[data-sid]').forEach((b) => (b.onclick = async () => { list.hidden = true; if (await saveSales(cs, cur().concat(b.dataset.sid))) render(); }));
    };
    q.addEventListener('input', run); q.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 180));
  }

  // ---------- workspace ----------
  // pipeline projects in the set's submarkets join the set automatically; removing one keeps it out
  function syncAutoPipe(cs) {
    const add = autoPipe(cs, membersOf(cs)).map((p) => p.id);
    if (!add.length) return 0;
    cs.propertyIds = [...(cs.propertyIds || []), ...add];
    cs.settings = { ...(cs.settings || {}), pipeAdded: [...new Set([...((cs.settings && cs.settings.pipeAdded) || []), ...add.map(String)])] };
    touch(cs); return add.length;
  }
  function workspace(cs) {
    const justAdded = syncAutoPipe(cs);
    if (justAdded) setTimeout(() => { try { updateCompSetUI(); updateCompSetBanner(); renderCompSetList(); paintPill(); wbSaveNote(`Added ${justAdded} pipeline project${justAdded === 1 ? '' : 's'} from the set’s submarkets`); } catch (e) {} }, 0);
    const map = byId(), ps = membersOf(cs, map);
    const missing = (cs.propertyIds || []).length - ps.length;
    return `
      <div class="csx-crumb"><button type="button" class="csx-back">← All comp sets</button></div>
      <div class="panel csx-headp">
        <div class="panel-header csx-wshead csx-slim">
          <div class="csx-ttl">
            <input class="csx-title panel-title" value="${E(cs.name)}" aria-label="Set name" maxlength="80">
            <input class="csx-desc" value="${E(cs.description || '')}" placeholder="Add the deal or site this set is for" aria-label="Deal or site" maxlength="120">
          </div>
          <div class="csx-acts csx-hacts">
            <div class="csx-ta csx-addta"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg><input class="csx-in csx-add-q" placeholder="Add a property by name or address…" aria-label="Add a property"><div class="csx-ta-list" hidden></div></div>
            <div class="toggle-group csx-addtg"><button type="button" class="toggle-btn csx-addbtn${UI.add === 'near' ? ' active' : ''}" data-a="near">Near a site</button><button type="button" class="toggle-btn csx-addbtn${UI.add === 'map' ? ' active' : ''}" data-a="map">On the map</button></div>
            <span class="csx-hsep" aria-hidden="true"></span>
            <div class="csx-savebox">${saveLabel(cs)}</div>
            <div class="csx-menuwrap">
              <button type="button" class="yx-btn csx-menubtn" aria-haspopup="menu" aria-expanded="${UI.menu ? 'true' : 'false'}">⚙ Actions</button>
              <div class="csx-menu" role="menu" ${UI.menu ? '' : 'hidden'}>
                ${UI.confirmDel
                  ? `<div class="csx-menuq">Delete “${E(cs.name)}” for everyone in ${E((window.__WBD && window.__WBD.title) || 'this market')}?</div><div class="csx-menurow"><button type="button" class="yx-btn csx-del2">Delete</button><button type="button" class="yx-btn csx-del-no">Keep</button></div>`
                  : `<button type="button" role="menuitem" class="csx-dup">Duplicate set</button><button type="button" role="menuitem" class="csx-csv">Download CSV</button><button type="button" role="menuitem" class="csx-pdf">Download PDF</button><div class="csx-menusep"></div><button type="button" role="menuitem" class="csx-del danger">Delete set…</button>`}
              </div>
            </div>
          </div>
        </div>
        ${UI.add === 'near' ? addNear(cs, map) : UI.add === 'map' ? '<div class="csx-hint csx-maphint">Click any property on the map below to add it; click a comp to remove it. <button type="button" class="csx-tomap">Go to map ↓</button></div>' : ''}
        ${ps.length ? '' : (UI.add ? '' : '<div class="csx-empty sm"><b>No properties yet</b><span>Search above, add the properties near a site, or pick them on the map.</span></div>')}
        ${missing > 0 ? `<div class="csx-hint warn">${missing} propert${missing === 1 ? 'y' : 'ies'} in this set ${missing === 1 ? 'isn’t' : 'aren’t'} in the current data (removed or filtered out by a data load).</div>` : ''}
      ${ps.length ? `<nav class="csx-nav" aria-label="Sections"><a href="#csx-s-ex">Rent comps</a><a href="#csx-s-lu">Lease-up outlook</a><a href="#csx-s-pi">Pipeline</a><a href="#csx-intel-slot">Analysis</a><a href="#csx-s-yoc">YOC check</a><a href="#csx-s-sm">Submarket</a><a href="#csx-s-sc">Sale comps</a><i class="csx-navbar" aria-hidden="true"></i></nav>` : ''}
      </div>
      ${ps.length ? sections(cs, ps) : ''}
      <div id="csx-intel-slot"></div>
      <div id="csx-s-yoc">${yocCheck(ps)}</div>
      ${ps.length ? baselineBlock(cs, ps) + salesSection(cs, ps) : ''}`;
  }
  // the set's headline figures go in the page header band, like every other tab's KPIs
  function heroKpis(cs) {
    const slot = document.querySelector('.wbi-hero-kpis'), hero = document.querySelector('.wbi-hero') || (slot && slot.parentElement);
    const old = document.getElementById('csx-hero'); if (old) old.remove();
    if (!slot) return;
    if (cs) {
      const ps = membersOf(cs), ex = ps.filter((p) => phaseOf(p) === 'exist'), lu = ps.filter((p) => phaseOf(p) === 'lease'), pi = ps.filter((p) => phaseOf(p) === 'pipe');
      const st = stats(ex.length ? ex : ps), k = (l, v, u, sub) => `<div class="kpi"><div class="kpi-label">${l}</div><div class="kpi-value">${v}${u ? `<span class="unit">${u}</span>` : ''}</div><div class="kpi-sub">${sub}</div></div>`;
      // the product type most of the comps are, and what the YOC matrix needs for it
      let need = null, prod = null, askP = null;
      try {
        const col = (p) => (typeof yocColumnFor === 'function' ? yocColumnFor(p.style) : p.style), byP = {};
        ex.forEach((p) => { const c = col(p); if (YOC_PRODUCT_COLUMNS.includes(c)) byP[c] = (byP[c] || 0) + (p.units || 0); });
        prod = Object.entries(byP).sort((a, b) => b[1] - a[1]).map((x) => x[0])[0];
        if (prod) { need = requiredPsfRent(prod, sfFor(prod)); askP = wa(ex.filter((p) => col(p) === prod), (p) => p.avgAskingSF); }
      } catch (e) {}
      const gap = need && askP ? (askP / need - 1) * 100 : null;
      const bl = baselineOf(cs, ps).name, inSm = bl ? all().filter((p) => p.submarket === bl) : [], uu = (a) => a.reduce((x, p) => x + (p.units || 0), 0);
      const inv = uu(inSm.filter((p) => p.status === 'Existing')), sup = uu(inSm.filter((p) => p.status !== 'Existing' && !isStalled(p) && !isProposed(p))), worstS = uu(inSm.filter((p) => p.status !== 'Existing'));
      const O = outlook(cs, lu, pi), R = rpFor(bl);
      const row = document.createElement('div'); row.className = 'kpi-row'; row.id = 'csx-hero';
      row.innerHTML = k('Comp asking rent', st.ask == null ? '—' : '$' + st.ask.toFixed(2), '/SF', `${st.askU ? '$' + Math.round(st.askU).toLocaleString() + '/mo · ' : ''}${ex.length} stabilized comps`)
        + k(prod ? `${prod} needs` : 'Rent needed', need == null ? '—' : '$' + need.toFixed(2), '/SF', gap == null ? `for ${(yocState.targetYoc * 100).toFixed(2)}% YOC` : `<b class="${gap >= 0 ? 'csx-up' : 'csx-dn'}">${Math.abs(gap).toFixed(0)}% ${gap >= 0 ? 'above' : 'below'}</b> · comps vs ${(yocState.targetYoc * 100).toFixed(2)}% YOC`)
        + k('Comp occupancy', st.occ == null ? '—' : st.occ.toFixed(1), st.occ == null ? '' : '%', `${wks(st.wks)} wks free`)
        + k('Under construction', inv ? ((sup / inv) * 100).toFixed(1) : '—', inv ? '%' : '', `of ${E(bl || 'submarket')} inventory · ${inv ? ((worstS / inv) * 100).toFixed(0) + '% worst case' : ''}`)
        + k('Lease-up clears', O && O.lastOwn ? monYr(O.lastOwn) : '—', '', O ? `own pace · ${O.lastV ? monYr(O.lastV) : '—'} at ${O.V}/mo` : 'Nothing leasing or under construction')
        + k('Rent growth forecast', R && R.avg != null ? gPct(R.avg) : '—', R && R.avg != null ? '/yr' : '', R ? `${R.Y + 1}–${R.Y + 3} · ${R.Y} was ${gPct(R.c.yR)}` : 'No RealPage coverage');
      slot.appendChild(row);
    }
    const on = () => { if (hero) hero.classList.toggle('has-kpis', !!slot.children.length); };
    on(); requestAnimationFrame(on); setTimeout(on, 60);   // the shell re-syncs the band on view change; re-assert after it
  }
  // what the YOC matrix says each product type needs, next to what these comps actually get (cards shaped like the YOC tab's)
  function yocCheck(ps) {
    if (typeof requiredPsfRent !== 'function' || typeof YOC_PRODUCT_COLUMNS === 'undefined' || typeof yocState === 'undefined') return '';
    const col = (p) => (typeof yocColumnFor === 'function' ? yocColumnFor(p.style) : p.style);
    const target = (yocState.targetYoc * 100).toFixed(2) + '%';
    const cards = YOC_PRODUCT_COLUMNS.map((prod) => {
      let req = null; try { req = requiredPsfRent(prod, sfFor(prod)); } catch (e) {}
      const g = ps.filter((p) => p.status === 'Existing' && p.avgAskingSF && col(p) === prod);
      const later = ps.filter((p) => p.status !== 'Existing' && p.avgAskingSF && col(p) === prod);
      const hits = req ? g.filter((p) => p.avgAskingSF >= req) : [];
      // every stabilized comp in the set, any product type: a mid-rise rent can carry garden construction
      const allEx = ps.filter((p) => p.status === 'Existing' && p.avgAskingSF), allHits = req ? allEx.filter((p) => p.avgAskingSF >= req) : [];
      const li = (p, counted) => { const ok = req && p.avgAskingSF >= req; return `<li class="${counted ? (ok ? 'ok' : 'bad') : 'na'}"><button type="button" class="csx-ycp" data-pid="${E(p.id)}">${E(p.name || p.address)}</button><small class="csx-yct${col(p) === prod ? ' same' : ''}">${E(col(p) || p.style || '')}</small><span>$${p.avgAskingSF.toFixed(2)}</span><em>${req ? (p.avgAskingSF >= req ? '+' : '−') + Math.abs((p.avgAskingSF / req - 1) * 100).toFixed(0) + '%' : ''}</em></li>`; };
      const sorted = (a) => [...a].sort((x, y) => y.avgAskingSF - x.avgAskingSF);
      const open = UI.yocOpen && UI.yocOpen[prod];
      let a = 0, w = 0; g.forEach((p) => { a += p.avgAskingSF * (p.units || 0); w += p.units || 0; }); const ask = w ? a / w : null;
      const ratio = req && ask ? ask / req : null, gap = ratio == null ? null : (ratio - 1) * 100;
      const fill = ratio == null ? 0 : Math.max(4, Math.min(100, ratio * 100));
      return `<div class="csx-yc">
        <div class="csx-yc-top"><b>${E(prod)}</b><span>${g.length} existing comp${g.length === 1 ? '' : 's'}</span></div>
        <div class="csx-yc-nums"><div><small>Needs</small><strong>${req == null ? '—' : '$' + req.toFixed(2)}</strong></div><div><small>Comps ask</small><strong>${ask == null ? '—' : '$' + ask.toFixed(2)}</strong></div><div><small>Gap</small><strong class="${gap == null ? '' : gap >= 0 ? 'ok' : 'bad'}">${gap == null ? '—' : (gap >= 0 ? '+' : '−') + Math.abs(gap).toFixed(0) + '%'}</strong></div></div>
        <div class="csx-ycbar"><i class="${gap == null ? '' : gap >= 0 ? 'ok' : 'bad'}" style="width:${fill}%"></i></div>
        <div class="csx-ychit2"><div><b class="${g.length ? (hits.length ? 'ok' : 'bad') : ''}">${g.length ? `${hits.length} of ${g.length}` : '—'}</b><small>${E(prod.toLowerCase())} comps hit</small></div><div><b class="${allHits.length ? 'ok' : 'bad'}">${allHits.length} of ${allEx.length}</b><small>all comps hit</small></div></div>
        ${allEx.length || later.length ? `<details class="csx-ychits" data-prod="${E(prod)}" ${open ? 'open' : ''}>
          <summary>Comps against $${req ? req.toFixed(2) : '—'}/SF<i aria-hidden="true">▾</i></summary>
          ${g.length ? `<div class="csx-ycl">${E(prod)}</div><ul>${sorted(g).map((p) => li(p, true)).join('')}</ul>` : ''}
          ${allEx.length > g.length ? `<div class="csx-ycl">Other product types</div><ul>${sorted(allEx.filter((p) => col(p) !== prod)).map((p) => li(p, true)).join('')}</ul>` : ''}
          ${later.length ? `<div class="csx-ycl">Not yet existing, not counted</div><ul>${sorted(later).map((p) => li(p, false)).join('')}</ul>` : ''}
        </details>` : `<div class="csx-yc-none">No stabilized comps in this set</div>`}
      </div>`;
    }).join('');
    return `<section class="panel csx-sec csx-yocp"><div class="csx-sech"><div class="csx-sect"><i></i><b>YOC check</b></div><span class="csx-fresh">Rent needed for a ${target} yield on the matrix's current costs, against this set's stabilized comps (unit-weighted, asking $/SF) <button type="button" class="csx-link csx-toyoc">Open YOC matrix →</button></span></div><div class="csx-ygrid2">${cards}</div></section>`;
  }
  function addSearch() {
    return `<div class="csx-add"><div class="csx-ta"><input class="csx-in csx-add-q" placeholder="Search a property by name or address…" value=""><div class="csx-ta-list" hidden></div></div></div>`;
  }
  function addNear(cs, map) {
    const anchor = UI.near;
    let cands = [];
    if (anchor) {
      const inSet = new Set((cs.propertyIds || []).map(String));
      const yr = parseInt(UI.nearYear, 10);
      cands = all().filter((p) => p.lat != null && !inSet.has(String(p.id)) && String(p.id) !== String(anchor.id))
        .map((p) => ({ p, d: mi(anchor, p) })).filter((x) => x.d <= UI.radius)
        .filter((x) => !UI.nearExisting || x.p.status === 'Existing').filter((x) => !yr || (x.p.yearBuilt || 0) >= yr)
        .sort((a, b) => a.d - b.d).slice(0, 60);
    }
    return `<div class="csx-add csx-near">
      <div class="csx-nearrow">
        <div class="csx-ta"><input class="csx-in csx-near-q" placeholder="Search the subject property or a nearby building…" value="${anchor ? E(anchor.name) : ''}"><div class="csx-ta-list" hidden></div></div>
        <select class="csx-in csx-rad">${[0.5, 1, 2, 3, 5].map((r) => `<option value="${r}" ${UI.radius === r ? 'selected' : ''}>within ${r} mi</option>`).join('')}</select>
        <label class="csx-ck"><input type="checkbox" class="csx-nex" ${UI.nearExisting ? 'checked' : ''}> Existing only</label>
        <select class="csx-in csx-nyr"><option value="">Any vintage</option>${[2000, 2010, 2015, 2018, 2020].map((y) => `<option value="${y}" ${String(UI.nearYear) === String(y) ? 'selected' : ''}>Built ${y}+</option>`).join('')}</select>
      </div>
      ${anchor ? (cands.length ? `<div class="csx-candhead"><span>${cands.length} within ${UI.radius} mi of ${E(anchor.name)}, nearest first</span><button type="button" class="csx-all">Select all</button></div><div class="csx-cands">${cands.map((x) => `<label class="csx-cand"><input type="checkbox" value="${E(x.p.id)}"><span><b>${E(x.p.name || x.p.address)}</b><small>${x.d.toFixed(1)} mi · ${(x.p.units || 0)} units · ${x.p.yearBuilt || '—'} · ${money(x.p.avgAskingSF)}/SF</small></span></label>`).join('')}</div>
        <div class="csx-bar"><button type="button" class="yx-btn yx-btn-primary csx-near-add" disabled>Add checked</button><button type="button" class="yx-btn csx-near-x">Close</button></div>`
        : '<div class="csx-hint">Nothing else within that radius with these filters.</div>') : '<div class="csx-hint">Pick the subject (or any building near the site), then choose a radius.</div>'}
    </div>`;
  }
  function typeahead(input, onPick, exclude) {
    const list = input.parentElement.querySelector('.csx-ta-list');
    const run = () => {
      const q = input.value.trim().toLowerCase(); if (q.length < 2) { list.hidden = true; return; }
      const ex = exclude ? exclude() : new Set();
      const hits = all().filter((p) => !ex.has(String(p.id)) && ((p.name || '') + ' ' + (p.address || '')).toLowerCase().includes(q)).slice(0, 8);
      list.innerHTML = hits.map((p) => `<button type="button" data-pid="${E(p.id)}"><b>${E(p.name || p.address)}</b><small>${E(p.address || '')} · ${p.units || 0} units · ${p.yearBuilt || '—'}${p.status !== 'Existing' ? ' · ' + E(p.status) : ''}</small></button>`).join('') || '<div class="csx-none">No match</div>';
      list.hidden = false;
      list.querySelectorAll('button[data-pid]').forEach((b) => (b.onclick = () => { list.hidden = true; onPick(byId().get(b.dataset.pid)); }));
    };
    input.addEventListener('input', run);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const f = list.querySelector('button[data-pid]'); if (f) f.click(); } if (e.key === 'Escape') list.hidden = true; });
    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 180));
  }

  // sets built here that never reached the database (offline, a failed save): keep retrying until they do
  const tried = {};
  function saveLocalOnly() {
    Object.values(compSets).forEach((cs) => { if (!cs.uuid && !tried[cs.id] && UI.save[cs.id] !== 'saving' && UI.save[cs.id] !== 'pending') { tried[cs.id] = true; saveNow(cs); } });
  }
  setTimeout(saveLocalOnly, 5000); setInterval(() => { Object.keys(tried).forEach((k) => { if (compSets[k] && !compSets[k].uuid) delete tried[k]; }); saveLocalOnly(); }, 120000);

  // ---------- render ----------
  function render() {
    if (UI.open && !compSets[UI.open]) UI.open = null;
    const cs = UI.open && compSets[UI.open];
    view.innerHTML = `<div class="csx">${cs ? workspace(cs) : library()}</div>`;
    wire(cs); heroKpis(cs); enterAnim(cs); drawSparks(); requestAnimationFrame(drawSparks);
    // the set's analysis (map, snapshot, fees, concessions, unit mix, positioning, sales, underwriting) lives under the workspace
    let intel = document.getElementById('cs-intel'); const slot = document.getElementById('csx-intel-slot');
    if (!intel && slot) { intel = document.createElement('div'); intel.id = 'cs-intel'; }   // the Demo's Index rebuild dropped the original container
    if (intel) {
      if (cs && slot) { slot.appendChild(intel); try { renderCompSetIntel(); } catch (e) { console.error('[csx]', e); } }
      else { const park = document.getElementById('csx-park') || Object.assign(document.createElement('div'), { id: 'csx-park', hidden: true }); if (!park.parentNode) view.after(park); park.appendChild(intel); }
    }
  }
  function wire(cs) {
    const $ = (s) => view.querySelector(s), $$ = (s) => view.querySelectorAll(s);
    $$('.csx-new').forEach((b) => (b.onclick = () => { UI.creating = true; UI.from = 'empty'; render(); setTimeout(() => { const i = $('.csx-nm-in'); if (i) i.focus(); }, 30); }));
    const q = $('.csx-q'); if (q) q.oninput = () => { UI.q = q.value; const pos = q.selectionStart; render(); const n = $('.csx-q'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } };
    $$('.csx-table tbody tr[data-id]').forEach((tr) => (tr.onclick = () => openSet(tr.dataset.id)));
    if (UI.creating && !cs) {
      $$('input[name=csx-from]').forEach((r) => (r.onchange = () => { UI.from = r.value; $$('.csx-opt').forEach((o) => o.classList.toggle('on', o.querySelector('input').checked)); }));
      $('.csx-make').onclick = create; $('.csx-cancel').onclick = () => { UI.creating = false; render(); };
      $('.csx-nm-in').onkeydown = (e) => { if (e.key === 'Enter') create(); };
    }
    if (!cs) return;
    $('.csx-back').onclick = () => { UI.open = null; render(); };
    const t = $('.csx-title'); t.onchange = () => { const v = t.value.trim(); if (!v) { t.value = cs.name; return; } cs.name = v; touch(cs); try { renderCompSetList(); updateCompSetBanner(); paintPill(); renderCompSetIntel(); } catch (e) {} };
    const d = $('.csx-desc'); d.onchange = () => { cs.description = d.value.trim(); touch(cs); };
    [t, d].forEach((i) => (i.onkeydown = (e) => { if (e.key === 'Enter') i.blur(); }));
    const r = $('.csx-retry'); if (r) r.onclick = () => saveNow(cs);
    const dp = $('.csx-dup'); if (dp) dp.onclick = () => { UI.menu = false;
      let name = cs.name + ' (copy)', k = 2; while (Object.values(compSets).some((s) => s.name === name)) name = `${cs.name} (copy ${k++})`;
      const id = 'cs-' + Date.now(); compSets[id] = { id, name, description: cs.description || '', propertyIds: [...(cs.propertyIds || [])], createdAt: Date.now(), updatedAt: Date.now() };
      touch(compSets[id]); openSet(id);
    };
    const mb = $('.csx-menubtn'); if (mb) mb.onclick = (e) => { e.stopPropagation(); UI.menu = !UI.menu; UI.confirmDel = false; render(); };
    const menu = $('.csx-menu'); if (menu) menu.onclick = (e) => e.stopPropagation();
    if (UI.menu) setTimeout(() => document.addEventListener('click', function off() { document.removeEventListener('click', off); if (UI.menu) { UI.menu = false; UI.confirmDel = false; render(); } }), 0);
    const cv = $('.csx-csv'); if (cv) cv.onclick = () => { UI.menu = false; render(); try { exportCompSetCsv(); } catch (e) { console.error(e); } };
    const pd = $('.csx-pdf'); if (pd) pd.onclick = () => { UI.menu = false; render(); try { exportCompSetPdf(); } catch (e) { console.error(e); } };
    const del = $('.csx-del'); if (del) del.onclick = () => { UI.confirmDel = true; render(); };
    const no = $('.csx-del-no'); if (no) no.onclick = () => { UI.confirmDel = false; UI.menu = false; render(); };
    const yes = $('.csx-del2'); if (yes) yes.onclick = async () => {
      yes.disabled = true; yes.textContent = 'Deleting…';
      try { if (cs.uuid && window.LegacyDB && LegacyDB.compSets) await LegacyDB.compSets.remove(cs); }
      catch (e) { yes.disabled = false; yes.textContent = 'Couldn’t delete: ' + (e.message || e); return; }
      if (state.activeCompSetId === cs.id) exitCompSet();
      delete compSets[cs.id]; try { saveCompSets(); renderCompSetList(); } catch (e) {} UI.open = null; UI.confirmDel = false; UI.menu = false; render();
    };
    const toMap = () => { const m = document.getElementById('csx-intel-slot'); if (m) m.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    $$('.csx-addbtn').forEach((b) => (b.onclick = () => { UI.add = UI.add === b.dataset.a ? '' : b.dataset.a; render(); const i = $('.csx-near-q'); if (UI.add === 'near' && i && !UI.near) i.focus(); if (UI.add === 'map') toMap(); }));
    const tm = $('.csx-tomap'); if (tm) tm.onclick = toMap;
    $$('.csx-ychits').forEach((d) => (d.ontoggle = () => { UI.yocOpen = UI.yocOpen || {}; UI.yocOpen[d.dataset.prod] = d.open; }));
    $$('.csx-ycp').forEach((b) => (b.onclick = () => { try { openDetail(b.dataset.pid); } catch (e) {} }));
    const ty = $('.csx-toyoc'); if (ty) ty.onclick = () => { const t = document.querySelector('.tab[data-view="yoc"]'); if (t) t.click(); window.scrollTo({ top: 0 }); };
    const inSet = () => new Set((cs.propertyIds || []).map(String));
    const aq = $('.csx-add-q'); if (aq) typeahead(aq, (p) => { if (!p) return; cs.propertyIds = [...(cs.propertyIds || []), p.id]; touch(cs); refresh(); setTimeout(() => { const i = $('.csx-add-q'); if (i) i.focus(); }, 30); }, inSet);
    const nq = $('.csx-near-q'); if (nq) typeahead(nq, (p) => { if (!p || p.lat == null) return; UI.near = { id: p.id, name: p.name || p.address, lat: p.lat, lng: p.lng }; render(); });
    const nx = $('.csx-near-x'); if (nx) nx.onclick = () => { UI.add = ''; UI.near = null; render(); };
    const rad = $('.csx-rad'); if (rad) rad.onchange = () => { UI.radius = parseFloat(rad.value); render(); };
    const nex = $('.csx-nex'); if (nex) nex.onchange = () => { UI.nearExisting = nex.checked; render(); };
    const nyr = $('.csx-nyr'); if (nyr) nyr.onchange = () => { UI.nearYear = nyr.value; render(); };
    const na = $('.csx-near-add'); if (na) {
      const sync = () => { const k = $$('.csx-cand input:checked').length; na.textContent = k ? `Add ${k} to the set` : 'Add checked'; na.disabled = !k; const a = $('.csx-all'); if (a) a.textContent = k && k === $$('.csx-cand input').length ? 'Clear' : 'Select all'; };
      $$('.csx-cand input').forEach((c) => (c.onchange = sync));
      const sa = $('.csx-all'); if (sa) sa.onclick = () => { const on = sa.textContent === 'Select all'; $$('.csx-cand input').forEach((c) => { c.checked = on; }); sync(); };
      na.onclick = () => { const add = [...$$('.csx-cand input:checked')].map((c) => { const p = byId().get(c.value); return p ? p.id : c.value; }); if (!add.length) return; cs.propertyIds = [...(cs.propertyIds || []), ...add]; touch(cs); UI.add = ''; UI.near = null; refresh(); };
    }
    $$('.csx-rm:not(.csx-srm)').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const pid = b.closest('tr').dataset.pid;
      if ((cs.propertyIds || []).some((x) => String(x) === String(pid))) {
        const pp = byId().get(String(pid)); if (pp && pp.status !== 'Existing') setPipeExcl(cs, [...pipeExcl(cs), String(pid)]);   // don't pull it back in
        cs.propertyIds = (cs.propertyIds || []).filter((x) => String(x) !== String(pid)); touch(cs); refresh(); }
      else { setPipeExcl(cs, [...pipeExcl(cs), String(pid)]); render(); }   // pulled in from the area: keep it off this set
    }));
    const pxr = $('.csx-pxreset'); if (pxr) pxr.onclick = () => { setPipeExcl(cs, []); render(); };
    const bs = $('.csx-blsel'); if (bs) bs.onchange = () => setBaseline(cs, bs.value);
    $$('.csx-sec-ex th.csx-sortable').forEach((th) => (th.onclick = () => { const k = th.dataset.sk, st = UI.rcSort || { k: 'built', d: -1 };
      UI.rcSort = st.k === k ? { k, d: -st.d } : { k, d: ['name', 'owner', 'style'].includes(k) ? 1 : -1 }; render(); }));
    wireSales(cs, membersOf(cs));
    const vs = $('.csx-vel'); if (vs) vs.onchange = () => { cs.settings = { ...(cs.settings || {}), vel: +vs.value }; touch(cs); render(); };
    const sd = $('.csx-stl'); if (sd) sd.ontoggle = () => { UI.stalledOpen = sd.open; };
    const prd = $('.csx-prop'); if (prd) prd.ontoggle = () => { UI.propOpen = prd.open; };
    const smy = $('.csx-smyrs'); if (smy) smy.ontoggle = () => { UI.smYrs = smy.open; };
    const pinHead = () => { const h = view.querySelector('.csx-headp'), n = h && h.querySelector('.csx-nav'); if (!h || !n) return; h.style.top = (56 - (h.offsetHeight - n.offsetHeight)) + 'px'; };
    pinHead(); requestAnimationFrame(pinHead);
    if (!window.__csxPinRz) { window.__csxPinRz = true; window.addEventListener('resize', () => { const h = document.querySelector('#view-compsets .csx-headp'), n = h && h.querySelector('.csx-nav'); if (h && n) h.style.top = (56 - (h.offsetHeight - n.offsetHeight)) + 'px'; }); }
    if (!window.__csxNavSpy) { window.__csxNavSpy = true; let raf = 0; window.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => {
      const links = [...document.querySelectorAll('#view-compsets .csx-nav a')]; if (!links.length) return; let cur = links[0];
      links.forEach((l) => { const t = document.getElementById(l.getAttribute('href').slice(1)); if (t && t.getBoundingClientRect().top < 160) cur = l; });
      links.forEach((l) => l.classList.toggle('on', l === cur)); moveBar(cur); }); }, { passive: true }); }
    moveBar(view.querySelector('.csx-nav a.on') || view.querySelector('.csx-nav a'));
    $$('.csx-nav a').forEach((a) => (a.onclick = (e) => { const t = document.getElementById(a.getAttribute('href').slice(1)); if (!t) return; e.preventDefault(); window.scrollTo({ top: t.getBoundingClientRect().top + scrollY - 110, behavior: 'smooth' }); }));
    const ap = $('.csx-addproj'); if (ap) ap.onclick = () => { UI.addProj = !UI.addProj; render(); const f = $('.csx-ap [data-f=name]'); if (f) f.focus(); };
    const apb = $('.csx-ap'); if (apb) { apb.querySelector('.csx-ap-x').onclick = () => { UI.addProj = false; UI.apPrefill = null; render(); }; apb.querySelector('.csx-ap-save').onclick = () => saveProject(apb, cs); wirePin(apb, null); }
    $$('.csx-updbtn').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const pid = b.closest('tr').dataset.pid; UI.upd = UI.upd === pid ? null : pid; render(); const f = view.querySelector('.csx-uf'); if (f) f.scrollIntoView({ block: 'nearest' }); }));
    $$('.csx-uf:not(.csx-ap)').forEach((box) => {
      box.querySelector('.csx-uf-x').onclick = () => { UI.upd = null; render(); };
      box.querySelector('.csx-uf-save').onclick = () => saveUpdate(box, cs);
      wirePin(box, byId().get(box.dataset.pid));
      const stg = box.querySelector('.csx-uf-stage');
      if (stg) stg.onchange = () => { const d = stg.value === 'Delivered'; box.querySelector('.csx-uf-dl').textContent = d ? 'Delivered (month)' : 'Estimated completion'; box.querySelector('.csx-uf-dv').hidden = !d; };
      const live = () => {   // $/SF and the mix-weighted average as you type
        let n = 0, r = 0, sfw = 0;
        box.querySelectorAll('.csx-uf-mix tr[data-b]').forEach((tr) => {
          const k = tr.dataset.b, p = byId().get(box.dataset.pid) || {}, sf = p[k + 'SF'];
          const rent = num(tr.querySelector('.csx-uf-rent').value), u = num(tr.querySelector('[data-f^="units"]').value);
          tr.querySelector('.csx-uf-psf').textContent = rent && sf ? '$' + (rent / sf).toFixed(2) : '—';
          if (rent && u) { n += u; r += rent * u; if (sf) sfw += sf * u; }
        });
        const av = box.querySelector('.csx-uf-avgv'); if (av && n) av.textContent = `${sfw ? '$' + (r / sfw).toFixed(2) + '/SF · ' : ''}$${Math.round(r / n).toLocaleString()}/mo`;
      };
      box.querySelectorAll('.csx-uf-mix input').forEach((i) => (i.oninput = live));
      const cw = box.querySelector('.csx-uf-cw');
      if (cw) { const conv = () => { const p = byId().get(box.dataset.pid) || {}, t = box.querySelector('.csx-uf-ct').value, a = num(box.querySelector('.csx-uf-ca').value), l = num(box.querySelector('.csx-uf-cl').value) || 12;
          let rn = p.avgAskingUnit; { let n = 0, r = 0; box.querySelectorAll('.csx-uf-mix tr[data-b]').forEach((tr) => { const u = num(tr.querySelector('[data-f^="units"]').value), rr = num(tr.querySelector('.csx-uf-rent').value); if (u && rr) { n += u; r += u * rr; } }); if (n) rn = r / n; }
          const w = toWeeks(t, a, l, rn);
          cw.innerHTML = w == null ? (a == null && t !== 'none' ? 'Leave blank to use CoStar’s figure' : 'Needs an asking rent to convert') : `= <b>${w.toFixed(1)}</b> weeks free on a 12-month lease${rn ? ` · about $${Math.round((w / 52) * rn).toLocaleString()}/mo off` : ''}`;
          box.querySelector('.csx-uf-ca').disabled = t === 'none'; };
        box.querySelectorAll('.csx-uf-ct, .csx-uf-ca, .csx-uf-cl, .csx-uf-mix input').forEach((i) => { const o = i.oninput; i.oninput = (e) => { if (o) o(e); conv(); }; i.onchange = conv; }); conv(); }
    });
    $$('.csx-pname').forEach((b) => (b.onclick = () => { try { openDetail(b.closest('tr').dataset.pid); } catch (e) { console.error(e); } }));
  }
  function wirePin(box, prop) {
      const pinBtn = box.querySelector('.csx-uf-pin');
      if (pinBtn) pinBtn.onclick = () => {
        const el = box.querySelector('.csx-uf-map'), ll = box.querySelector('.csx-uf-ll');
        if (!el.hidden) { el.hidden = true; pinBtn.textContent = 'Move pin on map'; return; }
        el.hidden = false; pinBtn.textContent = 'Hide map';
        if (el._map || typeof L === 'undefined') { if (el._map) el._map.invalidateSize(); return; }
        const p = prop || {}, m0 = (ll.value.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/) || []);
        const ctr = (() => { const cs = UI.open && compSets[UI.open], q = cs ? membersOf(cs).filter((x) => x.lat != null) : []; return q.length ? [q.reduce((a, x) => a + x.lat, 0) / q.length, q.reduce((a, x) => a + x.lng, 0) / q.length] : ((window.__WBD && window.__WBD.center) || [39.74, -104.99]); })();
        const start = m0[1] ? [+m0[1], +m0[2]] : (p.lat != null ? [p.lat, p.lng] : ctr);
        if (!m0[1] && p.lat == null) { setTimeout(() => { if (!ll.value) ll.value = start[0].toFixed(6) + ', ' + start[1].toFixed(6); }, 0); }
        const map = L.map(el, { zoomControl: true, attributionControl: false }).setView(start, 17);
        try { (typeof wbSatLayer === 'function' ? wbSatLayer() : L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}')).addTo(map); } catch (e) { console.error(e); }
        const mk = L.marker(start, { draggable: true, icon: L.divIcon({ className: 'csx-pin', html: '<i></i>', iconSize: [22, 22], iconAnchor: [11, 22] }) }).addTo(map);
        const put = (latlng) => { mk.setLatLng(latlng); ll.value = latlng.lat.toFixed(6) + ', ' + latlng.lng.toFixed(6); };
        mk.on('dragend', () => put(mk.getLatLng())); map.on('click', (e) => put(e.latlng));
        ll.onchange = () => { const m = ll.value.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/); if (m) { mk.setLatLng([+m[1], +m[2]]); map.setView([+m[1], +m[2]]); } };
        el._map = map; setTimeout(() => map.invalidateSize(), 50);
      };
  }
  function moveBar(a) {
    const bar = document.querySelector('#view-compsets .csx-navbar'); if (!bar || !a) return;
    const nav = a.parentElement; bar.style.width = a.offsetWidth - 16 + 'px'; bar.style.transform = `translateX(${a.offsetLeft - nav.scrollLeft + 8}px)`; bar.style.opacity = 1;
  }
  // first open of a set: sections rise in and the header figures count up (once, not on every edit)
  let animatedFor = null, animTimer = null;
  function countUp() {
    document.querySelectorAll('#csx-hero .kpi-value').forEach((el) => {
      const n = el.firstChild; if (!n || n.nodeType !== 3) return;
      const m = n.textContent.match(/^([^0-9\-]*)(-?[0-9][0-9,]*\.?[0-9]*)(.*)$/); if (!m) return;
      const target = parseFloat(m[2].replace(/,/g, '')), dec = (m[2].split('.')[1] || '').length, t0 = performance.now(), dur = 700;
      const step = (t) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3), v = target * e;
        n.textContent = m[1] + (dec ? v.toFixed(dec) : Math.round(v).toLocaleString()) + m[3]; if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }
  function enterAnim(cs) {
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!cs || reduce) { animatedFor = cs ? cs.id : null; return; }
    if (animatedFor === cs.id && !animTimer) return;
    animatedFor = cs.id;
    const root = view.querySelector('.csx'); if (root) root.classList.add('csx-pre');   // hidden until the opening renders settle
    clearTimeout(animTimer);
    animTimer = setTimeout(() => {
      animTimer = null; const r = view.querySelector('.csx'); if (!r) return;
      r.classList.remove('csx-pre'); r.classList.add('csx-anim'); setTimeout(() => r.classList.remove('csx-anim'), 1400); countUp();
    }, 90);
  }
  // membership changed: the whole dashboard is scoped to this set, so re-render it and this view
  function refresh() { try { updateCompSetUI(); updateCompSetBanner(); renderCompSetList(); } catch (e) {} try { renderAll(); } catch (e) { console.error('[csx]', e); } render(); paintPill(); }

  // ---------- active set: header pill on every tab, URL, no toggle-off ----------
  const pill = document.createElement('div'); pill.className = 'csx-pill'; pill.hidden = true;
  function paintPill() {
    const on = state.compSetMode === 'viewing' && state.activeCompSetId && compSets[state.activeCompSetId];
    const head = document.querySelector('.wbi-head-row .wbi-ttl');
    if (head && pill.parentNode !== head) head.appendChild(pill);
    pill.hidden = !on;
    if (on) {
      const cs = compSets[state.activeCompSetId];
      pill.innerHTML = `<span class="csx-pill-k">Comp set</span><button type="button" class="csx-pill-n" title="Open in Comp Sets">${E(cs.name)} · ${(cs.propertyIds || []).length}</button><button type="button" class="csx-pill-x" title="Stop using this set" aria-label="Stop using this comp set">×</button>`;
      pill.querySelector('.csx-pill-n').onclick = () => openSet(cs.id);
      pill.querySelector('.csx-pill-x').onclick = () => { exitCompSet(); if (UI.open) { UI.open = null; } if (document.querySelector('.tab.active[data-view="compsets"]')) render(); };
    }
    // remember the active set in the address, so a reload or a shared link keeps it
    try {
      const u = new URL(location.href), key = on ? (compSets[state.activeCompSetId].uuid || state.activeCompSetId) : null;
      if ((u.searchParams.get('set') || null) !== key) { if (key) u.searchParams.set('set', key); else u.searchParams.delete('set'); u.searchParams.delete('compset'); history.replaceState(null, '', u); }
    } catch (e) {}
  }
  const _act = activateCompSet;
  activateCompSet = function (id) {
    if (!compSets[id]) return;
    if (state.activeCompSetId === id && state.compSetMode === 'viewing') { paintPill(); return; }   // choosing the active set again keeps it on
    const r = _act.apply(this, arguments); paintPill(); if (document.querySelector('.tab.active[data-view="compsets"]')) render(); return r;
  };
  window.activateCompSet = activateCompSet;
  const _exit = exitCompSet;
  exitCompSet = function () { const r = _exit.apply(this, arguments); paintPill(); return r; };
  window.exitCompSet = exitCompSet;
  const _ban = updateCompSetBanner;
  updateCompSetBanner = function () { const r = _ban.apply(this, arguments); paintPill(); return r; };

  // the view switch: render on entry; keep the analysis panel parked when leaving
  const _ra = renderActive;
  renderActive = function () { document.body.dataset.wbView = getActiveView(); if (getActiveView() === 'compsets') { render(); return; } const o = document.getElementById('csx-hero'); if (o) o.remove(); return _ra.apply(this, arguments); };
  window.renderActive = renderActive;

  // reopen the set named in the address once the sets have loaded
  (function restore() {
    const key = new URLSearchParams(location.search).get('set'); if (!key) return;
    let tries = 0;
    const go = () => {
      const cs = Object.values(compSets).find((s) => s.id === key || s.uuid === key);
      if (!cs) { if (tries++ < 40) setTimeout(go, 250); return; }
      if (state.activeCompSetId !== cs.id) activateCompSet(cs.id);
    };
    go();
  })();
  // every pop-up says which comp set it's showing; a property card says so only if that property is in the set
  // mark the property card's own header, so any other pop-up that reuses the same container isn't mistaken for it
  if (typeof openDetail === 'function') { const _od = openDetail; openDetail = function (pid) { const r = _od.apply(this, arguments); const h = document.querySelector('#modal-content .modal-header'); if (h) h.dataset.prop = String(pid); tagModals(); return r; }; window.openDetail = openDetail; }
  function tagModals() {
    const on = state.compSetMode === 'viewing' && state.activeCompSetId && compSets[state.activeCompSetId];
    document.querySelectorAll('.modal .modal-header').forEach((h) => {
      let t = h.querySelector('.csx-mtag');
      const modal = h.closest('.modal');
      const isCard = !!h.dataset.prop;
      const cs = on && compSets[state.activeCompSetId];
      const show = cs && (!isCard || (cs.propertyIds || []).some((x) => String(x) === h.dataset.prop));
      if (!show) { if (t) t.remove(); return; }
      const txt = isCard ? `In comp set ${cs.name}` : `Comp set ${cs.name} · ${(cs.propertyIds || []).length} properties`;
      if (t && t.dataset.txt === txt) return;
      if (!t) { t = document.createElement('div'); t.className = 'csx-mtag'; const title = h.querySelector('.modal-title'); const host = title ? title.parentElement : h.firstElementChild || h; host.appendChild(t); }
      t.dataset.txt = txt; t.innerHTML = `<span>${isCard ? 'In comp set' : 'Comp set'}</span>${E(cs.name)}${isCard ? '' : ` · ${(cs.propertyIds || []).length}`}`;
    });
  }
  let tq = 0; new MutationObserver(() => { cancelAnimationFrame(tq); tq = requestAnimationFrame(tagModals); }).observe(document.body, { childList: true, subtree: true });

  // Filters panel keeps the quick picker; building and editing happen in the tab
  const pk = document.getElementById('cs-picker');
  if (pk && !document.getElementById('csx-manage')) {
    const b = document.createElement('button'); b.type = 'button'; b.id = 'csx-manage'; b.className = 'csx-manage'; b.textContent = 'Manage comp sets →';
    b.onclick = () => { const done = [...document.querySelectorAll('button')].find((x) => x.offsetParent && x.textContent.trim() === 'Done'); if (done) done.click(); window.wbOpenCompSets(); };
    pk.after(b);
  }
  setTimeout(paintPill, 0);
})();
