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
  const wksOf = (p) => (p.concessions == null ? null : (p.concessions / 100) * 52);
  const membersOf = (cs, map) => (cs.propertyIds || []).map((id) => (map || byId()).get(String(id))).filter(Boolean);
  const UI = { open: null, q: '', creating: false, from: 'empty', add: '', near: null, radius: 1, nearExisting: true, nearYear: '', save: {}, confirmDel: false };
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
      return `<tr data-id="${E(cs.id)}">
        <td class="nm"><b>${E(cs.name)}</b>${active ? '<span class="csx-tag on">In use</span>' : ''}${!cs.uuid ? '<span class="csx-tag warn">This browser only</span>' : ''}${cs.description ? `<small>${E(cs.description)}</small>` : ''}</td>
        <td class="r">${s.n}</td><td class="r">${s.units.toLocaleString()}</td><td class="r">${s.yr}</td><td class="r">${money(s.ask)}</td><td class="r">${money(s.eff)}</td>
        <td class="r">${pct(s.occ)}</td><td class="r">${wks(s.wks)}</td>
        <td class="up" title="${E(cs.updatedBy || cs.createdBy || '')}">${day(cs.updatedAt)}</td><td class="go" aria-hidden="true">›</td></tr>`;
    }).join('');
    return `
      ${UI.creating ? creator() : ''}
      <section class="csx-card">
        <header class="csx-head">
          <div><h2 class="csx-h">Comp sets</h2><div class="csx-sub">${total ? `${total} saved for ${E((window.__WBD && window.__WBD.title) || 'this market')}. Open one to edit it and use it across the dashboard.` : 'Build a set for each deal you underwrite: the YOC matrix and every tab can then run on just those comps.'}</div></div>
          <div class="csx-acts">${total > 6 ? `<input class="csx-in csx-q" placeholder="Search sets…" value="${E(UI.q)}">` : ''}${UI.creating ? '' : '<button type="button" class="yx-btn yx-btn-primary csx-new">New comp set</button>'}</div>
        </header>
        ${total ? `<div class="csx-tw"><table class="csx-t csx-lib">
          <thead><tr><th>Set</th><th class="r">Properties</th><th class="r">Units</th><th class="r">Built</th><th class="r">Asking $/SF</th><th class="r">Effective $/SF</th><th class="r">Occupancy</th><th class="r">Weeks free</th><th>Updated</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="10" class="csx-none">No sets match "${E(UI.q)}"</td></tr>`}</tbody></table></div>`
        : `<div class="csx-empty"><b>No comp sets yet</b><span>Start one from scratch, from your Property Index results, or from the properties near a site.</span>${UI.creating ? '' : '<button type="button" class="yx-btn yx-btn-primary csx-new">New comp set</button>'}</div>`}
      </section>`;
  }

  // ---------- new set ----------
  function idxRows() { try { return (window.__pxLast && window.__pxLast.length) ? window.__pxLast : (typeof window.pxApply === 'function' ? window.pxApply(getFiltered()) : []); } catch (e) { return []; } }
  function creator() {
    const n = idxRows().length;
    const opt = (k, t, s) => `<label class="csx-opt${UI.from === k ? ' on' : ''}"><input type="radio" name="csx-from" value="${k}" ${UI.from === k ? 'checked' : ''}><span><b>${t}</b><small>${s}</small></span></label>`;
    return `<section class="csx-card csx-create">
      <header class="csx-head"><div><h2 class="csx-h">New comp set</h2><div class="csx-sub">Name it, choose where to start, then add or remove properties.</div></div></header>
      <div class="csx-form">
        <label class="csx-f"><span>Name</span><input class="csx-in csx-nm" placeholder="e.g. Littleton Equine" maxlength="80"></label>
        <label class="csx-f"><span>Deal or site <em>optional</em></span><input class="csx-in csx-ds" placeholder="e.g. 8025 S Santa Fe Dr · 393 units" maxlength="120"></label>
      </div>
      <div class="csx-opts">
        ${opt('empty', 'Start empty', 'Add properties by search or from a radius next')}
        ${opt('near', 'Properties near a site', 'Pick a property or site, then a radius')}
        ${opt('index', `Property Index results${n ? ` (${n})` : ''}`, n ? 'Everything your current Index filters show' : 'Set filters in the Property Index first')}
      </div>
      <div class="csx-bar"><button type="button" class="yx-btn yx-btn-primary csx-make">Create comp set</button><button type="button" class="yx-btn csx-cancel">Cancel</button><span class="csx-msg"></span></div>
    </section>`;
  }
  function create() {
    const name = (view.querySelector('.csx-nm').value || '').trim(), msg = view.querySelector('.csx-msg');
    if (!name) { msg.textContent = 'Name the set first.'; view.querySelector('.csx-nm').focus(); return; }
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

  // ---------- workspace ----------
  function workspace(cs) {
    const map = byId(), ps = membersOf(cs, map), s = stats(ps);
    const missing = (cs.propertyIds || []).length - ps.length;
    const rows = ps.map((p, i) => `<tr data-pid="${E(p.id)}">
        <td class="rk">${i + 1}</td><td class="nm"><button type="button" class="csx-pname">${E(p.name || p.address)}</button><small>${E(p.address || '')}${p.status !== 'Existing' ? ` · <span class="csx-st">${E(p.status === 'Under Construction' ? 'UC' : p.status)}</span>` : ''}</small></td>
        <td>${E(p.submarket || '')}</td><td>${E(p.style || '')}</td><td class="r">${(p.units || 0).toLocaleString()}</td><td class="r">${p.yearBuilt || '—'}</td>
        <td class="r">${money(p.avgAskingSF)}</td><td class="r">${money(p.avgEffectiveSF)}</td><td class="r">${pct(occOf(p))}</td><td class="r">${wks(wksOf(p))}</td>
        <td class="x"><button type="button" class="csx-rm" title="Remove from set" aria-label="Remove ${E(p.name)}">×</button></td></tr>`).join('');
    return `
      <section class="csx-card">
        <header class="csx-head csx-wshead">
          <div class="csx-ttl">
            <button type="button" class="csx-back">← All comp sets</button>
            <input class="csx-title" value="${E(cs.name)}" aria-label="Set name" maxlength="80">
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
        </header>
        <div class="csx-kpis">
          <div><span>Properties</span><b>${s.n}</b><em>${s.units.toLocaleString()} units${s.uc ? ` · ${s.uc} not yet existing` : ''}</em></div>
          <div><span>Asking</span><b>${money(s.ask)}<i>/SF</i></b><em>${s.askU != null ? '$' + Math.round(s.askU).toLocaleString() + '/mo' : ''}</em></div>
          <div><span>Effective</span><b>${money(s.eff)}<i>/SF</i></b><em>unit-weighted</em></div>
          <div><span>Occupancy</span><b>${pct(s.occ)}</b><em>existing only</em></div>
          <div><span>Concessions</span><b>${wks(s.wks)}<i> wks</i></b><em>free, unit-weighted</em></div>
          <div><span>Built</span><b>${s.yr}</b><em>${s.sf ? Math.round(s.sf).toLocaleString() + ' SF avg unit' : '&nbsp;'}</em></div>
        </div>
        ${yocCheck(ps)}
        <div class="csx-addbar">
          <div class="csx-ta csx-addta"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg><input class="csx-in csx-add-q" placeholder="Add a property by name or address…" aria-label="Add a property"><div class="csx-ta-list" hidden></div></div>
          <button type="button" class="yx-btn csx-addbtn${UI.add === 'near' ? ' on' : ''}" data-a="near">Add near a site</button>
          <button type="button" class="yx-btn csx-addbtn${UI.add === 'map' ? ' on' : ''}" data-a="map">Pick on the map</button>
        </div>
        ${UI.add === 'near' ? addNear(cs, map) : UI.add === 'map' ? '<div class="csx-hint csx-maphint">Click any property on the map below to add it; click a comp to remove it. <button type="button" class="csx-tomap">Go to map ↓</button></div>' : ''}
        ${ps.length ? `<div class="csx-tw"><table class="csx-t csx-mem">
          <thead><tr><th class="rk">#</th><th>Property</th><th>Submarket</th><th>Type</th><th class="r">Units</th><th class="r">Built</th><th class="r">Asking $/SF</th><th class="r">Effective $/SF</th><th class="r">Occupancy</th><th class="r">Weeks free</th><th></th></tr></thead>
          <tbody>${rows}</tbody></table></div>` : (UI.add ? '' : '<div class="csx-empty sm"><b>No properties yet</b><span>Search above, add the properties near a site, or pick them on the map.</span></div>')}
        ${missing > 0 ? `<div class="csx-hint warn">${missing} propert${missing === 1 ? 'y' : 'ies'} in this set ${missing === 1 ? 'isn’t' : 'aren’t'} in the current data (removed or filtered out by a data load).</div>` : ''}
      </section>
      <div id="csx-intel-slot"></div>`;
  }
  // what the YOC matrix says each product type needs, next to what these comps actually get
  function yocCheck(ps) {
    if (typeof requiredPsfRent !== 'function' || typeof YOC_PRODUCT_COLUMNS === 'undefined' || typeof yocState === 'undefined') return '';
    const col = (p) => (typeof yocColumnFor === 'function' ? yocColumnFor(p.style) : p.style);
    const cells = YOC_PRODUCT_COLUMNS.map((prod) => {
      let req = null; try { req = requiredPsfRent(prod, sfFor(prod)); } catch (e) {}
      const g = ps.filter((p) => p.status === 'Existing' && p.avgAskingSF && col(p) === prod);
      let a = 0, w = 0; g.forEach((p) => { a += p.avgAskingSF * (p.units || 0); w += p.units || 0; }); const ask = w ? a / w : null;
      const gap = req && ask ? (ask / req - 1) * 100 : null;
      return `<div class="csx-yc"><span>${E(prod)}</span><b>${req == null ? '—' : '$' + req.toFixed(2)}<i>/SF required</i></b>
        <em>${ask == null ? 'No existing ' + E(prod.toLowerCase()) + ' comps in the set' : `Comps ask $${ask.toFixed(2)} · <strong class="${gap >= 0 ? 'ok' : 'bad'}">${gap >= 0 ? '+' : '−'}${Math.abs(gap).toFixed(0)}%</strong> ${gap >= 0 ? 'above' : 'below'} required`}</em></div>`;
    }).join('');
    return `<div class="csx-yoc"><div class="csx-yoch"><b>YOC matrix check</b><span>Required rent at the matrix's current ${(yocState.targetYoc * 100).toFixed(2)}% target YOC, against these comps' unit-weighted asking rent (existing only)</span><button type="button" class="csx-toyoc">Open YOC matrix →</button></div><div class="csx-ycs">${cells}</div></div>`;
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
    wire(cs);
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
    $$('.csx-new').forEach((b) => (b.onclick = () => { UI.creating = true; UI.from = 'empty'; render(); setTimeout(() => { const i = $('.csx-nm'); if (i) i.focus(); }, 30); }));
    const q = $('.csx-q'); if (q) q.oninput = () => { UI.q = q.value; const pos = q.selectionStart; render(); const n = $('.csx-q'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } };
    $$('.csx-lib tbody tr[data-id]').forEach((tr) => (tr.onclick = () => openSet(tr.dataset.id)));
    if (UI.creating && !cs) {
      $$('input[name=csx-from]').forEach((r) => (r.onchange = () => { UI.from = r.value; $$('.csx-opt').forEach((o) => o.classList.toggle('on', o.querySelector('input').checked)); }));
      $('.csx-make').onclick = create; $('.csx-cancel').onclick = () => { UI.creating = false; render(); };
      $('.csx-nm').onkeydown = (e) => { if (e.key === 'Enter') create(); };
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
  renderActive = function () { document.body.dataset.wbView = getActiveView(); if (getActiveView() === 'compsets') { render(); return; } return _ra.apply(this, arguments); };
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
