/* Paste-to-update from CoStar (Nov 23). In a property card's edit mode: select all on the CoStar property page,
   copy, paste here. The text is read locally in the browser (nothing is sent anywhere, no AI): it finds CoStar's
   labels (units, vacancy, rents, concessions, unit mix…), fills the edit form and highlights what changed.
   Nothing is saved until Save is pressed, so every figure can be checked first. */
(function () {
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = (s) => { if (s == null) return null; const v = parseFloat(String(s).replace(/[$,\s]/g, '')); return isNaN(v) ? null : v; };
  const money = (v) => v == null ? '—' : '$' + Math.round(v).toLocaleString('en-US');

  // ---------- reading the pasted text ----------
  // label, then anything that isn't a digit/$ for a short stretch (colon, tab, line break, "Per Unit"), then the value
  const after = (txt, label, value, gap = 40) => {
    const re = new RegExp(label + '[^\\d$\\n]{0,' + gap + '}?(?:\\n[^\\d$\\n]{0,' + gap + '}?)?' + value, 'i');
    const m = txt.match(re); return m ? m[1] : null;
  };
  function readSummary(txt) {
    const f = {};
    f.units = num(after(txt, '(?:No\\.?\\s*(?:of\\s*)?Units|Number of Units|Total Units|# of Units)', '([\\d,]{1,6})\\b'))
      ?? num(after(txt, '\\bUnits\\b', '([\\d,]{2,6})\\b(?!\\s*(?:SF|%|\\/))', 6));
    const vac = num(after(txt, '\\bVacancy(?:\\s*Rate)?\\b', '([\\d.]+)\\s*%'));
    const occ = num(after(txt, '\\b(?:Occupancy|Occupied|Leased)(?:\\s*Rate)?\\b', '([\\d.]+)\\s*%'));
    f.occ = vac != null ? +(100 - vac).toFixed(1) : occ;
    f.askU = num(after(txt, '\\bAsking\\s*Rents?(?:\\s*Per\\s*Unit|\\s*\\/\\s*Unit)?', '\\$\\s*([\\d,]{3,6}(?:\\.\\d+)?)'));
    f.askSF = num(after(txt, '\\bAsking\\s*Rents?\\s*(?:Per|\\/)\\s*(?:SF|Sq\\.?\\s*Ft\\.?)', '\\$\\s*(\\d{1,2}\\.\\d{1,2})'));
    if (f.askSF == null) { const m = txt.match(/Asking[\s\S]{0,80}?\$\s*(\d{1,2}\.\d{2})\s*(?:\/|per)\s*SF/i); if (m) f.askSF = num(m[1]); }
    f.effU = num(after(txt, '\\bEffective\\s*Rents?(?:\\s*Per\\s*Unit|\\s*\\/\\s*Unit)?', '\\$\\s*([\\d,]{3,6}(?:\\.\\d+)?)'));
    f.effSF = num(after(txt, '\\bEffective\\s*Rents?\\s*(?:Per|\\/)\\s*(?:SF|Sq\\.?\\s*Ft\\.?)', '\\$\\s*(\\d{1,2}\\.\\d{1,2})'));
    f.conc = num(after(txt, '\\bConcessions?\\b', '([\\d.]+)\\s*%'));
    f.sf = num(after(txt, '\\bAvg\\.?\\s*(?:Unit\\s*)?(?:Size|SF)\\b', '([\\d,]{3,5})\\b'));
    f.year = num(after(txt, '\\b(?:Year\\s*Built|Built|Delivered|Year\\s*Delivered)\\b', '((?:19|20)\\d{2})\\b', 14));
    f.stories = num(after(txt, '\\b(?:Stories|Floors)\\b', '(\\d{1,3})\\b', 6));
    // sanity: drop values that can't be right rather than fill them in
    if (f.units != null && (f.units < 2 || f.units > 5000)) f.units = null;
    if (f.occ != null && (f.occ < 0 || f.occ > 100)) f.occ = null;
    if (f.askSF != null && (f.askSF < 0.3 || f.askSF > 15)) f.askSF = null;
    if (f.askU != null && (f.askU < 300 || f.askU > 30000)) f.askU = null;
    if (f.sf != null && (f.sf < 250 || f.sf > 4000)) f.sf = null;
    if (f.stories != null && (f.stories < 1 || f.stories > 120)) f.stories = null;
    if (f.conc != null && f.conc > 60) f.conc = null;
    return f;
  }
  // unit mix: one row per unit type (or CoStar's "All 1 Beds" subtotal rows when present)
  const TYPE = [
    ['Studio', /^(?:all\s+)?(?:studios?|efficienc(?:y|ies)|0\s*(?:bed(?:room)?s?|br)\b)/i],
    ['1 Bed', /^(?:all\s+)?(?:1|one)\s*(?:bed(?:room)?s?|br)\b/i],
    ['2 Bed', /^(?:all\s+)?(?:2|two)\s*(?:bed(?:room)?s?|br)\b/i],
    ['3 Bed', /^(?:all\s+)?(?:3|three)\s*(?:bed(?:room)?s?|br)\b/i],
  ];
  function readMix(txt) {
    const lines = txt.split('\n').map((l) => l.replace(/ /g, ' ').trim()).filter(Boolean);
    // which comes first in the table header: the size column or the unit count (CoStar: Avg SF, then Units)
    let sfFirst = true;
    const hdr = lines.find((l) => /\bunits\b/i.test(l) && /\b(?:avg\.?\s*)?sf\b|\bsq\.?\s*ft/i.test(l) && !/\$/.test(l));
    if (hdr) { const iu = hdr.search(/\bunits\b/i), is = hdr.search(/\b(?:avg\.?\s*)?sf\b|\bsq\.?\s*ft/i); sfFirst = is < iu; }
    const rows = {};
    const hasAll = lines.some((l) => /^all\s+/i.test(l));
    lines.forEach((l) => {
      const t = TYPE.find(([, re]) => re.test(l)); if (!t) return;
      if (hasAll && !/^all\s+/i.test(l)) return;   // CoStar lists bath splits; use its per-type subtotal rows
      const rest = l.replace(t[1], '');
      const toks = rest.split(/\t+|\s{2,}|\s(?=[$\d])/).map((x) => x.trim()).filter(Boolean);
      const ints = [], monies = [];
      let sfTok = null;
      toks.forEach((x, i) => {
        if (/%$/.test(x)) return;
        if (/^\$/.test(x)) { const v = num(x); if (v != null) monies.push(v); return; }
        if (/^[\d,]+(?:\.\d+)?$/.test(x)) {
          const v = num(x), nx = toks[i + 1] || '';
          if (/^sf$|^sq/i.test(nx) || /sf$/i.test(x)) { sfTok = v; return; }
          ints.push(v);
        } else if (/^[\d,]+\s*sf$/i.test(x)) sfTok = num(x);
      });
      const big = ints.filter((v) => v >= 1);
      let sf = sfTok, units = null;
      if (sf == null) { const i = sfFirst ? big.findIndex((v) => v >= 250 && v <= 4000) : 1; sf = i >= 0 ? big[i] : null; units = sfFirst ? big[i + 1] ?? null : big[0] ?? null; }
      else units = big[0] ?? null;
      const rent = monies.find((v) => v >= 300) ?? null;
      const r = rows[t[0]] || (rows[t[0]] = { u: 0, sfw: 0, su: 0, rw: 0, ru: 0 });
      const n = units || 0;
      r.u += n;
      if (sf && n) { r.sfw += sf * n; r.su += n; }
      if (rent && n) { r.rw += rent * n; r.ru += n; }
      if (!n) { r.sf0 = sf; r.rent0 = rent; }
    });
    const out = {};
    Object.entries(rows).forEach(([k, r]) => {
      out[k] = { u: r.u || null, sf: r.su ? Math.round(r.sfw / r.su) : (r.sf0 || null), rent: r.ru ? Math.round(r.rw / r.ru) : (r.rent0 || null) };
      if (!out[k].u && !out[k].sf && !out[k].rent) delete out[k];
    });
    return out;
  }

  // ---------- filling the edit form ----------
  function setInput(el, v) {
    if (!el || v == null) return false;
    const before = el.value;
    const next = String(v);
    if (before !== '' && +before === +next) return false;
    el.value = next; el.classList.add('cpx-filled'); el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  function hidden(field, v) {   // a figure with no box in the form (CoStar's concessions %): carried as a hidden field for Save
    const root = $('#modal-content'); let el = root.querySelector(`input[type=hidden][data-field="${field}"]`);
    if (!el) { el = document.createElement('input'); el.type = 'hidden'; el.className = 'edit-input'; el.dataset.field = field; el.dataset.type = 'number'; root.querySelector('.modal-body').appendChild(el); }
    el.value = String(v); return true;
  }
  function apply(p, sum, mix) {
    const root = $('#modal-content'); const got = [], same = [];
    const note = (label, changed) => (changed ? got : same).push(label);
    note('Units', setInput(root.querySelector('[data-field="units"]'), sum.units));
    note('Occupancy', setInput(root.querySelector('[data-field="vacancy"][data-invert]'), sum.occ));
    note('Stories', setInput(root.querySelector('[data-field="stories"]'), sum.stories));
    note('Year delivered', setInput(root.querySelector('[data-field="yearBuilt"]'), sum.year));
    const mixKeys = Object.keys(mix);
    mixKeys.forEach((k) => {
      const m = mix[k]; let ch = false;
      ch = setInput(root.querySelector(`[data-mix="${k}"][data-k="u"]`), m.u) || ch;
      ch = setInput(root.querySelector(`[data-mix="${k}"][data-k="sf"]`), m.sf) || ch;
      ch = setInput(root.querySelector(`[data-mix="${k}"][data-k="rent"]`), m.rent) || ch;
      note(k + ' mix', ch);
    });
    // no unit mix found: CoStar's summary rents and size go straight in (with a mix, they're calculated from it)
    if (!mixKeys.length) {
      if (sum.askU != null) note('Asking / month', hidden('avgAskingUnit', sum.askU) && sum.askU !== p.avgAskingUnit);
      if (sum.askSF != null) note('Asking / SF', hidden('avgAskingSF', sum.askSF) && sum.askSF !== p.avgAskingSF);
      if (sum.sf != null) note('Avg unit size', hidden('avgUnitSF', sum.sf) && sum.sf !== p.avgUnitSF);
    }
    if (sum.conc != null && sum.conc !== p.concessions) { hidden('concessions', sum.conc); note('CoStar concessions', true); }
    return { got, same };
  }

  function paint(host, state) {
    const { p } = state;
    if (!state.res) {
      host.innerHTML = `<div class="cpx">
        <div class="cpx-h"><b>Update from CoStar</b><span>On the property’s CoStar page press <kbd>Ctrl</kbd>+<kbd>A</kbd>, then <kbd>Ctrl</kbd>+<kbd>C</kbd>, and paste below. Read here in your browser; nothing is saved until you press Save.</span></div>
        <textarea class="cpx-in" rows="2" placeholder="Paste the CoStar page here (Ctrl+V)"></textarea>
      </div>`;
      return;
    }
    const { sum, mix, out } = state.res;
    const found = [];
    if (sum.units != null) found.push(['Units', sum.units.toLocaleString('en-US')]);
    if (sum.occ != null) found.push(['Occupancy', sum.occ.toFixed(1) + '%']);
    if (sum.askSF != null || sum.askU != null) found.push(['Asking', (sum.askSF != null ? '$' + sum.askSF.toFixed(2) + '/SF' : '') + (sum.askU != null ? ' · ' + money(sum.askU) + '/mo' : '')]);
    if (sum.conc != null) found.push(['Concessions', sum.conc + '% (≈' + (sum.conc / 100 * 52).toFixed(1) + ' wks)']);
    if (sum.stories != null) found.push(['Stories', sum.stories]);
    if (sum.year != null) found.push(['Delivered', sum.year]);
    const mk = Object.keys(mix);
    const miss = ['Units', 'Occupancy', 'Asking'].filter((k) => !found.some((f) => f[0] === k)).concat(mk.length ? [] : ['Unit mix']);
    host.innerHTML = `<div class="cpx cpx-done">
      <div class="cpx-h"><b>Filled from CoStar</b><button type="button" class="cpx-again">Paste again</button><span>${out.got.length ? `Changed: ${out.got.map(esc).join(', ')}. Highlighted below. Check them, then Save.` : 'Everything matched what’s already here; nothing changed.'}</span></div>
      <div class="cpx-found">${found.map(([k, v]) => `<span><em>${esc(k)}</em>${esc(v)}</span>`).join('')}${mk.length ? `<span><em>Unit mix</em>${mk.map((k) => `${esc(k)}: ${mix[k].u != null ? mix[k].u.toLocaleString('en-US') : '—'} units · ${mix[k].sf != null ? mix[k].sf.toLocaleString('en-US') : '—'} SF · ${money(mix[k].rent)}`).join(' · ')}</span>` : ''}</div>
      ${miss.length ? `<div class="cpx-miss">Not found in what was pasted: ${miss.map(esc).join(', ')}. If the unit mix is missing, copy just CoStar’s Unit Mix table and paste it.</div>` : ''}
      ${sum.conc != null ? '<div class="cpx-miss">CoStar’s concessions are saved as CoStar’s figure. Your checked weeks free, if entered, still win everywhere.</div>' : ''}
    </div>`;
  }

  window.wbCostarPasteWire = function (p) {
    const host = $('#cpx'); if (!host) return;
    const state = { p, res: null };
    paint(host, state);
    host.addEventListener('paste', (e) => {
      if (!e.target.closest('.cpx-in')) return;
      const txt = (e.clipboardData || window.clipboardData).getData('text') || '';
      e.preventDefault();
      if (txt.trim().length < 20) return;
      const sum = readSummary(txt), mix = readMix(txt);
      const out = apply(p, sum, mix);
      state.res = { sum, mix, out }; paint(host, state);
    });
    host.addEventListener('click', (e) => {
      if (!e.target.closest('.cpx-again')) return;
      state.res = null; paint(host, state); const t = $('.cpx-in', host); if (t) t.focus();
    });
  };
  window.__wbCostarParse = (txt) => ({ sum: readSummary(txt), mix: readMix(txt) });   // for testing
})();
