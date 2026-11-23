/* Property website tracking (Nov 23): the "Website" section of the property card.
   Editors turn tracking on with the site's URL, how often and until when. A scheduled Supabase function
   (web-scrape) reads the site and saves a snapshot each run; this file only reads those snapshots.
   What a single read gives: units listed as available, asking rent by bedroom ($/SF first), the posted special.
   What needs time: leasing pace (units dropping off the list) — shown once there are 14 days of reads. */
(function () {
  const S = () => WB.sb.schema('market');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, el) => (el || document).querySelector(sel);
  const money = (v) => v == null ? '—' : '$' + Math.round(v).toLocaleString('en-US');
  const psf = (v) => v == null ? '—' : '$' + (+v).toFixed(2);
  const BEDS = { '0': 'Studio', '1': '1 Bed', '2': '2 Bed', '3': '3 Bed', '4': '4 Bed', '?': 'Unknown' };
  const PLAT = { greystar: 'Greystar site', 'unit-rows': 'property site' };
  const MIN_DAYS = 14;
  let cur = null;   // { p, uuid, track, snaps }

  const canEdit = () => { try { return window.wbCsCanEdit ? window.wbCsCanEdit() : false; } catch (e) { return false; } };
  const uuidOf = (p) => { const W = window.__WBD || {}; return (W.propByCostar && W.propByCostar[p.id]) || p.id; };
  const ago = (iso) => {
    if (!iso) return 'never';
    const h = (Date.now() - Date.parse(iso)) / 36e5;
    return h < 1 ? 'under an hour ago' : h < 24 ? Math.round(h) + ' hr ago' : Math.round(h / 24) + ' days ago';
  };
  const day = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // leasing pace: units listed on one read and gone on the next. A signal, not a fact: a unit can come off for other reasons.
  function pace(snaps) {
    const ok = snaps.filter((s) => s.ok && Array.isArray(s.units));
    if (ok.length < 2) return null;
    let off = 0, added = 0;
    for (let i = 1; i < ok.length; i++) {
      const a = new Set(ok[i - 1].units.map((u) => u.unit)), b = new Set(ok[i].units.map((u) => u.unit));
      a.forEach((u) => { if (!b.has(u)) off++; }); b.forEach((u) => { if (!a.has(u)) added++; });
    }
    const days = (Date.parse(ok[ok.length - 1].scraped_at) - Date.parse(ok[0].scraped_at)) / 864e5;
    return { off, added, days, perWeek: days > 0 ? off / days * 7 : null, reads: ok.length };
  }

  function spark(snaps) {
    const pts = snaps.filter((s) => s.ok && s.summary).map((s) => [Date.parse(s.scraped_at), s.summary.available]);
    if (pts.length < 3) return '';
    const W = 220, H = 36, x0 = pts[0][0], x1 = pts[pts.length - 1][0] || x0 + 1;
    const ys = pts.map((p) => p[1]), lo = Math.min(...ys), hi = Math.max(...ys) || 1;
    const X = (t) => (t - x0) / ((x1 - x0) || 1) * (W - 4) + 2, Y = (v) => H - 3 - (v - lo) / ((hi - lo) || 1) * (H - 6);
    return `<svg class="wbw-spark" viewBox="0 0 ${W} ${H}" aria-label="Units listed over time"><polyline points="${pts.map((p) => X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(' ')}" fill="none" stroke="#432890" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  }

  function paint() {
    const host = $('#wbw'); if (!host || !cur) return;
    const { p, track, snaps } = cur;
    if (!track) {
      host.innerHTML = canEdit() ? `<div class="detail-section-title">Website</div>
        <div class="wbw-off"><p>Read this property’s website on a schedule: units listed, asking rent by unit type and the posted special, next to CoStar’s figures.</p>
        <button type="button" class="wbw-btn" data-act="setup">Track website…</button></div>` : '';
      return;
    }
    const last = [...snaps].reverse().find((s) => s.ok);
    const lastAny = snaps[snaps.length - 1];
    const status = !track.enabled ? `Paused${track.last_error && /^Stopped/.test(track.last_error) ? ' · ' + esc(track.last_error) : ''}`
      : `${track.frequency === 'weekly' ? 'Weekly' : 'Daily'}${track.until ? ' until ' + day(track.until + 'T12:00:00') : ' until ' + (track.stop_at_occ || 95) + '% occupied'}`;
    const menu = canEdit() ? `<span class="wbw-acts">
        <button type="button" data-act="run" title="Read the site now (at most every 10 minutes)">Read now</button>
        <button type="button" data-act="toggle">${track.enabled ? 'Pause' : 'Resume'}</button>
        <button type="button" data-act="setup">Settings</button></span>` : '';
    let body = '';
    if (!last) {
      body = `<p class="wbw-note">${lastAny && lastAny.error ? 'Couldn’t read the site: ' + esc(lastAny.error) : 'Waiting for the first read. It runs within a minute of turning tracking on, then every morning.'}</p>`;
    } else {
      const s = last.summary || {}, units = +p.units || null;
      const days = (Date.now() - Date.parse(snaps.find((x) => x.ok).scraped_at)) / 864e5;
      const pc = pace(snaps);
      const vsC = (a, b) => a != null && b ? `${a >= b ? '+' : '−'}${Math.abs((a / b - 1) * 100).toFixed(1)}% vs CoStar` : 'CoStar has no figure';
      const wkC = p.concessions == null ? null : p.concessions / 100 * 52;
      const g = (k, v, unit, sub) => `<div class="pcg-c"><div class="pcg-k">${k}</div><div class="pcg-v">${v}${unit ? `<i>${unit}</i>` : ''}</div><div class="pcg-s">${sub || '&nbsp;'}</div></div>`;
      const paceCell = pc && pc.days >= MIN_DAYS
        ? g('Leasing pace', pc.perWeek.toFixed(1), ' /wk', `units off the list · ${Math.round(pc.days)} days`)
        : g('Leasing pace', 'Building', '', `day ${Math.max(1, Math.round(days) + 1)} of ${MIN_DAYS} · needs two weeks of reads`);
      const rows = Object.keys(s.byBeds || {}).sort().map((k) => { const b = s.byBeds[k];
        return `<tr><td>${BEDS[k] || k + ' Bed'}</td><td class="num">${b.n}</td><td class="num">${b.sf ? Math.round(b.sf).toLocaleString('en-US') : '—'}</td><td class="num"><b>${psf(b.psf)}</b></td><td class="num">${money(b.rent)}</td><td class="num">${money(b.min)}</td></tr>`; }).join('');
      body = `<div class="pcg pcg4">
          ${g('Listed available', s.available, units ? ` of ${units.toLocaleString('en-US')}` : '', units ? `${(s.available / units * 100).toFixed(0)}% of units` : '')}
          ${g('Asking', psf(s.psf), '/SF', `${money(s.rent)}/mo · ${vsC(s.psf, p.avgAskingSF)}`)}
          ${g('Special', last.weeks_free != null ? (+last.weeks_free).toFixed(1).replace(/\.0$/, '') : (last.specials ? 'Listed' : 'None'), last.weeks_free != null ? ' wks' : '', wkC != null ? `CoStar shows ${wkC.toFixed(1)} wks` : 'CoStar has no figure')}
          ${paceCell}
        </div>
        ${last.specials ? `<p class="wbw-special">“${esc(last.specials)}”</p>` : ''}
        <table class="unit-mix-table wbw-tbl"><thead><tr><th style="text-align:left">Type</th><th class="num">Listed</th><th class="num">Avg SF</th><th class="num">Asking / SF</th><th class="num">Asking / Mo</th><th class="num">From</th></tr></thead><tbody>${rows}</tbody></table>
        ${spark(snaps) ? `<div class="wbw-trend">${spark(snaps)}<span>Units listed, ${day(snaps.find((x) => x.ok).scraped_at)} to today${pc ? ` · ${pc.off} came off, ${pc.added} added` : ''}</span></div>` : ''}
        <p class="wbw-note">Asking rents are what the site quotes today for available units only, not the whole building. ${pc && pc.days >= MIN_DAYS ? 'Pace counts units that came off the list; some come off for reasons other than a lease, so read it next to CoStar’s occupancy.' : ''}</p>`;
    }
    host.innerHTML = `<div class="detail-section-title wbw-h">Website <span class="wbw-src">${esc(PLAT[track.platform] || 'website')} · ${status} · last read ${ago(track.last_ok_at)}${track.last_error && track.enabled ? ' · <span class="wbw-err">last try failed</span>' : ''}</span>${menu}</div>
      ${body}
      <p class="wbw-url"><a href="${esc(track.url)}" target="_blank" rel="noopener">${esc(track.url.replace(/^https:\/\//, ''))}</a></p>`;
  }

  function setup() {
    const host = $('#wbw'); if (!host || !cur) return;
    const t = cur.track || {};
    host.innerHTML = `<div class="detail-section-title">Website</div>
      <div class="wbw-form">
        <label class="wbw-f wide"><span>Website page that lists available units</span><input class="edit-input" id="wbw-url" type="url" placeholder="https://…" value="${esc(t.url || '')}"></label>
        <label class="wbw-f"><span>How often</span><select class="edit-input" id="wbw-freq"><option value="daily"${t.frequency !== 'weekly' ? ' selected' : ''}>Daily</option><option value="weekly"${t.frequency === 'weekly' ? ' selected' : ''}>Weekly</option></select></label>
        <label class="wbw-f"><span>Stop on <em>(optional)</em></span><input class="edit-input" id="wbw-until" type="date" value="${esc(t.until || '')}"></label>
        <label class="wbw-f"><span>Or once occupancy reaches</span><input class="edit-input" id="wbw-stop" type="number" min="50" max="100" step="1" value="${t.stop_at_occ != null ? t.stop_at_occ : 95}"></label>
        <p class="wbw-hint">Works today with Greystar property pages and sites that list units on an availability page (like Shorehaven’s). Use the page that shows unit numbers and prices.</p>
        <div class="wbw-formacts"><button type="button" class="wbw-btn" data-act="save">${cur.track ? 'Save' : 'Start tracking'}</button><button type="button" class="wbw-link" data-act="cancel">Cancel</button>
        ${cur.track ? '<button type="button" class="wbw-link wbw-danger" data-act="delete">Stop tracking and delete its readings</button>' : ''}<span class="wbw-msg" id="wbw-msg"></span></div>
      </div>`;
  }

  async function runNow() {
    if (!cur || !cur.track) return;
    try {
      const { data: s } = await WB.sb.auth.getSession();
      const r = await fetch(WB.SB_URL + '/functions/v1/web-scrape', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (s && s.session ? s.session.access_token : '') }, body: JSON.stringify({ track_id: cur.track.id }) });
      const j = await r.json().catch(() => ({}));
      if (j.skipped) WB.toast && WB.toast('Read in the last 10 minutes already');
    } catch (e) { /* the scheduled run will pick it up */ }
    await load(cur.p, true);
  }

  async function act(a) {
    if (!cur) return;
    if (a === 'setup') return setup();
    if (a === 'cancel') return paint();
    if (a === 'run') { const h = $('#wbw .wbw-acts'); if (h) h.innerHTML = '<span class="wbw-src">Reading…</span>'; return runNow(); }
    if (a === 'toggle') {
      const { error } = await S().from('web_tracks').update({ enabled: !cur.track.enabled, last_error: null }).eq('id', cur.track.id);
      if (error) return alert('Couldn’t change it: ' + error.message);
      return load(cur.p, true);
    }
    if (a === 'delete') {
      if (!confirm('Stop tracking this website and delete all of its readings?')) return;
      const { error } = await S().from('web_tracks').delete().eq('id', cur.track.id);
      if (error) return alert('Couldn’t delete: ' + error.message);
      cur.track = null; cur.snaps = []; return paint();
    }
    if (a === 'save') {
      const msg = $('#wbw-msg'), url = ($('#wbw-url').value || '').trim();
      if (!/^https:\/\/[^\s]+\.[^\s]+/.test(url)) { msg.textContent = 'Paste the full https:// address'; return; }
      const row = { property_id: cur.uuid, market_id: (window.__WBD || {}).market, url, frequency: $('#wbw-freq').value, until: $('#wbw-until').value || null, stop_at_occ: +$('#wbw-stop').value || 95, enabled: true };
      msg.textContent = 'Saving…';
      const q = cur.track ? S().from('web_tracks').update(row).eq('id', cur.track.id).select('*') : S().from('web_tracks').insert(row).select('*');
      const { data, error } = await q;
      if (error || !data || !data.length) { msg.textContent = 'Couldn’t save: ' + ((error && error.message) || 'no edit access in this market'); return; }
      const fresh = !cur.track || cur.track.url !== url;
      cur.track = data[0]; paint();
      if (fresh) { const h = $('#wbw .wbw-acts'); if (h) h.innerHTML = '<span class="wbw-src">Reading the site…</span>'; await runNow(); }
    }
  }

  async function load(p, force) {
    const uuid = uuidOf(p);
    if (!force && cur && cur.uuid === uuid) { paint(); return; }
    cur = { p, uuid, track: null, snaps: [] };
    const { data: t } = await S().from('web_tracks').select('*').eq('property_id', uuid).maybeSingle();
    if (!cur || cur.uuid !== uuid) return;
    cur.track = t || null;
    if (t) {
      const { data: s } = await S().from('web_snapshots').select('scraped_at,ok,error,summary,specials,weeks_free,units').eq('track_id', t.id).order('scraped_at').limit(400);
      if (!cur || cur.uuid !== uuid) return;
      cur.snaps = s || [];
    }
    cur.p = p; paint();
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('#wbw [data-act]'); if (!b) return;
    e.preventDefault(); act(b.dataset.act);
  });
  window.wbWebFill = (p) => { load(p).catch((e) => console.warn('[website]', e)); };
})();
