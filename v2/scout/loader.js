/* Site Scout loader: sign in with the shared login, keep this page's browser storage separate from the
   old Site Scout (same web address), then start the app. */
(function () {
  const PREFIX = 'wbv2:scout:';
  const proto = Storage.prototype, get = proto.getItem, set = proto.setItem, del = proto.removeItem;
  proto.getItem = function (k) { return get.call(this, PREFIX + k); };
  proto.setItem = function (k, v) { return set.call(this, PREFIX + k, v); };
  proto.removeItem = function (k) { return del.call(this, PREFIX + k); };

  const addEv = window.addEventListener.bind(window);
  window.addEventListener = function (type, fn, opts) {
    if ((type === 'load' || type === 'DOMContentLoaded') && document.readyState === 'complete') { setTimeout(fn, 0); return; }
    return addEv(type, fn, opts);
  };
  const addDocEv = document.addEventListener.bind(document);
  document.addEventListener = function (type, fn, opts) {
    if (type === 'DOMContentLoaded' && document.readyState !== 'loading') { setTimeout(fn, 0); return; }
    return addDocEv(type, fn, opts);
  };

  WB.ready('scout', { marketMode: 'single' }).then(() => {
    const band = WB.band({ eyebrow: 'Site scout', title: 'Off-market sites', compact: true,
      lede: 'Parcels, owners and nearby product for sites we are chasing. Deals checked "Show in Site Scout" in Pipeline appear here.' });
    const acts = document.createElement('div'); acts.className = 'acts'; band.querySelector('.top').appendChild(acts);
    const sb = document.getElementById('settingsBtn');
    if (sb) { sb.textContent = 'Settings'; sb.className = 'b'; sb.removeAttribute('style'); acts.appendChild(sb); }
    const setTop = () => { document.documentElement.style.setProperty('--top', Math.round(band.getBoundingClientRect().bottom) + 'px'); window.dispatchEvent(new Event('resize')); };
    let last = 0; new ResizeObserver(() => { const b = Math.round(band.getBoundingClientRect().bottom); if (b !== last) { last = b; setTop(); } }).observe(band);
    const s = document.createElement('script');
    s.src = 'app.js?v=' + (window.WB_BUILD || '1');
    // the app bar's market dropdown drives Site Scout (its own Phoenix/Denver toggle is hidden)
    let shown = null;
    const follow = () => { const m = WB.activeMarket(); if (m && m !== 'all' && m !== shown && typeof window.setMarket === 'function') { shown = m; window.setMarket(m); } };
    s.onload = () => setTimeout(follow, 0);
    window.addEventListener('wb:market', follow);
    document.body.appendChild(s);
  });
})();
