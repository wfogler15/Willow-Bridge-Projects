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
    if (window.WB && WB.getMarket() !== id) WB.setMarket(id);   // keep the top-bar market in step
    const u = new URL(location.href); u.searchParams.set('market', id); location.href = u.toString();
  };
  const overlay = document.createElement('div');
  overlay.id = 'wb-intel-loading';
  overlay.style.cssText = 'position:fixed;inset:48px 0 0 0;z-index:9000;display:grid;place-items:center;background:var(--cloud,#FBFBF9);font:15px/1.4 Aptos,Inter,Arial,sans-serif;color:#1D1247';

  async function boot() {
    const { sb, user } = await WB.ready('intel', { marketMode: 'single' });
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
    s.onload = () => { overlay.remove(); try { intelShell(); } catch (e) { console.error('[intel] shell', e); } };
    s.onerror = () => { overlay.textContent = 'The dashboard code failed to load. Reload the page.'; };
    document.body.appendChild(s);
  }

  // The Midnight page band (shared with every tab) replaces the dashboard's own header and tab strip.
  function intelShell() {
    const D = window.__WBD;
    const NAMES = { overview: 'Overview', absorption: 'Lease-up', pipeline: 'Supply', trends: 'Trends and forecast', yoc: 'Yield on cost',
      submarkets: 'Map', properties: 'Properties', salecomps: 'Sale comps', opportunities: 'Opportunities' };
    const band = WB.band({ eyebrow: 'Market intel', title: D.title || 'Market', lede: (D.msa_label || '') + '. CoStar inventory and RealPage rents, refreshed from the shared database.', tabs: ' ' });
    const acts = document.createElement('div'); acts.className = 'acts'; band.querySelector('.top').appendChild(acts);
    ['overview-report-btn', 'settings-btn'].forEach((id, i) => {
      const b = document.getElementById(id); if (!b) return;
      b.querySelectorAll('span').forEach((x) => x.remove());
      b.className = 'b' + (i === 0 ? ' primary' : ''); acts.appendChild(b);
    });
    const tabs = band.querySelector('.tabs'); tabs.textContent = '';
    document.querySelectorAll('.main > .tabs .tab').forEach((t) => { t.textContent = NAMES[t.dataset.view] || t.textContent; tabs.appendChild(t); });
    document.body.classList.add('wb-shell');
    // labels: commas, not middle dots
    const tidy = (root) => root.querySelectorAll('.kpi-label,.kpi-sub,.panel-sub,.lu-kpi-sub').forEach((el) => {
      if (el.children.length === 0 && el.textContent.includes(' · ')) el.textContent = el.textContent.replace(/ · /g, ', ');
    });
    tidy(document);
    new MutationObserver(() => tidy(document.querySelector('.content') || document)).observe(document.querySelector('.content') || document.body, { childList: true, subtree: true, characterData: true });
  }

  boot().catch((e) => {
    console.error('[intel] load failed', e);
    overlay.textContent = 'Could not load market data: ' + (e.message || e);
    document.body.appendChild(overlay);
  });
})();
