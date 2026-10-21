/* Market Intel loader: sign in, pull the chosen market from Supabase, then start the dashboard (app.js). */
(function () {
  // 1) Private storage. The old dashboards share this web address and their browser caches;
  //    the dashboard re-pushes cached records on start, so v2 keeps its own namespaced copy.
  const PREFIX = 'wbv2:intel:';
  const proto = Storage.prototype, get = proto.getItem, set = proto.setItem, del = proto.removeItem;
  proto.getItem = function (k) { return get.call(this, k === 'wb_dashboard_theme' ? k : PREFIX + k); };
  proto.setItem = function (k, v) { return set.call(this, k === 'wb_dashboard_theme' ? k : PREFIX + k, v); };
  proto.removeItem = function (k) { return del.call(this, k === 'wb_dashboard_theme' ? k : PREFIX + k); };

  // 2) The dashboard hooks window 'load' in a couple of places; it starts after load has fired, so replay those.
  const addEv = window.addEventListener.bind(window);
  window.addEventListener = function (type, fn, opts) {
    if (type === 'load' && document.readyState === 'complete') { setTimeout(fn, 0); return; }
    return addEv(type, fn, opts);
  };

  let MARKETS = {};
  // Switch markets from Settings: remember the choice, reload with that market's data
  window.wbSwitchMarket = function (id) {
    if (!id || id === (window.__WBD && window.__WBD.market)) return;
    localStorage.setItem('market', id);
    if (window.WB && WB.getMarket() !== id) WB.setMarket(id);   // keep this tab's market toggle in step
    const u = new URL(location.href); u.searchParams.set('market', id); location.href = u.toString();
  };
  const overlay = document.createElement('div');
  overlay.id = 'wb-intel-loading';
  overlay.style.cssText = 'position:fixed;inset:48px 0 0 0;z-index:9000;display:grid;place-items:center;background:var(--cloud,#FBFBF9);font:15px/1.4 Aptos,Inter,Arial,sans-serif;color:#1D1247';

  async function boot() {
    const { sb, user } = await WB.ready('intel', { marketMode: 'single', navAutoHide: true });
    // active markets drive the Settings picker; adding a market = a row in core.markets with config.active = true + its data
    const { data: mlist, error: mErr } = await sb.schema('core').from('markets').select('id,label,title,active:config->active').order('id');
    if (mErr) throw mErr;
    const markets = (mlist || []).filter((m) => m.active === true);
    MARKETS = Object.fromEntries(markets.map((m) => [m.id, (m.label || m.id).split(',')[0]]));
    const q = new URLSearchParams(location.search);
    const shared = WB.getMarket();
    let market = q.get('market') || (shared !== 'all' ? shared : null) || localStorage.getItem('market') || 'denver';
    if (!MARKETS[market]) market = markets.length ? markets.find((m) => m.id === 'denver')?.id || markets[0].id : 'denver';
    localStorage.setItem('market', market);
    WB.showMarket(market);
    overlay.textContent = `Loading ${MARKETS[market]} market data…`;
    document.body.appendChild(overlay);

    const t0 = performance.now();
    const [mrow, props, rp, trends] = await Promise.all([
      sb.schema('core').from('markets').select('*').eq('id', market).single(),
      WB.fetchAll('core', 'properties', '*', (x) => x.eq('market_id', market).neq('kind', 'land').order('costar_id')),
      WB.fetchAll('market', 'rp_property_data', 'realpage_id,data', (x) => x.eq('market_id', market).order('realpage_id')),
      WB.fetchAll('market', 'rp_trends', 'geography,data', (x) => x.eq('market_id', market)),
    ]);
    if (mrow.error) throw mrow.error;
    const cfg = mrow.data.config || {};

    // CoStar records back into the shape the dashboard was built on
    const propByCostar = {}, costarByProp = {}, customProps = new Set();
    const RAW_DATA = [];
    for (const p of props) {
      if (p.source !== 'costar') {   // custom properties arrive through the dashboard's own custom-property sync
        customProps.add(p.id);
        const lid = (p.attrs && p.attrs.legacy_id) || p.id;
        propByCostar[lid] = p.id; costarByProp[p.id] = lid;
        continue;
      }
      propByCostar[p.costar_id] = p.id; costarByProp[p.id] = p.costar_id;
      RAW_DATA.push({
        ...p.attrs,
        id: p.costar_id, address: p.address, name: p.name, units: p.units, starRating: p.star_rating, class: p.class,
        status: p.status, submarket: p.costar_submarket, city: p.city, state: p.state, zip: p.zip, avgUnitSF: p.avg_unit_sf,
        monthBuilt: p.month_built, yearBuilt: p.year_built, stories: p.stories, developer: p.developer, lat: p.lat, lng: p.lng,
        owner: p.owner, propertyManager: p.manager, style: p.style, acreage: p.acres, landAreaSF: p.land_sf,
        market: (p.attrs && p.attrs.market) || mrow.data.label,
      });
    }
    window.__WBD = {
      market, label: mrow.data.label, title: cfg.title || mrow.data.title, msa_label: cfg.msa_label || cfg.title,
      center: cfg.center || [39.74, -104.99], WB_SUBMARKETS: cfg.wb_submarkets || [], WB_RP_MAPPING: cfg.rp_mapping || {},
      RAW_DATA, RP_PROPERTIES: Object.fromEntries(rp.map((r) => [r.realpage_id, r.data])),
      RP_FORECAST: Object.fromEntries(trends.map((r) => [r.geography, r.data])),
      propByCostar, costarByProp, customProps, user, markets,
    };
    // the top-bar market dropdown drives this page too
    window.addEventListener('wb:market', (e) => { if (e.detail && e.detail !== 'all') window.wbSwitchMarket(e.detail); });
    console.info(`[intel] ${market}: ${RAW_DATA.length} properties, ${rp.length} RealPage, ${trends.length} trend series in ${Math.round(performance.now() - t0)} ms`);

    // tag edits with the signed-in user instead of asking for a name
    if (!localStorage.getItem('wb_dashboard_editor_name')) localStorage.setItem('wb_dashboard_editor_name', user.email);

    const titleEl = document.getElementById('wb-mkt-title'); if (titleEl) titleEl.textContent = window.__WBD.title;
    const eyeEl = document.getElementById('wb-mkt-eyebrow'); if (eyeEl && cfg.eyebrow) eyeEl.textContent = market === 'denver' ? 'Greater Denver · Colorado' : cfg.eyebrow;
    document.title = `Market Intel · ${MARKETS[market]} · Willow Bridge Intel`;
    for (const id of ['trends-chart-caption-title', 'sc-panel-sub', 'trends-sm-blend-info']) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = el.innerHTML.replace(/Denver MSA/g, window.__WBD.title).replace('Denver-Aurora-Centennial MSA', window.__WBD.msa_label);
    }

    const s = document.createElement('script');
    s.src = 'app.js?v=' + (window.WB_BUILD || '1');
    s.onload = () => { overlay.remove(); buildShell(); sentenceCase(); document.addEventListener('click', scLater, true); };
    s.onerror = () => { overlay.textContent = 'The dashboard code failed to load. Reload the page.'; };
    document.body.appendChild(s);
  }

  // ---------- Page shell (Oct 2026 redesign) ----------
  // Hierarchy: the shared app nav on top; the views as a left rail; the page header carries the view title,
  // two actions, and the filters as one row of compact menus. The legacy controls are moved, not rebuilt,
  // so every handler in app.js keeps working. Styling lives in the wb-minimal block at the end of index.html.
  function buildShell() {
    const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const app = $('.app'), main = $('.app > .main'), inner = $('.app > .sidebar .sidebar-inner');
    const top = $('.main > .topbar'), tabs = $('.main > .tabs'), content = $('.main > .content');
    if (!app || !main || !inner || !tabs || !content || $('.wbi-rail')) return;
    app.classList.remove('sidebar-collapsed');

    // 1) views → left rail, grouped
    const groups = $$(':scope > .filter-group', inner);
    const rail = document.createElement('nav'); rail.className = 'wbi-rail'; rail.setAttribute('aria-label', 'Market Intel views');
    const mkt = document.createElement('div'); mkt.className = 'wbi-rail-mkt';
    const ttl = document.createElement('div'); ttl.className = 'wbi-rail-title'; ttl.textContent = (window.__WBD && window.__WBD.title) || 'Market Intel';
    mkt.append(ttl, WB.marketToggle()); rail.appendChild(mkt);
    const tabBy = Object.fromEntries($$('.tab', tabs).map((t) => [t.dataset.view, t]));
    [['Market', ['overview', 'trends', 'submarkets', 'properties']], ['Supply', ['absorption', 'pipeline']], ['Underwriting', ['yoc', 'salecomps', 'opportunities']]]
      .forEach(([label, ids]) => {
        const h = document.createElement('div'); h.className = 'wbi-rail-h'; h.textContent = label; rail.appendChild(h);
        ids.forEach((id) => { if (tabBy[id]) { rail.appendChild(tabBy[id]); delete tabBy[id]; } });
      });
    Object.values(tabBy).forEach((t) => rail.appendChild(t));
    inner.appendChild(rail);

    // 2) hero: one Midnight band per view — eyebrow (market · section), view title, filter summary, actions,
    //    then that view's headline KPIs, moved in from the view and handed back when you switch views.
    const hero = document.createElement('section'); hero.className = 'wbi-hero';
    hero.innerHTML = '<div class="wbi-hero-deco" aria-hidden="true"></div><header class="wbi-head"><div class="wbi-head-row"><div class="wbi-ttl"><div class="wbi-eyebrow"></div><h1 class="wbi-h1"></h1><div class="wbi-sum"></div></div><div class="wbi-acts"></div></div></header><div class="wbi-hero-kpis"></div>';
    const head = $('.wbi-head', hero), acts = $('.wbi-acts', hero), slot = $('.wbi-hero-kpis', hero);
    ['overview-report-btn', 'settings-btn'].forEach((id) => {
      const b = document.getElementById(id); if (!b) return;
      b.childNodes.forEach((n) => { if (n.nodeType === 3 && n.textContent.trim()) { const t = n.textContent.trim(); n.textContent = ' ' + t.charAt(0) + t.slice(1).toLowerCase(); } });
      acts.appendChild(b);
    });
    if (top) top.style.display = 'none';
    tabs.style.display = 'none';
    main.insertBefore(hero, content);
    const h1 = $('.wbi-h1', hero), eyebrow = $('.wbi-eyebrow', hero);
    const mktName = (window.__WBD && window.__WBD.title) || 'Market Intel';
    const sectionOf = (t) => { let e = t.previousElementSibling; while (e && !e.classList.contains('wbi-rail-h')) e = e.previousElementSibling; return e ? e.textContent : ''; };
    // the view's lead KPI row: its first child, or right after a small sub-tab row (Sale comps), or the Trends KPI row
    const leadKpis = (v) => {
      if (!v) return null;
      const first = v.firstElementChild, r = v.querySelector(':scope > .kpi-row');
      if (r && (r === first || (first && first.nextElementSibling === r && !first.classList.contains('panel')))) return r;
      return v.querySelector('.trends2-kpirow');
    };
    let held = null;
    const syncHero = () => {
      const v = $('.content > .view.active') || $('.view.active');
      if (held && held.view === v) return;
      if (held) { held.marker.replaceWith(held.row); held = null; }
      const r = leadKpis(v);
      if (r) { const m = document.createComment('hero kpis'); r.replaceWith(m); slot.appendChild(r); held = { row: r, marker: m, view: v }; }
      hero.classList.toggle('has-kpis', !!held);
      // the grid below changed height and width: let the charts re-measure
      requestAnimationFrame(() => { try { if (typeof charts !== 'undefined') Object.values(charts).forEach((c) => c && c.resize && c.resize()); } catch (e) {} });
    };
    const syncTitle = () => {
      const a = $('.tab.active', rail);
      h1.textContent = a ? a.textContent.trim() : '';
      eyebrow.textContent = mktName + (a && sectionOf(a) ? ' · ' + sectionOf(a) : '');
      setTimeout(syncHero, 0);
    };
    new MutationObserver(syncTitle).observe(rail, { subtree: true, attributes: true, attributeFilter: ['class'] }); syncTitle();

    // 3) filters → one Filters button (with a count) that opens a panel holding every original control group;
    //    a quiet summary line under the title says what's applied.
    const NAMES = { 'data taxonomy': 'Taxonomy', 'building class': 'Class', 'building status': 'Status', 'avg unit size': 'Unit size', 'comp set': 'Comp set', 'product type': 'Product', 'city': 'City', 'submarket': 'Submarket' };
    const labelOf = (g) => {
      const L = $('.filter-label', g); if (!L) return '';
      const s = $('span', L); const raw = (s ? s.childNodes[0].textContent : L.textContent).trim();
      return NAMES[raw.toLowerCase()] || raw;
    };
    const valueOf = (g) => {
      if (g.id === 'cs-side-group') {
        const b = $('#cs-side-build-state'); if (b && b.style.display !== 'none') return 'Building, ' + ($('#cs-selection-count') ? $('#cs-selection-count').textContent.trim().toLowerCase() : '');
        const p = $('#cs-picker'); return p && p.value ? p.options[p.selectedIndex].textContent.trim() : 'None';
      }
      const tx = $('.taxonomy-btn.active', g); if (tx) return tx.textContent.trim();
      const sum = $('.acc-summary', g); if (sum) return sum.textContent.trim() || 'All';
      const on = $$('.chip.active', g).map((c) => c.textContent.trim());
      return !on.length || on.includes('All') ? 'All' : on.join(', ');
    };
    const fbtn = document.createElement('button'); fbtn.type = 'button'; fbtn.className = 'wbi-fbtn';
    fbtn.setAttribute('aria-haspopup', 'dialog'); fbtn.setAttribute('aria-expanded', 'false');
    fbtn.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M4.5 8h7M7 12h2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>Filters</span><b class="n"></b>';
    acts.prepend(fbtn);
    const panel = document.createElement('div'); panel.className = 'wbi-fpanel'; panel.hidden = true;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Filters');
    panel.innerHTML = '<div class="wbi-fgrid"></div><div class="wbi-ffoot"><span></span><button type="button" class="wbi-fdone">Done</button></div>';
    hero.appendChild(panel);
    const fgrid = $('.wbi-fgrid', panel), items = [];
    groups.forEach((g) => {
      const name = labelOf(g); if (!name) return;
      const sec = document.createElement('section'); sec.className = 'wbi-fsec' + (/^(City|Submarket)$/.test(name) ? ' list' : '');
      const h = document.createElement('div'); h.className = 'wbi-fsec-h'; h.textContent = name;
      g.classList.remove('collapsed'); sec.append(h, g); fgrid.appendChild(sec); items.push([name, g]);
    });
    const reset = document.getElementById('clear-filters');
    if (reset) { reset.textContent = 'Reset filters'; $('.wbi-ffoot > span', panel).appendChild(reset); }
    const sumEl = $('.wbi-sum', head);
    let rq = 0;
    const refresh = () => {
      cancelAnimationFrame(rq);
      rq = requestAnimationFrame(() => {
        const on = items.map(([n, g]) => [n, valueOf(g)]).filter(([n, v]) => n === 'Taxonomy' ? v !== 'Willow Bridge' : !['All', 'None'].includes(v));
        $('.n', fbtn).textContent = on.length ? String(on.length) : '';
        sumEl.textContent = on.length ? on.map(([n, v]) => n === 'Taxonomy' ? v + ' taxonomy' : n === 'Unit size' ? 'Units ' + v : n + ' ' + v).join(' · ') : 'All properties';
      });
    };
    new MutationObserver(refresh).observe(fgrid, { subtree: true, attributes: true, childList: true, characterData: true });
    fgrid.addEventListener('change', refresh); refresh();
    const setOpen = (open) => { panel.hidden = !open; fbtn.setAttribute('aria-expanded', String(open)); };
    fbtn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(panel.hidden); });
    $('.wbi-fdone', panel).addEventListener('click', () => setOpen(false));
    document.addEventListener('click', (e) => { if (!panel.hidden && !e.target.closest('.wbi-fpanel, .wbi-fbtn')) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { setOpen(false); fbtn.focus(); } });

    const st = document.createElement('style'); st.textContent = 'html,body{overflow-x:clip !important;overflow-y:visible !important}'; document.head.appendChild(st);

    // 4) charts and maps re-measure for the new column widths
    setTimeout(() => {
      try { if (typeof charts !== 'undefined') Object.values(charts).forEach((c) => c && c.resize && c.resize()); } catch (e) {}
      try { [window._propertyMap, window._oppMap].forEach((m) => m && m.invalidateSize && m.invalidateSize()); } catch (e) {}
      window.dispatchEvent(new Event('resize'));
    }, 60);
  }
  // Legacy buttons carry ALL-CAPS labels in their markup ("+ ADD COMP", "EXPORT PDF"). Sentence-case them, keeping acronyms.
  const KEEP_CAPS = new Set(['PDF', 'YOC', 'ROC', 'UC', 'CSV', 'MSA', 'SF', 'TPC', 'HC', 'NRSF', 'RP', 'KPI', 'LOI', 'DD', 'YTD']);
  function sentenceCase(root) {
    (root || document).querySelectorAll('.app button, .modal-backdrop button').forEach((b) => b.childNodes.forEach((n) => {
      if (n.nodeType !== 3) return; const t = n.textContent;
      if (!/[A-Z]{3,}/.test(t) || /[a-z]/.test(t)) return;
      let first = true;
      n.textContent = t.replace(/[A-Z][A-Z0-9&'.-]*/g, (w) => {
        if (KEEP_CAPS.has(w)) { first = false; return w; }
        const out = first ? w.charAt(0) + w.slice(1).toLowerCase() : w.toLowerCase(); first = false; return out;
      });
    }));
  }
  let scT = 0;
  const scLater = () => { clearTimeout(scT); scT = setTimeout(() => sentenceCase(), 60); };

  boot().catch((e) => {
    console.error('[intel] load failed', e);
    overlay.textContent = 'Could not load market data: ' + (e.message || e);
    document.body.appendChild(overlay);
  });
})();
