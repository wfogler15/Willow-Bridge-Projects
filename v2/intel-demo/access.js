/* Settings → People and access. Lists core.market_access; admins add, change and remove people.
   The database enforces the same rules (tools/supabase/20261120_market_access.sql); this is a view on them.
   A person can be given a market that hasn't been uploaded yet ("New market…"): they create it with their first upload. */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ROLE = { view: 'View', edit: 'Edit', admin: 'Admin' };
  const slug = (s) => (s || '').toLowerCase().replace(/,.*$/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const pretty = (id) => id.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  let rows = null, markets = null, busy = false, armed = null;
  const me = () => ((window.__WBD && window.__WBD.user && window.__WBD.user.email) || '').toLowerCase();

  // styles: one block, scoped to #wb-access, matching the Settings controls
  if (!document.getElementById('wba-css')) {
    const st = document.createElement('style'); st.id = 'wba-css';
    st.textContent = `
      #wb-access{font-family:'Inter Tight',Aptos,sans-serif;color:var(--ink-1)}
      #wb-access .wba-lead{font-size:13px;color:var(--ink-3);line-height:1.5;margin:0 0 14px}
      #wb-access .wba-grid{display:grid;grid-template-columns:minmax(0,1fr) 210px 110px 84px;column-gap:14px;align-items:center}
      #wb-access .wba-head{border-bottom:1px solid var(--line)}
      #wb-access .wba-h{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);padding:0 0 8px}
      #wb-access .wba-r{min-height:52px;border-bottom:1px solid var(--line)}
      #wb-access .wba-r>div{padding:8px 0}
      #wb-access .wba-who{font-size:14px;line-height:1.3;overflow:hidden;text-overflow:ellipsis}
      #wb-access .wba-sub{font-size:12px;color:var(--ink-3);margin-top:2px}
      #wb-access .wba-fixed{font-size:14px;padding-left:1px}
      #wb-access .wba-pend{color:var(--ink-3);font-size:12px}
      #wb-access select,#wb-access input{box-sizing:border-box;width:100%;height:36px;font:14px 'Inter Tight',Aptos,sans-serif;padding:0 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg-2);color:var(--ink-1)}
      #wb-access select:focus,#wb-access input:focus{outline:2px solid var(--accent-text);outline-offset:-1px}
      #wb-access .wba-x{border:0;background:none;padding:6px 0;font:13px 'Inter Tight',Aptos,sans-serif;color:var(--ink-3);cursor:pointer;text-align:left}
      #wb-access .wba-x:hover,#wb-access .wba-x.armed{color:var(--negative)}
      #wb-access .wba-add{padding-top:14px}
      #wb-access .wba-btn{height:36px;width:100%;border:1px solid var(--ink-1);border-radius:6px;background:var(--ink-1);color:#fff;font:600 13px 'Inter Tight',Aptos,sans-serif;cursor:pointer}
      #wb-access .wba-btn:disabled{opacity:.5;cursor:default}
      #wb-access .wba-newmkt{margin-top:8px}
      #wb-access .wba-foot{font-size:12px;color:var(--ink-3);margin-top:10px;line-height:1.5}
      #wb-access .wba-msg{font-size:12px;margin-top:8px;min-height:16px}
      #wb-access .wba-msg.bad{color:var(--negative)}`;
    document.head.appendChild(st);
  }

  async function load() {
    const [a, m] = await Promise.all([
      WB.sb.schema('core').from('market_access').select('email,market_id,role,note').order('email'),
      WB.sb.schema('core').from('markets').select('id,label').order('label'),
    ]);
    if (a.error) throw a.error;
    rows = (a.data || []).sort((x, y) => (x.email.toLowerCase() === me() ? -1 : y.email.toLowerCase() === me() ? 1 : x.email.localeCompare(y.email)));
    markets = m.data || [];
  }
  const loaded = (id) => (markets || []).some((m) => m.id === id);
  const mLabel = (id) => (id === '*' ? 'All markets' : ((markets || []).find((m) => m.id === id) || {}).label || pretty(id));
  const isAdmin = () => (rows || []).some((r) => r.email.toLowerCase() === me() && r.market_id === '*' && r.role === 'admin');
  const pendingIds = () => [...new Set((rows || []).map((r) => r.market_id).filter((id) => id !== '*' && !loaded(id)))];
  function mktOpts(sel, withNew) {
    const o = [['*', 'All markets'], ...(markets || []).map((m) => [m.id, m.label]), ...pendingIds().map((id) => [id, pretty(id)])];
    return o.map(([v, l]) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(l)}</option>`).join('') + (withNew ? '<option value="__new">New market…</option>' : '');
  }
  const roleOpts = (sel) => Object.entries(ROLE).map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${l}</option>`).join('');

  function html() {
    if (!rows) return '<p class="wba-lead">Loading…</p>';
    if (!isAdmin()) {
      const mine = rows.filter((r) => r.email.toLowerCase() === me());
      return `<p class="wba-lead">Your access: ${mine.map((r) => `<b>${ROLE[r.role]}</b> · ${esc(mLabel(r.market_id))}`).join('; ') || 'none'}. Ask Will to change it.</p>`;
    }
    const admins = rows.filter((r) => r.market_id === '*' && r.role === 'admin').length;
    const list = rows.map((r, i) => {
      const self = r.email.toLowerCase() === me();
      const lock = self || (r.market_id === '*' && r.role === 'admin' && admins <= 1);   // you can't lock yourself or the last admin out
      const pend = r.market_id !== '*' && !loaded(r.market_id);
      return `<div class="wba-grid wba-r">
        <div><div class="wba-who">${esc(r.email)}</div>${self ? '<div class="wba-sub">You</div>' : r.note ? `<div class="wba-sub">${esc(r.note)}</div>` : ''}</div>
        <div>${lock ? `<div class="wba-fixed">${esc(mLabel(r.market_id))}</div>` : `<select data-i="${i}" data-f="market_id" aria-label="Market for ${esc(r.email)}">${mktOpts(r.market_id)}</select>`}${pend ? '<div class="wba-pend">Not loaded yet: they create it with their first upload</div>' : ''}</div>
        <div>${lock ? `<div class="wba-fixed">${ROLE[r.role]}</div>` : `<select data-i="${i}" data-f="role" aria-label="Access for ${esc(r.email)}">${roleOpts(r.role)}</select>`}</div>
        <div>${lock ? '' : `<button type="button" class="wba-x" data-rm="${i}">Remove</button>`}</div>
      </div>`;
    }).join('');
    return `
      <p class="wba-lead">Who can open Market Intel, and what they can do in each market. <b>View</b> sees it. <b>Edit</b> also uploads data and makes changes. <b>Admin</b> does everything, including adding markets and managing this list.</p>
      <div class="wba-grid wba-head"><div class="wba-h">Person</div><div class="wba-h">Market</div><div class="wba-h">Access</div><div class="wba-h"></div></div>
      ${list}
      <div class="wba-grid wba-add">
        <div><input id="wba-email" type="email" placeholder="name@willowbridgepc.com" aria-label="Email of the person to add" autocomplete="off"></div>
        <div><select id="wba-market" aria-label="Market">${mktOpts((window.__WBD && window.__WBD.market) || '*', true)}</select></div>
        <div><select id="wba-role" aria-label="Access">${roleOpts('edit')}</select></div>
        <div><button type="button" class="wba-btn" id="wba-add">Add</button></div>
      </div>
      <div class="wba-grid"><div></div><div class="wba-newmkt" id="wba-newwrap" hidden><input id="wba-newname" placeholder="Market name, e.g. Fort Lauderdale" aria-label="New market name"></div><div></div><div></div></div>
      <div class="wba-msg" id="wba-msg" role="status"></div>
      <p class="wba-foot">Adding someone doesn't send anything. Share the Market Intel link; they sign in with this email (password or an emailed code). Anyone not on this list is turned away at sign-in.</p>`;
  }

  function wire(box) {
    const msg = (t, bad) => { const el = box.querySelector('#wba-msg'); if (el) { el.textContent = t || ''; el.classList.toggle('bad', !!bad); } };
    const save = async (fn, okText) => {
      if (busy) return; busy = true;
      try { const { error } = await fn(); if (error) throw error; await load(); paint(box); WB.toast && WB.toast(okText); }
      catch (e) { msg(e.message || String(e), true); }
      busy = false;
    };
    box.querySelectorAll('select[data-i]').forEach((s) => s.addEventListener('change', () => {
      const r = rows[+s.dataset.i]; const patch = { [s.dataset.f]: s.value };
      if (patch.role === 'admin' && r.market_id !== '*') patch.market_id = '*';            // admin is an all-markets role
      if (patch.market_id && patch.market_id !== '*' && r.role === 'admin') patch.role = 'edit';
      save(() => WB.sb.schema('core').from('market_access').update(patch).eq('email', r.email).eq('market_id', r.market_id), `Updated ${r.email}`);
    }));
    box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
      const r = rows[+b.dataset.rm]; const k = r.email + '|' + r.market_id;
      if (armed !== k) {   // first click arms, second click removes (no browser dialog)
        armed = k; box.querySelectorAll('[data-rm]').forEach((x) => { x.textContent = 'Remove'; x.classList.remove('armed'); });
        b.textContent = 'Confirm'; b.classList.add('armed');
        setTimeout(() => { if (armed === k) { armed = null; if (b.isConnected) { b.textContent = 'Remove'; b.classList.remove('armed'); } } }, 4000);
        return;
      }
      armed = null;
      save(() => WB.sb.schema('core').from('market_access').delete().eq('email', r.email).eq('market_id', r.market_id), `Removed ${r.email}`);
    }));
    const mk = box.querySelector('#wba-market'), wrap = box.querySelector('#wba-newwrap');
    if (mk) mk.addEventListener('change', () => { wrap.hidden = mk.value !== '__new'; if (!wrap.hidden) box.querySelector('#wba-newname').focus(); });
    const add = box.querySelector('#wba-add');
    if (add) add.addEventListener('click', () => {
      const email = box.querySelector('#wba-email').value.trim().toLowerCase();
      let market_id = mk.value; const role = box.querySelector('#wba-role').value;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return msg('Enter an email address', true);
      if (market_id === '__new') {
        market_id = slug(box.querySelector('#wba-newname').value);
        if (!/^[a-z][a-z0-9_]{1,30}$/.test(market_id)) return msg('Name the new market, e.g. Fort Lauderdale', true);
      }
      if (role === 'admin') market_id = '*';
      if (rows.some((r) => r.email.toLowerCase() === email && r.market_id === market_id)) return msg('Already on the list for that market. Change their access instead.', true);
      save(() => WB.sb.schema('core').from('market_access').insert({ email, market_id, role }), `Added ${email}`);
    });
  }

  function paint(box) { box.innerHTML = html(); if (rows) wire(box); }

  /** Called by renderSettingsModal() after it draws; fills the People and access section. */
  window.wbRenderAccess = async function () {
    const box = document.getElementById('wb-access'); if (!box) return;
    paint(box);
    try { await load(); } catch (e) { box.innerHTML = `<p class="wba-lead" style="color:var(--negative)">Couldn't load the access list: ${esc(e.message || e)}</p>`; return; }
    const now = document.getElementById('wb-access'); if (now) paint(now);
  };
})();
