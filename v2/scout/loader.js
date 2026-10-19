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
    const s = document.createElement('script');
    s.src = 'app.js?v=' + (window.WB_BUILD || '1');
    // the app bar's market dropdown drives Site Scout (its own Phoenix/Denver toggle is hidden)
    // Site scout's own market toggle sits in its panel header
    const follow = () => { const m = WB.getMarket(); if (m && typeof window.setMarket === 'function') window.setMarket(m); };
    s.onload = () => setTimeout(() => {
      follow();
      const head = document.getElementById('brand');
      if (head) { const t = WB.marketToggle(); t.classList.add('scout-mkt'); head.appendChild(t); }
    }, 0);
    window.addEventListener('wb:market', follow);
    document.body.appendChild(s);
  });
})();
