// web-scrape: reads tracked property websites and saves a snapshot per run (market.web_snapshots).
// Runs daily from pg_cron (6:15am Mountain, with the scheduler key); the property card can also ask for one run of a single track (editors only).
// No Claude or third-party service involved: plain fetch + a reader per website platform.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const M = sb.schema('market');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

type Unit = { unit: string; plan?: string; beds?: number | null; sf?: number | null; rent?: number | null; available?: string | null };

async function get(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only web addresses (http/https) can be read');
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 25000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' }, redirect: 'follow', signal: ac.signal });
    if (!r.ok) throw new Error(`The website answered ${r.status}${r.status === 403 ? ' (it blocks automated visits)' : ''}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

// ---- readers -------------------------------------------------------------------------------------
// Greystar (greystar.com property pages): units sit in the page's embedded data; bedrooms come from the floor plan list.
function readGreystar(html: string): Unit[] {
  const s = html.replace(/\\+"/g, '"');
  const beds: Record<string, number> = {};
  for (const m of s.matchAll(/"identifier":"(\d+)","name":"([^"]*)","numberOfBedrooms":(\d+)/g)) beds[m[1]] = +m[3];
  const out: Record<string, Unit> = {};
  const re = /"area":(\d+(?:\.\d+)?),"availableOn":"([^"]*)","floorPlanId":"(\d+)","floorPlanLabel":"([^"]*)"((?:(?!"area":)[\s\S]){0,600}?)"unitNumber":"([^"]+)"/g;
  for (const m of s.matchAll(re)) {
    const mid = m[5];
    const price = (mid.match(/"minPrice":(\d+(?:\.\d+)?)/) || [])[1];
    const uid = (mid.match(/"unitId":"(\d+)"/) || [])[1] || m[6];
    out[uid] = { unit: m[6], plan: m[4], beds: beds[m[3]] ?? null, sf: +m[1] || null, rent: price && +price > 0 ? +price : null, available: m[2] || null };
  }
  return Object.values(out);
}
// Sites that list units as <tr class="unit" data-price=… data-sq-footage=… data-type=beds …> (Shorehaven's theme and similar)
function readUnitRows(html: string): Unit[] {
  const out: Record<string, Unit> = {};
  const re = /<tr class="unit"([^>]*)>([\s\S]*?)<\/tr>/g;
  for (const m of html.matchAll(re)) {
    const a = m[1], body = m[2];
    const at = (k: string) => (a.match(new RegExp(`data-${k}="([^"]*)"`)) || [])[1];
    if (at('availability') === 'false') continue;
    const unit = (body.match(/View unit ([^"]+)"/) || body.match(/Apply for unit ([^"]+)"/) || [])[1];
    if (!unit) continue;
    const d = at('available-date'); let iso: string | null = null;
    if (d && /^\d{2}\/\d{2}\/\d{4}$/.test(d)) { const [mm, dd, yy] = d.split('/'); iso = `${yy}-${mm}-${dd}`; }
    const plan = (body.match(/floor-plans\/([^/"]+)\//) || [])[1];
    const price = +at('price')!;   // -1 / 0 = "call for pricing"
    out[unit] = { unit, plan, beds: at('type') != null && at('type') !== '' ? +at('type')! : null, sf: +at('sq-footage')! || null, rent: price > 0 ? price : null, available: iso };
  }
  return Object.values(out);
}
function platformOf(url: string, html: string): string | null {
  if (/greystar\.com/i.test(url)) return 'greystar';
  if (/<tr class="unit"[^>]*data-price=/.test(html)) return 'unit-rows';
  return null;
}

// ---- specials: the promotion as written, and weeks free when it states a number --------------------
const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, ten: 10, twelve: 12 };
function readSpecial(html: string): { text: string | null; weeks: number | null } {
  const txt = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&bull;|&#8226;|&middot;|&#183;/g, '·').replace(/&rsquo;|&#8217;|&#039;|&#39;/g, '’').replace(/&ldquo;|&rdquo;|&#8220;|&#8221;|&quot;/g, '"').replace(/&ndash;|&#8211;|&mdash;|&#8212;/g, '–').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  const m = txt.match(/[^.!?]{0,120}\b(?:up to\s+)?(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|ten|twelve)\s+(weeks?|months?)\s+(?:of\s+)?(?:free|off)\b[^.!?]{0,80}[.!?]?/i);
  if (!m) {
    const f = txt.match(/[^.!?]{0,80}\b(?:special|promotion|look and lease|move-in special)\b[^.!?]{0,120}[.!?]?/i);
    return { text: f ? f[0].trim().slice(0, 240) : null, weeks: null };
  }
  const n = NUM[m[1].toLowerCase()] ?? +m[1];
  const weeks = /month/i.test(m[2]) ? Math.round(n * 52 / 12 * 10) / 10 : n;
  return { text: m[0].trim().slice(0, 240), weeks };
}

function summarize(units: Unit[]) {
  const byBeds: Record<string, { n: number; rent: number | null; sf: number | null; psf: number | null; min: number | null }> = {};
  const agg = (us: Unit[]) => {
    const r = us.filter((u) => u.rent), s = us.filter((u) => u.sf), b = us.filter((u) => u.rent && u.sf);
    const rent = r.length ? r.reduce((x, u) => x + u.rent!, 0) / r.length : null;
    const sf = s.length ? s.reduce((x, u) => x + u.sf!, 0) / s.length : null;
    const psf = b.length ? b.reduce((x, u) => x + u.rent!, 0) / b.reduce((x, u) => x + u.sf!, 0) : null;
    const min = r.length ? Math.min(...r.map((u) => u.rent!)) : null;
    return { n: us.length, rent, sf, psf, min };
  };
  for (const u of units) { const k = u.beds == null ? '?' : String(u.beds); (byBeds[k] ||= agg([])); }
  for (const k of Object.keys(byBeds)) byBeds[k] = agg(units.filter((u) => (u.beds == null ? '?' : String(u.beds)) === k));
  return { available: units.length, ...agg(units), byBeds };
}

async function occupancyOf(propertyId: string): Promise<number | null> {
  const { data: p } = await sb.schema('core').from('properties').select('attrs').eq('id', propertyId).single();
  const { data: o } = await M.from('property_overrides').select('edits').eq('property_id', propertyId).maybeSingle();
  const v = (o && o.edits && o.edits.vacancy != null) ? +o.edits.vacancy : (p && p.attrs && p.attrs.vacancy != null ? +p.attrs.vacancy : null);
  return v == null || isNaN(v) ? null : 100 - v;
}

async function runTrack(t: any) {
  const now = new Date().toISOString();
  let snap: any = { track_id: t.id, property_id: t.property_id, market_id: t.market_id, ok: false };
  let platform = t.platform;
  try {
    const html = await get(t.url);
    platform = platformOf(t.url, html);
    if (!platform) throw new Error('This website isn’t supported yet');
    const units = platform === 'greystar' ? readGreystar(html) : readUnitRows(html);
    let sp = readSpecial(html);
    if (!sp.text) {   // many sites put the promotion only on the home page
      try { const home = await get(new URL('/', t.url).toString()); const h = readSpecial(home); if (h.text) sp = h; } catch (_) { /* optional */ }
    }
    if (!units.length) throw new Error('Read the page but found no units listed');
    snap = { ...snap, ok: true, units, specials: sp.text, weeks_free: sp.weeks, summary: summarize(units) };
    await M.from('web_tracks').update({ platform, last_run_at: now, last_ok_at: now, last_error: null }).eq('id', t.id);
  } catch (e) {
    snap.error = String((e as Error).message || e).slice(0, 300);
    await M.from('web_tracks').update({ platform, last_run_at: now, last_error: snap.error }).eq('id', t.id);
  }
  const { error } = await M.from('web_snapshots').insert(snap);
  if (error) throw error;
  return { id: t.id, ok: snap.ok, units: snap.units ? snap.units.length : 0, error: snap.error || null };
}

// the property card calls this from the browser ("Read now"), so answer the browser's cross-site check
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

// who may call: "Read now" needs a signed-in user with edit rights on the track's market;
// the full daily run needs the scheduler's key (kept in core.app_secrets, readable only server-side)
async function canEdit(req: Request, marketId: string): Promise<boolean> {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return false;
  const { data: u } = await sb.auth.getUser(jwt);
  const email = u && u.user && u.user.email ? u.user.email.toLowerCase() : null;
  if (!email) return false;
  const { data: rows } = await sb.schema('core').from('market_access').select('email, market_id, role');
  return (rows || []).some((r: any) => String(r.email).toLowerCase() === email && (r.market_id === '*' || r.market_id === marketId) && (r.role === 'edit' || r.role === 'admin'));
}
async function isScheduler(req: Request): Promise<boolean> {
  const k = req.headers.get('x-cron-key') || '';
  if (!k) return false;
  const { data } = await sb.schema('core').from('app_secrets').select('value').eq('name', 'web_scrape_cron_key').maybeSingle();
  return !!data && data.value === k;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  let body: any = {}; try { body = await req.json(); } catch (_) { /* scheduled call has no body */ }
  const results: any[] = [];
  if (body.track_id) {
    // one track on demand (from the property card); at most once every 10 minutes
    const { data: t } = await M.from('web_tracks').select('*').eq('id', body.track_id).maybeSingle();
    if (!t) return J({ error: 'unknown track' }, 404);
    if (!(await canEdit(req, t.market_id))) return J({ error: 'You need edit access to this market to read the website' }, 403);
    if (t.last_run_at && Date.now() - Date.parse(t.last_run_at) < 10 * 60e3) return J({ skipped: 'ran in the last 10 minutes' });
    results.push(await runTrack(t));
    return J({ results });
  }
  if (!(await isScheduler(req))) return J({ error: 'not allowed' }, 403);
  const { data: tracks } = await M.from('web_tracks').select('*').eq('enabled', true);
  const today = new Date().toISOString().slice(0, 10);
  for (const t of tracks || []) {
    const gapH = t.last_run_at ? (Date.now() - Date.parse(t.last_run_at)) / 36e5 : 1e9;
    if (gapH < (t.frequency === 'weekly' ? 6.5 * 24 : 12)) continue;   // daily: anything not read in the last 12 hours
    if (t.until && today > t.until) { await M.from('web_tracks').update({ enabled: false, last_error: 'Stopped: reached its end date' }).eq('id', t.id); continue; }
    const occ = t.stop_at_occ != null ? await occupancyOf(t.property_id) : null;
    if (occ != null && occ >= +t.stop_at_occ) { await M.from('web_tracks').update({ enabled: false, last_error: `Stopped: ${occ.toFixed(0)}% occupied` }).eq('id', t.id); continue; }
    try { results.push(await runTrack(t)); } catch (e) { results.push({ id: t.id, error: String(e) }); }
    await new Promise((r) => setTimeout(r, 1500));   // gentle: one site at a time
  }
  return J({ results });
});
