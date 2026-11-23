/* Settings → People and access. One row per person: what they can view, and which markets they can edit.
   Stored as lines in core.market_access (email, market_id, role); the strongest line wins per market:
     view '*'                  → can view every market
     edit <market>             → can edit that market (one line per market)
     admin '*'                 → everything, incl. adding markets and managing this list
   The database enforces the same rules (tools/supabase/20261120_market_access.sql); this screen is a view on them.
   An edit market can be one that isn't loaded yet ("New market…"): that person creates it with their first upload. */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const slug = (s) => (s || '').toLowerCase().replace(/,.*$/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const pretty = (id) => id.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  let lines = null, markets = null, busy = false, armed = null;
  const me = () => ((window.__WBD && window.__WBD.user && window.__WBD.user.email) || '').toLowerCase();
  const T = () => WB.sb.schema('core').from('market_access');

  if (!document.getElementById('wba-css')) {
    const st = document.createElement('style'); st.id = 'wba-css';
    st.textContent = `
      #wb-access [hidden]{display:none!important}
      #wb-access{font-family:'Inter Tight',Aptos,sans-serif;color:var(--ink-1)}
      #wb-access .wba-lead{font-size:13px;color:var(--ink-3);line-height:1.5;margin:0 0 14px}
      #wb-access .wba-grid{display:grid;grid-template-columns:minmax(0,1fr) 200px minmax(0,1.3fr) 70px;column-gap:16px;align-items:center}
      #wb-access .wba-head{border-bottom:1px solid var(--line)}
      #wb-access .wba-h{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);padding:0 0 8px}
      #wb-access .wba-r{border-bottom:1px solid var(--line)}
      #wb-access .wba-r>div{padding:12px 0}
      #wb-access .wba-who{font-size:14px;line-height:1.3;overflow:hidden;text-overflow:ellipsis}
      #wb-access .wba-sub{font-size:12px;color:var(--ink-3);margin-top:2px}
      #wb-access .wba-fixed{font-size:14px}
      #wb-access .wba-muted{font-size:13px;color:var(--ink-3)}
      #wb-access select,#wb-access input{box-sizing:border-box;height:32px;font:13px 'Inter Tight',Aptos,sans-serif;padding:0 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg-2);color:var(--ink-1)}
      #wb-access .wba-full{width:100%}
      #wb-access select:focus,#wb-access input:focus{outline:2px solid var(--accent-text);outline-offset:-1px}
      #wb-access .wba-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
      #wb-access .wba-chip{display:inline-flex;align-items:center;gap:2px;height:28px;padding:0 2px 0 10px;border:1px solid var(--line);border-radius:14px;font-size:13px;white-space:nowrap}
      #wb-access .wba-chip.pend{border-style:dashed;color:var(--ink-3)}
      #wb-access .wba-chip button{border:0;background:none;color:var(--ink-3);font-size:15px;line-height:1;cursor:pointer;padding:0 7px;border-radius:10px}
      #wb-access .wba-chip button:hover{color:var(--negative)}
      #wb-access select.wba-plus{height:28px;border:1px dashed var(--line);border-radius:14px;padding:0 8px;color:var(--accent-text);background:none;max-width:170px}
      #wb-access .wba-x{border:0;background:none;padding:4px 0;font:13px 'Inter Tight',Aptos,sans-serif;color:var(--ink-3);cursor:pointer}
      #wb-access .wba-x:hover,#wb-access .wba-x.armed{color:var(--negative)}
      #wb-access .wba-add>div{padding:14px 0 0;align-self:start}
      #wb-access .wba-btn{height:32px;width:100%;border:1px solid var(--ink-1);border-radius:6px;background:var(--ink-1);color:#fff;font:600 13px 'Inter Tight',Aptos,sans-serif;cursor:pointer}
      #wb-access .wba-new{display:flex;gap:6px;margin-top:6px}
      #wb-access .wba-new input{flex:1}
      #wb-access .wba-msg{font-size:12px;margin-top:8px;min-height:16px}
      #wb-access .wba-msg.bad{color:var(--negative)}
      #wb-access .wba-foot{font-size:12px;color:var(--ink-3);margin-top:6px;line-height:1.5}`;
    document.head.appendChild(st);
  }

  async function load() {
    const [a, m] = await Promise.all([T().select('email,market_id,role,note'), WB.sb.schema('core').from('markets').select('id,label,config').order('label')]);
    if (a.error) throw a.error;
    lines = a.data || []; markets = (m.data || []).filter((x) => x.label);
  }
  const loaded = (id) => (markets || []).some((m) => m.id === id);
  const mLabel = (id) => ((markets || []).find((m) => m.id === id) || {}).label || pretty(id);
  // one record per person
  function people() {
    const by = {};
    for (const l of lines || []) {
      const k = l.email.toLowerCase(); const p = (by[k] = by[k] || { email: l.email, note: null, admin: false, viewAll: false, editAll: false, edits: [] });
      if (l.note && !p.note) p.note = l.note;
      if (l.market_id === '*' && l.role === 'admin') p.admin = true;
      else if (l.market_id === '*') { p.viewAll = true; if (l.role === 'edit') p.editAll = true; }
      else if (l.role !== 'view') p.edits.push(l.market_id);
    }
    return Object.values(by).sort((x, y) => (x.email.toLowerCase() === me() ? -1 : y.email.toLowerCase() === me() ? 1 : x.email.localeCompare(y.email)));
  }
  const isAdmin = () => people().some((p) => p.email.toLowerCase() === me() && p.admin);
  const viewMode = (p) => (p.admin ? 'admin' : p.viewAll ? 'all' : 'own');
  // regions live on each market (core.markets.config.region); "All West markets" grants every market in the region at once
  const regionOf = (id) => { const m = (markets || []).find((x) => x.id === id); return (m && m.config && m.config.region) || ''; };
  const regionList = () => [...new Set((markets || []).map((m) => m.config && m.config.region).filter(Boolean))].sort();
  const inRegion = (r) => (markets || []).filter((m) => m.config && m.config.region === r).map((m) => m.id);
  const addOpts = (exclude) => {
    const rg = regionList().filter((r) => inRegion(r).some((id) => !exclude.includes(id)));
    return [rg.length ? `<optgroup label="Whole region">${rg.map((r) => `<option value="__region:${esc(r)}">All ${esc(r)} markets</option>`).join('')}</optgroup><optgroup label="One market">` : '',
      ...(markets || []).filter((m) => !exclude.includes(m.id)).map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`), rg.length ? '</optgroup>' : '', '<option value="__new">New market…</option>'].join('');
  };
  const regionsOf = (p) => [...new Set(p.edits.map(regionOf).filter(Boolean))];

  function html() {
    if (!lines) return '<p class="wba-lead">Loading…</p>';
    const ps = people();
    if (!isAdmin()) {
      const p = ps.find((x) => x.email.toLowerCase() === me()) || { edits: [] };
      return `<p class="wba-lead">You can view ${p.viewAll ? 'every market' : 'the markets you edit'}${p.edits.length ? ` and edit ${p.edits.map((id) => `<b>${esc(mLabel(id))}</b>`).join(', ')}` : ''}. Ask Will to change it.</p>`;
    }
    const admins = ps.filter((p) => p.admin).length;
    const rows = ps.map((p, i) => {
      const self = p.email.toLowerCase() === me(), lock = self || (p.admin && admins <= 1);
      const vm = viewMode(p);
      const view = lock ? `<div class="wba-fixed">${p.admin ? 'Admin: everything' : p.viewAll ? 'All markets' : 'Markets they edit'}</div>`
        : `<select class="wba-full" data-view="${i}" aria-label="What ${esc(p.email)} can view"><option value="all"${vm === 'all' ? ' selected' : ''}>All markets</option><option value="own"${vm === 'own' ? ' selected' : ''}>Only markets they edit</option><option value="admin"${vm === 'admin' ? ' selected' : ''}>Admin: everything</option></select>`;
      const edit = p.admin ? '<div class="wba-muted">All markets</div>' : p.editAll ? '<div class="wba-fixed">All markets</div>'
        : `<div class="wba-chips">${p.edits.map((id) => `<span class="wba-chip${loaded(id) ? '' : ' pend'}" title="${loaded(id) ? '' : 'Not loaded yet: they create it with their first upload'}">${esc(mLabel(id))}${loaded(id) ? '' : ' · not loaded yet'}<button type="button" data-unedit="${i}" data-m="${esc(id)}" aria-label="Stop ${esc(p.email)} editing ${esc(mLabel(id))}">×</button></span>`).join('')}
            <select class="wba-plus" data-edit="${i}" aria-label="Let ${esc(p.email)} edit another market"><option value="">+ Add market</option>${addOpts(p.edits)}</select></div>
           <div class="wba-new" data-neww="${i}" hidden><input placeholder="Market name, e.g. Fort Lauderdale" data-newn="${i}"><button type="button" class="wba-btn" style="width:auto;padding:0 14px" data-newok="${i}">Add</button></div>`;
      return `<div class="wba-grid wba-r">
        <div><div class="wba-who">${esc(p.email)}</div>${(() => { const bits = [self ? 'You' : p.note || '', p.admin ? '' : regionsOf(p).map((r) => r + ' region').join(', ')].filter(Boolean); return bits.length ? `<div class="wba-sub">${esc(bits.join(' · '))}</div>` : ''; })()}</div>
        <div>${view}</div><div>${edit}</div>
        <div>${lock ? '' : `<button type="button" class="wba-x" data-rm="${i}">Remove</button>`}</div></div>`;
    }).join('');
    return `
      <p class="wba-lead">Who can open Market Intel. Viewing lets someone see a market; editing also lets them upload data and make changes there. Admins can do everything, including adding markets and managing this list.</p>
      <div class="wba-grid wba-head"><div class="wba-h">Person</div><div class="wba-h">Can view</div><div class="wba-h">Can edit</div><div class="wba-h"></div></div>
      ${rows}
      <div class="wba-grid wba-add">
        <div><input class="wba-full" id="wba-email" type="email" placeholder="name@willowbridgepc.com" aria-label="Email of the person to add" autocomplete="off"></div>
        <div><select class="wba-full" id="wba-view" aria-label="Can view"><option value="all" selected>All markets</option><option value="own">Only markets they edit</option></select></div>
        <div><select class="wba-full" id="wba-mkt" aria-label="Can edit"><option value="">Nothing (view only)</option>${addOpts([])}</select>
          <input class="wba-full" id="wba-newname" placeholder="Market name, e.g. Fort Lauderdale" aria-label="New market name" hidden style="margin-top:6px"></div>
        <div><button type="button" class="wba-btn" id="wba-add">Add</button></div>
      </div>
      <div class="wba-msg" id="wba-msg" role="status"></div>
      <p class="wba-foot">Adding someone doesn't email them. Send them the Market Intel link; they sign in with this email, leaving the password blank to get a code by email. Anyone not on this list is turned away at sign-in.</p>`;
  }

  function wire(box) {
    const ps = people();
    const msg = (t, bad) => { const el = box.querySelector('#wba-msg'); if (el) { el.textContent = t || ''; el.classList.toggle('bad', !!bad); } };
    const run = async (steps, okText) => {
      if (busy) return; busy = true;
      try { for (const s of steps) { const { error } = await s(); if (error) throw error; } await load(); paint(box); WB.toast && WB.toast(okText); }
      catch (e) { const t = e.message || String(e); try { await load(); paint(box); } catch (_) {} const b2 = document.getElementById('wb-access'); const m2 = b2 && b2.querySelector('#wba-msg'); if (m2) { m2.textContent = t; m2.classList.add('bad'); } }
      busy = false;
    };
    const newId = (name) => { const id = slug(name); if (!/^[a-z][a-z0-9_]{1,30}$/.test(id)) { msg('Name the new market, e.g. Fort Lauderdale', true); return null; } return id; };

    box.querySelectorAll('[data-view]').forEach((s) => s.addEventListener('change', () => {
      const p = ps[+s.dataset.view], e = p.email, v = s.value;
      const steps = [() => T().delete().eq('email', e).eq('market_id', '*')];
      if (v === 'all') steps.push(() => T().insert({ email: e, market_id: '*', role: 'view' }));
      if (v === 'admin') steps.push(() => T().insert({ email: e, market_id: '*', role: 'admin' }));
      run(steps, `Updated ${e}`);
    }));
    box.querySelectorAll('[data-edit]').forEach((s) => s.addEventListener('change', () => {
      const i = s.dataset.edit, p = ps[+i];
      if (s.value === '__new') { box.querySelector(`[data-neww="${i}"]`).hidden = false; box.querySelector(`[data-newn="${i}"]`).focus(); s.value = ''; return; }
      if (!s.value) return;
      if (s.value.startsWith('__region:')) {
        const r = s.value.slice(9), ids = inRegion(r).filter((id) => !p.edits.includes(id));
        return run([() => T().upsert(ids.map((id) => ({ email: p.email, market_id: id, role: 'edit' })), { onConflict: 'email,market_id' })], `${p.email} can now edit every ${r} market`);
      }
      const id = s.value; run([() => T().upsert({ email: p.email, market_id: id, role: 'edit' }, { onConflict: 'email,market_id' })], `${p.email} can now edit ${mLabel(id)}`);
    }));
    box.querySelectorAll('[data-newok]').forEach((b) => b.addEventListener('click', () => {
      const i = b.dataset.newok, p = ps[+i]; const id = newId(box.querySelector(`[data-newn="${i}"]`).value); if (!id) return;
      run([() => T().upsert({ email: p.email, market_id: id, role: 'edit' }, { onConflict: 'email,market_id' })], `${p.email} can now edit ${pretty(id)}`);
    }));
    box.querySelectorAll('[data-unedit]').forEach((b) => b.addEventListener('click', () => {
      const p = ps[+b.dataset.unedit], id = b.dataset.m;
      run([() => T().delete().eq('email', p.email).eq('market_id', id)], `${p.email} can no longer edit ${mLabel(id)}`);
    }));
    box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
      const p = ps[+b.dataset.rm];
      if (armed !== p.email) {   // first click arms, second removes
        armed = p.email; box.querySelectorAll('[data-rm]').forEach((x) => { x.textContent = 'Remove'; x.classList.remove('armed'); });
        b.textContent = 'Confirm'; b.classList.add('armed');
        setTimeout(() => { if (armed === p.email) { armed = null; if (b.isConnected) { b.textContent = 'Remove'; b.classList.remove('armed'); } } }, 4000);
        return;
      }
      armed = null; run([() => T().delete().eq('email', p.email)], `Removed ${p.email}`);
    }));
    const mk = box.querySelector('#wba-mkt'), nn = box.querySelector('#wba-newname');
    if (mk) mk.addEventListener('change', () => { nn.hidden = mk.value !== '__new'; if (!nn.hidden) nn.focus(); });
    const add = box.querySelector('#wba-add');
    if (add) add.addEventListener('click', () => {
      const email = box.querySelector('#wba-email').value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return msg('Enter an email address', true);
      if (ps.some((p) => p.email.toLowerCase() === email)) return msg('Already on the list. Change their access in their row.', true);
      const view = box.querySelector('#wba-view').value; let id = mk.value;
      if (id === '__new') { id = newId(nn.value); if (!id) return; }
      if (view === 'own' && !id) return msg('Pick a market they can edit, or let them view all markets', true);
      const ins = [];
      if (view === 'all') ins.push({ email, market_id: '*', role: 'view' });
      if (id && id.startsWith('__region:')) inRegion(id.slice(9)).forEach((mid) => ins.push({ email, market_id: mid, role: 'edit' }));
      else if (id) ins.push({ email, market_id: id, role: 'edit' });
      run([() => T().insert(ins)], `Added ${email}`);
    });
  }

  function paint(box) { box.innerHTML = html(); if (lines) wire(box); }

  /** Called by renderSettingsModal() after it draws; fills the People and access section. */
  window.wbRenderAccess = async function () {
    const box = document.getElementById('wb-access'); if (!box) return;
    paint(box);
    try { await load(); } catch (e) { box.innerHTML = `<p class="wba-lead" style="color:var(--negative)">Couldn't load the access list: ${esc(e.message || e)}</p>`; return; }
    const now = document.getElementById('wb-access'); if (now) paint(now);
  };
})();
