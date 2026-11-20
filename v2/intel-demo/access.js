/* Settings → People and access. Lists core.market_access; admins add, change and remove people.
   The database enforces the same rules (see tools/supabase/20261120_market_access.sql), so this page is only a view on them. */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ROLE = { view: 'View', edit: 'Edit', admin: 'Admin' };
  const ROLE_NOTE = 'View: sees the market. Edit: also uploads data and makes changes. Admin: everything, plus adds markets and manages this list.';
  let rows = null, markets = null, busy = false;
  const me = () => ((window.__WBD && window.__WBD.user && window.__WBD.user.email) || '').toLowerCase();
  const T = "font-family:'Inter Tight',sans-serif;";
  const inp = `${T}font-size:13px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg-2);color:var(--ink-1);`;

  async function load() {
    const sb = WB.sb;
    const [a, m] = await Promise.all([
      sb.schema('core').from('market_access').select('email,market_id,role,note').order('email'),
      sb.schema('core').from('markets').select('id,label').order('label'),
    ]);
    if (a.error) throw a.error;
    rows = a.data || []; markets = m.data || [];
  }
  const mLabel = (id) => (id === '*' ? 'All markets' : ((markets || []).find((m) => m.id === id) || {}).label || id);
  const isAdmin = () => (rows || []).some((r) => r.email.toLowerCase() === me() && r.market_id === '*' && r.role === 'admin');
  const mktOpts = (sel) => [['*', 'All markets'], ...(markets || []).map((m) => [m.id, m.label])].map(([v, l]) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const roleOpts = (sel) => Object.entries(ROLE).map(([v, l]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${l}</option>`).join('');

  function html() {
    if (!rows) return `<div style="${T}font-size:13px;color:var(--ink-3);">Loading…</div>`;
    const admin = isAdmin();
    if (!admin) {
      const mine = rows.filter((r) => r.email.toLowerCase() === me());
      return `<div style="${T}font-size:13px;color:var(--ink-3);line-height:1.5;">Your access: ${mine.map((r) => `<b style="color:var(--ink-1)">${ROLE[r.role]}</b> · ${esc(mLabel(r.market_id))}`).join('; ') || 'none'}. Ask Will to change it.</div>`;
    }
    const admins = rows.filter((r) => r.market_id === '*' && r.role === 'admin').length;
    const th = `style="${T}text-align:left;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-3);padding:6px 10px 6px 0;border-bottom:1px solid var(--line);"`;
    const td = `style="${T}font-size:13px;color:var(--ink-1);padding:7px 10px 7px 0;border-bottom:1px solid var(--line);vertical-align:middle;"`;
    const body = rows.map((r, i) => {
      const self = r.email.toLowerCase() === me();
      const lastAdmin = r.market_id === '*' && r.role === 'admin' && admins <= 1;
      const lock = self || lastAdmin;   // don't let the owner lock themselves out
      return `<tr>
        <td ${td}>${esc(r.email)}${self ? ' <span style="color:var(--ink-3)">(you)</span>' : ''}${r.note ? `<div style="color:var(--ink-3);font-size:12px;">${esc(r.note)}</div>` : ''}</td>
        <td ${td}>${lock ? esc(mLabel(r.market_id)) : `<select data-i="${i}" data-f="market_id" style="${inp}">${mktOpts(r.market_id)}</select>`}</td>
        <td ${td}>${lock ? ROLE[r.role] : `<select data-i="${i}" data-f="role" style="${inp}">${roleOpts(r.role)}</select>`}</td>
        <td ${td}>${lock ? '' : `<button class="modal-btn" data-rm="${i}" style="background:var(--bg-2);border-color:var(--line);color:var(--accent-text);">Remove</button>`}</td></tr>`;
    }).join('');
    return `
      <div style="${T}font-size:13px;color:var(--ink-3);margin-bottom:12px;line-height:1.5;">Who can open the dashboard, which market, and what they can do. ${ROLE_NOTE} People sign in themselves with the email listed here (password or emailed code).</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:14px;"><thead><tr><th ${th}>Person</th><th ${th}>Market</th><th ${th}>Access</th><th ${th}></th></tr></thead><tbody>${body}</tbody></table>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        <input id="wba-email" type="email" placeholder="name@willowbridgepc.com" style="${inp}min-width:240px;" aria-label="Email">
        <select id="wba-market" style="${inp}" aria-label="Market">${mktOpts((window.__WBD && window.__WBD.market) || '*')}</select>
        <select id="wba-role" style="${inp}" aria-label="Access">${roleOpts('edit')}</select>
        <button class="modal-btn" id="wba-add" style="background:var(--bg-2);border-color:var(--line);color:var(--accent-text);">Add person</button>
        <span id="wba-msg" style="${T}font-size:12px;color:var(--ink-3);"></span>
      </div>`;
  }

  function wire(box) {
    const msg = (t, bad) => { const el = box.querySelector('#wba-msg'); if (el) { el.textContent = t; el.style.color = bad ? 'var(--negative)' : 'var(--ink-3)'; } };
    const save = async (fn, okText) => {
      if (busy) return; busy = true;
      try { const { error } = await fn(); if (error) throw error; await load(); paint(box); WB.toast && WB.toast(okText); }
      catch (e) { busy = false; msg(e.message || String(e), true); return; }
      busy = false;
    };
    box.querySelectorAll('select[data-i]').forEach((s) => s.addEventListener('change', () => {
      const r = rows[+s.dataset.i]; const patch = { [s.dataset.f]: s.value };
      if (patch.role === 'admin' && r.market_id !== '*') patch.market_id = '*';   // admin is an all-markets role
      if (patch.market_id && patch.market_id !== '*' && r.role === 'admin') patch.role = 'edit';
      save(() => WB.sb.schema('core').from('market_access').update(patch).eq('email', r.email).eq('market_id', r.market_id), `Updated ${r.email}`);
    }));
    box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => {
      const r = rows[+b.dataset.rm];
      if (!confirmRemove(r)) return;
      save(() => WB.sb.schema('core').from('market_access').delete().eq('email', r.email).eq('market_id', r.market_id), `Removed ${r.email} from ${mLabel(r.market_id)}`);
    }));
    const add = box.querySelector('#wba-add');
    if (add) add.addEventListener('click', () => {
      const email = box.querySelector('#wba-email').value.trim().toLowerCase();
      let market_id = box.querySelector('#wba-market').value; const role = box.querySelector('#wba-role').value;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return msg('Enter an email address', true);
      if (role === 'admin') market_id = '*';
      if (rows.some((r) => r.email.toLowerCase() === email && r.market_id === market_id)) return msg('Already on the list for that market: change the access instead', true);
      save(() => WB.sb.schema('core').from('market_access').insert({ email, market_id, role }), `Added ${email}`);
    });
  }
  // a two-step remove without a browser dialog: the first click arms the button, the second removes
  let armed = null;
  function confirmRemove(r) { const k = r.email + '|' + r.market_id; if (armed === k) { armed = null; return true; } armed = k; const b = [...document.querySelectorAll('#wb-access [data-rm]')].find((x) => rows[+x.dataset.rm] === r); if (b) b.textContent = 'Click again to remove'; setTimeout(() => { if (armed === k) { armed = null; if (b && b.isConnected) b.textContent = 'Remove'; } }, 4000); return false; }

  function paint(box) { box.innerHTML = html(); if (rows) wire(box); }

  /** Called by renderSettingsModal() after it draws; fills the People and access section. */
  window.wbRenderAccess = async function () {
    const box = document.getElementById('wb-access'); if (!box) return;
    paint(box);
    try { await load(); } catch (e) { box.innerHTML = `<div style="${T}font-size:13px;color:var(--negative);">Couldn't load the access list: ${esc(e.message || e)}</div>`; return; }
    const now = document.getElementById('wb-access'); if (now) paint(now);
  };
})();
