/* Willow Bridge Intel: shared client.
   - One Supabase client for every page (publishable key: safe in public code; the database
     only serves rows to signed-in users on the approved list).
   - Email-link login gate, top navigation, paged reads, small helpers. */
(function () {
  const SB_URL = 'https://wmydniiakotcliraajaa.supabase.co';
  const SB_KEY = 'sb_publishable_FWrjAmI9VJZpXWJ5Q7AmFg_2zluUmIL';
  const PAGES = [
    { id: 'home', label: 'Overview', href: '' },
    { id: 'intel', label: 'Market intel', href: 'intel/' },
    { id: 'scout', label: 'Site scout', href: 'scout/' },
    { id: 'pipeline', label: 'Pipeline', href: 'pipeline/' },
    { id: 'comps', label: 'Sale comps', href: 'comps/' },
  ];

  // Root of the v2 site, worked out from where this script was loaded.
  const scriptSrc = document.currentScript && document.currentScript.src;
  const ROOT = scriptSrc ? scriptSrc.replace(/shared\/wb\.js.*$/, '') : './';

  const sb = window.supabase.createClient(SB_URL, SB_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg, ms = 2600) {
    let t = $('.wb-toast');
    if (!t) { t = document.createElement('div'); t.className = 'wb-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms);
  }

  // Browser storage as it was before any tool page re-scopes it (Intel and Scout prefix their own keys),
  // so the market choice is shared by every tab.
  const _get = Storage.prototype.getItem, _set = Storage.prototype.setItem;
  const store = {
    get(k) { try { return _get.call(window.localStorage, 'wb:' + k); } catch (e) { return null; } },
    set(k, v) { try { _set.call(window.localStorage, 'wb:' + k, v); } catch (e) { /* private mode */ } },
  };

  // Shared chrome stylesheet, loaded once per page.
  (function chrome() {
    const add = (href) => { const abs = new URL(href, location.href).href; if ([...document.querySelectorAll('link[rel=stylesheet]')].some((l) => l.href === abs)) return; const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); };
    add(ROOT + 'shared/wb-chrome.css?v=202610192101');
  })();

  // ---------- market context shared across tabs ----------
  let MARKETS = [];   // [{id, label, short}]
  const shortName = (label, id) => String(label || id || '').split(',')[0];
  // Each tab keeps its own market (no app-wide switch). The toggle is a small segmented control a page places where it wants.
  let PAGE = 'home', SINGLE = false;
  const valid = (m) => m === 'all' ? !SINGLE : MARKETS.some((x) => x.id === m);
  function getMarket() { const m = store.get('market:' + PAGE); return m && valid(m) ? m : (SINGLE ? (MARKETS[0] || {}).id : 'all'); }
  function activeMarket() { return getMarket(); }
  function paintToggles(id) { document.querySelectorAll('.wb-mkt button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.m === id)); }
  function showMarket(id) { paintToggles(id); }
  function setMarket(id) {
    if (!valid(id)) return;
    store.set('market:' + PAGE, id); paintToggles(id); paintStrip();
    window.dispatchEvent(new CustomEvent('wb:market', { detail: id }));
  }
  /** A market toggle (All / Denver / Phoenix; no All on single-market tabs). Returns the element; the page puts it where it fits. */
  function marketToggle() {
    const el = document.createElement('div'); el.className = 'wb-mkt'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Market');
    const cur = getMarket();
    el.innerHTML = (SINGLE ? [] : [{ id: 'all', short: 'All' }]).concat(MARKETS).map((m) => `<button type="button" data-m="${m.id}" aria-pressed="${m.id === cur}">${esc(m.short)}</button>`).join('');
    el.addEventListener('click', (e) => { const b = e.target.closest('button[data-m]'); if (b && b.dataset.m !== getMarket()) setMarket(b.dataset.m); });
    return el;
  }
  const ICON = {
    strip: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 10V6M5 10V2M8 10V5M11 10V7"/></svg>',
  };

  function renderNav(active, user, opts) {
    if ($('.wb-nav')) return;
    PAGE = active; SINGLE = opts.marketMode === 'single';
    const nav = document.createElement('header');
    nav.className = 'wb-nav';
    const local = (user.email || '?').split('@')[0], parts = local.split(/[._-]/).filter(Boolean);
    const initials = (parts.length > 1 ? parts[0][0] + parts[1][0] : local.slice(0, 2)).toUpperCase();
    nav.innerHTML = `
      <a class="brand" href="${ROOT}"><img src="${ROOT}shared/wb-mark.png" alt=""><span>Willow Bridge Intel</span></a>
      <nav>${PAGES.map((p) => `<a href="${ROOT}${p.href}" class="${p.id === active ? 'on' : ''}">${p.label}</a>`).join('')}</nav>
      <div class="right">

        ${`<button type="button" class="ctl strip-btn" aria-pressed="false" title="Show the market snapshot">${ICON.strip}<span>Market snapshot</span></button>`}
        <div class="me"><button type="button" aria-haspopup="true" title="${esc(user.email)}">${esc(initials)}</button>
          <div class="menu"><div class="who">Signed in as<br>${esc(user.email)}</div><button type="button" data-signout>Sign out</button></div></div>
      </div>`;
    document.body.prepend(nav);
    const me = $('.me', nav), menu = $('.menu', me);
    $('button', me).onclick = (e) => { e.stopPropagation(); menu.classList.toggle('open'); };
    document.addEventListener('click', () => menu.classList.remove('open'));
    $('[data-signout]', nav).onclick = async () => { await sb.auth.signOut(); location.reload(); };

    // market strip: inline on Overview, a drop-down sheet on the tools
    const strip = document.createElement('section');
    strip.className = 'wb-strip drop';
    strip.setAttribute('aria-label', 'Market snapshot');
    nav.after(strip);
    const btn = $('.strip-btn', nav);
    if (btn) {
      btn.onclick = (e) => { e.stopPropagation(); const open = !strip.classList.contains('open'); strip.classList.toggle('open', open); btn.setAttribute('aria-pressed', open); };
      document.addEventListener('click', (e) => { if (!strip.contains(e.target)) { strip.classList.remove('open'); btn.setAttribute('aria-pressed', 'false'); } });
    }
    loadStrip();
    // dense tools (Market intel) give the app bar's space back once you scroll; it returns at the top of the page or when the pointer touches the top edge
    if (opts.navAutoHide) {
      nav.classList.add('autohide');
      let peek = false;
      const sync = () => nav.classList.toggle('hid', window.scrollY > 60 && !peek && !nav.matches(':hover') && !$('.menu.open', nav) && !$('.wb-strip.drop.open'));
      window.addEventListener('scroll', sync, { passive: true });
      document.addEventListener('mousemove', (e) => { const p = e.clientY < 8 || (peek && e.clientY < 56); if (p !== peek) { peek = p; sync(); } }, { passive: true });
      nav.addEventListener('mouseleave', () => setTimeout(sync, 300));
    }
  }

  let STRIP = null, stripP = null;
  function loadStrip() {
    stripP = stripP || (async () => { try { STRIP = (await sb.schema('market').from('strip_summary').select('*')).data || []; } catch (e) { STRIP = []; } paintStrip(); return STRIP; })();
    return stripP;
  }

  /** The Midnight page band under the nav. o = {eyebrow, title, lede, actions, figs, tabs, compact} (HTML strings). */
  function band(o = {}) {
    let el = $('.wb-band');
    if (!el) {
      el = document.createElement('section'); el.className = 'wb-band';
      const after = $('.wb-strip') || $('.wb-nav');
      if (after) after.after(el); else document.body.prepend(el);
    }
    el.classList.toggle('compact', !!o.compact);
    el.innerHTML = `<div class="in"><div class="top"><div>${o.eyebrow ? `<div class="eyebrow">${o.eyebrow}</div>` : ''}<h1>${o.title || ''}</h1>${o.lede ? `<p class="lede">${o.lede}</p>` : ''}</div>`
      + `<div class="acts">${o.actions || ''}</div></div>${(Array.isArray(o.figs) ? o.figs : o.figs ? [o.figs] : []).map((f) => `<div class="figs"${o.figsCols ? ` style="grid-template-columns:${o.figsCols}"` : ''}>${f}</div>`).join('')}${o.tabs ? `<div class="tabs" role="tablist">${o.tabs}</div>` : ''}</div>`;
    if (o.market !== false) el.querySelector('.acts').prepend(marketToggle());
    return el;
  }
  const fig = (v, l, sub) => `<div class="fig"><div class="v">${v}${sub ? `<span>${sub}</span>` : ''}</div><div class="l">${l}</div></div>`;
  function paintStrip() {
    const el = $('.wb-strip'); if (!el || !STRIP) return;
    const cur = getMarket();
    const rows = MARKETS.map((m) => STRIP.find((r) => r.market_id === m.id)).filter(Boolean);
    el.style.setProperty('--n', rows.length || 1);
    const usd = (v) => v == null ? '—' : '$' + Math.round(+v).toLocaleString('en-US');
    el.innerHTML = rows.map((r) => `
      <div class="m${cur !== 'all' && cur !== r.market_id ? ' dim' : ''}">
        <div class="nm">${esc(shortName(r.label, r.market_id))}</div>
        <div><div class="v">$${(+r.asking_rent_psf).toFixed(2)}<span>${usd(r.asking_rent_mo)}/mo</span></div><div class="l">Asking rent per SF</div></div>
        <div><div class="v">${(+r.occupancy_pct).toFixed(1)}%</div><div class="l">Occupancy</div></div>
        <div><div class="v">${(+r.concessions_weeks).toFixed(1)} wks</div><div class="l">Concessions</div></div>
        <div><div class="v">${Math.round(+r.uc_units).toLocaleString('en-US')}</div><div class="l">Units under construction</div></div>
        <div><div class="v">${r.price_per_unit_24m ? '$' + Math.round(r.price_per_unit_24m / 1000) + 'K' : '—'}<span>${r.median_cap_24m ? (+r.median_cap_24m).toFixed(2) + '% cap' : ''}</span></div><div class="l">Sales per unit, 24 mo</div></div>
      </div>`).join('');
  }

  function loginScreen(message, isErr) {
    return new Promise(() => {
      const el = document.createElement('div');
      el.className = 'wb-login';
      el.innerHTML = `
        <div class="card">
          <img src="${ROOT}shared/wb-mark.png" alt="">
          <h1>Willow Bridge Intel</h1>
          <p>Sign in with your Willow Bridge email and password, or leave the password blank to get a code by email.</p>
          <form id="wb-f1">
            <input class="input" type="email" name="email" required placeholder="you@willowbridgepc.com" autocomplete="email">
            <input class="input" type="password" name="password" placeholder="Password (leave blank to get an emailed code)" autocomplete="current-password">
            <button class="btn primary" type="submit">Sign in</button>
          </form>
          <form id="wb-f2" hidden>
            <input class="input" name="code" required inputmode="numeric" autocomplete="one-time-code" placeholder="Code from the email" pattern="[0-9]{6,10}">
            <button class="btn primary" type="submit">Sign in</button>
            <button class="btn" type="button" id="wb-back">Use a different email</button>
          </form>
          <div class="msg ${isErr ? 'err' : ''}">${message ? esc(message) : ''}</div>
        </div>`;
      document.body.appendChild(el);
      // Codes, not links: Outlook's link scanners open sign-in links before you can, which uses them up.
      const f1 = $('#wb-f1', el), f2 = $('#wb-f2', el), msg = $('.msg', el);
      let email = '';
      const say = (t, err) => { msg.className = 'msg' + (err ? ' err' : ''); msg.textContent = t; };
      const hashErr = new URLSearchParams(location.hash.slice(1)).get('error_description');
      if (hashErr && !message) say(hashErr.replace(/\+/g, ' ') + '. Use the code option below instead.', true);
      f1.onsubmit = async (e) => {
        e.preventDefault();
        email = f1.email.value.trim();
        const btn = $('button', f1); btn.disabled = true;
        if (f1.password.value) {
          const { error: pErr } = await sb.auth.signInWithPassword({ email, password: f1.password.value });
          btn.disabled = false;
          if (pErr) return say(pErr.message, true);
          history.replaceState(null, '', location.pathname + location.search);
          return location.reload();
        }
        const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
        btn.disabled = false;
        if (error) return say(error.message, true);
        f1.hidden = true; f2.hidden = false; f2.code.focus();
        say(`We emailed a code to ${email}. Enter it here; ignore any link in the email.`);
      };
      f2.onsubmit = async (e) => {
        e.preventDefault();
        const btn = $('button', f2); btn.disabled = true;
        const { error } = await sb.auth.verifyOtp({ email, token: f2.code.value.trim(), type: 'email' });
        btn.disabled = false;
        if (error) return say(error.message, true);
        history.replaceState(null, '', location.pathname + location.search);
        location.reload();
      };
      $('#wb-back', el).onclick = () => { f2.hidden = true; f1.hidden = false; say(''); };
    });
  }

  /** Call once per page. Resolves with {sb, user} only for signed-in, approved users. */
  async function ready(active, opts = {}) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return loginScreen();
    // Approved list check: the markets table only answers members.
    const { data, error } = await sb.schema('core').from('markets').select('id,label,active:config->active').order('id');
    if (error || !data || data.length === 0) {
      await sb.auth.signOut();
      return loginScreen(`${session.user.email} isn't on the access list. Ask Will to add you.`, true);
    }
    MARKETS = data.filter((m) => m.active !== false).map((m) => ({ id: m.id, label: m.label, short: shortName(m.label, m.id) }));
    renderNav(active, session.user, opts);
    return { sb, user: session.user };
  }

  /** Read every row of a table, 1,000 at a time. build(q) can add filters/order. */
  async function fetchAll(schema, table, select = '*', build = (q) => q) {
    const out = []; const size = 1000;
    for (let from = 0; ; from += size) {
      const { data, error } = await build(sb.schema(schema).from(table).select(select)).range(from, from + size - 1);
      if (error) throw error;
      out.push(...data);
      if (data.length < size) break;
    }
    return out;
  }

  // formatting
  const fmt = {
    usd(v) { if (v == null || v === '') return '—'; const n = +v; if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`; return n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`; },
    usdFull(v) { return v == null || v === '' ? '—' : '$' + Math.round(+v).toLocaleString('en-US'); },
    psf(v) { return v == null || v === '' ? '—' : `$${(+v).toFixed(2)}`; },
    int(v) { return v == null || v === '' ? '—' : Math.round(+v).toLocaleString('en-US'); },
    ac(v) { return v == null || v === '' ? '—' : (+v).toFixed(2); },
    pct(v, d = 1) { return v == null || v === '' ? '—' : `${(+v).toFixed(d)}%`; },
    date(v) { if (!v) return '—'; const [y, m, d] = String(v).slice(0, 10).split('-'); return `${+m}/${+d}/${y.slice(2)}`; },
  };
  const median = (xs) => { const a = xs.filter((x) => x != null && !isNaN(x)).map(Number).sort((p, q) => p - q); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

  window.WB = { sb, ready, band, marketToggle, fig, strip: () => loadStrip(), marketLabel: (id) => (MARKETS.find((m) => m.id === id) || {}).short || id, fetchAll, toast, esc, fmt, median, ROOT, SB_URL, getMarket, setMarket, activeMarket, showMarket, get markets() { return MARKETS; } };
})();
