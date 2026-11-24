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


  // ---------- CoStar's own layout (Nov 24, from real pastes) ----------
  // Copied CoStar pages put one value per line. The top strip has the value ABOVE its label ("215" / "Units",
  // "2026" / "Built"); the Building section has the label above the value ("Avg Unit Size" / "845 SF");
  // tables come through one cell per line. Both the property overview and the Unit Mix tab are read.
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const isNum = (l) => /^\$?-?[\d,]+(?:\.\d+)?%?$/.test(l) || /^[\d,]+(?:\.\d+)?\s*SF$/i.test(l);
  function readCoStar(txt) {
    const L = txt.split(/\r?\n/).map((l) => l.replace(/ /g, ' ').trim()).filter((l) => l && l !== '*');
    const eq = (a, b) => a.toLowerCase() === b.toLowerCase();
    const before = (label, re) => { for (let i = 1; i < L.length; i++) if (eq(L[i], label) && re.test(L[i - 1])) return L[i - 1]; return null; };
    const after = (label, re) => { for (let i = 0; i < L.length - 1; i++) if (eq(L[i], label) && re.test(L[i + 1])) return L[i + 1]; return null; };
    const tabbed = (label) => { const l = L.find((x) => new RegExp('^' + label + '\\t', 'i').test(x)); return l ? l.split('\t').slice(1).join(' ').trim() : null; };
    const f = {};
    f.units = num(before('Units', /^[\d,]{1,6}$/)) ?? num(after('Units', /^[\d,]{1,6}$/));
    const vac = num(before('Vacancy', /^[\d.]+%$/));
    if (vac != null) f.occ = +(100 - vac).toFixed(1);
    f.askU = num(before('Asking Rent/Unit', /^\$[\d,]+/));
    f.askSF = num(before('Asking Rent/SF', /^\$\d+\.\d+/));
    f.sf = num(after('Avg Unit Size', /^[\d,]+\s*SF$/i));
    f.stories = num(after('Stories', /^\d{1,3}$/));
    const yb = tabbed('Year Built') || after('Year Built', /(19|20)\d\d/);
    if (yb) { const m = yb.match(/([A-Za-z]{3})[a-z]*\s+((?:19|20)\d\d)/); if (m && MON[m[1].toLowerCase()]) { f.month = MON[m[1].toLowerCase()]; f.year = +m[2]; } else { const y = yb.match(/(?:19|20)\d\d/); if (y) f.year = +y[0]; } }
    if (f.year == null) f.year = num(before('Built', /^(?:19|20)\d\d$/));

    // unit mix: the table's column labels start at "Beds" and run to the first figure; rows follow until "Totals"
    const mix = {}; let conc = null;
    const start = L.findIndex((l) => eq(l, 'Unit Mix'));
    if (start >= 0) {
      let i = start + 1; while (i < L.length && !isNum(L[i])) i++;
      const head = L.slice(start + 1, i);
      const b = head.map((h) => h.toLowerCase()).lastIndexOf('beds');
      const cols = b >= 0 ? head.slice(b).map((h) => h.toLowerCase()) : [];
      const N = cols.length;
      const nth = (name, k) => { let n = 0; for (let j = 0; j < N; j++) if (cols[j] === name && n++ === k) return j; return -1; };
      const ci = {
        beds: cols.indexOf('beds'),
        units: nth('units', 0),
        sf: cols.indexOf('avg sf'),
        rent: cols.indexOf('asking rent/unit') >= 0 ? cols.indexOf('asking rent/unit') : nth('per unit', 0),
        conc: cols.indexOf('concessions') >= 0 ? cols.indexOf('concessions') : cols.lastIndexOf('%'),
      };
      if (N >= 4 && ci.beds >= 0 && ci.units >= 0) {
        const acc = {}; let cu = 0, cw = 0;
        while (i + N <= L.length && !/^totals$/i.test(L[i])) {
          const row = L.slice(i, i + N);
          if (!/^(?:\d|studio)/i.test(row[ci.beds])) break;
          const bedsRaw = row[ci.beds].toLowerCase(), beds = /studio/.test(bedsRaw) ? 0 : parseInt(bedsRaw, 10);
          const key = ['Studio', '1 Bed', '2 Bed', '3 Bed'][beds];
          const u = num(row[ci.units]) || 0, sf = ci.sf >= 0 ? num(row[ci.sf]) : null, rent = ci.rent >= 0 ? num(row[ci.rent]) : null, c = ci.conc >= 0 ? num(row[ci.conc]) : null;
          if (key && u) {
            const a = acc[key] || (acc[key] = { u: 0, sfw: 0, su: 0, rw: 0, ru: 0 });
            a.u += u; if (sf) { a.sfw += sf * u; a.su += u; } if (rent) { a.rw += rent * u; a.ru += u; }
          }
          if (c != null && u) { cu += u; cw += c * u; }
          i += N;
        }
        Object.entries(acc).forEach(([k, a]) => { mix[k] = { u: a.u, sf: a.su ? Math.round(a.sfw / a.su) : null, rent: a.ru ? Math.round(a.rw / a.ru) : null }; });
        if (cu) conc = +(cw / cu).toFixed(1);
      }
    }
    // CoStar's own Totals row has the property's concessions %; use it over my unit-weighted average
    for (let j = L.length - 2; j >= 0; j--) {
      if (!/^totals$/i.test(L[j]) || !isNum(L[j + 1])) continue;
      let k = j + 1; while (k < L.length && isNum(L[k])) k++;
      const last = L[k - 1]; if (/%$/.test(last)) conc = num(last);
      break;
    }
    if (conc != null) f.conc = conc;
    return { sum: f, mix };
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
    if (sum.month) note('Month delivered', setInput(root.querySelector('select[data-field="monthBuilt"]'), sum.month));
    const mixKeys = Object.keys(mix);
    // CoStar's unit mix replaces the whole table: unit types it doesn't list are cleared
    if (mixKeys.length) ['Studio', '1 Bed', '2 Bed', '3 Bed'].filter((k) => !mixKeys.includes(k)).forEach((k) => {
      let ch = false;
      ['u', 'sf', 'rent'].forEach((f) => { const el = root.querySelector(`[data-mix="${k}"][data-k="${f}"]`); if (el && el.value !== '') { el.value = ''; el.classList.add('cpx-filled'); el.dispatchEvent(new Event('input', { bubbles: true })); ch = true; } });
      if (ch) got.push(k + ' cleared');
    });
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
    if (sum.conc != null) {   // the weeks-free box falls back to CoStar's figure: point it at the pasted one so effective rent follows
      const wk = root.querySelector('[data-weeks]');
      if (wk) {
        const w = (sum.conc / 100 * 52).toFixed(1);
        wk.placeholder = w;
        const hint = wk.parentElement && wk.parentElement.querySelector('.edit-hint');
        if (hint) hint.textContent = `Blank uses CoStar’s ${w} wks`;
        wk.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    return { got, same };
  }

  function paint(host, state) {
    const { p } = state;
    if (!state.res) {
      host.innerHTML = `<div class="cpx">
        <div class="cpx-h"><b>Update from CoStar</b><span>On the property’s CoStar page press <kbd>Ctrl</kbd>+<kbd>A</kbd>, then <kbd>Ctrl</kbd>+<kbd>C</kbd>, and paste below. Do the overview page and the Unit Mix tab, one after the other. Read here in your browser; nothing is saved until you press Save.</span></div>
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
    if (sum.year != null) found.push(['Delivered', (sum.month ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][sum.month - 1] + ' ' : '') + sum.year]);
    const mk = Object.keys(mix);
    const miss = ['Units', 'Occupancy', 'Asking'].filter((k) => !found.some((f) => f[0] === k)).concat(mk.length ? [] : ['Unit mix']);
    host.innerHTML = `<div class="cpx cpx-done">
      <div class="cpx-h"><b>Filled from CoStar</b><button type="button" class="cpx-again">Paste more</button><span>${out.got.length ? `Changed: ${out.got.map(esc).join(', ')}. Highlighted below. Check them, then Save.` : 'Everything matched what’s already here; nothing changed.'}</span></div>
      <div class="cpx-found">${found.map(([k, v]) => `<span><em>${esc(k)}</em>${esc(v)}</span>`).join('')}${mk.length ? `<span><em>Unit mix</em>${mk.map((k) => `${esc(k)}: ${mix[k].u != null ? mix[k].u.toLocaleString('en-US') : '—'} units · ${mix[k].sf != null ? mix[k].sf.toLocaleString('en-US') : '—'} SF · ${money(mix[k].rent)}`).join(' · ')}</span>` : ''}</div>
      ${miss.length ? `<div class="cpx-miss">Not found yet: ${miss.map(esc).join(', ')}. ${miss.includes('Unit mix') ? 'Open the property’s Unit Mix tab in CoStar, copy the page and press Paste more.' : 'Paste the property’s overview page too.'}</div>` : ''}
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
      const cs = readCoStar(txt), gen = readSummary(txt);
      const sum = { ...gen, ...Object.fromEntries(Object.entries(cs.sum).filter(([, v]) => v != null)) };
      if (cs.sum.units == null && gen.units != null && gen.year != null && gen.units === gen.year) sum.units = null;   // never take the year for the unit count
      const mix = Object.keys(cs.mix).length ? cs.mix : readMix(txt);
      const prev = state.res || { sum: {}, mix: {}, out: { got: [], same: [] } };
      const keep = Object.fromEntries(Object.entries(sum).filter(([, v]) => v != null));
      const allSum = { ...prev.sum, ...keep }, allMix = { ...prev.mix, ...mix };
      const out = apply(p, keep, mix);
      state.res = { sum: allSum, mix: allMix, out: { got: [...new Set([...prev.out.got, ...out.got])], same: out.same }, n: (prev.n || 0) + 1 };
      paint(host, state);
    });
    host.addEventListener('click', (e) => {
      if (!e.target.closest('.cpx-again')) return;
      const keep = state.res; state.res = null; paint(host, state); state.res = keep;   // show the box again; the next paste adds to what's filled
      const t = $('.cpx-in', host); if (t) t.focus();
    });
  };
  window.__wbCostarParse = (txt) => readCoStar(txt);   // for testing
})();
