/* Willow Bridge Intel: shared client.
   - One Supabase client for every page (publishable key: safe in public code; the database
     only serves rows to signed-in users on the approved list).
   - Email-link login gate, top navigation, paged reads, small helpers. */
(function () {
  const SB_URL = 'https://wmydniiakotcliraajaa.supabase.co';
  const SB_KEY = 'sb_publishable_FWrjAmI9VJZpXWJ5Q7AmFg_2zluUmIL';
  const PAGES = [
    { id: 'home', label: 'Home', href: '' },
    { id: 'intel', label: 'Market Intel', href: 'intel/' },
    { id: 'scout', label: 'Site Scout', href: 'scout/' },
    { id: 'pipeline', label: 'Pipeline', href: 'pipeline/' },
    { id: 'comps', label: 'Sale Comps', href: 'comps/' },
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

  // Shared chrome stylesheet + brand fonts, loaded once per page.
  (function chrome() {
    const add = (href) => { const abs = new URL(href, location.href).href; if ([...document.querySelectorAll('link[rel=stylesheet]')].some((l) => l.href === abs)) return; const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); };
    add(ROOT + 'shared/wb-chrome.css');
    add('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&display=swap');
  })();

  function renderNav(active, user) {
    if ($('.wb-nav')) return;
    const nav = document.createElement('header');
    nav.className = 'wb-nav';
    nav.innerHTML = `
      <a class="brand" href="${ROOT}"><img src="${ROOT}shared/wb-mark.png" alt=""><span>Willow Bridge Intel</span></a>
      <nav>${PAGES.filter((p) => p.id !== 'home').map((p) =>
        `<a href="${ROOT}${p.href}" class="${p.id === active ? 'on' : ''}">${p.label}</a>`).join('')}</nav>
      <div class="who"><span class="email">${esc(user.email)}</span><button type="button" id="wb-signout">Sign out</button></div>`;
    document.body.prepend(nav);
    $('#wb-signout').onclick = async () => { await sb.auth.signOut(); location.reload(); };
    if (active !== 'home') autoHide(nav, active);
  }

  // Tool pages: keep the nav tucked above the page. A small tab at the top edge pulls it down on hover;
  // clicking the tab pins it open until clicked again (and is the way in on touch screens).
  function autoHide(nav, active) {
    nav.classList.add('auto');
    const label = (PAGES.find((p) => p.id === active) || {}).label || 'Menu';
    const tab = document.createElement('button');
    tab.type = 'button'; tab.className = 'wb-tab'; tab.title = 'Show the Willow Bridge Intel menu';
    tab.innerHTML = `<img src="${ROOT}shared/wb-mark.png" alt=""><span>${esc(label)}</span><svg viewBox="0 0 10 10"><path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const hot = document.createElement('div'); hot.className = 'wb-hot';
    document.body.append(hot, tab);
    let pinned = false, timer;
    const set = (open) => { clearTimeout(timer); nav.classList.toggle('open', open); tab.classList.toggle('open', open); };
    const show = () => set(true);
    const hideSoon = () => { if (pinned) return; clearTimeout(timer); timer = setTimeout(() => set(false), 350); };
    [hot, tab, nav].forEach((el) => { el.addEventListener('mouseenter', show); el.addEventListener('mouseleave', hideSoon); });
    tab.addEventListener('click', () => { pinned = !pinned; tab.classList.toggle('pinned', pinned); set(pinned || nav.matches(':hover')); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('open')) { pinned = false; tab.classList.remove('pinned'); set(false); } });
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
  async function ready(active) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return loginScreen();
    // Approved list check: the markets table only answers members.
    const { data, error } = await sb.schema('core').from('markets').select('id').limit(1);
    if (error || !data || data.length === 0) {
      await sb.auth.signOut();
      return loginScreen(`${session.user.email} isn't on the access list. Ask Will to add you.`, true);
    }
    renderNav(active, session.user);
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

  window.WB = { sb, ready, fetchAll, toast, esc, fmt, median, ROOT, SB_URL };
})();
