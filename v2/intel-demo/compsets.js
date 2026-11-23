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
  const isProposed = (p) => typeof isPlannedProposed === 'function' && isPlannedProposed(p);
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
    return best;
  }
  function updCell(p) {
    const u = lastUpd(p);
    if (!u) return `<td class="csx-upd-c"><span class="csx-src">CoStar</span><small>${day(typeof TODAY !== 'undefined' ? TODAY : null)}</small></td>`;
    const old = Date.now() - u.at > 92 * 86400000;
    return `<td class="csx-upd-c${old ? ' old' : ''}" title="${E((u.by || '') + (u.src ? ' · ' + u.src : ''))}"><span class="csx-src">${E(u.src || 'Hand entry')}</span><small>${day(u.at)}${u.by ? ' · ' + E(who(u.by)) : ''}</small></td>`;
  }
  const updBtn = (p) => `<button type="button" class="yx-btn csx-updbtn${UI.upd === String(p.id) ? ' on' : ''}">${UI.upd === String(p.id) ? 'Close' : 'Update'}</button>`;
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
        <label><span>Stage</span><select class="csx-in csx-uf-f csx-uf-stage" data-f="pipelineStage"><option value="UC"${!isProposed(p) ? ' selected' : ''}>Under construction</option><option value="Proposed"${isProposed(p) ? ' selected' : ''}>Proposed</option><option value="Delivered">Delivered</option></select></label>
        <label><span class="csx-uf-dl">Estimated completion</span><input type="month" class="csx-in csx-uf-f" data-f="estDelivery" value="${mv}"></label>
        <label class="csx-uf-dv" hidden><span>Occupancy % now <em>optional</em></span><input type="number" class="csx-in csx-uf-f" data-f="occ" min="0" max="100" step="0.1"></label>
        <label><span>Units</span><input type="number" class="csx-in csx-uf-f" data-f="units" value="${p.units || ''}" min="0"></label>
      </div>${notes}`;
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
  function baselineBlock(cs, ps) {
    const bl = baselineOf(cs, ps); if (!bl.name) return '';
    const inSm = all().filter((p) => p.submarket === bl.name), u = (a) => a.reduce((s, p) => s + (p.units || 0), 0);
    const exU = u(inSm.filter((p) => p.status === 'Existing')), ucU = u(inSm.filter((p) => p.status !== 'Existing' && !isProposed(p))), prU = u(inSm.filter((p) => p.status !== 'Existing' && isProposed(p)));
    const luU = u(inSm.filter((p) => p.status === 'Existing' && phaseOf(p) === 'lease'));
    const r = (n) => (exU ? ((n / exU) * 100).toFixed(1) + '%' : '—');
    const k = (l, v, sub) => hero(l, v, sub);
    // RealPage: blended for the submarket (same blend the Trends tab uses)
    let rp = '';
    const f = typeof getRpForecastForWbSubmarket === 'function' ? getRpForecastForWbSubmarket(bl.name) : null;
    const Y = typeof CURRENT_YEAR !== 'undefined' ? CURRENT_YEAR : new Date().getFullYear();
    if (f && f[Y]) {
      const c = f[Y], g = (x) => (x == null ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1) + '%');
      const cls = (x) => (x == null ? '' : x >= 0 ? 'up' : 'dn');
      const avgSf = stats(inSm.filter((p) => p.status === 'Existing')).sf;
      const fy = [1, 2, 3].map((i) => f[Y + i] || {}), fg = fy.map((r) => r.yR).filter((x) => x != null);
      const cum = fg.length ? fg.reduce((a, x) => a * (1 + x), 1) - 1 : null, avg = fg.length ? Math.pow(1 + cum, 1 / fg.length) - 1 : null;
      const s3 = fy.reduce((a, r) => a + (r.sp || 0), 0), d3 = fy.reduce((a, r) => a + (r.dm || 0), 0);
      const yrs = [Y - 3, Y - 2, Y - 1, Y, Y + 1, Y + 2, Y + 3, Y + 4].filter((y) => f[y]);
      const row = (l, fn) => `<tr><th>${l}</th>${yrs.map((y) => { const v = fn(f[y] || {}); return `<td class="${y > Y ? 'fc' : y === Y ? 'cy' : ''} ${v.c || ''}">${v.t}</td>`; }).join('')}</tr>`;
      rp = `<div class="csx-rp"><div class="csx-rph"><b>RealPage</b><span>${E((typeof getRpBlendInfo === 'function' && getRpBlendInfo(bl.name)) || bl.name)} · ${Y} current year, ${Y + 1}+ forecast</span></div>
        <div class="csx-hcs">
          ${hero('Effective rent', c.eR ? '$' + Math.round(c.eR).toLocaleString() + '<u>/mo</u>' : '—', c.eR && avgSf ? '$' + (c.eR / avgSf).toFixed(2) + '/SF at the submarket’s avg unit size' : '')}
          ${hero(`Rent growth ${Y}`, `<span class="${cls(c.yR)}">${g(c.yR)}</span>`, `YoY vs ${Y - 1}`)}
          ${hero(`Forecast ${Y + 1}–${Y + 3}`, `<span class="${cls(avg)}">${g(avg)}</span><u>/yr</u>`, cum != null ? `${g(cum)} cumulative` : '')}
          ${hero('Occupancy', c.oc != null ? (c.oc * 100).toFixed(1) + '<u>%</u>' : '—', fy[2].oc != null ? (fy[2].oc * 100).toFixed(1) + '% forecast ' + (Y + 3) : '')}
          ${hero(`Supply ${Y + 1}–${Y + 3}`, s3 ? Math.round(s3).toLocaleString() + '<u> units</u>' : '—', d3 ? `${Math.round(d3).toLocaleString()} absorbed · ${(d3 / s3).toFixed(2)}× demand/supply` : '')}
        </div>
        <div class="table-scroll"><table class="csx-rpt"><thead><tr><th></th>${yrs.map((y) => `<th class="${y > Y ? 'fc' : y === Y ? 'cy' : ''}">${y}${y > Y ? '<i>F</i>' : ''}</th>`).join('')}</tr></thead><tbody>
          ${row('Effective rent', (r) => ({ t: r.eR ? '$' + Math.round(r.eR).toLocaleString() : '—' }))}
          ${row('Rent growth YoY', (r) => ({ t: g(r.yR), c: cls(r.yR) }))}
          ${row('Occupancy', (r) => ({ t: r.oc != null ? (r.oc * 100).toFixed(1) + '%' : '—' }))}
          ${row('Supply (units)', (r) => ({ t: r.sp != null ? Math.round(r.sp).toLocaleString() : '—' }))}
          ${row('Demand (units)', (r) => ({ t: r.dm != null ? Math.round(r.dm).toLocaleString() : '—' }))}
        </tbody></table></div></div>`;
    } else rp = `<div class="csx-hint">No RealPage coverage mapped to ${E(bl.name)}.</div>`;
    return `<div class="panel csx-bl">
      <div class="panel-header"><div><div class="panel-title">Submarket baseline</div><div class="panel-sub">Pipeline is measured against this submarket's existing inventory; RealPage figures are for the same submarket</div></div>
        <div class="csx-acts"><select class="csx-in csx-blsel" aria-label="Baseline submarket">${smOptions().map((o) => `<option${o === bl.name ? ' selected' : ''}>${E(o)}</option>`).join('')}</select>${bl.picked ? '' : '<span class="csx-save">Auto: where most of the set’s units are</span>'}</div></div>
      <div class="panel-body">
        <div class="csx-hcs csx-hcs-bl">
          ${k('Existing inventory', exU.toLocaleString() + ' units', `${inSm.filter((p) => p.status === 'Existing').length} properties in ${E(bl.name)} (CoStar)`)}
          ${k('Under construction', ucU.toLocaleString() + ' units', `${r(ucU)} of inventory`)}
          ${k('Proposed', prU.toLocaleString() + ' units', `${r(prU)} of inventory`)}
          ${k('UC + proposed', (ucU + prU).toLocaleString() + ' units', `${r(ucU + prU)} of inventory`)}
          ${k('In lease-up', luU.toLocaleString() + ' units', `${r(luU)} of inventory`)}
        </div>
        ${rp}
        ${window.__WB_CS_NO_SETTINGS ? '<div class="csx-hint warn">The baseline choice is kept in this browser until the database update (comp_sets.settings) is run.</div>' : ''}
      </div></div>`;
  }

  // ---------- section panels: header band + hero cards + table ----------
  const hero = (l, v, sub, tone) => `<div class="csx-hc${tone ? ' ' + tone : ''}"><span>${l}</span><b>${v}</b><small>${sub || '&nbsp;'}</small></div>`;
  const fresh = (p) => { const u = lastUpd(p); return u && Date.now() - u.at <= 92 * 86400000; };
  function sections(cs, ps) {
    const ex = ps.filter((p) => phaseOf(p) === 'exist'), lu = ps.filter((p) => phaseOf(p) === 'lease'), pi = ps.filter((p) => phaseOf(p) === 'pipe');
    const rowWith = (p, cells, cols) => `<tr data-pid="${E(p.id)}"${UI.upd === String(p.id) ? ' class="csx-open"' : ''}>${cells}</tr>${UI.upd === String(p.id) ? updForm(p, phaseOf(p), cols) : ''}`;
    const sec = (key, title, count, sub, cards, head, body) => `<section class="panel csx-sec csx-sec-${key}">
      <div class="csx-sech"><div class="csx-sect"><i></i><b>${title}</b><em>${count}</em></div><span>${sub}</span></div>
      <div class="csx-hcs">${cards}</div>
      <div class="table-scroll"><table class="csx-table csx-dense">${head}<tbody>${body}</tbody></table></div></section>`;
    const tail = (p) => `${updCell(p)}<td class="csx-ub">${updBtn(p)}</td>${rmCell(p)}`;
    const checked = (a) => `${a.filter(fresh).length} of ${a.length} checked in the last 90 days`;
    let out = '';
    if (ex.length) {
      const s = stats(ex), hw = ex.filter((p) => handWks(p) != null).length;
      out += sec('ex', 'Existing', ex.length, checked(ex) + (ex.some((p) => handWks(p) == null) ? ' · <span class="csx-cs">gray weeks free = CoStar, not checked</span>' : ''),
        hero('Units', s.units.toLocaleString(), `${ex.length} stabilized ${ex.length === 1 ? 'property' : 'properties'}`)
        + hero('Asking rent', s.ask == null ? '—' : '$' + s.ask.toFixed(2) + '<u>/SF</u>', s.askU ? '$' + Math.round(s.askU).toLocaleString() + '/mo · unit-weighted' : '')
        + hero('Effective rent', s.eff == null ? '—' : '$' + s.eff.toFixed(2) + '<u>/SF</u>', 'Net of concessions')
        + hero('Occupancy', s.occ == null ? '—' : s.occ.toFixed(1) + '<u>%</u>', 'Unit-weighted')
        + hero('Concessions', s.wks == null ? '—' : s.wks.toFixed(1) + '<u> wks</u>', `${hw} of ${ex.length} from websites`),
        '<thead><tr><th class="csx-pc">Property</th><th>Type</th><th class="num">Units</th><th class="num">Built</th><th class="num">Asking $/SF</th><th class="num">$/mo</th><th class="num">Eff. $/SF</th><th class="num">Occ.</th><th class="num">Wks free</th><th>Updated</th><th></th><th></th></tr></thead>',
        ex.map((p) => rowWith(p, `${nameCell(p, E(p.submarket || ''))}<td>${E(p.style || '')}</td><td class="num">${(p.units || 0).toLocaleString()}</td><td class="num">${p.yearBuilt || '—'}</td><td class="num csx-k">${money(p.avgAskingSF)}</td><td class="num">${p.avgAskingUnit ? '$' + Math.round(p.avgAskingUnit).toLocaleString() : '—'}</td><td class="num">${money(p.avgEffectiveSF)}</td><td class="num">${pct(occOf(p))}</td>${wksCell(p)}${tail(p)}`, 12)).join(''));
    }
    if (lu.length) {
      const L = lu.map((p) => ({ p, l: leaseOf(p) }));
      const v = L.reduce((a, x) => a + (x.l.v || 0), 0), units = lu.reduce((a, p) => a + (p.units || 0), 0);
      const togo = L.reduce((a, x) => a + (x.l.target && !x.l.done ? x.l.target - x.l.leased : 0), 0);
      const leased = L.reduce((a, x) => a + (x.l.leased || 0), 0);
      const last = L.filter((x) => x.l.stab).sort((a, b) => b.l.stab - a.l.stab)[0];
      const allStab = v > 0 && togo > 0 ? new Date(Date.now() + (togo / v) * 30.44 * 86400000) : null;
      out += sec('lu', 'Lease-up', lu.length, checked(lu) + (lu.some((p) => handWks(p) == null) ? ' · <span class="csx-cs">gray weeks free = CoStar, not checked</span>' : ''),
        hero('Units', units.toLocaleString(), `${Math.round(togo).toLocaleString()} left to ${STAB * 100}%`)
        + hero('Occupancy', units ? ((leased / units) * 100).toFixed(1) + '<u>%</u>' : '—', 'Unit-weighted')
        + hero('Velocity', v ? v.toFixed(0) + '<u> leases/mo</u>' : '—', 'Combined, since leasing began')
        + hero('Lease-up clears', allStab ? monYr(allStab) : togo > 0 ? '—' : 'Done', 'At today’s combined pace')
        + hero('Last to stabilize', last ? monYr(last.l.stab) : '—', last ? E(last.p.name) : ''),
        '<thead><tr><th class="csx-pc">Property</th><th class="num">Units</th><th>Leasing since</th><th class="num">Months</th><th class="num">Occ.</th><th class="num">Leases/mo</th><th>Stabilizes (95%)</th><th class="num">Asking $/SF</th><th class="num">Wks free</th><th>Updated</th><th></th><th></th></tr></thead>',
        L.map(({ p, l }) => rowWith(p, `${nameCell(p, E(p.style || ''))}<td class="num">${(p.units || 0).toLocaleString()}</td><td>${monYr(l.d)}</td><td class="num">${l.mo ? l.mo.toFixed(1) : '—'}</td><td class="num">${pct(l.o)}${l.o != null ? `<span class="csx-bar1"><i style="width:${Math.min(100, l.o)}%"></i></span>` : ''}</td><td class="num csx-k">${l.v ? l.v.toFixed(1) : '—'}</td><td>${l.done ? '<span class="csx-ok">Stabilized</span>' : l.stab ? monYr(l.stab) + ` <small>${l.left.toFixed(0)} mo</small>` : '—'}</td><td class="num">${money(p.avgAskingSF)}</td>${wksCell(p)}${tail(p)}`, 12)).join(''));
    }
    if (pi.length) {
      const uc = pi.filter((p) => !isProposed(p)), pr = pi.filter(isProposed), u = (a) => a.reduce((s, p) => s + (p.units || 0), 0);
      const bl = baselineOf(cs, ps).name, base = bl ? all().filter((p) => p.submarket === bl && p.status === 'Existing').reduce((s, p) => s + (p.units || 0), 0) : 0;
      const rel = (n) => (base ? `${((n / base) * 100).toFixed(1)}% of ${E(bl)} inventory` : '');
      const now = new Date(), yr = new Date(+now + 365 * 86400000);
      const next = [...uc].filter((p) => deliveryOf(p)).sort((a, b) => deliveryOf(a) - deliveryOf(b))[0];
      const in12 = u(uc.filter((p) => { const d = deliveryOf(p); return d && d <= yr; }));
      out += sec('pi', 'Pipeline', pi.length, checked(pi),
        hero('Under construction', u(uc).toLocaleString() + '<u> units</u>', rel(u(uc)) || `${uc.length} buildings`)
        + hero('Proposed', u(pr).toLocaleString() + '<u> units</u>', rel(u(pr)) || `${pr.length} buildings`)
        + hero('Delivering in 12 months', in12.toLocaleString() + '<u> units</u>', base ? rel(in12) : '')
        + hero('Next delivery', next ? monYr(deliveryOf(next)) : '—', next ? E(next.name) : ''),
        '<thead><tr><th class="csx-pc">Property</th><th>Stage</th><th>Type</th><th class="num">Units</th><th>Est. completion</th><th>Notes</th><th>Updated</th><th></th><th></th></tr></thead>',
        [...uc, ...pr].map((p) => rowWith(p, `${nameCell(p, E(p.submarket || ''))}<td><span class="csx-chip ${isProposed(p) ? 'pr' : 'uc'}">${isProposed(p) ? 'Proposed' : 'Under construction'}</span></td><td>${E(p.style || '')}</td><td class="num">${(p.units || 0).toLocaleString()}</td><td>${monYr(deliveryOf(p))}</td><td class="csx-note">${E(ed(p).notes || p.notes || '')}</td>${tail(p)}`, 9)).join(''));
    }
    return out;
  }

  // ---------- workspace ----------
  function workspace(cs) {
    const map = byId(), ps = membersOf(cs, map);
    const missing = (cs.propertyIds || []).length - ps.length;
    return `
      <div class="csx-crumb"><button type="button" class="csx-back">← All comp sets</button></div>
      <div class="panel csx-headp">
        <div class="panel-header csx-wshead">
          <div class="csx-ttl">
            <input class="csx-title panel-title" value="${E(cs.name)}" aria-label="Set name" maxlength="80">
            <input class="csx-desc" value="${E(cs.description || '')}" placeholder="Add the deal or site this set is for" aria-label="Deal or site" maxlength="120">
          </div>
          <div class="csx-acts">
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
        <div class="csx-addbar">
          <div class="csx-ta csx-addta"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg><input class="csx-in csx-add-q" placeholder="Add a property by name or address…" aria-label="Add a property"><div class="csx-ta-list" hidden></div></div>
          <div class="toggle-group csx-addtg"><button type="button" class="toggle-btn csx-addbtn${UI.add === 'near' ? ' active' : ''}" data-a="near">Near a site</button><button type="button" class="toggle-btn csx-addbtn${UI.add === 'map' ? ' active' : ''}" data-a="map">On the map</button></div>
        </div>
        ${UI.add === 'near' ? addNear(cs, map) : UI.add === 'map' ? '<div class="csx-hint csx-maphint">Click any property on the map below to add it; click a comp to remove it. <button type="button" class="csx-tomap">Go to map ↓</button></div>' : ''}
        ${ps.length ? '' : (UI.add ? '' : '<div class="csx-empty sm"><b>No properties yet</b><span>Search above, add the properties near a site, or pick them on the map.</span></div>')}
        ${missing > 0 ? `<div class="csx-hint warn">${missing} propert${missing === 1 ? 'y' : 'ies'} in this set ${missing === 1 ? 'isn’t' : 'aren’t'} in the current data (removed or filtered out by a data load).</div>` : ''}
      </div>
      ${yocCheck(ps)}
      ${ps.length ? sections(cs, ps) + baselineBlock(cs, ps) : ''}
      <div id="csx-intel-slot"></div>`;
  }
  // the set's headline figures go in the page header band, like every other tab's KPIs
  function heroKpis(cs) {
    const slot = document.querySelector('.wbi-hero-kpis'), hero = document.querySelector('.wbi-hero') || (slot && slot.parentElement);
    const old = document.getElementById('csx-hero'); if (old) old.remove();
    if (!slot) return;
    if (cs) {
      const s = stats(membersOf(cs)), k = (l, v, u, sub) => `<div class="kpi"><div class="kpi-label">${l}</div><div class="kpi-value">${v}${u ? `<span class="unit">${u}</span>` : ''}</div><div class="kpi-sub">${sub}</div></div>`;
      const row = document.createElement('div'); row.className = 'kpi-row'; row.id = 'csx-hero';
      row.innerHTML = k('Properties', s.n, '', `${s.units.toLocaleString()} units${s.uc ? ` · ${s.uc} not yet existing` : ''}`)
        + k('Asking / SF', s.ask == null ? '—' : '$' + s.ask.toFixed(2), '', s.askU != null ? '$' + Math.round(s.askU).toLocaleString() + '/mo · unit-weighted' : 'unit-weighted')
        + k('Effective / SF', s.eff == null ? '—' : '$' + s.eff.toFixed(2), '', 'Net of concessions')
        + k('Occupancy', s.occ == null ? '—' : s.occ.toFixed(1), s.occ == null ? '' : '%', 'Existing only')
        + k('Concessions', wks(s.wks), s.wks == null ? '' : 'wks', 'Weeks free · unit-weighted')
        + k('Built', s.yr, '', s.sf ? Math.round(s.sf).toLocaleString() + ' SF avg unit' : '&nbsp;');
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
      const li = (p, counted) => { const ok = req && p.avgAskingSF >= req; return `<li class="${counted ? (ok ? 'ok' : 'bad') : 'na'}"><button type="button" class="csx-ycp" data-pid="${E(p.id)}">${E(p.name || p.address)}</button><span>$${p.avgAskingSF.toFixed(2)}</span><em>${req ? (p.avgAskingSF >= req ? '+' : '−') + Math.abs((p.avgAskingSF / req - 1) * 100).toFixed(0) + '%' : ''}</em></li>`; };
      const sorted = (a) => [...a].sort((x, y) => y.avgAskingSF - x.avgAskingSF);
      const open = UI.yocOpen && UI.yocOpen[prod];
      let a = 0, w = 0; g.forEach((p) => { a += p.avgAskingSF * (p.units || 0); w += p.units || 0; }); const ask = w ? a / w : null;
      const ratio = req && ask ? ask / req : null, gap = ratio == null ? null : (ratio - 1) * 100;
      const fill = ratio == null ? 0 : Math.max(4, Math.min(100, ratio * 100));
      return `<div class="panel csx-ycard">
        <div class="csx-ych"><b>${E(prod)}</b><span>${g.length} existing comp${g.length === 1 ? '' : 's'}</span></div>
        <div class="csx-yck">Rent needed for ${target} YOC</div>
        <div class="csx-ycv">${req == null ? '—' : '$' + req.toFixed(2)}<span>/SF</span></div>
        <div class="csx-ycbar"><i class="${gap == null ? '' : gap >= 0 ? 'ok' : 'bad'}" style="width:${fill}%"></i></div>
        <div class="csx-ycs">${ask == null ? `No existing ${E(prod.toLowerCase())} comps in this set` : `Comps ask <b>$${ask.toFixed(2)}</b> · <b class="${gap >= 0 ? 'ok' : 'bad'}">${Math.abs(gap).toFixed(0)}% ${gap >= 0 ? 'above' : 'below'}</b> what's needed`}</div>
        ${g.length || later.length ? `<details class="csx-ychits" data-prod="${E(prod)}" ${open ? 'open' : ''}>
          <summary><b class="${hits.length ? 'ok' : 'bad'}">${hits.length} of ${g.length}</b> existing comps hit $${req ? req.toFixed(2) : '—'}<i aria-hidden="true">▾</i></summary>
          <ul>${sorted(g).map((p) => li(p, true)).join('')}</ul>
          ${later.length ? `<div class="csx-ycl">Not yet existing, not counted</div><ul>${sorted(later).map((p) => li(p, false)).join('')}</ul>` : ''}
        </details>` : ''}
      </div>`;
    }).join('');
    return `<div class="csx-ygrid">${cards}<div class="panel csx-ycard csx-ynote"><div class="csx-ych"><b>From the YOC matrix</b></div><div class="csx-ycs">Required rent uses the matrix's current costs, ${target} target and operating assumptions. Comps are this set's existing properties, unit-weighted.</div><button type="button" class="yx-btn csx-toyoc">Open YOC matrix →</button></div></div>`;
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

  // ---------- render ----------
  function render() {
    if (UI.open && !compSets[UI.open]) UI.open = null;
    const cs = UI.open && compSets[UI.open];
    view.innerHTML = `<div class="csx">${cs ? workspace(cs) : library()}</div>`;
    wire(cs); heroKpis(cs);
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
    $$('.csx-rm').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const pid = b.closest('tr').dataset.pid; cs.propertyIds = (cs.propertyIds || []).filter((x) => String(x) !== String(pid)); touch(cs); refresh(); }));
    const bs = $('.csx-blsel'); if (bs) bs.onchange = () => setBaseline(cs, bs.value);
    $$('.csx-updbtn').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const pid = b.closest('tr').dataset.pid; UI.upd = UI.upd === pid ? null : pid; render(); const f = view.querySelector('.csx-uf'); if (f) f.scrollIntoView({ block: 'nearest' }); }));
    $$('.csx-uf').forEach((box) => {
      box.querySelector('.csx-uf-x').onclick = () => { UI.upd = null; render(); };
      box.querySelector('.csx-uf-save').onclick = () => saveUpdate(box, cs);
      const pinBtn = box.querySelector('.csx-uf-pin');
      if (pinBtn) pinBtn.onclick = () => {
        const el = box.querySelector('.csx-uf-map'), ll = box.querySelector('.csx-uf-ll');
        if (!el.hidden) { el.hidden = true; pinBtn.textContent = 'Move pin on map'; return; }
        el.hidden = false; pinBtn.textContent = 'Hide map';
        if (el._map || typeof L === 'undefined') { if (el._map) el._map.invalidateSize(); return; }
        const p = byId().get(box.dataset.pid) || {}, m0 = (ll.value.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/) || []);
        const start = m0[1] ? [+m0[1], +m0[2]] : (p.lat != null ? [p.lat, p.lng] : ((window.__WBD && window.__WBD.center) || [39.74, -104.99]));
        const map = L.map(el, { zoomControl: true, attributionControl: false }).setView(start, 17);
        try { (typeof wbSatLayer === 'function' ? wbSatLayer() : L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}')).addTo(map); } catch (e) { console.error(e); }
        const mk = L.marker(start, { draggable: true, icon: L.divIcon({ className: 'csx-pin', html: '<i></i>', iconSize: [22, 22], iconAnchor: [11, 22] }) }).addTo(map);
        const put = (latlng) => { mk.setLatLng(latlng); ll.value = latlng.lat.toFixed(6) + ', ' + latlng.lng.toFixed(6); };
        mk.on('dragend', () => put(mk.getLatLng())); map.on('click', (e) => put(e.latlng));
        ll.onchange = () => { const m = ll.value.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/); if (m) { mk.setLatLng([+m[1], +m[2]]); map.setView([+m[1], +m[2]]); } };
        el._map = map; setTimeout(() => map.invalidateSize(), 50);
      };
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
