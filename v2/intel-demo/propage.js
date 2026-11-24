/* Property page (Nov 24). The property modal becomes a quick summary (top figures, unit mix, lease-up) with an
   "Open full page" button. The full page is the same property card laid out across the whole screen in two
   columns, with its own link (#property/<id>) so the browser's Back button works and it can be shared,
   plus previous / next through the properties in the current filter.
   app.js renders the card as before; wbPropLayout() regroups it into sections and arranges them per mode. */
(function () {
  const modalEl = () => document.getElementById('modal');
  const isPage = () => { const m = modalEl(); return !!(m && m.classList.contains('prop-page')); };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let list = [];      // property ids for previous / next
  let pushed = false; // we added the #property entry to history (so Back can return to where it came from)

  const KEY = (t) => {
    t = t.toLowerCase();
    if (/unit mix/.test(t)) return 'mix';
    if (/lease-up/.test(t)) return 'leaseup';
    if (/ownership/.test(t)) return 'owner';
    if (/realpage/.test(t)) return 'realpage';
    if (/trend|quarter/.test(t)) return 'trends';
    if (/history/.test(t)) return 'history';
    if (/location/.test(t)) return 'map';
    if (/sale/.test(t)) return 'sales';
    if (/website/.test(t)) return 'website';
    return 'other';
  };

  // group the card's flat list of blocks into <section data-sec=…> by heading
  function sections(body) {
    const kids = [...body.children];
    const groups = []; let cur = { key: 'top', els: [] }; groups.push(cur);
    kids.forEach((el) => {
      if (el.id === 'wbw') { cur = { key: 'website', els: [el] }; groups.push(cur); cur = { key: 'after-website', els: [] }; groups.push(cur); return; }
      if (el.classList && el.classList.contains('detail-section-title')) { cur = { key: KEY(el.textContent || ''), els: [] }; groups.push(cur); }
      cur.els.push(el);
    });
    return groups.filter((g) => g.els.length).map((g) => {
      const s = document.createElement('section'); s.className = 'pc-sec'; s.dataset.sec = g.key;
      g.els.forEach((el) => s.appendChild(el)); return s;
    });
  }

  window.wbPropLayout = function (p) {
    const content = document.getElementById('modal-content'); if (!content) return;
    const body = content.querySelector('.modal-body'); if (!body) return;
    const editing = body.classList.contains('editing');
    const page = isPage();
    // design hooks (propcard.css): header, body and the container; cleared when another popup reuses the box
    const head = content.querySelector('.modal-header'); if (head) head.classList.add('pcx-head');
    if (!editing) body.classList.add('pcx-body');
    content.classList.add('pcx');
    if (!content.__pcxObs) {
      content.__pcxObs = new MutationObserver(() => { if (!content.querySelector('.pcx-head')) content.classList.remove('pcx', 'pc-page', 'pc-summary'); });
      content.__pcxObs.observe(content, { childList: true });
    }
    content.classList.toggle('pc-page', page);
    content.classList.toggle('pc-summary', !page && !editing);
    const pid = String(p.id);

    // header buttons: summary gets "Open full page"; the page gets Back instead of Close
    const acts = content.querySelector('.modal-actions');
    if (acts && !editing) {
      const close = acts.querySelector('.modal-close');
      if (page) {
        if (close) { close.textContent = '← Back'; close.classList.add('pc-back'); close.setAttribute('onclick', 'wbPropBack()'); }
      } else if (close) {
        const b = document.createElement('button'); b.className = 'modal-btn pc-open'; b.type = 'button';
        b.textContent = 'Full page ↗'; b.onclick = () => window.openPropertyPage(pid);
        acts.insertBefore(b, close);
      }
    }
    if (editing && !page) return;   // the edit form stays one column in the modal

    const secs = sections(body);
    body.innerHTML = '';
    if (!page) {
      // quick summary: the top figures, unit mix and lease-up; everything else is on the full page
      const keep = new Set(['top', 'mix', 'leaseup']);
      secs.forEach((s) => { if (!keep.has(s.dataset.sec)) s.classList.add('pc-hide'); body.appendChild(s); });
      const more = document.createElement('div'); more.className = 'pc-more';
      more.innerHTML = `<button type="button" class="pc-more-btn">Open the full property page <span>Ownership, RealPage forecast, website, history and map →</span></button>`;
      more.querySelector('button').onclick = () => window.openPropertyPage(pid);
      body.appendChild(more);
      return;
    }
    if (editing) { secs.forEach((s) => body.appendChild(s)); return; }
    // full page: figures across the top, then two columns
    const LEFT = ['mix', 'leaseup', 'realpage', 'trends', 'other'];
    const RIGHT = ['map', 'owner', 'website', 'after-website', 'history', 'sales'];
    const grid = document.createElement('div'); grid.className = 'pc-grid';
    const L = document.createElement('div'); L.className = 'pc-col pc-left';
    const R = document.createElement('div'); R.className = 'pc-col pc-right';
    secs.forEach((s) => {
      const k = s.dataset.sec;
      if (k === 'top') body.appendChild(s);
      else if (RIGHT.includes(k)) R.appendChild(s);
      else if (LEFT.includes(k)) L.appendChild(s);
      else L.appendChild(s);
    });
    // right column order: map, ownership, website, history, sales
    RIGHT.forEach((k) => { const s = R.querySelector(`[data-sec="${k}"]`); if (s) R.appendChild(s); });
    grid.appendChild(L); grid.appendChild(R); body.appendChild(grid);

    // previous / next through the current filter
    const i = list.indexOf(pid);
    const bar = document.createElement('div'); bar.className = 'pc-bar';
    bar.innerHTML = `<button type="button" class="pc-nav" data-go="-1" ${i > 0 ? '' : 'disabled'}>‹ Previous</button>
      <span class="pc-pos">${i >= 0 && list.length > 1 ? `${(i + 1).toLocaleString('en-US')} of ${list.length.toLocaleString('en-US')} in the current filter` : ''}</span>
      <button type="button" class="pc-nav" data-go="1" ${i >= 0 && i < list.length - 1 ? '' : 'disabled'}>Next ›</button>`;
    bar.querySelectorAll('.pc-nav').forEach((b) => { b.onclick = () => { const j = i + +b.dataset.go; if (list[j]) go(list[j], true); }; });
    content.insertBefore(bar, content.firstChild);
  };

  function currentList(pid) {
    try { const ids = (typeof getFiltered === 'function' ? getFiltered() : []).map((x) => String(x.id)); if (ids.includes(String(pid))) return ids; } catch (e) { /* fall through */ }
    return [String(pid)];
  }
  function go(pid, replace) {
    const h = '#property/' + encodeURIComponent(pid);
    if (replace) history.replaceState(null, '', h); else { history.pushState(null, '', h); pushed = true; }
    route();
  }
  window.openPropertyPage = function (pid) {
    list = currentList(pid);
    try { sessionStorage.setItem('wb_page_list', JSON.stringify(list)); } catch (e) { /* optional */ }
    go(String(pid), false);
  };
  window.wbPropBack = function () {
    if (pushed) { pushed = false; history.back(); return; }
    history.replaceState(null, '', location.pathname + location.search);
    route();
  };

  let tries = 0;
  function route() {
    const m = location.hash.match(/^#property\/(.+)$/);
    const modal = modalEl(); if (!modal) return;
    if (m) {
      const pid = decodeURIComponent(m[1]);
      if (typeof RAW_DATA === 'undefined' || !RAW_DATA.length || typeof openDetail !== 'function') {   // opened from a link: wait for the market's data
        if (tries++ < 60) setTimeout(route, 250); return;
      }
      if (!list.length) { try { list = JSON.parse(sessionStorage.getItem('wb_page_list') || '[]'); } catch (e) { list = []; } if (!list.includes(pid)) list = currentList(pid); }
      modal.classList.add('prop-page');
      openDetail(pid);
      modal.scrollTop = 0;
    } else if (modal.classList.contains('prop-page')) {
      modal.classList.remove('prop-page');
      origClose();
    }
  }
  // closing while on the page (Esc, a link that closes the card) leaves the page through the history too
  const origClose = window.closeModal;
  window.closeModal = function () {
    if (isPage() && /^#property\//.test(location.hash)) { window.wbPropBack(); return; }
    const m = modalEl(); if (m) m.classList.remove('prop-page');
    return origClose.apply(this, arguments);
  };
  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', route);
  if (/^#property\//.test(location.hash)) route();
})();
