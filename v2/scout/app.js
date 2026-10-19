
/* =====================================================================
   Willow Bridge · Site Scout
   Data: Maricopa County Assessor (parcels), City of Phoenix (zoning),
         US Census ACS 5-yr via FCC block lookup (demographics)
   ===================================================================== */

// ---------- Config ----------
const ACS_YEAR = 2023;
const MIN_PARCEL_ZOOM = 16;
const MAX_FEATURES = 1000;
const TILE_MIN_ZOOM = 13;
const STORE_KEY = 'wb_sitescout_v1';
// Regrid unified parcel API — one token covers every US county with a uniform schema.
// Token is stored only in this browser (localStorage), never in the shared file or Supabase.
const REGRID_TOKEN_KEY = 'wb_regrid_token';
function regridToken(){ try{ return (localStorage.getItem(REGRID_TOKEN_KEY)||'').trim(); }catch(e){ return ''; } }
function useRegrid(){ return mkt().provider === 'regrid' && !!regridToken(); }

// case-insensitive attribute pick (county schemas vary in casing)
function pickAttr(a, ...names){ for(const n of names){ for(const k in a){ if(k.toLowerCase()===n.toLowerCase() && a[k]!=null && a[k]!=='') return a[k]; } } return undefined; }
// returns the actual FIELD NAME present on a record (raw source field first, canonical last) so we
// can build server-side WHERE clauses. Canonical names (OWNER_NAME/MAIL_ADDR1) come last as fallback.
function pickAttrKey(a, names){ for(const n of names){ for(const k in a){ if(k.toLowerCase()===n.toLowerCase() && a[k]!=null && a[k]!=='') return k; } } return null; }
const OWNER_KEYS = ['ownernamefull','ownername1','owner','owner_name','ownername','ownernme','owner1','ownernam','own_name','ownname','grantee','OWNER_NAME'];
const MAIL_KEYS  = ['owneraddressfull','owneraddress','owneraddress1','mailaddr','mailingaddress','mail_address','maddr','MAIL_ADDR1'];

// Phoenix — Maricopa County (single assessor). Full attribute schema.
const PHX_PARCEL_FIELDS = ['APN','APN_DASH','PHYSICAL_ADDRESS','PHYSICAL_CITY','OWNER_NAME','CONST_YEAR','LIVING_SPACE','LAND_SIZE','PUC','MAIL_CITY','MAIL_STATE','SALE_DATE','FCV_CUR'].join(',');
const PHX_PARCEL_FIELDS_FULL = ['APN','APN_DASH','OWNER_NAME','PHYSICAL_ADDRESS','PHYSICAL_CITY','PHYSICAL_ZIP','MAIL_ADDR1','MAIL_CITY','MAIL_STATE','MAIL_ZIP','SALE_DATE','SALE_PRICE','LAND_SIZE','CONST_YEAR','LIVING_SPACE','FCV_CUR','LPV_CUR','PUC','CITY_ZONING','JURISDICTION','SUBNAME'].join(',');

const PHX_ZONING = [
  { name:'Phoenix',    url:'https://maps.phoenix.gov/pub/rest/services/Public/Zoning/MapServer',                              layers:[0] },
  { name:'Mesa',       url:'https://gis.mesaaz.gov/s_mesaaz/rest/services/Accela/Accela_Base/MapServer',                      layers:[33] },
  { name:'Tempe',      url:'https://services.arcgis.com/lQySeXwbBg53XWDi/arcgis/rest/services/zoning_districts/FeatureServer', layers:[0] },
  { name:'Gilbert',    url:'https://maps.gilbertaz.gov/arcgis/rest/services/OD/Growth_Development_Maps_1/MapServer',           layers:[8] },
  { name:'Scottsdale', url:'https://maps.scottsdaleaz.gov/arcgis/rest/services/OpenData/MapServer',                           layers:[24] },
  { name:'Chandler',   url:'https://gis.chandleraz.gov/appsanonymous/rest/services/OpenData/Planning_Zoning_Jurisdiction/MapServer', layers:[1] },
];

// Denver / Front Range — parcels come from each COUNTY's own fast ArcGIS service (much quicker
// than the statewide composite). A universal normalizer maps each county's schema to the common
// fields, and each source carries a rough bbox so a viewport queries only the county it's over.
function coNormalize(a){
  const acresRaw = pickAttr(a,'landAcres','landacres','gisacre','acres','GISACRES','ACREAGE');
  const sqftRaw  = pickAttr(a,'landSqft','landsqft','LAND_SF');
  const acres = (acresRaw!=null && acresRaw!=='' && +acresRaw>0) ? +acresRaw : null;
  const sqft  = (sqftRaw!=null && sqftRaw!=='' && +sqftRaw>0) ? +sqftRaw : null;
  return Object.assign({}, a, {
    APN: pickAttr(a,'parcel_id','parcelnb','parcel_no','parcelno','parcelid','pin','schednum','sched_num','schednbr','account','accountno','account_no','strap','parcelnum','parcel') || '',
    APN_DASH: pickAttr(a,'parcel_id','parcelnb','parcel_no','parcelno','parcelid','pin','schednum','account','parcelnum') || '',
    OWNER_NAME: pickAttr(a,'owner','ownernamefull','ownername1','owner_name','ownername','ownernme','owner1','ownernam','own_name','ownname','grantee','name') || '',
    OWNER_NAME2: pickAttr(a,'owner2') || '',
    PHYSICAL_ADDRESS: pickAttr(a,'situsAdd','concataddr1','situs','situsaddr','situs_addr','situsaddress','situs_address','situsadd','propaddr','prop_addr','propertyaddress','address','saddress','fulladdr','fulladdress','site_addr','siteaddr','locaddr','concataddr') || '',
    PHYSICAL_CITY: pickAttr(a,'sitAddCty','loccity','situscity','situs_city','propcity','prop_city','city','saddcity','sitecity') || '',
    PHYSICAL_ZIP: pickAttr(a,'sitAddZip','situszip','zip') || '',
    // mailing / owner-of-record address — powers absentee + out-of-state + mailing-trace
    MAIL_ADDR1: pickAttr(a,'ownerAdd','owneraddressfull','owneraddress','mailaddr','mail_addr1','mailingaddress') || '',
    MAIL_CITY: pickAttr(a,'ownAddCty','ownercity','mail_city','mailcity','mailingcity') || '',
    MAIL_STATE: pickAttr(a,'ownAddStt','ownerstate','mail_state','mailstate','mailingstate') || '',
    MAIL_ZIP: pickAttr(a,'ownAddZip','mailzip') || '',
    // richer attributes present in the CO master parcel file (absent from the live feature service)
    SALE_DATE: pickAttr(a,'saleDate','saledate','last_sale_date') || '',
    SALE_PRICE: numOr0(pickAttr(a,'salePrice','saleprice','last_sale_price')),
    FCV_CUR: numOr0(pickAttr(a,'apprValTot','apprvaltot','total_value','parval')),
    ASSESSED_VAL: numOr0(pickAttr(a,'asedValTot','asedvaltot')),
    CITY_ZONING: pickAttr(a,'zoningCode','zoningcode','zoning') || '',
    ZONING_DESC: pickAttr(a,'zoningDesc','zoningdesc') || '',
    LAND_USE: pickAttr(a,'landUseDsc','landUseCde','landusedsc','landusecde') || '',
    SUBNAME: pickAttr(a,'subName','subname') || '',
    LAND_SIZE: sqft ? sqft : (acres ? Math.round(acres * 43560) : ''),
    _acresAttr: acres ? acres : (sqft ? sqft/43560 : null),
    _county: pickAttr(a,'countyName','county','countyname','county_nam','cnty') || '',
  });
}
function numOr0(v){ if(v==null || v==='') return ''; const n = +String(v).replace(/[^0-9.\-]/g,''); return isFinite(n) ? n : ''; }
const DEN_COMPOSITE = 'https://gis.colorado.gov/public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/FeatureServer/0';
// County bbox = [[south,west],[north,east]] (approximate; used only to route a viewport to a county)
const DEN_COUNTIES = [
  { name:'Jefferson',  svc:null, bounds:[[39.13,-105.40],[39.93,-105.05]] },
  { name:'Denver',     svc:null, bounds:[[39.61,-105.11],[39.91,-104.60]] },
  { name:'Arapahoe',   svc:null, bounds:[[39.50,-105.06],[39.74,-103.65]] },
  { name:'Adams',      svc:'https://services3.arcgis.com/4PNQOtAivErR7nbT/arcgis/rest/services/Parcels/FeatureServer/0', bounds:[[39.79,-105.05],[40.00,-103.70]] },
  { name:'Douglas',    svc:null, bounds:[[39.13,-105.22],[39.57,-104.60]] },
  { name:'Broomfield', svc:null, bounds:[[39.90,-105.14],[40.00,-104.97]] },
  { name:'Boulder',    svc:null, bounds:[[39.91,-105.69],[40.26,-105.05]] },
  { name:'Larimer',    svc:null, bounds:[[40.25,-105.90],[41.00,-104.94]] },
  { name:'Weld',       svc:null, bounds:[[39.99,-104.94],[40.66,-103.70]] },
  { name:'El Paso',    svc:null, bounds:[[38.51,-105.10],[39.13,-104.05]] },
];

// ---- Per-county assessor detail services (building SF, year built, municipal zoning) ----
// The statewide composite lacks these; each county publishes them on its OWN ArcGIS service with
// its OWN field names. We query by point on click and map fields through the broad variant lists
// below, so common names are caught even where a county's exact schema is unverified. Adding a
// county = one line here; click a parcel in it and the console prints its field names to tune.
const COUNTY_DETAIL = {
  'Denver':     { svc:'https://services5.arcgis.com/rqsYvPKZmvSrSWbw/ArcGIS/rest/services/parcels/FeatureServer/0' },
  'Douglas':    { svc:'https://gisapps.douglas.co.us/arcgis/rest/services/Public/Parcel_Information/MapServer/0' },
  'Boulder':    { svc:'https://maps.bouldercounty.org/arcgis/rest/services/POS/Parcels/MapServer/0' },
  'Jefferson':  { svc:'https://arcgis.jeffco.us/arcgis/rest/services/Assessor/Parcels/MapServer/0' },
  'Arapahoe':   { svc:null },
  'Adams':      { svc:'https://services3.arcgis.com/4PNQOtAivErR7nbT/arcgis/rest/services/Parcels/FeatureServer/0' },
  'Broomfield': { svc:null },
  'Larimer':    { svc:null },
  'Weld':       { svc:null },
  'El Paso':    { svc:null },
};
// County Clerk & Recorder search — the authoritative deed history, always offered as the fallback.
const COUNTY_RECORDER = {
  'Denver':'https://www.denvergov.org/property', 'Douglas':'https://apps.douglas.co.us/clerkrecords/', 'Boulder':'https://recorder.bouldercounty.gov/countyweb/login.do?countyname=Boulder',
  'Jefferson':'https://denweb.jeffco.us/webinquiry/', 'Arapahoe':'https://recording.arapahoegov.com/recorder/web/', 'Adams':'https://recording.adcogov.org/recorder/web/',
  'Broomfield':'https://recording.broomfield.org/recorder/web/', 'Larimer':'https://records.larimer.org/lcnet/RecordSearch.aspx', 'Weld':'https://records.weld.gov/', 'El Paso':'https://recording.elpasoco.com/recorder/web/',
};
// Per-county Denver assessor property-search pages (APN entered on the page; deep-link formats vary by county).
const COUNTY_ASSESSOR = {
  'Denver':'https://www.denvergov.org/property', 'Douglas':'https://apps.douglas.co.us/apps/proptax/', 'Boulder':'https://maps.boco.solutions/PropertySearch/',
  'Jefferson':'https://property.jeffco.us/', 'Arapahoe':'https://parcelsearch.arapahoegov.com/', 'Adams':'https://adcogov.org/assessor-property-search',
  'Broomfield':'https://gisweb.broomfield.org/AssessorPropertySearch/', 'Larimer':'https://apps.larimer.gov/assessor/query/search.cfm', 'Weld':'https://www.weld.gov/Government/Departments/Assessor', 'El Paso':'https://property.spatialest.com/co/elpaso/',
};
// Resolve the right assessor link for a parcel by market/county.
function assessorLinkFor(p, apn){
  if(mkt().counties){                       // Denver / Front Range → route by county
    const url = p._county && COUNTY_ASSESSOR[p._county];
    if(url) return { url, label:(p._county+' County Assessor') };
    // fallback: a Colorado property-search search if the county isn't mapped
    return { url:'https://www.google.com/search?q='+encodeURIComponent((p._county?p._county+' County ':'')+'Colorado assessor property search '+(p.APN_DASH||apn||'')), label:'County Assessor' };
  }
  return { url:'https://mcassessor.maricopa.gov/mcs/?q='+encodeURIComponent(p.APN_DASH || apn), label:'Assessor record' };
}
// Broad field-name variants — the flexible matcher. Catches most county schemas without hardcoding.
const F_BLDGSF = ['TOTAL_FINISHED_SF','FINISHED_SF','BLDG_SF','BUILDING_SF','TOTALSQFT','TOTAL_SQFT','SQFT','SQ_FT','GROSS_SF','BLDGAREA','BLDG_AREA','IMPROVEMENT_SF','TOTAL_AREA','HEATED_AREA','LIVING_AREA','GLA','ABOVE_GRADE_SF','totalSqft','bldgSqFt','SQUARE_FEET','FINISHED_SQFT'];
const F_YEAR   = ['YEAR_BUILT','YEARBUILT','YR_BUILT','ACTUAL_YEAR_BUILT','ACT_YEAR_BUILT','BUILT_YEAR','EFF_YEAR_BUILT','YEAR_BLT','CONSTRUCTION_YEAR','yearBuilt','YRBLT'];
const F_ZONE   = ['ZONE','ZONING','ZONE_CODE','ZONING_CODE','ZONE_DIST','ZONEDIST','ZONE_DISTRICT','ZONING_DIST','ZONE_CLASS','ZON_CODE','ZONE_DESC','ZONING_DESCRIPTION','zoneCode','ZONE_TYPE','LU_CODE'];

async function enrichParcelDetail(feature, countyName){
  const reg = COUNTY_DETAIL[countyName];
  if(!reg || !reg.svc) return;                     // no detail service wired for this county yet
  const seq = ++enrichParcelDetail._seq;
  let center;
  try{ center = feature.geometry ? L.geoJSON(feature).getBounds().getCenter() : (window._lastParcelClick||null); }
  catch(e){ center = window._lastParcelClick||null; }
  if(!center) return;
  try{
    const pt = {x:center.lng, y:center.lat, spatialReference:{wkid:4326}};
    const gj = await arcgisQuery(reg.svc, {
      geometry: JSON.stringify(pt), geometryType:'esriGeometryPoint',
      inSR:4326, outSR:4326, spatialRel:'esriSpatialRelIntersects',
      outFields:'*', returnGeometry:false, resultRecordCount:1,
    }).catch(()=>null);
    if(seq !== enrichParcelDetail._seq) return;     // superseded by a newer click
    const a = gj && gj.features && gj.features[0] && gj.features[0].attributes;
    if(!a){ console.log('[detail]', countyName, '— no record at point'); return; }
    if(!enrichParcelDetail._logged[countyName]){
      enrichParcelDetail._logged[countyName] = true;
      console.log('[detail]', countyName, 'fields:', Object.keys(a));
    }
    const sf   = +pickAttr(a, ...F_BLDGSF) || 0;
    const year = pickAttr(a, ...F_YEAR) || '';
    const zone = pickAttr(a, ...F_ZONE) || '';
    // fill the cells live, only when the county actually returned the value
    if(sf > 0){
      const el = $('bldgSfVal'); if(el){ el.textContent = fmtInt(sf) + ' SF'; el.style.fontSize='16.5px'; }
      const nt = $('bldgSfNote'); if(nt) nt.textContent = 'county assessor';
    }
    if(year && +year > 1000){
      const yc = $('yearCell');
      if(yc) yc.innerHTML = '<div class="s-label">Year built</div><div class="s-val num">'+esc(String(year))+'</div>';
    }
    if(zone){
      const zv = $('zoneVal'), zs = $('zoneSrc');
      if(zv){ zv.textContent = zone; zv.style.fontSize=''; }
      if(zs) zs.textContent = countyName + ' assessor';
    }
  }catch(e){ /* county service down or CORS — panel keeps its baseline values */ }
}
enrichParcelDetail._seq = 0;
enrichParcelDetail._logged = {};

// Front Range zoning is per-city/county (like the Phoenix cities). Wire each GeoService URL here.
// Front Range zoning — only verified-working services belong here. Unverified URLs cause failing
// requests on every parcel, which is worse than no overlay. Douglas is confirmed; others pending.
const DEN_ZONING = [
  { name:'Douglas',  url:'https://services.arcgis.com/seTexOicoRXDvRsJ/arcgis/rest/services/Zoning_View/FeatureServer', layers:[0] },
];

const MARKETS = {
  phoenix: {
    name:'Phoenix MSA', sub:'Phoenix MSA parcel intelligence &amp; pipeline',
    center:[33.4484,-112.0740], zoom:12, ready:true,
    parcelSvc:'https://gis.mcassessor.maricopa.gov/arcgis/rest/services/MaricopaDynamicQueryService/MapServer/3',
    parcelFields:PHX_PARCEL_FIELDS, parcelFieldsFull:PHX_PARCEL_FIELDS_FULL, normalize:(a)=>a,
    minParcelZoom:16, genPx:1.1, split:true,
    apnSearch:(q)=>{ const clean=q.replace(/[\s-]/g,'').toUpperCase(), dash=q.trim().toUpperCase(); return `APN='${clean}' OR APN_DASH='${dash}'`; },
    tileUrl:'https://gis.mcassessor.maricopa.gov/arcgis/rest/services/ParcelOutline/MapServer/tile/{z}/{y}/{x}',
    zoning:PHX_ZONING, searchViewbox:'-113.35,34.05,-111.20,32.90', entityLookup:'az',
  },
  denver: {
    name:'Denver · Front Range', sub:'Denver &amp; Front Range parcel intelligence &amp; pipeline',
    center:[39.7392,-104.9903], zoom:12, ready:true,
    counties:DEN_COUNTIES, fallbackSvc:DEN_COMPOSITE, fallbackName:'Colorado (statewide)',
    provider:'regrid',
    entityLookup:'co',
    parcelFields:'*', parcelFieldsFull:'*', normalize:coNormalize, maxFeatures:1000,
    apnSearch:(q)=>`UPPER(PARCELNB)=UPPER('${q.trim().replace(/'/g,"''")}')`,
    tileUrl:null, zoning:DEN_ZONING, searchViewbox:'-105.75,40.75,-104.50,38.60',
    minParcelZoom:16, genPx:2.6, split:false,
  },
};
let currentMarket = 'phoenix';
function mkt(){ return MARKETS[currentMarket]; }
function marketReady(){ return mkt().ready; }
function activeZoning(){ return mkt().zoning; }
function normalizeFeature(f){ if(f && f.properties) f.properties = mkt().normalize(f.properties); return f; }
function parcelFloorZoom(){ return mkt().tileUrl ? TILE_MIN_ZOOM : (mkt().minParcelZoom || MIN_PARCEL_ZOOM); }
function maxFeatures(){ return mkt().maxFeatures || MAX_FEATURES; }
// which parcel service(s) cover a viewport — a single service, or the intersecting counties
function boundsIntersect(cb, b){ return !(cb[1][0] < b.getSouth() || cb[0][0] > b.getNorth() || cb[1][1] < b.getWest() || cb[0][1] > b.getEast()); }
function parcelSourcesFor(b){
  const m = mkt();
  if(m.counties){
    const wired = m.counties.filter(c => c.svc && (!c.bounds || boundsIntersect(c.bounds, b)));
    // Use fast county services where they cover the view; only fall to the composite when none do.
    // (Stacking a county server AND the statewide layer was the source of the slow, flickery loads.)
    if(wired.length) return wired.map(c => ({name:c.name, svc:c.svc}));
    if(m.fallbackSvc) return [{name:m.fallbackName||'Statewide', svc:m.fallbackSvc, slow:true}];
    return [];
  }
  return m.parcelSvc ? [{name:m.name, svc:m.parcelSvc}] : [];
}
function anyCountyPending(b){ return false; }


const STATUSES = [
  {id:'monitor',     label:'Monitor',        color:'var(--st-monitor)',     hex:'#E0A22C', pipeline:false},
  {id:'prospect',    label:'Prospect',       color:'var(--st-prospect)',    hex:'#5D3FB8', pipeline:true},
  {id:'underwriting',label:'Underwriting',   color:'var(--st-underwriting)',hex:'#6FBF95', pipeline:true},
  {id:'contacted',   label:'Owner Contacted',color:'var(--st-contacted)',   hex:'#33A06E', pipeline:true},
  {id:'loi',         label:'LOI',            color:'var(--st-loi)',         hex:'#1B7A50', pipeline:true},
  {id:'past',        label:'Past Pursuit',   color:'var(--st-past)',        hex:'#9E3B36', pipeline:false},
];
const statusById = Object.fromEntries(STATUSES.map(s=>[s.id,s]));

// ---------- Small utilities ----------
const $ = id => document.getElementById(id);
const fmtInt = n => (n==null||isNaN(n)) ? '—' : Number(n).toLocaleString('en-US');
const fmtUsd = n => (n==null||isNaN(n)||n<=0) ? '—' : '$' + Number(n).toLocaleString('en-US',{maximumFractionDigits:0});
const fmtAcres = n => (n==null||isNaN(n)) ? '—' : n.toLocaleString('en-US',{maximumFractionDigits:2}) + ' ac';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function fmtDateMs(ms){
  if(!ms) return '—';
  const d = new Date(ms);
  return isNaN(d) ? '—' : d.toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'});
}
// Parse a date value (epoch ms, ISO string, or M/D/Y) to epoch ms for sorting
function msOf(v){
  if(v == null || v === '') return 0;
  if(typeof v === 'number') return v;
  const d = new Date(v);
  return isNaN(d) ? 0 : d.getTime();
}
// Reusable centered modal
function showModal(title, bodyHtml){
  let m = document.getElementById('appModal');
  if(!m){
    m = document.createElement('div');
    m.id = 'appModal';
    m.innerHTML = '<div class="modal-backdrop"></div><div class="modal-card"><div class="modal-head"><h3 id="appModalTitle"></h3><button class="modal-x" id="appModalX">×</button></div><div class="modal-body" id="appModalBody"></div></div>';
    document.body.appendChild(m);
    m.querySelector('.modal-backdrop').addEventListener('click', hideModal);
    m.querySelector('#appModalX').addEventListener('click', hideModal);
    document.addEventListener('keydown', e=>{ if(e.key==='Escape') hideModal(); });
  }
  document.getElementById('appModalTitle').textContent = title;
  document.getElementById('appModalBody').innerHTML = bodyHtml;
  m.classList.add('open');
}
function hideModal(){ const m = document.getElementById('appModal'); if(m) m.classList.remove('open'); }
function debounce(fn, ms){
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(()=>fn(...args), ms); };
}

// Geodesic area (spherical excess) of a GeoJSON Polygon/MultiPolygon ring set → acres
function ringAreaM2(coords){
  const R = 6378137, rad = Math.PI/180;
  let total = 0;
  const n = coords.length;
  if(n < 3) return 0;
  for(let i=0;i<n;i++){
    const [l1,f1] = coords[i], [l2,f2] = coords[(i+1)%n];
    total += (l2 - l1) * rad * (2 + Math.sin(f1*rad) + Math.sin(f2*rad));
  }
  return Math.abs(total * R * R / 2);
}
function geomAcres(geom){
  if(!geom) return null;
  let m2 = 0;
  const polys = geom.type === 'Polygon' ? [geom.coordinates]
              : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  for(const poly of polys){
    poly.forEach((ring,i)=>{ m2 += (i===0 ? 1 : -1) * ringAreaM2(ring); });
  }
  return m2 > 0 ? m2 / 4046.8564224 : null;
}

// ---------- ArcGIS query with fetch → JSONP fallback ----------
let jsonpSeq = 0;
function jsonp(url, params){
  return new Promise((resolve,reject)=>{
    const cb = '__ss_cb' + (++jsonpSeq);
    params = {...params, f:'json', callback:cb};
    const qs = Object.entries(params).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const s = document.createElement('script');
    const timer = setTimeout(()=>{ cleanup(); reject(new Error('JSONP timeout')); }, 9000);
    function cleanup(){ clearTimeout(timer); delete window[cb]; s.remove(); }
    window[cb] = data => { cleanup(); resolve(data); };
    s.onerror = () => { cleanup(); reject(new Error('JSONP failed')); };
    s.src = url + '?' + qs;
    document.head.appendChild(s);
  });
}
// Convert Esri JSON featureset → GeoJSON FeatureCollection.
// keepNoGeom=true keeps attribute-only features (needed for point lookups that request no geometry).
// Handles web-mercator output (converts to lng/lat) and tags the source SR for diagnostics.
function esriToGeoJSON(fs, keepNoGeom){
  const sr = fs.spatialReference && (fs.spatialReference.latestWkid || fs.spatialReference.wkid);
  const conv = (sr === 102100 || sr === 3857)
    ? (x,y)=>{ const lng = x/20037508.342789244*180; let lat = y/20037508.342789244*180;
               lat = 180/Math.PI*(2*Math.atan(Math.exp(lat*Math.PI/180)) - Math.PI/2); return [lng,lat]; }
    : (x,y)=>[x,y];
  const feats = (fs.features||[]).map(f=>{
    let geometry = null;
    if(f.geometry && f.geometry.rings){
      geometry = {type:'Polygon', coordinates:f.geometry.rings.map(r=>r.map(p=>conv(p[0],p[1])))};
    }
    return {type:'Feature', properties:f.attributes||{}, geometry};
  }).filter(f => keepNoGeom || f.geometry);
  const fc = {type:'FeatureCollection', features:feats};
  fc._sr = sr;
  return fc;
}
const corsBlockedHosts = new Set();
// ---- Regrid unified parcel API (v2) — GeoJSON in, standardized nationwide schema out ----
const REGRID_BASE = 'https://app.regrid.com/api/v2/parcels';
function regridNormalize(p){
  return Object.assign({}, p, {
    APN: pickAttr(p,'parcelnumb','parcelnumb_no','altparno','parcelnum','parcel_id') || '',
    APN_DASH: pickAttr(p,'parcelnumb','altparno','parcelnum') || '',
    OWNER_NAME: pickAttr(p,'owner','owner2','mailname') || '',
    PHYSICAL_ADDRESS: pickAttr(p,'address','saddress','situs') || '',
    PHYSICAL_CITY: pickAttr(p,'scity','city','pcity') || '',
    MAIL_ADDR1: pickAttr(p,'mailadd','mail_address1','mailaddress') || '',
    MAIL_CITY: pickAttr(p,'mail_city','mailcity') || '',
    MAIL_STATE: pickAttr(p,'mail_state2','mailstate','mail_state') || '',
    CONST_YEAR: pickAttr(p,'yearbuilt','year_built') || '',
    SALE_DATE: pickAttr(p,'saledate','last_sale_date') || '',
    SALE_PRICE: pickAttr(p,'saleprice','last_sale_price') || '',
    FCV_CUR: pickAttr(p,'parval','landval','improvval','total_value') || '',
    LAND_SIZE: pickAttr(p,'ll_gisacre','gisacre','deededacreage') || '',
    _county: pickAttr(p,'county','county_name') || '',
    _regrid: true,
  });
}
function regridFeatures(j){
  return (j && ((j.parcels && j.parcels.features) || j.features || j.results)) || [];
}
async function regridBBox(b, signal){
  const poly = {type:'Polygon', coordinates:[[
    [b.getWest(),b.getSouth()],[b.getEast(),b.getSouth()],[b.getEast(),b.getNorth()],[b.getWest(),b.getNorth()],[b.getWest(),b.getSouth()]
  ]]};
  const url = REGRID_BASE + '/query?' + new URLSearchParams({
    token: regridToken(), geojson: JSON.stringify(poly), limit:'1000', return_custom:'false'
  });
  const r = await fetch(url, {signal});
  if(!r.ok) throw new Error('Regrid HTTP ' + r.status);
  const feats = regridFeatures(await r.json());
  feats.forEach(f=>{ f.properties = regridNormalize(f.properties||{}); });
  return feats;
}
async function regridPoint(lat, lng){
  const url = REGRID_BASE + '/point?' + new URLSearchParams({ token:regridToken(), lat:lat, lon:lng, radius:'4' });
  const r = await fetch(url);
  if(!r.ok) return null;
  const feats = regridFeatures(await r.json());
  const f = feats[0]; if(!f) return null;
  f.properties = regridNormalize(f.properties||{}); f._full = true; return f;
}
function hostOf(u){ try{ return new URL(u).host; }catch(e){ return u; } }
async function arcgisQuery(layerUrl, params, signal){
  const url = layerUrl + '/query';
  const keepNoGeom = params.returnGeometry === false;
  const host = hostOf(url);
  let emptyResult = null;
  let corsBlocked = corsBlockedHosts.has(host);
  let serverErr = null;
  // 1) Cross-origin fetch — skipped entirely for hosts we've already seen block CORS (they'd
  //    just fail again and waste a round-trip). Esri-cloud (services*.arcgis.com) is CORS-only.
  if(!corsBlocked){
    for(const fmt of ['json','geojson']){
      try{
        const p = new URLSearchParams({...params, f:fmt});
        const r = await fetch(url + '?' + p.toString(), {signal});
        if(!r.ok){ serverErr = 'HTTP ' + r.status; continue; }
        const j = await r.json();
        if(j.error){ serverErr = (j.error.message || ('code '+j.error.code)) + ' [' + fmt + ']'; continue; }
        const fc = j.type === 'FeatureCollection' ? j : (j.features ? esriToGeoJSON(j, keepNoGeom) : null);
        if(fc){
          if(fc.features.length) return fc;
          emptyResult = fc;
        }
      }catch(e){
        if(e.name === 'AbortError') throw e;
        corsBlocked = true; serverErr = 'CORS/network';
        if(!/\/\/services\d*\.arcgis\.com\//.test(url)) corsBlockedHosts.add(host);
        break;
      }
    }
  }
  if(emptyResult && !corsBlocked) return emptyResult;
  // 2) JSONP fallback for CORS-blocked servers. Esri-cloud hosted services don't support JSONP.
  if(/\/\/services\d*\.arcgis\.com\//.test(url)) throw new Error(serverErr || 'hosted CORS failed');
  try{
    const j = await jsonp(url, params);
    if(j.error) throw new Error(j.error.message || 'ArcGIS error');
    return esriToGeoJSON(j, keepNoGeom);
  }catch(e){
    throw new Error(serverErr ? (serverErr + ' / jsonp ' + e.message) : ('jsonp ' + e.message));
  }
}

// ---------- Map & basemaps ----------
const map = L.map('map', {zoomControl:true, attributionControl:true, zoomSnap:0.25, zoomDelta:0.5, wheelPxPerZoomLevel:120})
  .setView([33.4484, -112.0740], 12); // Phoenix
map.attributionControl.setPrefix(false);

// Recolor road tiles with a TONE CURVE: dark name-label text is kept dark and crisp (high
// contrast = readable), while the road lines are lifted to a clean soft white and halos stay
// light. Baked into the canvas so it survives html2canvas export.
function tintRoadPixels(px){
  for(let i=0;i<px.length;i+=4){
    if(!px[i+3]) continue;
    const v = 0.299*px[i] + 0.587*px[i+1] + 0.114*px[i+2];
    let o;
    if(v < 100) o = v * 0.6;                          // label text → darker, crisper
    else o = Math.min(255, 205 + (v-150)*0.5);        // road lines/halos → clean soft white
    px[i]=o*0.985; px[i+1]=o*0.99; px[i+2]=o;         // whisper of cool, otherwise neutral
  }
}
const RoadTintLayer = L.TileLayer.extend({
  createTile: function(coords, done){
    const tile = document.createElement('canvas');
    const size = this.getTileSize(); tile.width = size.x; tile.height = size.y;
    const img = new Image(); img.crossOrigin = 'anonymous';
    const url = this.getTileUrl(coords);
    img.onload = () => {
      const w = img.naturalWidth || size.x, h = img.naturalHeight || size.y;
      tile.width = w; tile.height = h;                              // keep full source detail
      tile.style.width = size.x+'px'; tile.style.height = size.y+'px';
      const ctx = tile.getContext('2d'); ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      try{ const d = ctx.getImageData(0,0,w,h); tintRoadPixels(d.data); ctx.putImageData(d,0,0); }
      catch(e){ ctx.drawImage(img,0,0,w,h); }
      done(null, tile);
    };
    img.onerror = (e) => done(e, tile);
    img.src = url;
    return tile;
  }
});

const basemaps = {
  aerial: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom:20, maxNativeZoom:19, attribution:'Imagery © Esri', crossOrigin:true, className:'bm-aerial', detectRetina:true
  }),
  labels: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    maxZoom:20, maxNativeZoom:19, pane:'shadowPane', crossOrigin:true, className:'bm-labels', opacity:1, detectRetina:true
  }),
  roads: new RoadTintLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
    maxZoom:20, maxNativeZoom:19, pane:'shadowPane', crossOrigin:true, className:'bm-roads', opacity:0.68, detectRetina:true
  }),
  streets: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    maxZoom:20, attribution:'© OpenStreetMap © CARTO', subdomains:'abcd', crossOrigin:true, detectRetina:true
  }),
  streetsLabels: new (L.TileLayer.extend({
    // darken Carto's pale label text so city/town/neighborhood names are deck-readable,
    // baked into canvas so it holds up in PNG export. Base green hints come from the light base.
    createTile: function(coords, done){
      const tile=document.createElement('canvas'); const size=this.getTileSize(); tile.width=size.x; tile.height=size.y;
      const img=new Image(); img.crossOrigin='anonymous';
      img.onload=()=>{ const w=img.naturalWidth||size.x,h=img.naturalHeight||size.y; tile.width=w; tile.height=h; tile.style.width=size.x+'px'; tile.style.height=size.y+'px';
        const ctx=tile.getContext('2d'); ctx.imageSmoothingQuality='high'; ctx.drawImage(img,0,0,w,h);
        try{ const d=ctx.getImageData(0,0,w,h), px=d.data;
          for(let i=0;i<px.length;i+=4){ if(!px[i+3]) continue; const v=0.299*px[i]+0.587*px[i+1]+0.114*px[i+2];
            if(v<200){ px[i]*=0.38; px[i+1]*=0.38; px[i+2]*=0.38; } }   // darken text; keep light halos
          ctx.putImageData(d,0,0);
        }catch(e){}
        done(null,tile); };
      img.onerror=e=>done(e,tile); img.src=this.getTileUrl(coords); return tile;
    }
  }))('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
    maxZoom:20, subdomains:'abcd', crossOrigin:true, pane:'shadowPane', detectRetina:true
  })
};
let currentBM = 'aerial';
basemaps.aerial.addTo(map);

// ---- Crisp vector roads + labels from a Protomaps basemap .pmtiles (hosted on R2) ----
// Replaces the Esri raster roads/labels in Hybrid so labels are true vector (deck-crisp,
// on-brand) instead of bitmap text baked into tiles. Falls back to Esri raster if unset.
map.createPane('vlabels');
map.getPane('vlabels').style.zIndex = 500;
map.getPane('vlabels').style.pointerEvents = 'none';
const BASEMAP_URL_DEFAULT = '';   // set via Settings once the basemap .pmtiles is hosted on R2
function basemapUrl(){ return (localStorage.getItem('wb_basemap_url') || BASEMAP_URL_DEFAULT || '').trim(); }
let _vectorLayer = null, _vectorBuiltFor = null;
function buildVectorLayer(){
  const url = basemapUrl();
  if(!url || typeof protomapsL === 'undefined' || !protomapsL.leafletLayer) return null;
  if(_vectorLayer && _vectorBuiltFor === url) return _vectorLayer;
  try{
    const FONT = "'Inter Tight', system-ui, sans-serif";
    const kindOf = f => (f.props && (f.props.kind || f.props['pmap:kind'] || f.props.place)) || '';
    const paintRules = [
      // road lines, soft-white, hierarchy by class
      { dataLayer:'roads', symbolizer: new protomapsL.LineSymbolizer({
          color:'#D3D4D2', opacity:0.72,
          width:(z,f)=>{ const k=kindOf(f); return k==='highway'?3.0 : k==='major_road'?2.1 : k==='medium_road'?1.4 : 0.85; } }) },
    ];
    const labelRules = [
      // road/highway names along the line — dark, crisp, white halo (thin minor roads when zoomed out)
      { dataLayer:'roads', filter:(z,f)=>{ const k=kindOf(f); if(k==='medium_road') return z>=12; if(k==='minor_road') return z>=13.5; return true; },
        symbolizer: new protomapsL.LineLabelSymbolizer({
          labelProps:['name','name:en'], fill:'#160C33', stroke:'#FFFFFF', width:2.8,
          font:(z,f)=>{ const k=kindOf(f); return k==='highway'?"700 13px "+FONT : k==='major_road'?"600 12px "+FONT : "500 11px "+FONT; } }) },
      // place names — larger for localities (hide neighbourhoods when zoomed out)
      { dataLayer:'places', filter:(z,f)=>{ const k=kindOf(f); if(k==='neighbourhood'||k==='suburb'||k==='quarter') return z>=12; return true; },
        symbolizer: new protomapsL.CenteredTextSymbolizer({
          labelProps:['name','name:en'], fill:'#160C33', stroke:'#FFFFFF', width:3,
          font:(z,f)=>{ const k=kindOf(f); return (k==='locality'||k==='city')?"700 14px "+FONT : k==='region'?"600 13px "+FONT : "500 12px "+FONT; } }) },
    ];
    _vectorLayer = protomapsL.leafletLayer({ url, paintRules, labelRules, pane:'vlabels', attribution:'© OpenStreetMap' });
    _vectorBuiltFor = url;
  }catch(e){ console.error('[vector labels] build failed', e); _vectorLayer = null; }
  return _vectorLayer;
}
let _streetsVec=null, _streetsVecFor=null;
function buildStreetsVectorLayer(){
  const url=basemapUrl();
  if(!url || typeof protomapsL==='undefined' || !protomapsL.leafletLayer) return null;
  if(_streetsVec && _streetsVecFor===url) return _streetsVec;
  try{
    const FONT="'Inter Tight', system-ui, sans-serif";
    const kindOf=f=>(f.props&&(f.props.kind||f.props['pmap:kind']||f.props.place))||'';
    const labelRules=[
      { dataLayer:'roads', filter:(z,f)=>{ const k=kindOf(f); if(k==='medium_road') return z>=12; if(k==='minor_road') return z>=13.5; return true; },
        symbolizer:new protomapsL.LineLabelSymbolizer({ labelProps:['name','name:en'], fill:'#1D1247', stroke:'#FFFFFF', width:2.6,
          font:(z,f)=>{const k=kindOf(f); return k==='highway'?"700 13px "+FONT:k==='major_road'?"600 12px "+FONT:"500 11px "+FONT;} }) },
      { dataLayer:'places', filter:(z,f)=>{ const k=kindOf(f); if(k==='neighbourhood'||k==='suburb'||k==='quarter') return z>=12; return true; },
        symbolizer:new protomapsL.CenteredTextSymbolizer({ labelProps:['name','name:en'], fill:'#160C33', stroke:'#FFFFFF', width:3,
          font:(z,f)=>{const k=kindOf(f); return (k==='locality'||k==='city')?"700 14px "+FONT:k==='region'?"600 13px "+FONT:"500 12px "+FONT;} }) },
    ];
    _streetsVec=protomapsL.leafletLayer({ url, paintRules:[], labelRules, pane:'vlabels', attribution:'© OpenStreetMap' });
    _streetsVecFor=url;
  }catch(e){ console.error('[streets labels] build failed', e); _streetsVec=null; }
  return _streetsVec;
}
function applyBasemap(bm){
  [basemaps.aerial, basemaps.labels, basemaps.roads, basemaps.streets, basemaps.streetsLabels].forEach(l=>map.removeLayer(l));
  if(_vectorLayer) map.removeLayer(_vectorLayer);
  if(_streetsVec) map.removeLayer(_streetsVec);
  if(bm==='aerial') basemaps.aerial.addTo(map);
  else if(bm==='hybrid'){
    basemaps.aerial.addTo(map);
    const vl = buildVectorLayer();
    if(vl) vl.addTo(map);                                   // crisp vector labels
    else { basemaps.roads.addTo(map); basemaps.labels.addTo(map); }  // Esri raster fallback
  }
  else {
    basemaps.streets.addTo(map);
    const sv = buildStreetsVectorLayer();
    if(sv) sv.addTo(map);                                   // crisp vector labels (where pmtiles covers)
    else basemaps.streetsLabels.addTo(map);                 // darkened raster fallback
  }
  map.getContainer().classList.toggle('hybrid-mode', bm==='hybrid');
  currentBM = bm;
}
document.querySelectorAll('#basemapSwitch button').forEach(b=>{
  b.addEventListener('click', ()=>{
    document.querySelectorAll('#basemapSwitch button').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    const bm = b.dataset.bm;
    applyBasemap(bm);
    const lbl=$('basemapLabel'); if(lbl) lbl.textContent = b.querySelector('span').textContent;
    $('basemapCluster').classList.remove('open');   // collapse after choosing
  });
});
// ---------- Zoning: per-city registry ----------
// The assessor's countywide layer won't serve browsers, so we go to each city's own GIS.
// Endpoints below were confirmed from each service's own metadata. Both the click lookup AND
// the map overlay use our own arcgisQuery path (geojson→json→JSONP), which is the only thing
// proven to reach every one of these servers. The overlay draws polygons on canvas like parcels.
const zonePane = map.createPane('zoning'); zonePane.style.zIndex = 410; // under parcels(420)
const zoneOpacity = () => (+$('zoningOpacity').value)/100;
const MIN_ZONE_ZOOM = 14;

// stable pastel color per zoning code so districts are visually distinct
const zoneColorCache = new Map();
function zoneColor(code){
  if(!code) return '#8B5CF6';
  if(zoneColorCache.has(code)) return zoneColorCache.get(code);
  let h = 0; for(let i=0;i<code.length;i++) h = (h*31 + code.charCodeAt(i)) & 0xffffffff;
  const c = `hsl(${Math.abs(h)%360} 58% 58%)`;
  zoneColorCache.set(code, c); return c;
}
function zoneFeatStyle(f){
  const col = zoneColor(f._zcode);
  return {color:col, weight:1, opacity:0.85, fillColor:col, fillOpacity:zoneOpacity()*0.6};
}
const zoneRenderer = L.canvas({pane:'zoning', padding:0.4});
const zoneLayer = L.geoJSON(null, {
  pane:'zoning', renderer:zoneRenderer, style:zoneFeatStyle,
  onEachFeature:(f,l)=>{ if(f._zcode) l.bindTooltip(`<b>${esc(f._zcode)}</b><br>${esc(f._zcity||'')}`, {sticky:true, className:'parcel-tip'}); }
});
let zoningOn = false;
const zoneLoadedIds = new Set();
let zoneAbort = null;

function syncZoningUI(){
  $('zoningOpacityRow').style.display = zoningOn ? 'flex' : 'none';
  $('zoneHint').classList.toggle('show', zoningOn && map.getZoom() < MIN_ZONE_ZOOM);
}
const zoneFieldCache = {};  // city name -> detected zoning field (so we can request just that field)
let lastZoneKey = '';
async function loadZoning(){
  if(!zoningOn) return;
  if(!marketReady()) return;
  if(map.getZoom() < MIN_ZONE_ZOOM){ syncZoningUI(); return; }
  const b = map.getBounds();
  const z = map.getZoom();
  const key = z + ':' + [b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].map(n=>n.toFixed(3)).join(',');
  if(key === lastZoneKey) return;   // view essentially unchanged — skip the 6 requests
  const env = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',');
  const metersPerPx = 156543.03392 * Math.cos(b.getCenter().lat*Math.PI/180) / Math.pow(2, z);
  const offset = (metersPerPx/111320)*1.2;   // generalize polygons to ~1px — big payload cut
  if(zoneAbort) zoneAbort.controller.abort();
  const controller = new AbortController();
  const token = zoneAbort = {controller};
  const status = {};
  await Promise.all(activeZoning().map(async c=>{
    try{
      const cachedField = zoneFieldCache[c.name];
      const gj = await arcgisQuery(c.url + '/' + c.layers[0], {
        where:'1=1', geometry:env, geometryType:'esriGeometryEnvelope',
        inSR:4326, outSR:4326, spatialRel:'esriSpatialRelIntersects',
        outFields: cachedField || '*', returnGeometry:true, maxAllowableOffset:offset,
        resultRecordCount:1000,
      }, controller.signal);
      if(token !== zoneAbort) return;
      const projected = gj._sr && ![4326,3857,102100,4269].includes(gj._sr);
      if(projected){ status[c.name] = {err:'SR '+gj._sr+' — needs reprojection'}; return; }
      status[c.name] = gj.features.length;
      const fresh = [];
      for(const f of gj.features){
        if(!f.geometry){ continue; }
        const picked = pickZoneField(f.properties||{});
        if(picked && !zoneFieldCache[c.name]) zoneFieldCache[c.name] = picked.field;  // learn field once
        f._zcode = picked ? String(picked.value ?? '').trim() : '';
        f._zcity = c.name;
        const id = c.name + ':' + (f.properties.OBJECTID ?? f.properties.FID ?? JSON.stringify(f.geometry?.coordinates?.[0]?.[0]));
        if(zoneLoadedIds.has(id)) continue;
        zoneLoadedIds.add(id); f._zid = id; fresh.push(f);
      }
      if(fresh.length) zoneLayer.addData(fresh);
    }catch(e){ if(e.name!=='AbortError') status[c.name] = {err: e.message || 'error'}; }
  }));
  if(token === zoneAbort){ lastZoneKey = key; pruneOffscreenZoning(); renderZoneStatus(status); }
}
function renderZoneStatus(status){
  const el = $('zoneStatus');
  if(!zoningOn){ el.style.display='none'; return; }
  el.style.display = 'block';
  el.innerHTML = '<div style="font-weight:600;color:var(--text);margin-bottom:3px">Zoning in view</div>' +
    activeZoning().map(c=>{
      const v = status[c.name];
      let mark, col, title='';
      if(v && typeof v === 'object' && v.err){ mark = '⚠ ' + v.err.slice(0,42); col='var(--danger)'; title=v.err; }
      else if(v > 0){ mark = v + ' polys'; col='var(--wb-purple)'; }
      else { mark = 'none here'; col='var(--text-faint)'; }
      return `<div title="${esc(title)}"><span style="color:${col}">${esc(c.name)}: ${esc(String(mark))}</span></div>`;
    }).join('');
}
function pruneOffscreenZoning(){
  const keep = map.getBounds().pad(1.0);
  zoneLayer.eachLayer(l=>{
    const lb = l.getBounds ? l.getBounds() : null;
    if(lb && !keep.intersects(lb)){ if(l.feature?._zid) zoneLoadedIds.delete(l.feature._zid); zoneLayer.removeLayer(l); }
  });
}
$('tglZoning').addEventListener('change', e=>{
  zoningOn = e.target.checked;
  if(zoningOn){ map.addLayer(zoneLayer); map.addLayer(localZoneLayer); loadZoning(); drawLocalZones(); }
  else { map.removeLayer(zoneLayer); map.removeLayer(localZoneLayer); zoneLayer.clearLayers(); localZoneLayer.clearLayers(); zoneLoadedIds.clear(); lastZoneKey=''; $('zoneStatus').style.display='none'; }
  syncZoningUI();
});
$('zoningOpacity').addEventListener('input', ()=>{ zoneLayer.setStyle(zoneFeatStyle); localZoneLayer.setStyle(f=>{ const col=zoneColor(f._zcode); return {color:col,weight:1,opacity:0.85,fillColor:col,fillOpacity:zoneOpacity()*0.6}; }); });
function refreshZoning(){ if(zoningOn) loadZoning(); }

// ---------- Local zoning files (GeoJSON / zipped shapefile) ----------
// A reliable escape hatch for cities whose live servers won't cooperate: load the data once,
// store it in the browser (IndexedDB), and it paints + resolves on click like any other city.
const localZonePane = map.createPane('localzone'); localZonePane.style.zIndex = 412;
const localZoneRenderer = L.canvas({pane:'localzone', padding:0.4});
let localZones = [];  // [{name, geojson, zoneField}]
const localZoneLayer = L.geoJSON(null, {
  pane:'localzone', renderer:localZoneRenderer,
  style:f => { const col = zoneColor(f._zcode); return {color:col, weight:1, opacity:0.85, fillColor:col, fillOpacity:zoneOpacity()*0.6}; },
  onEachFeature:(f,l)=>{ if(f._zcode) l.bindTooltip(`<b>${esc(f._zcode)}</b><br>${esc(f._zcity||'')}`, {sticky:true, className:'parcel-tip'}); }
});

function idbOpen(){
  return new Promise((res,rej)=>{
    const r = indexedDB.open('wb_scout', 1);
    r.onupgradeneeded = ()=> r.result.createObjectStore('zones', {keyPath:'name'});
    r.onsuccess = ()=> res(r.result);
    r.onerror = ()=> rej(r.error);
  });
}
async function idbPut(rec){ const db=await idbOpen(); return new Promise((res,rej)=>{ const tx=db.transaction('zones','readwrite'); tx.objectStore('zones').put(rec); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }
async function idbAll(){ const db=await idbOpen(); return new Promise((res,rej)=>{ const rq=db.transaction('zones','readonly').objectStore('zones').getAll(); rq.onsuccess=()=>res(rq.result||[]); rq.onerror=()=>rej(rq.error); }); }
async function idbDel(name){ const db=await idbOpen(); return new Promise((res,rej)=>{ const tx=db.transaction('zones','readwrite'); tx.objectStore('zones').delete(name); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); }); }

function toFC(gj){
  if(Array.isArray(gj)){ // shpjs can return an array of FeatureCollections
    return {type:'FeatureCollection', features: gj.flatMap(g => g.features || [])};
  }
  if(gj.type === 'FeatureCollection') return gj;
  if(gj.type === 'Feature') return {type:'FeatureCollection', features:[gj]};
  return {type:'FeatureCollection', features:[]};
}
async function importZoneFile(file){
  const nameGuess = file.name.replace(/\.(geojson|json|zip)$/i,'').replace(/[_-]+/g,' ').trim() || 'Local zoning';
  $('zoneFileMsg').textContent = 'Reading ' + file.name + '…';
  try{
    let gj;
    if(/\.zip$/i.test(file.name)){
      if(typeof shp === 'undefined') throw new Error('shapefile reader still loading — try again in a moment');
      gj = await shp(await file.arrayBuffer());
    } else {
      gj = JSON.parse(await file.text());
    }
    const fc = toFC(gj);
    if(!fc.features.length) throw new Error('no features found in file');
    const picked = pickZoneField(fc.features[0].properties || {});
    const rec = {name:nameGuess, geojson:fc, zoneField: picked ? picked.field : null};
    await idbPut(rec);
    localZones = localZones.filter(z=>z.name!==rec.name).concat(rec);
    $('zoneFileMsg').textContent = `Loaded “${rec.name}” — ${fc.features.length} polygons` + (rec.zoneField ? ` (field: ${rec.zoneField})` : ' (no zoning field detected)');
    renderLocalZoneList();
    if(zoningOn) drawLocalZones();
  }catch(err){
    $('zoneFileMsg').textContent = 'Could not load: ' + err.message;
  }
}
function renderLocalZoneList(){
  $('localZoneList').innerHTML = localZones.map(z=>
    `<div class="site-card" style="display:flex;justify-content:space-between;align-items:center;cursor:default">
      <span>${esc(z.name)} · <span class="num">${z.geojson.features.length}</span></span>
      <button class="mini-btn" data-zone="${esc(z.name)}">Remove</button>
    </div>`).join('');
  $('localZoneList').querySelectorAll('button[data-zone]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const name = btn.getAttribute('data-zone');
      await idbDel(name);
      localZones = localZones.filter(z=>z.name!==name);
      renderLocalZoneList(); drawLocalZones();
    });
  });
}
function drawLocalZones(){
  localZoneLayer.clearLayers();
  if(!zoningOn) return;
  for(const z of localZones){
    const feats = z.geojson.features.map(f=>{
      const val = z.zoneField ? f.properties?.[z.zoneField] : (pickZoneField(f.properties||{})||{}).value;
      return {...f, _zcode:String(val ?? '').trim(), _zcity:z.name};
    }).filter(f=>f.geometry);
    if(feats.length) localZoneLayer.addData(feats);
  }
}

// point-in-polygon (ray casting) for local click lookup
function pointInRing(x, y, ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const xi=ring[i][0], yi=ring[i][1], xj=ring[j][0], yj=ring[j][1];
    if(((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi)) inside=!inside;
  }
  return inside;
}
function pointInGeom(x, y, geom){
  if(!geom) return false;
  const polys = geom.type==='Polygon' ? [geom.coordinates] : geom.type==='MultiPolygon' ? geom.coordinates : [];
  for(const poly of polys){
    if(pointInRing(x,y,poly[0])){
      let hole=false;
      for(let k=1;k<poly.length;k++) if(pointInRing(x,y,poly[k])) hole=true;
      if(!hole) return true;
    }
  }
  return false;
}
function lookupLocalZoning(latlng){
  for(const z of localZones){
    for(const f of z.geojson.features){
      if(pointInGeom(latlng.lng, latlng.lat, f.geometry)){
        const val = z.zoneField ? f.properties?.[z.zoneField] : (pickZoneField(f.properties||{})||{}).value;
        if(val != null && String(val).trim() !== '') return {code:String(val).trim(), source:z.name, field:z.zoneField||'auto'};
      }
    }
  }
  return null;
}
$('zoneFile').addEventListener('change', e=>{ const f=e.target.files[0]; if(f) importZoneFile(f); e.target.value=''; });
idbAll().then(recs=>{ localZones = recs || []; renderLocalZoneList(); }).catch(()=>{});

// Pick the attribute holding the zoning code, preferring exact/known names.
function pickZoneField(props){
  const keys = Object.keys(props);
  const exact = keys.find(n => /^(zoningcode|zcode|zoning|zone_code|zoning_code|zone|zoneclass|zoning_cla|zn_code)$/i.test(n));
  if(exact) return {field:exact, value:props[exact]};
  const loose = keys.find(n => /zon/i.test(n) && !/desc|description|ordinance|label|legend|date|prior|_lu|luvs/i.test(n));
  return loose ? {field:loose, value:props[loose]} : null;
}

// Query each city (and each candidate layer) at the point; return the first real code plus a
// full diagnostic trace of what every source returned — this is what makes failures visible.
async function lookupZoning(latlng){
  const pt = {x:latlng.lng, y:latlng.lat, spatialReference:{wkid:4326}};
  const trace = [];
  let hit = null;
  // Local loaded files first — authoritative and instant.
  const local = lookupLocalZoning(latlng);
  if(local){ hit = local; trace.push({name:local.source, status:'ok'}); }
  for(const c of activeZoning()){
    if(hit) break;
    let cityStatus = 'empty';
    for(const layerId of c.layers){
      try{
        const gj = await arcgisQuery(c.url + '/' + layerId, {
          where:'1=1',
          geometry: JSON.stringify(pt), geometryType:'esriGeometryPoint',
          inSR:4326, outSR:4326, spatialRel:'esriSpatialRelIntersects',
          outFields:'*', returnGeometry:false, resultRecordCount:1,
        });
        const f = gj.features && gj.features[0];
        if(f){
          const picked = pickZoneField(f.properties||{});
          if(picked && picked.value != null && String(picked.value).trim() !== ''){
            cityStatus = 'ok';
            if(!hit) hit = {code:String(picked.value).trim(), source:c.name, field:picked.field};
            break;
          } else {
            cityStatus = 'no-field';
          }
        }
      }catch(e){ cityStatus = 'error'; }
    }
    trace.push({name:c.name, status:cityStatus});
    if(hit) break; // stop at first city that resolves
  }
  return {hit, trace};
}


// ---------- Parcel layer (query on move, zoom-gated) ----------
const parcelTilePane = map.createPane('parceltiles'); parcelTilePane.style.zIndex = 415;
const parcelPane = map.createPane('parcels'); parcelPane.style.zIndex = 420;
const trackedPane = map.createPane('tracked'); trackedPane.style.zIndex = 430;
const selectedPane = map.createPane('selected'); selectedPane.style.zIndex = 440;
// highlight for the parcel currently open in the detail panel — soft glow halo + crisp outline
const selectedParcelGlow = L.geoJSON(null, {
  pane:'selected',
  style:{ color:'#FF7A00', weight:11, opacity:0.20, fill:false, lineJoin:'round', lineCap:'round' },
  interactive:false,
}).addTo(map);
const selectedParcelMid = L.geoJSON(null, {
  pane:'selected',
  style:{ color:'#FF7A00', weight:5, opacity:0.35, fill:false, lineJoin:'round', lineCap:'round' },
  interactive:false,
}).addTo(map);
const selectedParcelLayer = L.geoJSON(null, {
  pane:'selected',
  style:{ color:'#FFF4E8', weight:1.75, opacity:0.98, fillColor:'#FF9A2E', fillOpacity:0.10, lineJoin:'round' },
  interactive:false,
}).addTo(map);
const selectedMarker = L.marker([0,0], {
  pane:'selected', interactive:false, keyboard:false, opacity:0,
  icon: L.divIcon({ className:'sel-pin', html:'<div class="sel-pin-dot"></div>', iconSize:[18,18], iconAnchor:[9,9] }),
});
selectedMarker.addTo(map);
function _selSet(f){ [selectedParcelGlow, selectedParcelMid, selectedParcelLayer].forEach(l=>{ l.clearLayers(); try{ l.addData(f); }catch(e){} }); }
function _selClear(){ [selectedParcelGlow, selectedParcelMid, selectedParcelLayer].forEach(l=>l.clearLayers()); }
function highlightParcel(f, latlng){
  _selClear();
  let center = latlng || null;
  if(f && f.geometry){
    try{
      _selSet(f);
      center = center || selectedParcelLayer.getBounds().getCenter();
    }catch(e){}
  } else if(latlng){
    // tile-clicked parcels carry attributes but no polygon — fetch just this one shape to fill it
    fetchParcelShape(latlng, f && f.properties && f.properties.APN);
  }
  if(center){
    selectedMarker.setLatLng(center);
    selectedMarker.setOpacity(1);
  } else {
    selectedMarker.setOpacity(0);
  }
}
// One-parcel geometry fetch for the highlight fill (does not touch the panel data).
async function fetchParcelShape(latlng, apn){
  // Use the market's known-working geometry source. (County detail endpoints are unverified and
  // were failing silently, breaking the acreage backfill — reliability matters more than speed here.)
  const svc = mkt().fallbackSvc || mkt().parcelSvc || null;
  if(!svc) return;
  const seq = ++fetchParcelShape._seq;
  try{
    const pt = {x:latlng.lng, y:latlng.lat, spatialReference:{wkid:4326}};
    const gj = await arcgisQuery(svc, {
      geometry: JSON.stringify(pt), geometryType:'esriGeometryPoint',
      inSR:4326, outSR:4326, spatialRel:'esriSpatialRelIntersects',
      outFields:'', returnGeometry:true, resultRecordCount:1,
    }).catch(()=>null);
    if(seq !== fetchParcelShape._seq) return;       // a newer click superseded this
    const feat = gj && gj.features && gj.features[0];
    if(feat && feat.geometry){
      _selSet(feat);
      // The tile had no geometry, so acreage may be blank. Derive it from the real polygon and
      // backfill the panel + the current feature so tracking captures it too.
      try{
        const ac = geomAcres(feat.geometry);
        if(ac > 0){
          // Backfill by the APN we were asked to fetch — reliable even in assembly mode
          // where currentFeature isn't the parcel being added.
          if(apn) backfillParcelAcres(apn, ac);
          if(currentFeature){
            currentFeature.geometry = currentFeature.geometry || feat.geometry;
            currentFeature.properties = currentFeature.properties || {};
            if(!currentFeature.properties._acresAttr) currentFeature.properties._acresAttr = ac;
            const capn = currentFeature.properties.APN || (currentFeature.properties.APN_DASH||'').replace(/-/g,'');
            if(capn && capn !== apn) backfillParcelAcres(capn, ac);
          }
          const cell = document.getElementById('siteAreaVal');
          if(cell){ cell.textContent = ac.toFixed(2)+' ac'; }
          const sub = document.getElementById('siteAreaSub');
          if(sub){ sub.textContent = fmtInt(ac*43560)+' SF'; }
        }
      }catch(e){}
    }
  }catch(e){}
}
fetchParcelShape._seq = 0;
function clearParcelHighlight(){ _selClear(); selectedMarker.setOpacity(0); }
// Owner-portfolio overlay — the other parcels an owner holds, shown together on the map.
const portfolioLayer = L.geoJSON(null, {
  pane:'selected',
  style:{ color:'#2E9E8F', weight:2.5, opacity:1, fillColor:'#2E9E8F', fillOpacity:0.14 },
  interactive:true,
}).addTo(map);
const portfolioMarkers = L.layerGroup([], {pane:'siteMarkers'}).addTo(map);
function showPortfolio(rows, subject){
  clearPortfolio();
  const pts = [];
  // keep the subject parcel in frame (its amber pin is already drawn by highlightParcel)
  if(subject){
    let sc = null;
    if(subject.geometry){ try{ sc = L.geoJSON(subject).getBounds().getCenter(); }catch(e){} }
    if(!sc && window._lastParcelClick) sc = window._lastParcelClick;
    if(sc) pts.push(sc);
  }
  rows.forEach(f=>{
    let c = null;
    if(f.geometry){ try{ portfolioLayer.addData(f); c = L.geoJSON(f).getBounds().getCenter(); }catch(e){} }
    if(!c && f.properties && f.properties._lat){ c = L.latLng(f.properties._lat, f.properties._lng); }
    if(c){
      pts.push(c);
      L.marker(c, {pane:'siteMarkers', interactive:false,
        icon:L.divIcon({className:'pf-pin', html:'<div class="pf-pin-dot"></div>', iconSize:[12,12], iconAnchor:[6,6]})
      }).addTo(portfolioMarkers);
    }
  });
  if(pts.length){ try{ map.fitBounds(L.latLngBounds(pts).pad(0.25), {maxZoom:15}); }catch(e){} }
}
function clearPortfolio(){ portfolioLayer.clearLayers(); portfolioMarkers.clearLayers(); }
const parcelRenderer = L.canvas({pane:'parcels', padding:0.4});
const trackedRenderer = L.canvas({pane:'tracked', padding:0.4});
const apnToLayer = new Map();

// Cached parcel-outline tiles (Phoenix has a county tile cache; markets without one fall back to
// vectors at zoom 16+). URL is swapped per market in setMarket().
const parcelTiles = L.tileLayer(
  MARKETS[currentMarket].tileUrl || '',
  {pane:'parceltiles', className:'phx-parcel-tiles', minZoom:TILE_MIN_ZOOM, maxNativeZoom:19, maxZoom:22, opacity:0.9, updateWhenIdle:false}
);
if(MARKETS[currentMarket].tileUrl) parcelTiles.addTo(map);

// ---- Self-hosted PMTiles parcels (LandVision-style: pre-baked vector tiles off a CDN) ----
// Baked-in defaults so a new teammate sees parcels with zero setup. These are public file URLs,
// not secrets. A value pasted into Settings (stored per-browser) still overrides the default.
const DEFAULT_TILES = {
  denver: 'https://pub-100561ec884a4d388d7f6e389d4c3a87.r2.dev/frontrange.pmtiles?v=1',
  phoenix: ''   // Phoenix uses live Maricopa tiles — no PMTiles file yet
};
function tilesUrlFor(m){ try{ const v=(localStorage.getItem('wb_tiles_'+m)||'').trim(); return v || DEFAULT_TILES[m] || ''; }catch(e){ return DEFAULT_TILES[m] || ''; } }
function currentTilesUrl(){ return tilesUrlFor(currentMarket); }
function tileLibReady(){ return typeof protomapsL !== 'undefined' && !!(protomapsL && protomapsL.leafletLayer); }
function useTiles(){ return !!currentTilesUrl() && tileLibReady(); }
let pmLayer = null;
function buildTileLayer(url, maxDataZoom){
  // PolygonSymbolizer draws FILL ONLY — outlines need a separate LineSymbolizer, or single
  // parcels render invisibly (only stacked condo footprints accumulate enough fill to see).
  const rules = [
    // GIS convention: a bright line with a darker casing under it, so parcels read on both light
    // pavement and dark rooftops. Casing first (wider/dark), then the bright line on top.
    { dataLayer:'parcels', symbolizer: new protomapsL.PolygonSymbolizer({ fill:'#FFD24A', opacity:0.045 }) },
    { dataLayer:'parcels', symbolizer: new protomapsL.LineSymbolizer({ color:'#12101A', width:2.6, opacity:0.42 }) },
    { dataLayer:'parcels', symbolizer: new protomapsL.LineSymbolizer({ color:'#FFD24A', width:1.35, opacity:1.0 }) },
  ];
  const layer = protomapsL.leafletLayer({ url, pane:'parcels', maxDataZoom, paintRules: rules });
  layer.addTo(map);
  if(map.hasLayer(parcelTiles)) map.removeLayer(parcelTiles);   // tiles replace raster + live vectors
  clearVectorParcels();
  console.log('[tiles] active · maxDataZoom', maxDataZoom, '·', url);
  $('searchMsg').textContent = '';
  return layer;
}
function refreshTileLayer(){
  if(pmLayer){ try{ map.removeLayer(pmLayer); }catch(e){} pmLayer = null; }
  const url = currentTilesUrl();
  if(!url || !parcelsOn) return;
  if(!tileLibReady()){
    console.error('[tiles] protomaps-leaflet did not load — falling back to live queries');
    $('searchMsg').textContent = 'Tile library failed to load — using live data.';
    return;
  }
  // Read the archive's real max zoom first. Asking for zoom levels the file doesn't contain
  // returns nothing and the map goes blank past that zoom — this keeps overzoom working
  // no matter how the tiles were baked.
  let built = false;
  try{
    if(typeof pmtiles !== 'undefined' && pmtiles.PMTiles){
      const arc = new pmtiles.PMTiles(url);
      arc.getHeader().then(h=>{
        const mz = (h && typeof h.maxZoom === 'number') ? h.maxZoom : 16;
        console.log('[tiles] header — minZoom:', h && h.minZoom, 'maxZoom:', mz);
        if(!built && !pmLayer){ pmLayer = buildTileLayer(url, mz); built = true; }
      }).catch(e=>{
        console.warn('[tiles] header read failed, defaulting maxDataZoom 16', e);
        if(!built && !pmLayer){ pmLayer = buildTileLayer(url, 16); built = true; }
      });
      return;
    }
  }catch(e){ /* fall through to default */ }
  try{ pmLayer = buildTileLayer(url, 16); }
  catch(e){
    console.error('[tiles] layer failed:', e);
    $('searchMsg').textContent = 'Tiles failed to render — using live data.';
    pmLayer = null;
  }
}
// Pull the parcel under the cursor out of the loaded tile — attributes are baked in, so this
// costs zero network. protomaps-leaflet v2+ stripped its interaction API down to
// queryTileFeaturesDebug, so try that first and fall back across older names.
function pickFromTile(latlng){
  if(!pmLayer) return null;
  const tryFns = ['queryTileFeaturesDebug','queryFeatures'];
  for(const fn of tryFns){
    if(typeof pmLayer[fn] !== 'function') continue;
    try{
      const res = pmLayer[fn](latlng.lng, latlng.lat, 16);
      let feats = [];
      if(res instanceof Map) res.forEach(v=>{ if(Array.isArray(v)) feats = feats.concat(v); });
      else if(Array.isArray(res)) feats = res;
      for(const hit of feats){
        const feat = hit && hit.feature ? hit.feature : hit;
        const raw = (feat && (feat.props || feat.properties)) || (hit && (hit.props || hit.properties));
        if(!raw) continue;
        const props = mkt().normalize(Object.assign({}, raw));
        if(!props.APN) continue;
        // grab geometry if the pick exposes it (property name varies by version) so we can highlight it
        let geom = null;
        const g = feat && (feat.geom || feat.geometry);
        if(g && g.type && g.coordinates) geom = g;
        return { type:'Feature', properties:props, geometry:geom, _full:true, _fromTile:true };
      }
    }catch(e){ /* try the next name */ }
  }
  if(!pickFromTile._warned){
    pickFromTile._warned = true;
    console.warn('[tiles] no working feature-pick API on this layer — clicks will fall back to a live query');
  }
  return null;
}

let parcelLayer = L.geoJSON(null, {
  pane:'parcels',
  renderer: parcelRenderer,
  style: f => parcelStyle(f),
  onEachFeature: (f, lyr) => {
    const p = f.properties;
    apnToLayer.set(p.APN, lyr);
    // Click the already-loaded vector directly → panel opens instantly (no network round-trip);
    // openParcel enriches in the background. The map-level point query below only handles gaps
    // where no vector is loaded under the cursor.
    lyr.on('click', () => {
      featureClickGuard = true;
      setTimeout(()=>{ featureClickGuard = false; }, 0);
      if(assembly.active) addParcelToActiveSite(f); else openParcel(f);
    });
    lyr.bindTooltip(
      () => { const ac = f._acres ?? (f._acres = geomAcres(f.geometry)); return `<b>${esc(p.APN_DASH || p.APN)}</b><br>${esc(p.PHYSICAL_ADDRESS || 'No situs address')}<br>${ac ? ac.toFixed(2)+' ac' : ''}`; },
      {sticky:false, className:'parcel-tip', direction:'top', offset:[0,-4]}
    );
  }
}).addTo(map);

// Clicking anywhere queries the single parcel under the cursor and opens it — so selection
// works across the whole viewport, independent of which vectors happened to load.
let parcelClickBusy = false, featureClickGuard = false;
let _ctxLatLng = null;
function hideCtxMenu(){ const m=$('mapCtxMenu'); if(m) m.classList.remove('open'); }
map.on('contextmenu', (e)=>{
  if(_boundEdit) return;                     // not while drawing a boundary
  // Right-clicking a snapshot callout starts moving it (instead of the map menu)
  if(_snapComposed){ const hit=_snapCardAt(map.mouseEventToContainerPoint(e.originalEvent));
    if(hit){ L.DomEvent.preventDefault(e.originalEvent); startCalloutMove(hit); return; } }
  L.DomEvent.preventDefault(e.originalEvent);
  _ctxLatLng = e.latlng;
  const menu = $('mapCtxMenu'); if(!menu) return;
  menu.classList.add('open');
  const oe = e.originalEvent;
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  const x = Math.max(8, Math.min(oe.clientX, window.innerWidth  - mw - 8));
  const y = Math.max(8, Math.min(oe.clientY, window.innerHeight - mh - 8));
  menu.style.left = x+'px'; menu.style.top = y+'px';
});
{ const cc=$('ctxCompetitor'); if(cc) cc.addEventListener('click', ()=>{ hideCtxMenu(); if(_ctxLatLng) openCompetitorNew(_ctxLatLng.lat, _ctxLatLng.lng); }); }
{ const sv=$('ctxStreetView'); if(sv) sv.addEventListener('click', ()=>{ hideCtxMenu(); if(_ctxLatLng) window.open(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${_ctxLatLng.lat},${_ctxLatLng.lng}`, '_blank'); }); }
map.on('movestart', hideCtxMenu);
document.addEventListener('click', (e)=>{ if(!e.target.closest('#mapCtxMenu')) hideCtxMenu(); });
map.on('click', async (e)=>{
  if(_calloutMove){ finishCalloutMove(e.latlng); return; }   // placing a snapshot callout
  if(_poiMoveId){ finishPoiMove(e.latlng); return; }   // relocating an attraction
  if(_compMoveKey){ finishCompMove(e.latlng); return; }   // relocating a comp / project
  if(_addCompMode){ _addCompMode=false; const bar=$('poiMoveBar'); if(bar) bar.classList.remove('show'); map.getContainer().style.cursor=''; openCompetitorNew(e.latlng.lat, e.latlng.lng); return; }
  if(_addPoiMode){ _addPoiMode=false; const bar=$('poiMoveBar'); if(bar) bar.classList.remove('show'); map.getContainer().style.cursor=''; openPoiEditor(null, {id:PoiStore.newId(), la:+e.latlng.lat.toFixed(6), lo:+e.latlng.lng.toFixed(6), m:currentMarket, cat:'employer', n:'', sub:''}); return; }
  if(_boundEdit) return;                     // drawing a boundary — let the draw tool own the clicks
  if(_activeTool){ handleToolClick(e.latlng); return; }   // a map tool owns the click
  if(featureClickGuard){ featureClickGuard = false; return; }
  if(!parcelsOn || parcelClickBusy || !marketReady() || (!useTiles() && map.getZoom() < parcelFloorZoom()) || (useTiles() && map.getZoom() < 14)) return;
  window._lastParcelClick = e.latlng;
  parcelClickBusy = true;
  $('loader').style.display = 'block';
  try{
    let f = null;
    // tiles carry attributes — read the parcel straight from them (zero network)
    if(useTiles()){
      const tf = pickFromTile(e.latlng);
      if(tf){
        parcelClickBusy = false;
        if(assembly.active) addParcelToActiveSite(tf); else openParcel(tf);
        return;
      }
    }
    if(useRegrid()){
      f = await regridPoint(e.latlng.lat, e.latlng.lng).catch(()=>null);
      if(f){
        if(assembly.active) addParcelToActiveSite(f);
        else openParcel(f);
      }
    } else {
    // No tile pick available: show the panel immediately rather than freezing behind a slow
    // county query. The data fills in when it lands.
    if(!assembly.active) openParcelPending();
    const pt = {x:e.latlng.lng, y:e.latlng.lat, spatialReference:{wkid:4326}};
    const sources = parcelSourcesFor(map.getBounds());
    for(const src of sources){
      const gj = await arcgisQuery(src.svc, {
        geometry: JSON.stringify(pt), geometryType:'esriGeometryPoint',
        inSR:4326, outSR:4326, spatialRel:'esriSpatialRelIntersects',
        outFields: mkt().parcelFieldsFull, returnGeometry:true, resultRecordCount:1,
      }).catch(()=>null);
      if(gj && gj.features && gj.features[0]){ f = gj.features[0]; break; }
    }
    if(f){
      normalizeFeature(f);
      f._full = true;
      if(assembly.active) addParcelToActiveSite(f);
      else openParcel(f);
    } else if(!assembly.active){
      $('panelTitle').textContent = 'No parcel here';
      $('panelSub').textContent = '';
      $('panelBody').innerHTML = '<div class="ent-note" style="padding-top:16px">Nothing on record at that point, or the county service didn\u2019t answer.</div>';
    }
    }
  }catch(err){ /* clicked empty space or server hiccup */ }
  finally{ parcelClickBusy = false; $('loader').style.display = 'none'; }
});

let parcelsOn = true, loadedAPNs = new Set(), loadAbort = null;
const filters = {
  minAcres:null, maxAcres:null, city:'', use:'any', vacant:'any', maxSfAc:null,
  builtAfter:null, builtBefore:null, owner:'', ownedBefore:null, maxFcv:null,
  outState:false, absentee:false, entity:false, dim:true
};
const ENTITY_RE = /\b(LLC|L L C|LP|L P|LLLP|LLP|INC|CORP|CO|COMPANY|LTD|TRUST|TR|PARTNERS|PARTNERSHIP|HOLDINGS|ASSOC|ASSOCIATES|PROPERTIES|INVESTMENTS|GROUP|ENTERPRISES|VENTURES|CAPITAL|REALTY|DEVELOPMENT)\b/;

// Maricopa PUC: first two digits = general use category.
function pucCategory(puc){
  const c = String(puc==null?'':puc).replace(/[^0-9]/g,'').padStart(4,'0');
  const n = parseInt(c.slice(0,2),10);
  if(isNaN(n)) return 'other';
  if(n===0) return 'vacant';
  if(n===1) return 'sfr';
  if(n===2||n===3) return 'mfr';
  if(n>=10 && n<=29) return 'commercial';
  if(n>=30 && n<=36) return 'agricultural';
  if(n>=37 && n<=49) return 'industrial';
  return 'other';
}

function passesFilters(f){
  const p = f.properties;
  const ac = f._acres ?? geomAcres(f.geometry);
  const ls = +p.LIVING_SPACE || 0;
  if(filters.minAcres != null && !(ac >= filters.minAcres)) return false;
  if(filters.maxAcres != null && !(ac <= filters.maxAcres)) return false;
  if(filters.city && String(p.PHYSICAL_CITY||'').toUpperCase() !== filters.city) return false;
  if(filters.use !== 'any'){
    const cat = pucCategory(p.PUC);
    // treat no-living-space parcels as vacant even if PUC is blank/odd
    if(filters.use === 'vacant'){ if(!(cat==='vacant' || ls===0)) return false; }
    else if(cat !== filters.use) return false;
  }
  if(filters.vacant === 'vacant' && ls > 0) return false;
  if(filters.vacant === 'improved' && ls === 0) return false;
  if(filters.maxSfAc != null){ if(!(ls > 0 && ac > 0 && (ls/ac) <= filters.maxSfAc)) return false; }
  const yr = +p.CONST_YEAR;
  if(filters.builtBefore != null && !(yr && yr < filters.builtBefore)) return false;
  if(filters.builtAfter != null && !(yr && yr > filters.builtAfter)) return false;
  if(filters.owner && !String(p.OWNER_NAME||'').toUpperCase().includes(filters.owner)) return false;
  if(filters.ownedBefore != null){ const sd=p.SALE_DATE; const y=sd?new Date(sd).getFullYear():null; if(!(y && y < filters.ownedBefore)) return false; }
  if(filters.maxFcv != null && !(+p.FCV_CUR > 0 && +p.FCV_CUR <= filters.maxFcv)) return false;
  if(filters.outState){ const st=String(p.MAIL_STATE||'').toUpperCase().trim(); if(!st || st==='AZ' || st==='ARIZONA') return false; }
  if(filters.absentee){ const mc=String(p.MAIL_CITY||'').toUpperCase().trim(), pc=String(p.PHYSICAL_CITY||'').toUpperCase().trim(); if(!mc || !pc || mc===pc) return false; }
  if(filters.entity && !ENTITY_RE.test(String(p.OWNER_NAME||'').toUpperCase())) return false;
  return true;
}
function anyFilterActive(){
  return filters.minAcres!=null || filters.maxAcres!=null || !!filters.city || filters.use!=='any' ||
    filters.vacant!=='any' || filters.maxSfAc!=null || filters.builtAfter!=null || filters.builtBefore!=null ||
    !!filters.owner || filters.ownedBefore!=null || filters.maxFcv!=null ||
    filters.outState || filters.absentee || filters.entity;
}
function updateFilterCount(){
  let match=0, total=0;
  parcelLayer.eachLayer(l=>{ if(l.feature){ total++; if(passesFilters(l.feature)) match++; } });
  const active = anyFilterActive();
  const el = $('filterCount');
  if(el) el.textContent = active && total ? `${match} of ${total} match` : '';
}
// The readout is the instrument reporting the state of the view. Purple marks the live figure —
// the one that answers "does anything here clear my screen?"
function updateReadout(){
  const sites = marketSites();
  const total = sites.length;
  const active = total;
  const advancing = sites.filter(s => s.status === 'contacted' || s.status === 'loi').length;
  const rt = $('roTracked'), ra = $('roActive'), rv = $('roAdvancing'), rc = $('pipeCount');
  if(rt) rt.textContent = total;
  if(ra) ra.textContent = active;
  if(rv){ rv.textContent = advancing; rv.classList.toggle('live', advancing > 0); }
  if(rc) rc.textContent = total;
}
function updateCityOptions(){
  const sel = $('fCity'); if(!sel) return;
  const cities = new Set();
  parcelLayer.eachLayer(l=>{ const c=l.feature&&l.feature.properties.PHYSICAL_CITY; if(c) cities.add(String(c).toUpperCase()); });
  const current = filters.city;
  const opts = ['<option value="">Any city</option>'].concat([...cities].sort().map(c=>`<option value="${esc(c)}" ${c===current?'selected':''}>${esc(c)}</option>`));
  sel.innerHTML = opts.join('');
}
function parcelStyle(f){
  const active = anyFilterActive();
  const match = !active || passesFilters(f);
  const dimmed = filters.dim && active && !match;
  const highlighted = active && match;
  if(dimmed){
    return {color:'#6E6791', weight:0.6, opacity:0.25, fillColor:'#6E6791', fillOpacity:0.01};
  }
  if(highlighted){
    return {color:'#FFDD6B', weight:2.6, opacity:1, fillColor:'#432890', fillOpacity:0.26};
  }
  // default: exact Denver gold (#FFD24A), crisp with subtle fill for presence on dimmed hybrid
  return {color:'#FFD24A', weight:1.35, opacity:1, fillColor:'#FFD24A', fillOpacity:0.045};
}
function restyleParcels(){ parcelLayer.setStyle(f => parcelStyle(f)); updateFilterCount(); }

// ---- Parcel Search: query the county/assessor service by filter criteria, highlight + list ----
const searchResultsLayer = L.geoJSON(null, {
  pane:'selected',
  style:{ color:'#FFD24A', weight:2.2, opacity:1, fillColor:'#FFD24A', fillOpacity:0.28 },
}).addTo(map);
let searchResults = [];
// Map the generic filters to each market's real field names.
function buildSearchWhere(){
  const co = !!mkt().counties;   // Denver composite vs Phoenix Maricopa
  const F = co
    ? { owner:'owner', city:'sitAddCty', acres:'landAcres', val:'apprValTot' }
    : { owner:'OWNER_NAME', city:'PHYSICAL_CITY', acres:null, val:'FCV_CUR' };
  const w = [];
  if(filters.owner) w.push(`UPPER(${F.owner}) LIKE UPPER('%${filters.owner.replace(/'/g,"''")}%')`);
  if(filters.city)  w.push(`UPPER(${F.city}) = UPPER('${filters.city.replace(/'/g,"''")}')`);
  if(F.acres && filters.minAcres!=null) w.push(`${F.acres} >= ${filters.minAcres}`);
  if(F.acres && filters.maxAcres!=null) w.push(`${F.acres} <= ${filters.maxAcres}`);
  if(filters.maxFcv!=null) w.push(`${F.val} > 0 AND ${F.val} <= ${filters.maxFcv}`);
  if(filters.entity) w.push(`UPPER(${F.owner}) LIKE '%LLC%' OR UPPER(${F.owner}) LIKE '%L.L.C%' OR UPPER(${F.owner}) LIKE '%TRUST%' OR UPPER(${F.owner}) LIKE '%LP%'`);
  return w.length ? w.map(c=>'('+c+')').join(' AND ') : '1=1';
}
async function runParcelSearch(){
  const btn = $('runParcelSearch'); const sum = $('searchResultSummary');
  const svc = mkt().fallbackSvc || mkt().parcelSvc;
  if(!svc){ sum.innerHTML = '<span class="sr-msg">No searchable service for this market.</span>'; return; }
  const where = buildSearchWhere();
  if(where === '1=1'){ sum.innerHTML = '<span class="sr-msg">Set at least one filter above, then search.</span>'; return; }
  btn.textContent = 'Searching…'; btn.disabled = true;
  sum.innerHTML = '';
  clearSearchResults();
  try{
    const b = map.getBounds();
    const env = { xmin:b.getWest(), ymin:b.getSouth(), xmax:b.getEast(), ymax:b.getNorth(), spatialReference:{wkid:4326} };
    const gj = await arcgisQuery(svc, {
      where, geometry: JSON.stringify(env), geometryType:'esriGeometryEnvelope', inSR:4326,
      spatialRel:'esriSpatialRelIntersects', outFields:'*', returnGeometry:true, outSR:4326,
      resultRecordCount:500,
    });
    const feats = (gj.features||[]).map(f=>{ f.properties = mkt().normalize(f.properties||f.attributes||{}); return f; });
    // client-side pass for filters the service can't express (use/vacant/absentee/out-of-state/year)
    searchResults = feats.filter(f => passesClientFilters(f));
    if(!searchResults.length){
      sum.innerHTML = '<span class="sr-msg">No parcels match in this view. Zoom out or loosen filters.</span>';
    } else {
      searchResults.forEach(f=>{ try{ searchResultsLayer.addData(f); }catch(e){} });
      try{ map.fitBounds(searchResultsLayer.getBounds().pad(0.1), {maxZoom:16}); }catch(e){}
      sum.innerHTML = `<div class="sr-head"><b class="num">${searchResults.length}</b> parcel${searchResults.length>1?'s':''} found${searchResults.length>=500?'+':''}</div>`
        + `<div class="search-actions"><button class="btn full" id="seeSearchList">See list →</button><button class="mini-btn" id="clearSearchBtn">Clear</button></div>`;
      $('seeSearchList').addEventListener('click', openSearchList);
      $('clearSearchBtn').addEventListener('click', ()=>{ clearSearchResults(); sum.innerHTML=''; });
    }
  }catch(e){
    sum.innerHTML = '<span class="sr-msg">Search failed on the county service. Try a smaller area.</span>';
  }
  btn.textContent = 'Search parcels'; btn.disabled = false;
}
// filters the ArcGIS WHERE can't cleanly express — applied to the returned set
function passesClientFilters(f){
  const p = f.properties;
  if(filters.outState){ const st=String(p.MAIL_STATE||'').toUpperCase().trim(); const home = mkt().counties?'CO':'AZ'; if(!st || st===home) return false; }
  if(filters.absentee){ const mc=String(p.MAIL_CITY||'').toUpperCase().trim(), pc=String(p.PHYSICAL_CITY||'').toUpperCase().trim(); if(!mc||!pc||mc===pc) return false; }
  const yr=+p.CONST_YEAR;
  if(filters.builtBefore!=null && !(yr&&yr<filters.builtBefore)) return false;
  if(filters.builtAfter!=null && !(yr&&yr>filters.builtAfter)) return false;
  return true;
}
function clearSearchResults(){ searchResultsLayer.clearLayers(); searchResults = []; }
function openSearchList(){
  const rows = searchResults.map((f,i)=>{
    const p=f.properties;
    const addr=[p.PHYSICAL_ADDRESS,p.PHYSICAL_CITY].filter(Boolean).join(', ') || (p.APN_DASH||p.APN||'—');
    const ac = geomAcres(f.geometry) || p._acresAttr;
    const owner=p.OWNER_NAME||'—';
    return `<div class="srch-row" data-i="${i}">
        <div class="srch-main"><div class="srch-addr">${esc(addr)}</div><div class="srch-owner">${esc(owner)}</div></div>
        <div class="srch-ac num">${ac?ac.toFixed(2)+' ac':''}</div>
      </div>`;
  }).join('');
  showModal(`${searchResults.length} parcels`, `<div class="srch-list">${rows}</div>`);
  document.querySelectorAll('.srch-row').forEach(r=>r.addEventListener('click', ()=>{
    const f = searchResults[+r.dataset.i]; if(!f) return;
    hideModal();
    try{ if(f.geometry) map.fitBounds(L.geoJSON(f).getBounds().pad(0.8)); }catch(e){}
    f._full = true; window._lastParcelClick = null; openParcel(f);
  }));
}

let lastParcelKey = '';
function clearVectorParcels(){
  if(parcelLayer.getLayers().length){ parcelLayer.clearLayers(); loadedAPNs.clear(); apnToLayer.clear(); }
  lastParcelKey = '';
}
function parcelEnv(b){ return JSON.stringify({xmin:b.getWest(), ymin:b.getSouth(), xmax:b.getEast(), ymax:b.getNorth(), spatialReference:{wkid:4326}}); }
async function queryParcelCell(svc, b, offset, signal){
  const gj = await arcgisQuery(svc, {
    where:'1=1', geometry:parcelEnv(b), geometryType:'esriGeometryEnvelope',
    inSR:4326, outSR:4326, spatialRel:'esriSpatialRelIntersects',
    outFields:mkt().parcelFields, returnGeometry:true, resultRecordCount:maxFeatures(),
    geometryPrecision:6, maxAllowableOffset:offset,
  }, signal);
  const nz = mkt().normalize;
  gj.features.forEach(f=>{ f.properties = nz(f.properties); });
  return gj.features;
}
function split4(b){
  const c = b.getCenter(), w=b.getWest(), s=b.getSouth(), e=b.getEast(), n=b.getNorth();
  return [
    L.latLngBounds([s,w],[c.lat,c.lng]), L.latLngBounds([s,c.lng],[c.lat,e]),
    L.latLngBounds([c.lat,w],[n,c.lng]), L.latLngBounds([c.lat,c.lng],[n,e]),
  ];
}
// ---- Local parcel cache (IndexedDB) — revisited areas repaint instantly, even off the slow composite ----
const PCACHE = (function(){
  const DBN='wb_scout_cache', VER=1, STORE='parcels', CELL=0.01;
  let dbp = null;
  function open(){
    if(dbp) return dbp;
    dbp = new Promise((res,rej)=>{
      let rq; try{ rq = indexedDB.open(DBN, VER); }catch(e){ return rej(e); }
      rq.onupgradeneeded = e=>{
        const d = e.target.result;
        if(!d.objectStoreNames.contains(STORE)){
          const os = d.createObjectStore(STORE, {keyPath:'id'});
          os.createIndex('cell','cell',{unique:false});
        }
      };
      rq.onsuccess = ()=>res(rq.result);
      rq.onerror = ()=>rej(rq.error);
    }).catch(()=>null);
    return dbp;
  }
  function centroid(g){
    let ring = g && (g.type==='Polygon' ? g.coordinates[0] : g.type==='MultiPolygon' ? g.coordinates[0][0] : null);
    if(!ring || !ring.length) return null;
    let x=0,y=0; for(const p of ring){ x+=p[0]; y+=p[1]; } return [x/ring.length, y/ring.length];
  }
  const cid = (m,lat,lng)=> m+':'+Math.floor(lat/CELL)+'_'+Math.floor(lng/CELL);
  async function put(market, features){
    const d = await open(); if(!d || !features.length) return;
    try{
      const tx = d.transaction(STORE,'readwrite'), os = tx.objectStore(STORE);
      for(const f of features){
        const apn = f.properties && f.properties.APN; if(!apn || !f.geometry) continue;
        const c = centroid(f.geometry); if(!c) continue;
        os.put({ id:market+':'+apn, cell:cid(market,c[1],c[0]), t:Date.now(), f:{type:'Feature', properties:f.properties, geometry:f.geometry} });
      }
    }catch(e){}
  }
  async function getViewport(market, b){
    const d = await open(); if(!d) return [];
    const laMin=Math.floor(b.getSouth()/CELL), laMax=Math.floor(b.getNorth()/CELL);
    const loMin=Math.floor(b.getWest()/CELL), loMax=Math.floor(b.getEast()/CELL);
    if((laMax-laMin+1)*(loMax-loMin+1) > 600) return [];   // viewport too broad (zoomed out) — skip
    const cells=[]; for(let la=laMin; la<=laMax; la++) for(let lo=loMin; lo<=loMax; lo++) cells.push(market+':'+la+'_'+lo);
    try{
      const idx = d.transaction(STORE,'readonly').objectStore(STORE).index('cell');
      const out=[];
      await Promise.all(cells.map(cell=> new Promise(r=>{ const rq=idx.getAll(cell); rq.onsuccess=()=>{ (rq.result||[]).forEach(x=>out.push(x.f)); r(); }; rq.onerror=()=>r(); })));
      return out;
    }catch(e){ return []; }
  }
  async function clear(){
    const d = await open(); if(!d) return;
    try{ d.transaction(STORE,'readwrite').objectStore(STORE).clear(); }catch(e){}
  }
  async function count(){
    const d = await open(); if(!d) return 0;
    return new Promise(r=>{ try{ const rq=d.transaction(STORE,'readonly').objectStore(STORE).count(); rq.onsuccess=()=>r(rq.result||0); rq.onerror=()=>r(0);}catch(e){ r(0);} });
  }
  return {put, getViewport, clear, count};
})();
// Caching only helps the slow, tile-less markets (Denver composite). Fast tile-backed markets
// (Phoenix) skip it entirely so the hot path stays lean.
function cacheActive(){ return !mkt().tileUrl && !useTiles(); }
async function paintCachedParcels(b){
  if(!cacheActive()) return;
  try{
    const cached = await PCACHE.getViewport(currentMarket, b);
    const fresh = cached.filter(f=>{ const apn=f.properties.APN; if(!apn || loadedAPNs.has(apn)) return false; loadedAPNs.add(apn); return true; });
    if(fresh.length){ parcelLayer.addData(fresh); updateFilterCount(); }
  }catch(e){}
}
async function loadParcels(){
  if(!parcelsOn) return;
  if(useTiles()) return;   // PMTiles handle display; no live queries needed
  if(!marketReady()){ clearVectorParcels(); return; }
  const z = map.getZoom();
  const minZ = mkt().minParcelZoom || MIN_PARCEL_ZOOM;
  if(z < minZ){
    clearVectorParcels();
    return;
  }
  const b = map.getBounds();
  // Regrid path: one uniform query for the whole viewport, every county at once.
  if(useRegrid()){
    const rkey = 'regrid:' + z + ':' + [b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].map(n=>n.toFixed(3)).join(',');
    if(rkey === lastParcelKey) return;
    $('loader').style.display = 'block';
    paintCachedParcels(b);
    if(loadAbort) loadAbort.controller.abort();
    const controller = new AbortController();
    const token = loadAbort = {controller};
    try{
      const features = await regridBBox(b, controller.signal);
      if(token !== loadAbort) return;
      lastParcelKey = rkey;
      if(cacheActive()) PCACHE.put(currentMarket, features);
      const fresh = features.filter(f=>{ const apn=f.properties.APN; if(!apn || loadedAPNs.has(apn)) return false; loadedAPNs.add(apn); return true; });
      if(fresh.length) parcelLayer.addData(fresh);
      pruneOffscreenParcels(); updateCityOptions(); updateFilterCount();
    }catch(e){
      if(e.name === 'AbortError') return;
      console.error('Regrid load failed:', e);
      $('searchMsg').textContent = 'Regrid error — check your API token and remaining quota in Settings.';
    }finally{
      if(token === loadAbort) $('loader').style.display = 'none';
    }
    return;
  }
  const sources = parcelSourcesFor(b);
  if(!sources.length){
    clearVectorParcels();
    if(anyCountyPending(b)) $('searchMsg').textContent = 'This county isn\u2019t wired for parcels yet — send its GeoService URL.';
    return;
  }
  const key = z + ':' + sources.map(s=>s.name).join('') + ':' + [b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].map(n=>n.toFixed(3)).join(',');
  if(key === lastParcelKey) return;
  $('loader').style.display = 'block';
  paintCachedParcels(b);
  const metersPerPx = 156543.03392 * Math.cos(b.getCenter().lat * Math.PI/180) / Math.pow(2, z);
  const offsetDeg = (metersPerPx / 111320) * (mkt().genPx || 1.1);
  if(loadAbort) loadAbort.controller.abort();
  const controller = new AbortController();
  const token = loadAbort = {controller};
  try{
    const cap = maxFeatures();
    let features = [];
    for(const src of sources){
      let cellFeatures = await queryParcelCell(src.svc, b, offsetDeg, controller.signal).catch(()=>[]);
      if(token !== loadAbort) return;
      // Adaptive quad-split fills dense viewports past the row cap — only where the market opts in
      // (fast servers). Slow/statewide services skip it and rely on higher min-zoom + click-to-select.
      if(mkt().split && cellFeatures.length >= cap - 5){
        const cells = split4(b);
        const parts = await Promise.all(cells.map(c => queryParcelCell(src.svc, c, offsetDeg, controller.signal).catch(()=>[])));
        if(token !== loadAbort) return;
        const dense = cells.filter((c,i)=> parts[i].length >= cap - 5);
        let extra = [];
        if(dense.length){
          const subCells = dense.flatMap(split4);
          const subParts = await Promise.all(subCells.map(c => queryParcelCell(src.svc, c, offsetDeg, controller.signal).catch(()=>[])));
          if(token !== loadAbort) return;
          extra = subParts.flat();
        }
        cellFeatures = parts.flat().concat(extra);
      }
      features = features.concat(cellFeatures);
    }
    // If a fast county service covered the view but returned nothing (approximate bboxes overlap
    // at county lines), fall back to the statewide composite so the area still fills in.
    if(features.length === 0 && mkt().fallbackSvc && !sources.some(s=>s.svc === mkt().fallbackSvc)){
      features = await queryParcelCell(mkt().fallbackSvc, b, offsetDeg, controller.signal).catch(()=>[]);
      if(token !== loadAbort) return;
    }
    lastParcelKey = key;
    if(cacheActive()) PCACHE.put(currentMarket, features);
    const fresh = features.filter(f=>{
      const apn = f.properties.APN;
      if(!apn || loadedAPNs.has(apn)) return false;
      loadedAPNs.add(apn); return true;
    });
    if(fresh.length) parcelLayer.addData(fresh);
    pruneOffscreenParcels();
    updateCityOptions();
    updateFilterCount();
  }catch(e){
    if(e.name === 'AbortError') return;
    console.error('Parcel load failed:', e);
    $('searchMsg').textContent = 'Parcel service error — county server may be busy. Pan/zoom to retry.';
  }finally{
    if(token === loadAbort) $('loader').style.display = 'none';
  }
}
// Keep the working set bounded to what's near the viewport instead of accumulating forever —
// this is what keeps pan/zoom fluid after you've explored a lot of the map.
function pruneOffscreenParcels(){
  const keep = map.getBounds().pad(1.0); // generous buffer so nearby parcels don't pop in/out
  const toRemove = [];
  parcelLayer.eachLayer(lyr=>{
    const lb = lyr.getBounds ? lyr.getBounds() : null;
    if(!lb || !keep.intersects(lb)) toRemove.push(lyr);
  });
  for(const lyr of toRemove){
    const apn = lyr.feature?.properties?.APN;
    parcelLayer.removeLayer(lyr);
    if(apn){ loadedAPNs.delete(apn); apnToLayer.delete(apn); }
  }
}
const handleMove = debounce(()=>{ loadParcels(); refreshZoning(); }, 280);
map.on('movestart', ()=>{ if(map.getZoom() >= MIN_PARCEL_ZOOM) $('loader').style.display = 'none'; });
map.on('moveend', handleMove);
map.on('zoomend', ()=>{
  if(!useTiles() && map.getZoom() < MIN_PARCEL_ZOOM) clearVectorParcels();
  $('zoomHint').classList.toggle('show', parcelsOn && !useTiles() && map.getZoom() < parcelFloorZoom());
  if(typeof syncZoningUI === 'function') syncZoningUI();
});

$('tglParcels').addEventListener('change', e=>{
  parcelsOn = e.target.checked;
  if(parcelsOn){
    if(useTiles()){ refreshTileLayer(); map.addLayer(parcelLayer); }
    else { if(mkt().tileUrl) map.addLayer(parcelTiles); map.addLayer(parcelLayer); loadParcels(); }
  }
  else { if(pmLayer){ map.removeLayer(pmLayer); pmLayer=null; } map.removeLayer(parcelTiles); map.removeLayer(parcelLayer); $('zoomHint').classList.remove('show'); clearParcelHighlight(); if($('panel').classList.contains('open')) closeParcelPanel(); }
});

// filter wiring
const numOrNull = v => v==='' ? null : +v;
$('fMinAcres').addEventListener('input', e=>{ filters.minAcres = numOrNull(e.target.value); restyleParcels(); });
$('fMaxAcres').addEventListener('input', e=>{ filters.maxAcres = numOrNull(e.target.value); restyleParcels(); });
$('fCity').addEventListener('change', e=>{ filters.city = e.target.value; restyleParcels(); });
$('fUse').addEventListener('change', e=>{ filters.use = e.target.value; restyleParcels(); });
$('fVacant').addEventListener('change', e=>{ filters.vacant = e.target.value; restyleParcels(); });
$('fMaxSfAc').addEventListener('input', e=>{ filters.maxSfAc = numOrNull(e.target.value); restyleParcels(); });
$('fBuiltAfter').addEventListener('input', e=>{ filters.builtAfter = numOrNull(e.target.value); restyleParcels(); });
$('fMaxYear').addEventListener('input', e=>{ filters.builtBefore = numOrNull(e.target.value); restyleParcels(); });
$('fOwner').addEventListener('input', e=>{ filters.owner = e.target.value.trim().toUpperCase(); restyleParcels(); });
$('fOwnedBefore').addEventListener('input', e=>{ filters.ownedBefore = numOrNull(e.target.value); restyleParcels(); });
$('fMaxFcv').addEventListener('input', e=>{ filters.maxFcv = numOrNull(e.target.value); restyleParcels(); });
$('fOutState').addEventListener('change', e=>{ filters.outState = e.target.checked; restyleParcels(); });
$('fAbsentee').addEventListener('change', e=>{ filters.absentee = e.target.checked; restyleParcels(); });
$('fEntity').addEventListener('change', e=>{ filters.entity = e.target.checked; restyleParcels(); });
{ const td=$('tglDim'); if(td) td.addEventListener('change', e=>{ filters.dim = e.target.checked; restyleParcels(); }); }
{ const rs=$('runParcelSearch'); if(rs) rs.addEventListener('click', runParcelSearch); }
$('clearFilters').addEventListener('click', ()=>{
  ['fMinAcres','fMaxAcres','fMaxSfAc','fBuiltAfter','fMaxYear','fOwner','fOwnedBefore','fMaxFcv'].forEach(id=>$(id).value='');
  ['fCity','fUse','fVacant'].forEach(id=>$(id).value = id==='fCity' ? '' : (id==='fUse'||id==='fVacant' ? 'any' : ''));
  ['fOutState','fAbsentee','fEntity'].forEach(id=>$(id).checked=false);
  $('fUse').value='any'; $('fVacant').value='any'; $('fCity').value='';
  Object.assign(filters,{minAcres:null,maxAcres:null,city:'',use:'any',vacant:'any',maxSfAc:null,builtAfter:null,builtBefore:null,owner:'',ownedBefore:null,maxFcv:null,outState:false,absentee:false,entity:false});
  clearSearchResults(); const sum=$('searchResultSummary'); if(sum) sum.innerHTML='';
  restyleParcels();
});

// ---------- Demographics (FCC block → tract → ACS 5-yr) ----------
const acsCache = new Map();
async function fetchDemographics(lat, lng){
  const fcc = await (await fetch(`https://geo.fcc.gov/api/census/block/find?latitude=${lat}&longitude=${lng}&censusYear=2020&format=json`)).json();
  const fips = fcc && fcc.Block && fcc.Block.FIPS;
  if(!fips || fips.length < 11) throw new Error('No census block found');
  const state = fips.slice(0,2), county = fips.slice(2,5), tract = fips.slice(5,11);
  const key = state+county+tract;
  if(acsCache.has(key)) return acsCache.get(key);
  const vars = ['B01003_001E','B19013_001E','B25064_001E','B25003_001E','B25003_003E','B25077_001E'];
  const url = `https://api.census.gov/data/${ACS_YEAR}/acs/acs5?get=${vars.join(',')}&for=tract:${tract}&in=state:${state}%20county:${county}`;
  const rows = await (await fetch(url)).json();
  const h = rows[0], r = rows[1];
  const get = v => { const x = +r[h.indexOf(v)]; return (x && x > 0) ? x : null; };
  const out = {
    tract: `${tract.slice(0,4)}.${tract.slice(4)}`.replace(/^0+/,''),
    pop: get('B01003_001E'),
    mhhi: get('B19013_001E'),
    medRent: get('B25064_001E'),
    renterPct: (get('B25003_001E') && get('B25003_003E')) ? Math.round(100*get('B25003_003E')/get('B25003_001E')) : null,
    medHomeVal: get('B25077_001E'),
  };
  acsCache.set(key, out);
  return out;
}

// ---------- Pipeline store (localStorage; swappable for Supabase later) ----------
const Store = {
  data: {sites:{}, seq:0},
  load(){
    try{ const raw = localStorage.getItem(STORE_KEY); if(raw) this.data = JSON.parse(raw); }
    catch(e){ console.warn('Store load failed', e); }
    if(!this.data.sites) this.data.sites = {};
    if(this.data.seq == null) this.data.seq = 0;
    // migrate old single-parcel (APN-keyed) entries → multi-parcel site records
    let changed = false;
    for(const [k,v] of Object.entries(this.data.sites)){
      if(v && !Array.isArray(v.parcels)){
        const id = String(k).startsWith('site_') ? k : 'site_'+k;
        const site = {
          id, name: v.name || v.apnDash || v.apn || 'Site', status: v.status||'prospect',
          notes: v.notes||[], created: v.created||Date.now(), updated: v.updated||Date.now(),
          parcels: [{apn:v.apn||k, apnDash:v.apnDash||null, attrs:v.attrs||{}, geometry:v.geometry||null, acres:v.acres||null}]
        };
        delete this.data.sites[k]; this.data.sites[id] = site; changed = true;
      }
    }
    if(changed) this.save();
  },
  save(){ localStorage.setItem(STORE_KEY, JSON.stringify(this.data)); },
  newId(){ this.data.seq = (this.data.seq||0)+1; return 'site_'+this.data.seq+'_'+Date.now().toString(36); },
  get(id){ return this.data.sites[id] || null; },
  all(){ return Object.values(this.data.sites); },
  upsert(site){ site.updated = Date.now(); this.data.sites[site.id] = site; this.save(); sbPushSite(site); },
  remove(id){ delete this.data.sites[id]; this.save(); sbDeleteSite(id); },
  siteForApn(apn){ return this.all().find(s => (s.parcels||[]).some(p=>p.apn===apn)) || null; },
  async syncFromCloud(){
    const rows = await sbFetchAll();
    if(!rows) return false;
    const sites = {};
    for(const r of rows){ const d = r.data; if(d && d.id) sites[d.id] = d; }
    this.data.sites = sites; this.save();
    return true;
  },
};
Store.load();

// ============ Supabase backend: auth + shared pipeline sync ============
const SUPABASE_URL = (function(){ try{ return (localStorage.getItem('wb_sb_url')||'').trim(); }catch(e){ return ''; } })() || 'https://mbvymttyflpoycppupas.supabase.co';
const SUPABASE_KEY = (function(){ try{ return (localStorage.getItem('wb_sb_key')||'').trim(); }catch(e){ return ''; } })() || 'sb_publishable_gOBMpsyD689BbleoXvRnVA_hxj_4_83';
let sb = null, authed = false, sitesChannel = null;
try{ sb = window.ScoutDB; }   // v2: shared Willow Bridge tables (see shared/scout-db.js)
catch(e){ console.warn('[sb] client init failed', e); }
const cloudOn = ()=> !!sb;   // if the library/config is missing, app runs local-only (never bricks)

async function sbFetchAll(){
  if(!sb || !authed) return null;
  try{ const { data, error } = await sb.from('sites').select('id,data,updated'); if(error){ console.warn('[sb] fetch', error.message); return null; } return data; }
  catch(e){ console.warn('[sb] fetch failed', e); return null; }
}
async function sbPushSite(site){
  if(!sb || !authed) return;
  try{ const { error } = await sb.from('sites').upsert({ id:site.id, data:site, market:(typeof siteMarket==='function'?siteMarket(site):null), updated:site.updated||Date.now() }); if(error) console.warn('[sb] push', error.message); }
  catch(e){ console.warn('[sb] push failed', e); }
}
async function sbDeleteSite(id){
  if(!sb || !authed) return;
  try{ const { error } = await sb.from('sites').delete().eq('id', id); if(error) console.warn('[sb] delete', error.message); }
  catch(e){ console.warn('[sb] delete failed', e); }
}
// Live sync — teammates' changes stream in
function subscribeSites(){
  if(!sb || sitesChannel) return;
  sitesChannel = sb.channel('sites-live')
    .on('postgres_changes', { event:'*', schema:'public', table:'sites' }, payload=>{
      try{
        const ev = payload.eventType;
        if(ev==='DELETE'){ const id = payload.old && payload.old.id; if(id) delete Store.data.sites[id]; }
        else { const d = payload.new && payload.new.data; if(d && d.id){
          // don't clobber a site you're actively editing
          if(sdEditing && sdCurrentId === d.id) return;
          Store.data.sites[d.id] = d;
        } }
        Store.save();
        if(typeof renderTracked==='function') renderTracked();
        if(sdCurrentId && Store.get(sdCurrentId) && $('siteDetailOverlay').classList.contains('open') && !sdEditing) renderSiteDetailBody(Store.get(sdCurrentId));
      }catch(e){ console.warn('[sb] realtime apply failed', e); }
    })
    .subscribe();
}
// On successful login: migrate any local-only sites up, pull the shared truth down, go live
async function onAuthed(){
  authed = true;
  hideLogin();
  try{ const { data } = await sb.auth.getUser(); const em = data && data.user && data.user.email; const ag=$('acctGroup'), ae=$('acctEmail'); if(ag) ag.style.display=''; if(ae && em) ae.textContent = em; }catch(e){}
  const localSites = Object.values(Store.data.sites || {});
  const cloud = await sbFetchAll() || [];
  const cloudById = {}; cloud.forEach(r=>{ cloudById[r.id] = r; });
  // migration: push any local site the cloud lacks, or that's newer locally — nothing re-added
  for(const s of localSites){
    const c = cloudById[s.id];
    if(!c || (s.updated||0) > (c.updated||0)) await sbPushSite(s);
  }
  await Store.syncFromCloud();
  onPoiAuthed();
  subscribeSites();
  updateSyncStatus();
  if(typeof renderTracked==='function') renderTracked();
  if(typeof updateReadout==='function') updateReadout();
}
function updateSyncStatus(){
  const el = $('syncStatus'); if(!el) return;
  const n = Store.all().length;
  el.innerHTML = authed
    ? '<span style="color:#2E9E8F">●</span> Synced to team backend · ' + n + ' site' + (n!==1?'s':'') + ' in pipeline'
    : '<span style="color:var(--text-faint)">●</span> Working offline (local only)';
}
async function sbSignOut(){ try{ if(sb) await sb.auth.signOut(); }catch(e){} authed=false; if(sitesChannel){ try{ sb.removeChannel(sitesChannel); }catch(e){} sitesChannel=null; } showLogin(); }
function showLogin(){ const o=$('loginOverlay'); if(o) o.classList.add('show'); }
function hideLogin(){ const o=$('loginOverlay'); if(o) o.classList.remove('show'); }
async function doLogin(){
  const em=$('loginEmail'), pw=$('loginPass'), msg=$('loginMsg'), btn=$('loginBtn');
  if(!sb){ if(msg) msg.textContent='Backend not available — check connection and reload.'; return; }
  const email=(em?em.value:'').trim(), password=pw?pw.value:'';
  if(!email || !password){ if(msg) msg.textContent='Enter your email and password.'; return; }
  if(btn){ btn.disabled=true; btn.textContent='Signing in…'; }
  if(msg) msg.textContent='';
  try{
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if(error){ if(msg) msg.textContent = /invalid/i.test(error.message)?'Wrong email or password.':error.message; }
    else { await onAuthed(); }
  }catch(e){ if(msg) msg.textContent='Sign-in failed — try again.'; }
  if(btn){ btn.disabled=false; btn.textContent='Sign in'; }
}
// Boot auth: reuse an existing session, else show the login gate
async function initAuth(){
  if(!cloudOn()) return;   // no backend → local-only mode, no gate
  showLogin();
  try{
    const { data } = await sb.auth.getSession();
    if(data && data.session){ await onAuthed(); }
  }catch(e){ console.warn('[sb] session check failed', e); }
}
// Which market a site belongs to. Explicit field wins; otherwise infer from parcel data
// (Denver parcels carry a CO county), defaulting to Phoenix.
function siteMarket(s){
  if(s.market) return s.market;
  const hasCounty = (s.parcels||[]).some(p => p.attrs && p.attrs._county);
  return hasCounty ? 'denver' : 'phoenix';
}
function marketSites(){ return Store.all().filter(s => siteMarket(s) === currentMarket); }

// ---- Competitive projects: right-click to drop, tinted by stage, market-scoped ----
const COMP_STAGES = [
  {id:'proposed',     label:'Proposed / planning', hex:'#9B6DD6'},
  {id:'entitlement',  label:'Entitlements',        hex:'#2FA8A0'},
  {id:'permitting',   label:'Permitting',          hex:'#E0B23C'},
  {id:'construction', label:'Under construction',  hex:'#E08A2E'},
  {id:'existing',     label:'Existing',            hex:'#3F7FD6'},
];
const compStageById = Object.fromEntries(COMP_STAGES.map(s=>[s.id,s]));
// backward-compat: older saved competitive projects used a different stage set
compStageById.ground = compStageById.construction;
compStageById.delivered = compStageById.existing;
const _STAGE_ALIAS = {ground:'construction', delivered:'existing'};
function projStageOf(c){ const id=_STAGE_ALIAS[c.stage]||c.stage||'proposed'; return compStageById[id]||COMP_STAGES[0]; }
const COMP_KEY = 'wb_competitors_v1';
const Comp = {
  data: [],
  load(){ try{ const r=localStorage.getItem(COMP_KEY); if(r) this.data=JSON.parse(r)||[]; }catch(e){ this.data=[]; } },
  save(){ try{ localStorage.setItem(COMP_KEY, JSON.stringify(this.data)); }catch(e){} },
  all(){ return this.data; },
  add(c){ c.id='comp_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); this.data.push(c); this.save(); return c; },
  get(id){ return this.data.find(c=>c.id===id)||null; },
  update(id, patch){ const c=this.get(id); if(c){ Object.assign(c, patch); this.save(); } return c; },
  remove(id){ this.data=this.data.filter(c=>c.id!==id); this.save(); },
};
Comp.load();
function marketComps(){ return Comp.all().filter(c => (c.market||'phoenix') === currentMarket); }
let competitorsOn = true;
let pipelineOn = true;
// Tile-clicked parcels store no polygon. If a tracked parcel lacks geometry, fetch it by APN from
// the county service and cache it on the record, so every tracked site highlights on the map.
const _geomFetching = new Set();
async function ensureParcelGeometry(site, parcel){
  const apn = parcel.apn; if(!apn || _geomFetching.has(apn)) return;
  const m = MARKETS[siteMarket(site)] || mkt();
  const svc = m.fallbackSvc || m.parcelSvc;
  if(!svc){ console.warn('[geom] no service for', siteMarket(site)); return; }
  _geomFetching.add(apn);
  console.log('[geom] fetching', apn, '· click:', parcel._lat, parcel._lng, '· svc:', svc);
  try{
    let feat = null;
    if(parcel._lat != null && parcel._lng != null){
      const pt = {x:parcel._lng, y:parcel._lat, spatialReference:{wkid:4326}};
      const gj = await arcgisQuery(svc, {
        geometry: JSON.stringify(pt), geometryType:'esriGeometryPoint', inSR:4326,
        spatialRel:'esriSpatialRelIntersects', outFields:'', returnGeometry:true, outSR:4326, resultRecordCount:1,
      }).catch(e=>{ console.warn('[geom] point query error', e); return null; });
      feat = gj && gj.features && gj.features[0];
      console.log('[geom] point query →', gj ? (gj.features||[]).length+' features' : 'null', feat&&feat.geometry?'(has geometry)':'(no geometry)');
    } else { console.log('[geom] no click point stored, trying APN'); }
    if(!feat){
      const gj = await arcgisQuery(svc, {
        where: m.apnSearch ? m.apnSearch(apn) : `APN='${apn}'`,
        outFields:'', returnGeometry:true, outSR:4326, resultRecordCount:1,
      }).catch(e=>{ console.warn('[geom] APN query error', e); return null; });
      feat = gj && gj.features && gj.features[0];
      console.log('[geom] APN query →', gj ? (gj.features||[]).length+' features' : 'null');
    }
    if(feat && feat.geometry){
      const ac = geomAcres(feat.geometry);
      const s = Store.get(site.id);
      if(s){ const rec=(s.parcels||[]).find(x=>x.apn===apn); if(rec){ rec.geometry=feat.geometry; if(!(rec.acres>0)&&ac>0) rec.acres=ac; } Store.upsert(s); }
      console.log('[geom] ✓ stored geometry for', apn);
      renderTracked();
    } else {
      console.warn('[geom] ✗ no geometry found for', apn, '— it will not highlight');
    }
  }catch(e){ console.warn('[geom] failed', e); }
  finally{ _geomFetching.delete(apn); }
}

function computedAcres(s){ return (s.parcels||[]).reduce((a,p)=>a+(p.acres||0),0); }
// ---- Site documents (Excel, PDF, images) — stored base64 in the site record ----
const DOC_MAX = 8 * 1024 * 1024;   // 8 MB per file, keeps localStorage sane
function docIcon(name){
  const e = (name.split('.').pop()||'').toLowerCase();
  if(e==='xlsx'||e==='xls'||e==='csv') return '📊';
  if(e==='pdf') return '📄';
  if(e==='png'||e==='jpg'||e==='jpeg'||e==='gif') return '🖼️';
  if(e==='doc'||e==='docx') return '📝';
  return '📎';
}
function fmtBytes(b){ return b<1024?b+' B':b<1048576?(b/1024).toFixed(0)+' KB':(b/1048576).toFixed(1)+' MB'; }
function renderDocsList(s){
  const docs = s.docs||[];
  if(!docs.length) return '';
  return '<div class="doc-list">' + docs.map((d,i)=>
    '<div class="doc-item" data-i="'+i+'">'
    + '<span class="doc-ic">'+docIcon(d.name)+'</span>'
    + '<div class="doc-meta"><div class="doc-name">'+esc(d.name)+'</div><div class="doc-sub">'+fmtBytes(d.size)+' · '+new Date(d.t).toLocaleDateString('en-US',{month:'short',day:'numeric'})+'</div></div>'
    + '<button class="doc-dl" data-dl="'+i+'" title="Download">↓</button>'
    + '<button class="doc-rm" data-rm="'+i+'" title="Remove">×</button>'
    + '</div>').join('') + '</div>';
}
function wireDocs(s){
  const input = $('docInput'); if(!input) return;
  input.addEventListener('change', e=>{
    const file = e.target.files && e.target.files[0]; if(!file) return;
    if(file.size > DOC_MAX){ alert('That file is '+fmtBytes(file.size)+'. Attachments are capped at 8 MB so they fit in the browser store. For big workbooks, keep the file in Drive and note the link.'); input.value=''; return; }
    const reader = new FileReader();
    reader.onload = ()=>{
      const site = Store.get(sdCurrentId); if(!site) return;
      site.docs = site.docs || [];
      site.docs.push({ name:file.name, size:file.size, type:file.type, t:Date.now(), data:reader.result });
      Store.upsert(site); renderSiteDetailBody(site);
    };
    reader.readAsDataURL(file);
  });
  $('siteDetailBody').querySelectorAll('[data-dl]').forEach(b=>b.addEventListener('click', ()=>{
    const site=Store.get(sdCurrentId); const d=site&&site.docs&&site.docs[+b.dataset.dl]; if(!d) return;
    const a=document.createElement('a'); a.href=d.data; a.download=d.name; a.click();
  }));
  $('siteDetailBody').querySelectorAll('[data-rm]').forEach(b=>b.addEventListener('click', ()=>{
    const site=Store.get(sdCurrentId); if(!site||!site.docs) return;
    if(!confirm('Remove this attachment?')) return;
    site.docs.splice(+b.dataset.rm,1); Store.upsert(site); renderSiteDetailBody(site);
  }));
}
function siteAcres(s){
  if(s && s.acresOverride != null && s.acresOverride !== '') return +s.acresOverride || 0;
  return (s.parcels||[]).reduce((a,p)=>a+(p.acres||0),0);
}
function siteBounds(s){
  const b = L.latLngBounds([]);
  (s.parcels||[]).forEach(p=>{ if(p.geometry){ try{ b.extend(L.geoJSON(p.geometry).getBounds()); }catch(e){} } });
  return b.isValid() ? b : null;
}
function siteCentroid(s){ const b = siteBounds(s); return b ? b.getCenter() : null; }
function siteName(s){ return s.name || (s.parcels[0] && (s.parcels[0].apnDash || s.parcels[0].apn)) || 'Site'; }
function parcelRec(apn, attrs, geometry, acres){
  const rec = {apn, apnDash:attrs.APN_DASH || null, attrs, geometry, acres};
  // remember where it was clicked, so geometry can always be re-fetched via a point query
  const c = window._lastParcelClick;
  if(c){ rec._lat = c.lat; rec._lng = c.lng; }
  else if(geometry){ try{ const ctr = L.geoJSON(geometry).getBounds().getCenter(); rec._lat=ctr.lat; rec._lng=ctr.lng; }catch(e){} }
  return rec;
}

const siteMarkerPane = map.createPane('siteMarkers'); siteMarkerPane.style.zIndex = 650;
const siteMarkerLayer = L.layerGroup([], {pane:'siteMarkers'}).addTo(map);
const trackedLayer = L.geoJSON(null, {pane:'tracked', renderer:trackedRenderer}).addTo(map);
const compMarkerLayer = L.layerGroup([], {pane:'siteMarkers'}).addTo(map);

// ---- Map tools: measure, radius rings, street view ----
let _activeTool = null;
const toolLayer = L.layerGroup().addTo(map);
// Rings live on their own persistent layer (canvas-rendered so they show in snapshots) — they stay until cleared.
const ringsRenderer = L.canvas({ padding:0.5 });
const ringsGroup = L.layerGroup().addTo(map);
const RING_SETS = { small:[0.25,0.5,1], mid:[1,3,5], big:[1,5,10] };
let _ringSet = 'small', _ringCenter = null;
function ringMiLabel(mi){ return (mi===0.25?'¼':mi===0.5?'½':mi)+' mi'; }
function drawRings(latlng){
  _ringCenter = latlng; ringsGroup.clearLayers();
  L.circleMarker(latlng,{radius:6,color:'#111',weight:2.5,fillColor:'#FFEB3B',fillOpacity:1,renderer:ringsRenderer}).addTo(ringsGroup);
  RING_SETS[_ringSet].forEach(mi=>{
    const r = mi*1609.34;
    L.circle(latlng,{radius:r,color:'#000',weight:5,opacity:.32,fill:false,renderer:ringsRenderer}).addTo(ringsGroup);
    L.circle(latlng,{radius:r,color:'#FFEB3B',weight:2.5,opacity:1,fill:false,renderer:ringsRenderer}).addTo(ringsGroup);
    const edge = L.latLng(latlng.lat + (r/111320), latlng.lng);
    L.marker(edge,{interactive:false,icon:L.divIcon({className:'ring-lbl',html:ringMiLabel(mi),iconSize:[46,18]})}).addTo(ringsGroup);
  });
}
function clearRings(){ ringsGroup.clearLayers(); _ringCenter=null; }
let _measurePts = [];
function setTool(tool){
  const turningOff = (_activeTool === tool);
  clearActiveTool();
  document.querySelectorAll('#mapTools button').forEach(b=>b.classList.toggle('active', !turningOff && b.dataset.tool===tool));
  if(turningOff){ _activeTool=null; return; }
  _activeTool = tool;
  const bar = $('toolBar');
  if(tool==='rings'){
    bar.innerHTML = 'Rings: <span class="ring-sets" id="ringSets">'
      + '<button data-rs="small" class="'+(_ringSet==='small'?'on':'')+'">¼·½·1</button>'
      + '<button data-rs="mid" class="'+(_ringSet==='mid'?'on':'')+'">1·3·5</button>'
      + '<button data-rs="big" class="'+(_ringSet==='big'?'on':'')+'">1·5·10</button></span> mi · click a point'
      + ' <button class="tool-x" id="ringClear">Clear rings</button>'
      + ' <button class="tool-x" id="toolDone">Done</button>';
    bar.classList.add('show');
    map.getContainer().style.cursor = 'crosshair';
    bar.querySelectorAll('#ringSets button').forEach(b=>b.onclick=()=>{
      _ringSet=b.dataset.rs; bar.querySelectorAll('#ringSets button').forEach(x=>x.classList.toggle('on',x.dataset.rs===_ringSet));
      if(_ringCenter) drawRings(_ringCenter);   // live re-draw at the same center
    });
    const rc=$('ringClear'); if(rc) rc.onclick=()=>clearRings();
    const done=$('toolDone'); if(done) done.onclick=()=> setTool('rings');
    return;
  }
  const hint = tool==='measure' ? 'Click points to measure · double-click to finish · <span id="toolReadout">0 ft</span>'
    : 'Click a point to open Street View there';
  bar.innerHTML = hint + ' <button class="tool-x" id="toolDone">Done</button>';
  bar.classList.add('show');
  map.getContainer().style.cursor = 'crosshair';
  const done = $('toolDone'); if(done) done.onclick = ()=> setTool(tool);
}
function clearActiveTool(){
  toolLayer.clearLayers(); _measurePts = [];
  $('toolBar').classList.remove('show'); $('toolBar').innerHTML='';
  map.getContainer().style.cursor = '';
}
function fmtDist(m){
  const ft = m*3.28084;
  return ft < 1000 ? Math.round(ft).toLocaleString()+' ft' : (ft/5280).toFixed(2)+' mi ('+Math.round(ft).toLocaleString()+' ft)';
}
function handleToolClick(latlng){
  if(_activeTool==='measure'){
    _measurePts.push(latlng);
    toolLayer.clearLayers();
    L.polyline(_measurePts, {color:'#FF7A00', weight:3, dashArray:'6,4'}).addTo(toolLayer);
    _measurePts.forEach(p=> L.circleMarker(p,{radius:4,color:'#fff',weight:2,fillColor:'#FF7A00',fillOpacity:1}).addTo(toolLayer));
    let dist=0; for(let i=1;i<_measurePts.length;i++) dist += map.distance(_measurePts[i-1], _measurePts[i]);
    let txt = fmtDist(dist);
    if(_measurePts.length>=3){
      const ac = geomAcres({type:'Polygon', coordinates:[[..._measurePts.map(p=>[p.lng,p.lat]), [_measurePts[0].lng,_measurePts[0].lat]]]});
      if(ac>0) txt += ' · area ≈ '+ac.toFixed(2)+' ac';
    }
    const ro=$('toolReadout'); if(ro) ro.textContent = txt;
  } else if(_activeTool==='rings'){
    drawRings(latlng);
  } else if(_activeTool==='streetview'){
    window.open(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${latlng.lat},${latlng.lng}`, '_blank');
    setTool('streetview');
  }
}

// ---- Boundary editing: draw a fresh polygon to reshape a parcel ----
let _boundEdit = null;   // { siteId, pIdx, layer }
function startBoundaryEdit(siteId, pIdx){
  const site = Store.get(siteId); if(!site) return;
  const parcel = site.parcels[pIdx]; if(!parcel) return;
  if(!(map.pm)){ alert('Boundary tool is still loading — try again in a moment.'); return; }
  // close the modals so the map is visible
  $('siteDetailOverlay').classList.remove('open');
  $('sitesHomeOverlay').classList.remove('open');
  // center on the parcel (existing geometry or its stored click point) so you draw in the right spot
  try{
    if(parcel.geometry){ map.fitBounds(L.geoJSON(parcel.geometry).getBounds().pad(0.4)); }
    else if(parcel._lat!=null){ map.setView([parcel._lat, parcel._lng], 18); }
  }catch(e){}
  _boundEdit = { siteId, pIdx, layer:null };
  const bar = $('boundaryBar');
  if(bar){ const t=bar.querySelector('.bb-text'); if(t) t.innerHTML = 'Click to place each corner · click the first point to finish · <span id="bbAcres">—</span>'; }
  bar && bar.classList.add('show');
  // start Geoman's draw tool — click to place vertices, click the first to close
  map.pm.enableDraw('Polygon', { snappable:true, finishOn:null, templineStyle:{color:'#FF7A00'}, hintlineStyle:{color:'#FF7A00',dashArray:'4,4'}, pathOptions:{color:'#FF7A00', weight:3, fillColor:'#FF9A2E', fillOpacity:0.25} });
  map.once('pm:create', (e)=>{
    _boundEdit.layer = e.layer;
    try{ const a=geomAcres(e.layer.toGeoJSON().geometry); const el=$('bbAcres'); if(el) el.textContent = a>0?a.toFixed(2)+' ac':'—'; }catch(err){}
  });
}
function endBoundaryEdit(save){
  if(!_boundEdit) return;
  const { siteId, pIdx, layer } = _boundEdit;
  try{ map.pm.disableDraw('Polygon'); }catch(e){}
  if(save && layer){
    try{
      const geom = layer.toGeoJSON().geometry;
      const s = Store.get(siteId);
      if(s && s.parcels[pIdx]){
        s.parcels[pIdx].geometry = geom;
        const ac = geomAcres(geom);
        if(ac > 0){ s.parcels[pIdx].acres = ac; s.acresOverride = null; }  // recompute from drawn shape
        s.parcels[pIdx]._customBoundary = true;
        Store.upsert(s);
      }
    }catch(e){ console.warn('boundary save failed', e); }
  }
  try{ if(layer) map.removeLayer(layer); }catch(e){}
  $('boundaryBar').classList.remove('show');
  const sid = _boundEdit.siteId;
  _boundEdit = null;
  renderTracked();
  sdEditing = true;
  openSiteDetail(sid); setSdEditing(true);
}

// ---- Market comps (CoStar): one clustered layer, market-scoped, deletable ----
let _compsData = null, _compsLoading = false;
// dots must sit ABOVE the parcel tiles (z-index 415) or the tiles swallow their clicks
const compsPane = map.createPane('comps'); compsPane.style.zIndex = 620;
const compsRenderer = L.canvas({ pane:'comps', padding:0.5 });
const compsCluster = L.markerClusterGroup({ chunkedLoading:true, maxClusterRadius:50, spiderfyOnMaxZoom:true, disableClusteringAtZoom:16, clusterPane:'comps' });
let compsOn = true;   // unified "Comps" — drives both CoStar comps and manually-added comps
const PIPELINE_STATUSES = /under construction|proposed|planning|final planning/i;
// user-hidden comps (bad/outdated CoStar rows) persist across sessions
const COMP_HIDE_KEY = 'wb_comps_hidden_v1';
let _compHidden = (function(){ try{ return new Set(JSON.parse(localStorage.getItem(COMP_HIDE_KEY)||'[]')); }catch(e){ return new Set(); } })();
function compKey(c){ return (c.n||'')+'|'+c.la+'|'+c.lo; }
function hideComp(c){ _compHidden.add(compKey(c)); try{ localStorage.setItem(COMP_HIDE_KEY, JSON.stringify([..._compHidden])); }catch(e){} refreshComps(); }
async function loadComps(){
  if(_compsData || _compsLoading) return _compsData;
  _compsLoading = true;
  const st = $('compsStatus'); if(st) st.textContent = 'loading…';
  try{
    _compsData = await window.ScoutDB.loadComps();   // v2: from the property table (login required), not the public comps.json
    if(st) st.textContent = '· '+_compsData.length.toLocaleString()+' loaded';
  }catch(e){
    if(st) st.textContent = '· comps.json not found';
    _compsData = [];
  }
  _compsLoading = false;
  return _compsData;
}
function compMarker(c0){
  const c=compView(c0), ll=compLL(c0);
  const pipeline = PIPELINE_STATUSES.test(c.s||'');
  const color = compStatusColor(c.s);
  const m = L.circleMarker(ll, { radius:5, color:'#fff', weight:1, fillColor:color, fillOpacity:0.9, renderer:compsRenderer });
  const id = 'cdel_'+Math.random().toString(36).slice(2,9);
  const eid='ced_'+id, rid='crl_'+id;
  const usd = v => v!=null ? '$'+Number(v).toLocaleString('en-US') : '—';
  const psf = v => v!=null ? '$'+Number(v).toFixed(2) : '—';
  // stat tiles: PSF is the headline, per-unit the secondary line
  const tiles = [];
  if(c.oc!=null) tiles.push(`<div class="cpx-tile"><div class="cpx-v">${c.oc}%</div><div class="cpx-l">Occupancy</div></div>`);
  if(c.aps!=null||c.apu!=null) tiles.push(`<div class="cpx-tile"><div class="cpx-v">${psf(c.aps)}<span class="cpx-u">/sf</span></div><div class="cpx-l">Asking</div>${c.apu!=null?`<div class="cpx-sec">${usd(c.apu)}/unit</div>`:''}</div>`);
  if(c.eps!=null||c.epu!=null) tiles.push(`<div class="cpx-tile"><div class="cpx-v">${psf(c.eps)}<span class="cpx-u">/sf</span></div><div class="cpx-l">Effective</div>${c.epu!=null?`<div class="cpx-sec">${usd(c.epu)}/unit</div>`:''}</div>`);
  const statGrid = tiles.length ? `<div class="cpx-grid">${tiles.join('')}</div>` : '';
  const detail = [
    ['Units', c.u!=null?c.u:null],['Class', c.c],['Year built', c.y],
    ['Avg unit SF', c.usf!=null?Number(c.usf).toLocaleString()+' sf':null],
    ['Developer', c.d||c.dev],['Owner', c.o],['Submarket', c.sb],
  ].filter(r=>r[1]!=null && r[1]!=='')
   .map(r=>`<div class="cpx-row"><span class="cpx-k">${r[0]}</span><span class="cpx-val">${esc(String(r[1]))}</span></div>`).join('');
  const cid='ccl_'+id;
  const html = `<div class="cpx">
      <div class="cpx-head" style="--sc:${color}">
        <div class="cpx-htop">
          <span class="cpx-pill"><span class="cpx-pdot"></span>${esc(c.s||'Comp')}</span>
          <div class="cpx-icons"><button class="cpx-edit" id="${eid}" title="Edit comp"><svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M11.6 1.6 14.4 4.4 5.3 13.5l-3.3.8.8-3.3 9.1-9.1zM10.5 2.7 3 10.2l-.4 1.9 1.9-.4 7.5-7.5-1.5-1.5z"/></svg></button><button class="cpx-close" id="${cid}" title="Close">✕</button></div>
        </div>
        <div class="cpx-name">${esc(c.n||'Unnamed property')}</div>
        ${(c.a||c.ci)?`<div class="cpx-sub">${esc(c.a||'')}${c.ci?(c.a?', ':'')+esc(c.ci):''}</div>`:''}
      </div>
      ${statGrid}
      <div class="cpx-detail">${detail}</div>
      <div class="cpx-actions"><button class="cpx-act cpx-reloc" id="${rid}"><svg viewBox="0 0 16 16" width="12" height="12" style="vertical-align:-1px"><path fill="currentColor" d="M8 1 5.5 3.5h1.7v3.7H3.5V5.5L1 8l2.5 2.5V8.8h3.7v3.7H5.5L8 15l2.5-2.5H8.8V8.8h3.7v1.7L15 8l-2.5-2.5v1.7H8.8V3.5h1.7L8 1Z"/></svg> Relocate</button><button class="cpx-act cpx-del" id="${id}">Remove</button></div>
    </div>`;
  m.bindPopup(html, {className:'comp-popup', maxWidth:288, minWidth:252, closeButton:false});
  m.on('popupopen', ()=>{
    const del=document.getElementById(id); if(del) del.onclick=()=>{ map.closePopup(); hideComp(c0); };
    const ed=document.getElementById(eid); if(ed) ed.onclick=()=>{ map.closePopup(); openCompEditor('cs:'+compKey(c0)); };
    const rl=document.getElementById(rid); if(rl) rl.onclick=()=>{ map.closePopup(); startCompMove('cs:'+compKey(c0), c.n||'comp'); };
    const cl=document.getElementById(cid); if(cl) cl.onclick=()=>map.closePopup();
  });
  return m;
}
async function refreshComps(){
  if(!compsOn){ if(map.hasLayer(compsCluster)) map.removeLayer(compsCluster); return; }
  const data = await loadComps();
  compsCluster.clearLayers();
  const markers = data
    .filter(c => c.m === currentMarket && !_compHidden.has(compKey(c)))
    .map(compMarker);
  compsCluster.addLayers(markers);
  if(!map.hasLayer(compsCluster)) map.addLayer(compsCluster);
}

// ---- Major attractions (POI): team-editable, Supabase-backed, labeled ----
let poiOn = false, poiChannel = null, _poiSeedLoaded = false;
const poiPane = map.createPane('poi'); poiPane.style.zIndex = 618;
const poiCluster = L.markerClusterGroup({ chunkedLoading:true, maxClusterRadius:38, spiderfyOnMaxZoom:true, disableClusteringAtZoom:12, clusterPane:'poi' });
const POI_CATS = {
  employer:  {label:'Employer / HQ', color:'#3B5BDB', icon:'M3 5h10v9H3V5Zm2 2v1.5h1.5V7H5Zm3.5 0v1.5H10V7H8.5ZM5 10v1.5h1.5V10H5Zm3.5 0v1.5H10V10H8.5Z'},
  hospital:  {label:'Hospital', color:'#DB5A7B', icon:'M6.5 2h3v3h3v3h-3v3h-3V8h-3V5h3V2Z'},
  university:{label:'University', color:'#2E9E8F', icon:'M8 2.5 1.5 6 8 9.5 14.5 6 8 2.5ZM4 8.2v2.6C4 11.9 5.8 13 8 13s4-1.1 4-2.2V8.2L8 10.3 4 8.2Z'},
  venue:     {label:'Sports / venue', color:'#E8873D', icon:'M8 1.6 9.9 5.6 14.3 6.2 11.1 9.3 11.9 13.7 8 11.6 4.1 13.7 4.9 9.3 1.7 6.2 6.1 5.6 8 1.6Z'},
  transit:   {label:'Airport / transit', color:'#7048E8', icon:'M8 1.6 6.4 7 1.6 9.2v1.5l4.8-1.1L5.8 13.2l-1.6.9v1.3L8 14.2l3.8 1.2v-1.3l-1.6-.9-.6-3.6 4.8 1.1V9.2L9.6 7 8 1.6Z'},
  retail:    {label:'Retail center', color:'#C99A2E', icon:'M3.2 5h9.6l-.9 8.2H4.1L3.2 5Zm2.3-2h5v2h-5V3Z'},
};
const POI_CAT_ORDER = ['employer','hospital','university','venue','transit','retail'];

// Local mirror (cache); Supabase is source of truth when signed in
const PoiStore = {
  data:{},
  load(){ try{ const raw=localStorage.getItem('wb_pois_v1'); this.data = raw?JSON.parse(raw):{}; }catch(e){ this.data={}; } },
  save(){ try{ localStorage.setItem('wb_pois_v1', JSON.stringify(this.data)); }catch(e){} },
  all(){ return Object.values(this.data); },
  get(id){ return this.data[id]; },
  upsert(p){ p.updated=Date.now(); this.data[p.id]=p; this.save(); sbPushPoi(p); },
  remove(id){ delete this.data[id]; this.save(); sbDeletePoi(id); },
  newId(){ return 'poi_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6); },
};
PoiStore.load();

async function sbFetchPois(){
  if(!sb || !authed) return null;
  try{ const {data,error}=await sb.from('pois').select('id,data'); if(error){ console.warn('[poi] fetch',error.message); return null;} return data; }
  catch(e){ return null; }
}
async function sbPushPoi(p){
  if(!sb || !authed) return;
  try{ await sb.from('pois').upsert({ id:p.id, data:p, market:p.m, updated:p.updated||Date.now() }); }catch(e){ console.warn('[poi] push',e); }
}
async function sbDeletePoi(id){
  if(!sb || !authed) return;
  try{ await sb.from('pois').delete().eq('id',id); }catch(e){ console.warn('[poi] delete',e); }
}
async function loadPoiSeed(){
  try{
    return [];   // v2: POIs already live in core.pois
  }catch(e){ return []; }
}
// On login: migrate the curated seed into Supabase the first time, then pull the shared set
async function onPoiAuthed(){
  const cloud = await sbFetchPois();
  if(cloud === null) return;            // backend unreachable → keep local/seed
  if(cloud.length === 0){                // empty table → migrate the seed once
    const seed = await loadPoiSeed();
    for(const p of seed){ PoiStore.data[p.id]=p; await sbPushPoi(p); }
    PoiStore.save();
  } else {
    // MERGE by `updated` timestamp — never let an older cloud copy clobber a newer local edit
    // (e.g. a relocation saved locally before a push landed). Newer-local wins and gets pushed up.
    const cloudMap={}; cloud.forEach(r=>{ if(r.data && r.data.id) cloudMap[r.data.id]=r.data; });
    const merged={}, toPush=[];
    const ids=new Set([...Object.keys(cloudMap), ...Object.keys(PoiStore.data)]);
    ids.forEach(id=>{
      const c=cloudMap[id], l=PoiStore.data[id];
      if(c && l){
        if((l.updated||0) > (c.updated||0)){ merged[id]=l; toPush.push(l); }  // local is newer → keep + sync up
        else merged[id]=c;
      } else if(c){ merged[id]=c; }
      else { merged[id]=l; toPush.push(l); }                                   // local-only → keep + sync up
    });
    PoiStore.data = merged; PoiStore.save();
    for(const p of toPush){ sbPushPoi(p); }
  }
  subscribePois();
  if(poiOn) refreshPoi();
}
function subscribePois(){
  if(!sb || poiChannel) return;
  poiChannel = sb.channel('pois-live').on('postgres_changes',{event:'*',schema:'public',table:'pois'},payload=>{
    try{
      if(payload.eventType==='DELETE'){ const id=payload.old&&payload.old.id; if(id) delete PoiStore.data[id]; }
      else { const d=payload.new&&payload.new.data; if(d&&d.id){ const cur=PoiStore.data[d.id]; if(!cur || (d.updated||0) >= (cur.updated||0)) PoiStore.data[d.id]=d; } }
      PoiStore.save(); if(poiOn) refreshPoi();
    }catch(e){}
  }).subscribe();
}

function poiMarker(p){
  const cat = POI_CATS[p.cat] || POI_CATS.employer;
  // Clickable pin = a fixed-size circle (rock-solid hit area). Label rides as a tooltip.
  const icon = L.divIcon({ className:'poi-pin2', iconSize:[26,26], iconAnchor:[13,13],
    html:`<span class="poi-ic" style="--pc:${cat.color}"><svg viewBox="0 0 16 16" width="13" height="13"><path fill="#fff" d="${cat.icon}"/></svg></span>` });
  const m = L.marker([p.la, p.lo], { icon, pane:'poi' });
  const label = `<span class="poi-lab-name">${esc(p.n)}</span>` + (p.sub?`<span class="poi-lab-sub">${esc(p.sub)}</span>`:'');
  m.bindTooltip(label, { permanent:true, direction:'right', offset:[9,0], className:'poi-tip', pane:'poi', interactive:false });
  m.bindPopup(poiPopupHtml(p), { className:'poi-popup', minWidth:210, autoPan:true });
  m.on('popupopen', (ev)=>{
    const root = ev.popup.getElement(); if(!root) return;
    const ed = root.querySelector('.poi-edit'); if(ed) ed.onclick=()=>{ map.closePopup(); openPoiEditor(p.id); };
    const mv = root.querySelector('.poi-move'); if(mv) mv.onclick=()=>{ startPoiMove(p.id); };
    const del = root.querySelector('.poi-del'); if(del) del.onclick=()=>{ if(confirm('Remove "'+p.n+'" from attractions?')){ PoiStore.remove(p.id); map.closePopup(); refreshPoi(); } };
    const det = root.querySelector('.poi-details-btn'); if(det) det.onclick=()=>{ map.closePopup(); openPoiDetail(p.id); };
  });
  return m;
}
function poiPopupHtml(p){
  const cat = POI_CATS[p.cat] || POI_CATS.employer;
  return `<div class="poi-pop"><div class="poi-cat" style="color:${cat.color}">${cat.label}</div>`
    + `<div class="poi-name">${esc(p.n)}</div>`
    + (p.sub?`<div class="poi-metric">${esc(p.sub)}</div>`:'')
    + (p.note?`<div class="poi-note">${esc(p.note)}</div>`:'')
    + `<button class="poi-details-btn">View details →</button>`
    + `<div class="poi-actions"><button class="poi-edit">Edit</button><button class="poi-move">Move</button><button class="poi-del">Remove</button></div></div>`;
}
// Reliable "move" flow: tap Move, then click the map to drop the pin at the new spot.
let _poiMoveId = null;
function startPoiMove(id){
  const p = PoiStore.get(id); if(!p) return;
  _poiMoveId = id; map.closePopup();
  const b = $('poiMoveBar'); if(b){ $('poiMoveName').textContent = p.n || 'attraction'; b.classList.add('show'); }
  map.getContainer().style.cursor = 'crosshair';
}
function finishPoiMove(latlng){
  const p = PoiStore.get(_poiMoveId);
  if(p){ p.la = +latlng.lat.toFixed(6); p.lo = +latlng.lng.toFixed(6); PoiStore.upsert(p); refreshPoi(); if(_snapComposed){ snapExpandMarkers(); buildSnapLegend(); } if($('poiPickOverlay')&&$('poiPickOverlay').classList.contains('open')) buildPoiPickList(); }
  cancelPoiMove();
}
function cancelPoiMove(){
  _poiMoveId = null;
  const b = $('poiMoveBar'); if(b) b.classList.remove('show');
  map.getContainer().style.cursor = '';
}
document.addEventListener('keydown', e=>{ if(e.key==='Escape' && _poiMoveId) cancelPoiMove(); });
document.addEventListener('keydown', e=>{ if(e.key==='Escape' && _calloutMove) cancelCalloutMove(); });
document.addEventListener('keydown', e=>{ if(e.key==='Escape' && _compMoveKey) cancelCompMove(); });
function refreshPoi(){
  if(!poiOn){ if(map.hasLayer(poiCluster)) map.removeLayer(poiCluster); return; }
  poiCluster.clearLayers();
  const markers = PoiStore.all().filter(p=>p.m===currentMarket).map(p=>poiMarker(p));
  poiCluster.addLayers(markers);
  if(!map.hasLayer(poiCluster)) map.addLayer(poiCluster);
}

// Add-attraction from the right-click menu
function addPoiAt(lat,lng){
  const p = { id:PoiStore.newId(), n:'', cat:'employer', la:+lat.toFixed(6), lo:+lng.toFixed(6), m:currentMarket, sub:'', note:'' };
  openPoiEditor(null, p);
}
async function ensurePoiData(){
  if(PoiStore.all().length===0){
    const seed = await loadPoiSeed();
    const d={}; seed.forEach(p=>{ if(p.id) d[p.id]=p; }); PoiStore.data=d; PoiStore.save();
  }
}
let _poiEditDraft = null;
function openPoiEditor(existingId, draft){
  const p = existingId ? PoiStore.get(existingId) : draft;
  if(!p) return;
  _poiEditDraft = { ...p };
  $('poiEditTitle').textContent = existingId ? 'Edit attraction' : 'Add attraction';
  $('peName').value = p.n||''; $('peSub').value = p.sub||''; $('peNote').value = p.note||'';
  // category chips
  const wrap = $('peCats'); wrap.innerHTML='';
  POI_CAT_ORDER.forEach(c=>{
    const cat=POI_CATS[c];
    const b=document.createElement('button'); b.type='button'; b.className='pe-cat'+(p.cat===c?' on':'');
    b.dataset.cat=c; b.style.setProperty('--pc',cat.color);
    b.innerHTML=`<span class="pe-cat-ic"><svg viewBox="0 0 16 16" width="12" height="12"><path fill="#fff" d="${cat.icon}"/></svg></span>${cat.label}`;
    b.onclick=()=>{ _poiEditDraft.cat=c; wrap.querySelectorAll('.pe-cat').forEach(x=>x.classList.toggle('on', x.dataset.cat===c)); };
    wrap.appendChild(b);
  });
  $('peDelete').style.display = existingId ? '' : 'none';
  $('poiEditOverlay').classList.add('open');
  setTimeout(()=>$('peName').focus(), 50);
}
function closePoiEditor(){ $('poiEditOverlay').classList.remove('open'); _poiEditDraft=null; }
function savePoiEditor(){
  if(!_poiEditDraft) return;
  const name=$('peName').value.trim();
  if(!name){ $('peName').focus(); return; }
  const isNew = !PoiStore.get(_poiEditDraft.id);
  _poiEditDraft.n=name; _poiEditDraft.sub=$('peSub').value.trim(); _poiEditDraft.note=$('peNote').value.trim();
  PoiStore.upsert(_poiEditDraft);
  if(isNew) _snapLabeled.add('poi:'+_poiEditDraft.id);   // new anchors default on-deck
  closePoiEditor();
  if(!poiOn){ poiOn=true; const t=$('tglPoi'); if(t) t.checked=true; }
  refreshPoi();
  if(_snapComposed){ snapExpandMarkers(); buildSnapLegend(); }
  if($('poiPickOverlay')&&$('poiPickOverlay').classList.contains('open')) buildPoiPickList();
}

// ---- POI detail modal: rich breakdown, team description, smart links ----
let _pdId = null;
const POI_LINK_QUERY = {
  hospital:   n=>`${n} hospital beds trauma level`,
  university: n=>`${n} enrollment students`,
  employer:   n=>`${n} headquarters employees`,
  venue:      n=>`${n} seating capacity`,
  transit:    n=>`${n} annual passengers`,
  retail:     n=>`${n} square feet stores`,
};
function openPoiDetail(id){
  const p = PoiStore.get(id); if(!p) return;
  _pdId = id;
  const cat = POI_CATS[p.cat] || POI_CATS.employer;
  $('pdCat').textContent = cat.label; $('pdCat').style.color = cat.color;
  $('pdName').textContent = p.n;
  $('pdMetric').textContent = p.sub || '';
  $('pdMetric').style.display = p.sub ? '' : 'none';
  $('pdNote').textContent = p.note || '';
  $('pdNote').style.display = p.note ? '' : 'none';
  $('pdDesc').value = p.desc || '';
  // Smart links — all are searches/coords, never fabricated URLs
  const q = encodeURIComponent(p.n);
  const artQ = encodeURIComponent((POI_LINK_QUERY[p.cat]||(n=>n))(p.n));
  const links = [
    ['Website', `https://www.google.com/search?q=${q}+official+site`, '🌐'],
    ['Size & scale', `https://www.google.com/search?q=${artQ}`, '📊'],
    ['Wikipedia', `https://en.wikipedia.org/w/index.php?search=${q}`, '📖'],
    ['Google Maps', `https://www.google.com/maps/search/?api=1&query=${p.la},${p.lo}`, '📍'],
  ];
  $('pdLinks').innerHTML = links.map(([label,url,ic])=>`<a class="poi-dt-link" href="${url}" target="_blank" rel="noopener"><span class="pdl-ic">${ic}</span>${label}<span class="pdl-arrow">↗</span></a>`).join('');
  $('poiDetailOverlay').classList.add('open');
}
function closePoiDetail(){ $('poiDetailOverlay').classList.remove('open'); _pdId=null; }
function savePoiDesc(){
  const p = PoiStore.get(_pdId); if(!p) return;
  p.desc = $('pdDesc').value.trim(); PoiStore.upsert(p);
  const m=$('pdSave'); if(m){ m.textContent='Saved ✓'; setTimeout(()=>m.textContent='Save description',1600); }
}

// ---- Deck snapshot composer ----
let _snapComposed = false, _snapPrev = null, _snapAR = 1.6, _snapFlat = null;
function openSnap(){
  $('mapControls').querySelectorAll('.mc-cluster.open').forEach(c=>c.classList.remove('open'));
  const s = sdCurrentId ? Store.get(sdCurrentId) : null;
  if(s){ $('snapTitle').value = siteName(s); const ac=siteAcres(s); $('snapSub').value = [ac?ac.toFixed(2)+' ac':'', s.pricing||''].filter(Boolean).join(' · '); }
  $('snapPanel').classList.add('open');
}
function closeSnap(){ if(_snapComposed) snapDone(); $('snapPanel').classList.remove('open'); }
function sizeSnapBox(){
  const wrap=$('mapWrap'), w=wrap.clientWidth, h=wrap.clientHeight, m=0.92;
  let bw=w*m, bh=bw/_snapAR;
  if(bh>h*m){ bh=h*m; bw=bh*_snapAR; }
  const box=$('snapBox'); box.style.width=Math.round(bw)+'px'; box.style.height=Math.round(bh)+'px';
}
function snapBoxBounds(){
  const mapRect=map.getContainer().getBoundingClientRect(), r=$('snapBox').getBoundingClientRect();
  const nw=map.containerPointToLatLng([r.left-mapRect.left, r.top-mapRect.top]);
  const se=map.containerPointToLatLng([r.right-mapRect.left, r.bottom-mapRect.top]);
  return L.latLngBounds(nw,se);
}
function snapCompose(){
  _snapPrev = _snapPrev || { comps:compsOn, poi:poiOn, comp:competitorsOn, pipeline:pipelineOn };
  compsOn = competitorsOn = $('snapComps').checked; poiOn = $('snapPoi').checked; pipelineOn = $('snapPipeline').checked;
  const tc=$('tglComps'); if(tc) tc.checked=compsOn;
  const tp=$('tglPoi'); if(tp) tp.checked=poiOn;
  const tpl=$('tglPipeline'); if(tpl) tpl.checked=pipelineOn;
  const tcp=$('tglCompetitors'); if(tcp) tcp.checked=competitorsOn;
  if(map.hasLayer(compMarkerLayer)) map.removeLayer(compMarkerLayer);   // hide triangles — flat dots/cards used instead
  sizeSnapBox();
  const bm = document.querySelector('.brand-mark'); $('snapLogo').src = bm ? bm.src : '';
  $('snapFrTitle').textContent = $('snapTitle').value.trim() || 'Site overview';
  $('snapFrSub').textContent = $('snapSub').value.trim();
  $('snapFrSub').style.display = $('snapSub').value.trim() ? '' : 'none';
  $('snapFrDate').textContent = new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  $('legend').style.display='none';                       // hide the app's low-contrast legend
  document.querySelector('.snap-titleblock').style.display = $('snapHeader').checked ? '' : 'none';
  buildSnapLegend();
  $('snapFrLegend').style.display = $('snapLegend').checked ? '' : 'none';
  $('snapFrScale').style.display = $('snapScale').checked ? '' : 'none';
  $('snapFrame').classList.add('show');
  _snapComposed = true;
  map.dragging.enable();   // safety: composing never leaves the map un-pannable
  if(_snapSiteFilter===null && typeof sdCurrentId!=='undefined' && sdCurrentId) _snapSiteFilter = new Set([sdCurrentId]);
  Promise.resolve()
    .then(()=> compsOn ? refreshComps() : (refreshComps(), null))
    .then(()=> poiOn ? ensurePoiData().then(()=>refreshPoi()) : refreshPoi())
    .then(()=> renderTracked())
    .then(()=>{ snapExpandMarkers(); updateSnapScale(); buildSnapSites(); });
  $('snapCompose').textContent = 'Recompose';
  $('snapPng').style.display=''; $('snapPdf').style.display=''; $('snapDone').style.display='';
  { const a=$('snapArrange'); if(a) a.style.display=''; }
  $('snapMsg').textContent = 'Pan/zoom to frame the shot inside the box, then export PNG or PDF.';
}
let _snapLabeled = new Set();
let _snapOrder = [];   // user-controlled numbering order for comps/projects (keys); new picks append, removed pruned
let _snapPickedCache = [];   // last-rendered ordered picks, for the reorder view
let _snapCardOffsets = {};   // manual callout positions: key -> {px,py} offset from the anchor dot
let _snapCardReg = {};       // rendered callout rects: key -> {latlng,px,py,w,h,name,el,lineEl} for hit-testing
let _snapWidths = {};        // manual callout widths: key -> px
let _snapEdit = false, _snapDrag = null;   // Arrange mode + active drag/resize gesture
// Comp data overrides — lets you edit CoStar comp fields (name, units, year, SF, rent, occ) for the deck
const COMP_OV_KEY='wb_comp_ov_v1';
let _compOv={}; try{ _compOv=JSON.parse(localStorage.getItem(COMP_OV_KEY)||'{}'); }catch(e){ _compOv={}; }
function compView(c){ const o=_compOv[compKey(c)]; return o?Object.assign({},c,o):c; }
function compLL(c){ const o=_compOv[compKey(c)]; return [ (o&&o.la!=null)?o.la:c.la, (o&&o.lo!=null)?o.lo:c.lo ]; }
function saveCompOv(key,patch){ _compOv[key]=Object.assign({},_compOv[key]||{},patch); try{localStorage.setItem(COMP_OV_KEY,JSON.stringify(_compOv));}catch(e){} }
function compStatusColor(s){ s=(s||'').toLowerCase(); if(/under construction/.test(s)) return '#E08A2E'; if(/propos|planning/.test(s)) return '#9B6DD6'; return '#3F7FD6'; }
function compStatusLabel(s){ s=(s||'').toLowerCase(); if(/under construction/.test(s)) return 'Under construction'; if(/propos|planning/.test(s)) return 'Proposed / planning'; return 'Existing'; }
function snapDir(latlng){ const pt=map.latLngToContainerPoint(latlng), sz=map.getSize(); return (pt.x>sz.x*0.5?'l':'r')+(pt.y>sz.y*0.5?'t':'b'); }
function addSnapCard(latlng,color,name,meta,key){
  const html=`<span class="snc-line"></span><span class="snc-dot" style="--c:${color}"></span><span class="snc-card"><span class="snc-n">${esc(name)}</span>${meta?`<span class="snc-m">${esc(meta)}</span>`:''}</span>`;
  const m=L.marker(latlng,{pane:'poi',icon:L.divIcon({className:'snc snc-'+snapDir(latlng),iconSize:null,iconAnchor:[0,0],html})});
  if(key) m.on('click',()=>{ _snapLabeled.delete(key); snapExpandMarkers(); });
  _snapFlat.addLayer(m);
}
function addSnapDot(latlng,color,key,name){
  const m=L.marker(latlng,{pane:'poi',icon:L.divIcon({className:'snc-do',iconSize:[16,16],iconAnchor:[8,8],html:`<span class="snc-dot" style="--c:${color}"></span>`})});
  if(key) m.bindPopup(snapDotPopup(name,color,false),{className:'snc-pop',minWidth:150,closeButton:false})
    .on('popupopen',ev=>{ const r=ev.popup.getElement(); if(!r) return;
      const a=r.querySelector('.sp-label'); if(a) a.onclick=()=>{ map.closePopup(); _snapLabeled.add(key); snapExpandMarkers(); buildSnapLegend(); };
      const mv=r.querySelector('.sp-move'); if(mv) mv.onclick=()=>{ map.closePopup(); startCompMove(key, name); };
      const h=r.querySelector('.sp-hide'); if(h) h.onclick=()=>{ map.closePopup(); snapHideKey(key); };
    });
  _snapFlat.addLayer(m);
}
function snapDotPopup(name,color,labeled){
  return `<div class="sp-w"><div class="sp-n" style="border-left:3px solid ${color}">${esc(name||'')}</div>`
    + `<div class="sp-a"><button class="${labeled?'sp-unlabel':'sp-label'}">${labeled?'Remove label':'Add label'}</button><button class="sp-move">Move</button><button class="sp-hide">Hide</button></div></div>`;
}
// Move a comp / competitive project — click the map to drop it at a new spot
let _compMoveKey=null;
function startCompMove(key,name){
  _compMoveKey=key; map.closePopup();
  const b=$('poiMoveBar'); if(b){ $('poiMoveName').textContent=name||'comp'; b.classList.add('show'); }
  map.getContainer().style.cursor='crosshair';
}
function finishCompMove(latlng){
  const key=_compMoveKey; _compMoveKey=null;
  const b=$('poiMoveBar'); if(b) b.classList.remove('show'); map.getContainer().style.cursor='';
  if(!key) return;
  const la=+latlng.lat.toFixed(6), lo=+latlng.lng.toFixed(6);
  if(key.startsWith('cs:')){ saveCompOv(key.slice(3),{la,lo}); refreshComps(); }
  else { const id=key.slice(3); if((Comp.all()||[]).find(x=>x.id===id)){ Comp.update(id,{lat:la,lng:lo}); renderCompetitors(); } }
  if(_snapComposed){ snapExpandMarkers(); buildSnapLegend(); }
}
function cancelCompMove(){ _compMoveKey=null; const b=$('poiMoveBar'); if(b) b.classList.remove('show'); map.getContainer().style.cursor=''; }
let _addCompMode=false;
function startAddComp(){ _addCompMode=true; closeCompPicker(); const b=$('poiMoveBar'); if(b){ const n=$('poiMoveName'); if(n) n.textContent='new comp'; b.classList.add('show'); } map.getContainer().style.cursor='crosshair'; }
// Hide a comp/project from the snapshot entirely (dot + card)
let _snapHideCp = new Set();
function snapHideKey(key){
  if(key.startsWith('cs:')){ _compHidden.add(key.slice(3)); try{ localStorage.setItem(COMP_HIDE_KEY, JSON.stringify([..._compHidden])); }catch(e){} }
  else _snapHideCp.add(key.slice(3));
  _snapLabeled.delete(key);
  snapExpandMarkers(); buildSnapLegend();
}
function snapUnhideAll(){
  _compHidden.clear(); try{ localStorage.setItem(COMP_HIDE_KEY,'[]'); }catch(e){}
  _snapHideCp.clear(); refreshComps(); snapExpandMarkers(); buildSnapLegend();
}
function snapVisibleComps(){
  const b=map.getBounds(), out=[];
  if(compsOn) (_compsData||[]).forEach(c=>{ if(c.m===currentMarket && !_compHidden.has(compKey(c)) && c.la!=null && b.contains([c.la,c.lo])) out.push({key:'cs:'+compKey(c)}); });
  if(competitorsOn) (Comp.all()||[]).forEach(c=>{ if((c.market||'phoenix')===currentMarket && c.lat!=null && b.contains([c.lat,c.lng])) out.push({key:'cp:'+c.id}); });
  return out;
}
const _snapFields = {dev:true, u:true, y:true, usf:true, eps:true, oc:true};
function compMetaParts(c){
  const f=_snapFields, top=[], bot=[];
  const isExisting = compStatusLabel(c.s)==='Existing';
  const when = isExisting ? (c.y||c.delivery) : (c.delivery||c.y);   // pipeline → delivery; existing → year built
  if(f.dev && (c.d||c.dev)) top.push(c.d||c.dev);
  if(f.u && c.u!=null) top.push(c.u+' units');
  if(f.y && when) top.push(when);
  if(f.usf && c.usf!=null) top.push(Number(c.usf).toLocaleString()+' SF');
  if(f.eps && c.eps!=null) bot.push('$'+Number(c.eps).toFixed(2)+'/SF');
  if(f.oc && c.oc!=null) bot.push(c.oc+'% occ');
  return { top:top.join('  ·  '), bot:bot.join('  ·  ') };
}
function projMetaParts(c){
  // Identical structure to compMetaParts. Temporal slot is stage-aware: pipeline deals show
  // est. delivery (period + year); existing/built comps show year built.
  const f=_snapFields, top=[], bot=[];
  const isExisting = projStageOf(c).id==='existing';
  const when = isExisting ? (c.year||c.delivery) : (c.delivery||c.year);
  if(f.dev && c.developer) top.push(c.developer);
  if(f.u && c.units!=null) top.push(c.units+' units');
  if(f.y && when) top.push(when);
  if(f.usf && c.usf!=null) top.push(Number(c.usf).toLocaleString()+' SF');
  if(f.eps && c.rent!=null) bot.push('$'+Number(c.rent).toFixed(2)+'/SF');
  if(f.oc && c.occ!=null) bot.push(c.occ+'% occ');
  return { top:top.join('  ·  '), bot:bot.join('  ·  ') };
}
function compMeta(c){ const p=compMetaParts(c); return [p.top,p.bot].filter(Boolean).join('  ·  '); }
function projMeta(c){ const p=projMetaParts(c); return [p.top,p.bot].filter(Boolean).join('  ·  '); }
let _snapStyle = 'numbered';   // 'numbered' | 'callout'
let _snapSiteFilter = null;    // Set of site ids to show in the snapshot, or null = all
function buildSnapSites(){
  const el=$('snapSites'); if(!el) return;
  if(!_snapComposed || !pipelineOn){ el.style.display='none'; el.innerHTML=''; return; }
  const b=map.getBounds();
  const sites=marketSites().filter(s=>{ const c=siteCentroid(s); return c && b.contains(c); });
  if(sites.length<=1){ el.style.display='none'; el.innerHTML=''; return; }
  el.style.display='';
  el.innerHTML='<div class="snap-sublbl">Sites to show</div>'+sites.map(s=>{
    const on=_snapSiteFilter?_snapSiteFilter.has(s.id):true, st=statusById[s.status]||STATUSES[0];
    return `<label class="snap-subchk"><input type="checkbox" class="snap-site" data-id="${s.id}" ${on?'checked':''}><span class="snap-sdot" style="background:${st.hex}"></span>${esc(siteName(s))}</label>`;
  }).join('');
  el.querySelectorAll('.snap-site').forEach(chk=>chk.onchange=()=>{
    const set=new Set(); el.querySelectorAll('.snap-site:checked').forEach(c=>set.add(c.dataset.id));
    _snapSiteFilter=set; renderTracked(); buildSnapLegend();
  });
}
function snapExpandMarkers(){
  snapCollapseMarkers();
  if(!_snapComposed) return;
  _snapFlat = L.layerGroup().addTo(map);
  const b = map.getBounds();
  const onlyLabeled = $('snapOnlyLabeled') && $('snapOnlyLabeled').checked;
  const numbered = _snapStyle==='numbered';
  const picked = [];   // labeled items → {latlng,color,name,metaTop,metaBot,data,kind,key}
  // CoStar comps
  if(compsOn){
    const inView=(_compsData||[]).filter(c=>c.m===currentMarket && !_compHidden.has(compKey(c)) && c.la!=null && b.contains(compLL(c)));
    let dotBudget=300;   // cap only the plain dots for performance — picked cards always render
    inView.forEach(c0=>{
      const key='cs:'+compKey(c0);
      if(_snapLabeled.has(key)){ const c=compView(c0), color=compStatusColor(c.s), ll=compLL(c0), mp=compMetaParts(c); picked.push({latlng:ll,color,name:c.n||'Comp',metaTop:mp.top,metaBot:mp.bot,data:c,kind:'cs',key}); }
      else if(!onlyLabeled && dotBudget-->0){ const c=compView(c0), color=compStatusColor(c.s), ll=compLL(c0); addSnapDot(ll,color,key,c.n||'Comp'); }
    });
  }
  // Competitive projects
  if(competitorsOn){
    (Comp.all()||[]).filter(c=>(c.market||'phoenix')===currentMarket && c.lat!=null && !_snapHideCp.has(c.id) && b.contains([c.lat,c.lng])).forEach(c=>{
      const key='cp:'+c.id, st=projStageOf(c);
      if(_snapLabeled.has(key)){ const mp=projMetaParts(c); picked.push({latlng:[c.lat,c.lng],color:st.hex,name:c.name||'Project',metaTop:mp.top,metaBot:mp.bot,data:c,kind:'cp',key}); }
      else if(!onlyLabeled) addSnapDot([c.lat,c.lng],st.hex,key,c.name||'Project');
    });
  }
  // Attractions — only those toggled on-deck, callout style
  const poiCards=[];
  if(poiOn){
    PoiStore.all().filter(p=>p.m===currentMarket && p.la!=null && _snapLabeled.has('poi:'+p.id) && b.contains([p.la,p.lo])).forEach(p=>{
      const cat=POI_CATS[p.cat]||POI_CATS.employer;
      poiCards.push({latlng:[p.la,p.lo],color:cat.color,name:p.n,metaTop:p.sub||cat.label,metaBot:'',key:'poi:'+p.id});
    });
  }
  // Subject-site callout — labels the deal the aerial is built around
  if(pipelineOn && $('snapSiteCallout') && $('snapSiteCallout').checked){
    marketSites().forEach(s=>{
      if(_snapSiteFilter && !_snapSiteFilter.has(s.id)) return;
      const c=siteCentroid(s); if(!c || !b.contains(c)) return;
      const st=statusById[s.status]||STATUSES[0];
      let ac=0; try{ ac=siteAcres(s); }catch(e){}
      const meta=[ac?ac.toFixed(2)+' ac':'', st.label].filter(Boolean).join('  ·  ');
      poiCards.push({latlng:c, color:'#432890', name:siteName(s), eyebrow:'Subject site', metaTop:'', metaBot:'', subject:true, key:'site:'+s.id});
    });
  }
  // Default numbering is spatial (top→bottom), but the user can override the order via the
  // "Selected comps" reorder view. New picks append in spatial order; removed picks are pruned.
  picked.sort((a,b2)=>{ const pa=map.latLngToContainerPoint(a.latlng), pb=map.latLngToContainerPoint(b2.latlng); return (pa.y-pb.y)||(pa.x-pb.x); });
  const _pk=new Set(picked.map(p=>p.key));
  _snapOrder = _snapOrder.filter(k=>_pk.has(k));
  picked.forEach(p=>{ if(!_snapOrder.includes(p.key)) _snapOrder.push(p.key); });
  picked.sort((a,b2)=> _snapOrder.indexOf(a.key) - _snapOrder.indexOf(b2.key));
  _snapPickedCache = picked.slice();   // for the "Selected comps" reorder view
  if(numbered){
    placeBadges(picked);
    placeAndRenderCards(poiCards);            // attractions still callouts
    buildSnapTable(picked);
  } else {
    placeAndRenderCards(picked.concat(poiCards));
    buildSnapTable(null);
  }
  if(map.hasLayer(compsCluster)) map.removeLayer(compsCluster);
  if(map.hasLayer(poiCluster)) map.removeLayer(poiCluster);
  const any=(compsOn||competitorsOn);
  const set=(id,on)=>{ const e=$(id); if(e) e.style.display=on?'':'none'; };
  set('snapPickEdit',any); set('snapClearLabels',any&&_snapLabeled.size);
  set('snapDeckOrder', _snapPickedCache.length>0);
  set('snapFitPicks', _snapLabeled.size>0);
  set('snapUnhide',any&&(_compHidden.size||_snapHideCp.size)); set('snapPickHint',any);
  set('snapOnlyRow',any);
  set('snapPickPoi', poiOn);
}
// Greedy label placement: for each card pick the direction + vertical nudge that avoids the site marker and other cards, staying in-frame.
// Accurate card sizing via canvas text metrics (no more guessing)
let _measCtx=null;
function measureCardSize(name,metaTop,metaBot,eyebrow){
  if(!_measCtx) _measCtx=document.createElement('canvas').getContext('2d');
  _measCtx.font='700 14.5px "Inter Tight",Inter,sans-serif'; const wn=_measCtx.measureText(name||'').width;
  _measCtx.font='600 13px "Inter Tight",Inter,sans-serif'; const wt=_measCtx.measureText(metaTop||'').width;
  _measCtx.font='700 13.5px "Inter Tight",Inter,sans-serif'; const wb=_measCtx.measureText(metaBot||'').width;
  _measCtx.font='700 8.5px "Inter Tight",Inter,sans-serif'; const we=_measCtx.measureText((eyebrow||'').toUpperCase()).width*1.6;
  const w = Math.min(340, Math.max(wn,wt,wb,we)+28);
  let h = 26; if(eyebrow) h+=14; if(metaTop) h+=18; if(metaBot) h+=24;
  return { w, h };
}
function boxScreenRect(){
  const mr=map.getContainer().getBoundingClientRect(), r=$('snapBox').getBoundingClientRect();
  return { x:r.left-mr.left+12, y:r.top-mr.top+12, x2:r.right-mr.left-12, y2:r.bottom-mr.top-12 };
}
// Tidy label placement: try ranked candidate slots around each dot, take the closest clean one.
const SNC_GAP = 12;
function rectOverlap(r,list){ let s=0; for(const p of list){ const ox=Math.max(0,Math.min(r.x2,p.x2)-Math.max(r.x,p.x)); const oy=Math.max(0,Math.min(r.y2,p.y2)-Math.max(r.y,p.y)); s+=ox*oy; } return s; }
function candidateOffsets(w,h){
  const out=[], gaps=[SNC_GAP,20,30,44,62,84,110,140,176];
  for(const g of gaps){
    out.push([ g,        -h/2,   0]);   // right, vertically centred (cleanest)
    out.push([ -g-w,     -h/2,   0]);   // left,  vertically centred
    out.push([ g,        -h-5,   1]);   // right-up
    out.push([ g,         5,     1]);   // right-down
    out.push([ -g-w,     -h-5,   1]);   // left-up
    out.push([ -g-w,      5,     1]);   // left-down
    out.push([ -w/2,     -g-h,   2]);   // above
    out.push([ -w/2,      g,     2]);   // below
  }
  return out;
}
function segRect(ax,ay,bx,by,pad){ return {x:Math.min(ax,bx)-pad, y:Math.min(ay,by)-pad, x2:Math.max(ax,bx)+pad, y2:Math.max(ay,by)+pad}; }
function placeAndRenderCards(cards){
  if(!cards.length) return;
  const box=boxScreenRect(), obstacles=[];
  // subject-site parcels are obstacles — never cover the deal, and give the callout a real leader gap
  try{ Store.all().forEach(s=>{
    if(_snapSiteFilter && !_snapSiteFilter.has(s.id)) return;
    let b=null; try{ b=siteBounds(s); }catch(e){}
    if(b){ const p1=map.latLngToContainerPoint(b.getNorthWest()), p2=map.latLngToContainerPoint(b.getSouthEast());
      obstacles.push({x:Math.min(p1.x,p2.x)-8, y:Math.min(p1.y,p2.y)-8, x2:Math.max(p1.x,p2.x)+8, y2:Math.max(p1.y,p2.y)+8}); }
    else { const p0=s.parcels&&s.parcels[0]; if(p0&&p0._lat!=null){ const p=map.latLngToContainerPoint([p0._lat,p0._lng]); obstacles.push({x:p.x-14,y:p.y-14,x2:p.x+14,y2:p.y+14}); } }
  }); }catch(e){}
  cards.forEach(c=>{ const pt=map.latLngToContainerPoint(c.latlng); c.ax=pt.x; c.ay=pt.y; const sz=measureCardSize(c.name,c.metaTop,c.metaBot,c.eyebrow); c.w=sz.w; c.h=sz.h; if(c.key && _snapWidths[c.key]){ c.w=_snapWidths[c.key]; } });
  // every dot is an obstacle so cards never sit on top of a marker
  cards.forEach(c=>obstacles.push({x:c.ax-10,y:c.ay-10,x2:c.ax+10,y2:c.ay+10}));
  const placed=[], leaders=[];
  _snapCardReg = {};   // rebuild the right-click hit-test map for this render
  // cards the user has hand-placed: honor their offset, and treat them as obstacles for the rest
  const manual=[], auto=[];
  cards.forEach(c=>{ if(c.key && _snapCardOffsets[c.key]){ c.px=_snapCardOffsets[c.key].px; c.py=_snapCardOffsets[c.key].py; manual.push(c); } else auto.push(c); });
  manual.forEach(c=>{ placed.push({x:c.ax+c.px, y:c.ay+c.py, x2:c.ax+c.px+c.w, y2:c.ay+c.py+c.h}); });
  // subject site first (best slot), then top→bottom, left→right
  auto.slice().sort((a,b)=> (b.subject?1:0)-(a.subject?1:0) || (a.ay-b.ay) || (a.ax-b.ax)).forEach(c=>{
    let best=null, bestScore=Infinity;
    for(const [dx,dy,tier] of candidateOffsets(c.w,c.h)){
      const r={x:c.ax+dx, y:c.ay+dy}; r.x2=r.x+c.w; r.y2=r.y+c.h;
      if(r.x<box.x||r.y<box.y||r.x2>box.x2||r.y2>box.y2) continue;   // must sit fully in frame
      const rp={x:r.x-9,y:r.y-9,x2:r.x2+9,y2:r.y2+9};                // breathing gap between cards
      // this candidate's leader runs from the dot to the card's nearest edge
      const cxr=Math.max(dx,Math.min(0,dx+c.w)), cyr=Math.max(dy,Math.min(0,dy+c.h));
      const lr=segRect(c.ax, c.ay, c.ax+cxr, c.ay+cyr, 3);
      const ov = rectOverlap(rp,placed)                 // don't overlap other cards
               + rectOverlap(r,obstacles)*2             // never cover a dot / the deal
               + rectOverlap(r,leaders)*1.4             // don't sit across an existing leader
               + rectOverlap(lr,placed)*1.2;            // our leader shouldn't cross a placed card
      const lead = Math.hypot(dx<0?dx+c.w:dx, dy+c.h/2);
      const score = ov*3 + lead*0.7 + tier*5;
      if(score<bestScore){ bestScore=score; best={r,dx,dy,lr}; }
      if(ov===0 && tier===0) break;                                   // clean + closest — done
    }
    if(!best){
      const x=Math.max(box.x,Math.min(box.x2-c.w,c.ax+SNC_GAP)), y=Math.max(box.y,Math.min(box.y2-c.h,c.ay-c.h/2));
      best={r:{x,y,x2:x+c.w,y2:y+c.h}, dx:x-c.ax, dy:y-c.ay, lr:null};
    }
    c.px=Math.round(best.dx); c.py=Math.round(best.dy); placed.push(best.r); if(best.lr) leaders.push(best.lr);
  });
  cards.forEach(renderSnapCard);
}
function renderSnapCard(card){
  const dx=card.px, dy=card.py, w=Math.round(card.w);
  const manualW = card.key && _snapWidths[card.key];
  // leader runs from the dot to the nearest edge of the card
  const cx=Math.max(dx,Math.min(0,dx+w)), cy=Math.max(dy,Math.min(0,dy+card.h));
  const len=Math.max(3,Math.hypot(cx,cy)), ang=Math.atan2(cy,cx)*180/Math.PI;
  const body = (card.eyebrow?`<span class="snc-eye">${esc(card.eyebrow)}</span>`:'')
    + `<span class="snc-n">${esc(card.name)}</span>`
    + (card.metaTop?`<span class="snc-m">${esc(card.metaTop)}</span>`:'')
    + (card.metaBot?`<span class="snc-m2">${esc(card.metaBot)}</span>`:'');
  const handle = (_snapEdit && card.key) ? `<span class="snc-resize"></span>` : '';
  const wStyle = manualW ? `width:${w}px;white-space:normal;` : `width:${w}px;`;
  const html = `<span class="snc-line" style="width:${len}px;transform:rotate(${ang}deg);--lc:${card.color}"></span>`
    + `<span class="snc-dot${card.subject?' subject':''}" style="--c:${card.color}"></span>`
    + `<span class="snc-card${card.subject?' subject':''}" style="left:${dx}px;top:${dy}px;${wStyle}--cc:${card.color}">${body}${handle}</span>`;
  const m=L.marker(card.latlng,{pane:'poi',icon:L.divIcon({className:'snc',iconSize:null,iconAnchor:[0,0],html})});
  const movable = card.key && !card.key.startsWith('site:');
  if(movable && !_snapEdit) m.bindPopup(snapDotPopup(card.name,card.color,true),{className:'snc-pop',minWidth:150,closeButton:false})
    .on('popupopen',ev=>{ const r=ev.popup.getElement(); if(!r) return;
      const u=r.querySelector('.sp-unlabel'); if(u) u.onclick=()=>{ map.closePopup(); _snapLabeled.delete(card.key); snapExpandMarkers(); buildSnapLegend(); };
      const mv=r.querySelector('.sp-move'); if(mv) mv.onclick=()=>{ map.closePopup(); startCompMove(card.key, card.name); };
      const h=r.querySelector('.sp-hide'); if(h) h.onclick=()=>{ map.closePopup(); snapHideKey(card.key); };
    });
  _snapFlat.addLayer(m);
  // register the card's on-screen rect (+ live element refs) for hit-testing & editing
  if(card.key){ let cardEl=null, lineEl=null; const el=m.getElement();
    if(el){ cardEl=el.querySelector('.snc-card'); lineEl=el.querySelector('.snc-line'); }
    _snapCardReg[card.key] = { latlng:card.latlng, px:card.px, py:card.py, w:card.w, h:card.h, name:card.name, el:cardEl, lineEl:lineEl }; }
}
function _cardRect(r){
  const a=map.latLngToContainerPoint(r.latlng);
  const w = (r.el && r.el.offsetWidth) ? r.el.offsetWidth : r.w;
  const h = (r.el && r.el.offsetHeight) ? r.el.offsetHeight : r.h;
  return { x:a.x+r.px, y:a.y+r.py, w, h };
}
function _snapCardAt(cp){
  for(const key in _snapCardReg){ const r=_snapCardReg[key]; const b=_cardRect(r);
    if(cp.x>=b.x && cp.x<=b.x+b.w && cp.y>=b.y && cp.y<=b.y+b.h) return Object.assign({key}, r, {w:b.w, h:b.h}); }
  return null;
}
function _snapHandleAt(cp){   // bottom-right resize corner, edit mode only — uses the ACTUAL card box
  if(!_snapEdit) return null;
  for(const key in _snapCardReg){ const r=_snapCardReg[key]; const b=_cardRect(r);
    const x2=b.x+b.w, y2=b.y+b.h;
    if(cp.x>=x2-20 && cp.x<=x2+8 && cp.y>=y2-20 && cp.y<=y2+8) return Object.assign({key, resize:true}, r, {w:b.w, h:b.h}); }
  return null;
}
let _calloutMove=null;
function startCalloutMove(card){
  _calloutMove={ key:card.key, latlng:card.latlng, w:card.w, h:card.h, name:card.name };
  map.closePopup();
  const b=$('poiMoveBar'); if(b){ const n=$('poiMoveName'); if(n) n.textContent=(card.name||'callout')+' callout'; b.classList.add('show'); }
  map.getContainer().style.cursor='crosshair';
}
function finishCalloutMove(latlng){
  if(!_calloutMove) return;
  const a=map.latLngToContainerPoint(_calloutMove.latlng), pt=map.latLngToContainerPoint(latlng);
  _snapCardOffsets[_calloutMove.key]={ px:Math.round(pt.x-a.x-_calloutMove.w/2), py:Math.round(pt.y-a.y-_calloutMove.h/2) };
  _calloutMove=null;
  const bar=$('poiMoveBar'); if(bar) bar.classList.remove('show'); map.getContainer().style.cursor='';
  snapExpandMarkers();
}
function cancelCalloutMove(){ _calloutMove=null; const b=$('poiMoveBar'); if(b) b.classList.remove('show'); map.getContainer().style.cursor=''; }

// ---- Arrange mode: drag to move, drag the corner to resize ----
function toggleSnapEdit(on){
  _snapEdit = (on!=null) ? on : !_snapEdit;
  const btn=$('snapArrange'); if(btn){ btn.classList.toggle('on',_snapEdit); btn.textContent=_snapEdit?'✓ Done arranging':'✦ Arrange callouts'; }
  const el=map.getContainer(); el.classList.toggle('snap-editing',_snapEdit);
  // pan stays enabled — we only suppress it during an active card drag (see snapEditPointerDown)
  if(_snapEdit) map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
  map.dragging.enable();
  if(_snapComposed) snapExpandMarkers();
}
function onSnapDragMove(ev){
  if(!_snapDrag) return;
  const p=ev.touches?ev.touches[0]:ev, ddx=p.clientX-_snapDrag.sx, ddy=p.clientY-_snapDrag.sy;
  if(_snapDrag.mode==='resize'){
    const w=Math.round(Math.max(130, Math.min(380, _snapDrag.sw+ddx))); _snapDrag.w=w;
    if(_snapDrag.el){ _snapDrag.el.style.width=w+'px'; _snapDrag.el.style.whiteSpace='normal'; }
  } else {
    const px=Math.round(_snapDrag.spx+ddx), py=Math.round(_snapDrag.spy+ddy); _snapDrag.px=px; _snapDrag.py=py;
    if(_snapDrag.el){ _snapDrag.el.style.left=px+'px'; _snapDrag.el.style.top=py+'px';
      if(_snapDrag.lineEl){ const w=_snapDrag.w,h=_snapDrag.h,ccx=Math.max(px,Math.min(0,px+w)),ccy=Math.max(py,Math.min(0,py+h));
        _snapDrag.lineEl.style.width=Math.max(3,Math.hypot(ccx,ccy))+'px'; _snapDrag.lineEl.style.transform='rotate('+(Math.atan2(ccy,ccx)*180/Math.PI)+'deg)'; } }
  }
  if(ev.cancelable) ev.preventDefault();
}
function onSnapDragUp(){
  if(!_snapDrag) return;
  document.removeEventListener('mousemove',onSnapDragMove); document.removeEventListener('mouseup',onSnapDragUp);
  document.removeEventListener('touchmove',onSnapDragMove); document.removeEventListener('touchend',onSnapDragUp);
  map.dragging.enable();
  if(_snapDrag.mode==='resize') _snapWidths[_snapDrag.key]=_snapDrag.w;
  else _snapCardOffsets[_snapDrag.key]={px:_snapDrag.px, py:_snapDrag.py};
  _snapDrag=null; snapExpandMarkers();
}
function snapEditPointerDown(e){
  if(!_snapEdit || !_snapComposed) return;
  const cp = map.mouseEventToContainerPoint(e.originalEvent);
  const hit = _snapHandleAt(cp) || _snapCardAt(cp);
  if(!hit) return;                       // empty map → let the normal pan happen
  L.DomEvent.stop(e);
  map.dragging.disable();                // suppress pan for THIS card gesture only
  const oe=e.originalEvent, p=oe.touches?oe.touches[0]:oe;
  _snapDrag = { key:hit.key, mode: hit.resize?'resize':'move', sx:p.clientX, sy:p.clientY,
    spx:hit.px, spy:hit.py, sw:hit.w, w:hit.w, h:hit.h, px:hit.px, py:hit.py, el:hit.el, lineEl:hit.lineEl };
  document.addEventListener('mousemove',onSnapDragMove); document.addEventListener('mouseup',onSnapDragUp);
  document.addEventListener('touchmove',onSnapDragMove,{passive:false}); document.addEventListener('touchend',onSnapDragUp);
}
map.on('mousedown', snapEditPointerDown);
function snapCollapseMarkers(){ if(_snapFlat){ map.removeLayer(_snapFlat); _snapFlat=null; } }
// Numbered marker — small colored badge with an index; pairs with the comp table
// Numbered badges: nudge apart any that would overlap, keeping a dot at the exact location
// with a thin leader to the moved badge. Exact position preserved, numbers stay readable.
function placeBadges(picked){
  const MIN=33;   // min center-to-center px (badge is ~29px across incl. border, + a readable gap)
  const pts = picked.map(it=>{ const p=map.latLngToContainerPoint(it.latlng); return {x:p.x,y:p.y,ox:p.x,oy:p.y}; });
  for(let iter=0; iter<80; iter++){
    let moved=false;
    for(let i=0;i<pts.length;i++) for(let j=i+1;j<pts.length;j++){
      const a=pts[i], b=pts[j]; let dx=b.x-a.x, dy=b.y-a.y, d=Math.hypot(dx,dy);
      if(d<MIN){
        if(d<0.01){ dx=Math.cos(i*2.4); dy=Math.sin(i*2.4); d=1; }
        const push=(MIN-d)/2, ux=dx/d, uy=dy/d;
        a.x-=ux*push; a.y-=uy*push; b.x+=ux*push; b.y+=uy*push; moved=true;
      }
    }
    if(!moved) break;
  }
  picked.forEach((it,i)=>{ const p=pts[i]; addSnapBadge(it, i+1, p.x-p.ox, p.y-p.oy); });
}
function addSnapBadge(it, n, dx, dy){
  dx=dx||0; dy=dy||0;
  const off = Math.abs(dx)>1.5 || Math.abs(dy)>1.5;
  let icon;
  if(off){
    const len=Math.hypot(dx,dy), ang=Math.atan2(dy,dx)*180/Math.PI;
    const html = `<span class="snb-anchor" style="--c:${it.color}"></span>`
      + `<span class="snb-lead" style="--c:${it.color};width:${len.toFixed(1)}px;transform:rotate(${ang.toFixed(2)}deg)"></span>`
      + `<span class="snb-badge" style="--c:${it.color};left:${(dx-12).toFixed(1)}px;top:${(dy-12).toFixed(1)}px">${n}</span>`;
    icon = L.divIcon({className:'snb snb-off',iconSize:[0,0],iconAnchor:[0,0],html});
  } else {
    icon = L.divIcon({className:'snb',iconSize:[24,24],iconAnchor:[12,12],html:`<span class="snb-badge" style="--c:${it.color}">${n}</span>`});
  }
  const m=L.marker(it.latlng,{pane:'poi',icon});
  m.bindPopup(snapDotPopup(it.name,it.color,true),{className:'snc-pop',minWidth:150,closeButton:false})
    .on('popupopen',ev=>{ const r=ev.popup.getElement(); if(!r) return;
      const u=r.querySelector('.sp-unlabel'); if(u) u.onclick=()=>{ map.closePopup(); _snapLabeled.delete(it.key); snapExpandMarkers(); buildSnapLegend(); };
      const mv=r.querySelector('.sp-move'); if(mv) mv.onclick=()=>{ map.closePopup(); startCompMove(it.key,it.name); };
      const h=r.querySelector('.sp-hide'); if(h) h.onclick=()=>{ map.closePopup(); snapHideKey(it.key); };
    });
  _snapFlat.addLayer(m);
}
const SNAP_COLS = [
  {f:'dev', h:'Developer', get:x=>x.developer||x.d||x.dev||''},
  {f:'u',   h:'Units',     get:d=>d.u!=null?d.u:(d.units!=null?d.units:'')},
  {f:'y',   h:'Year',      get:d=>d.y||''},
  {f:'usf', h:'Avg SF',    get:d=>d.usf!=null?Number(d.usf).toLocaleString():''},
  {f:'eps', h:'Eff $/SF',  get:d=>d.eps!=null?'$'+Number(d.eps).toFixed(2):''},
  {f:'oc',  h:'Occ',       get:d=>d.oc!=null?d.oc+'%':''},
];
function buildSnapTable(picked){
  const el=$('snapFrTable'); if(!el) return;
  if(!picked || !picked.length || _snapStyle!=='numbered'){ el.style.display='none'; el.innerHTML=''; return; }
  const cols=SNAP_COLS.filter(c=>_snapFields[c.f]);
  const head=`<div class="snt-row snt-head"><span class="snt-num">#</span><span class="snt-name">Comparable</span>${cols.map(c=>`<span class="snt-c">${c.h}</span>`).join('')}</div>`;
  const rows=picked.map((it,i)=>`<div class="snt-row"><span class="snt-num" style="background:${it.color}">${i+1}</span><span class="snt-name">${esc(it.name)}</span>${cols.map(c=>`<span class="snt-c">${esc(String(c.get(it.data)||'—'))}</span>`).join('')}</div>`).join('');
  el.style.setProperty('--cols',`26px minmax(130px,1.5fr) repeat(${cols.length},1fr)`);
  el.style.left = (($('snapLegend')&&$('snapLegend').checked) ? 195 : 18)+'px';
  el.style.right = (($('snapScale')&&$('snapScale').checked) ? 150 : 18)+'px';
  el.innerHTML=head+rows; el.style.display='';
}
// ---- Selected comps · numbering order (drag to reorder, edit/remove inline) ----
function openDeckOrder(){ if(_snapComposed) snapExpandMarkers(); buildDeckOrderList(); $('deckOrderOverlay').classList.add('open'); }
function closeDeckOrder(){ $('deckOrderOverlay').classList.remove('open'); }
function buildDeckOrderList(){
  const list=$('doList'); if(!list) return;
  const items=_snapPickedCache;
  const cnt=$('doCount'); if(cnt) cnt.textContent=items.length+' comp'+(items.length===1?'':'s')+' on deck';
  if(!items.length){ list.innerHTML='<div style="padding:22px;text-align:center;color:var(--text-muted);font-size:13px">No comps on the deck yet. Use “Select &amp; edit comps” to add some, then reorder here.</div>'; return; }
  list.innerHTML = items.map((it,i)=>`<div class="do-row" draggable="true" data-key="${it.key}">
    <span class="do-grip">⣿</span>
    <span class="do-num" style="background:${it.color}">${i+1}</span>
    <div class="do-info"><div class="do-name">${esc(it.name||'Comp')}</div><div class="do-meta">${esc([it.metaTop,it.metaBot].filter(Boolean).join('  ·  '))}</div></div>
    <button class="do-act do-edit" title="Edit comp">✎ Edit</button>
    <button class="do-act do-remove" title="Remove from deck">✕</button>
  </div>`).join('');
  let dragKey=null;
  list.querySelectorAll('.do-row').forEach(row=>{
    row.addEventListener('dragstart',e=>{ dragKey=row.dataset.key; row.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; try{e.dataTransfer.setData('text/plain',dragKey);}catch(_){} });
    row.addEventListener('dragend',()=>{ row.classList.remove('dragging'); list.querySelectorAll('.do-row').forEach(r=>r.classList.remove('dragover')); });
    row.addEventListener('dragover',e=>{ e.preventDefault(); row.classList.add('dragover'); e.dataTransfer.dropEffect='move'; });
    row.addEventListener('dragleave',()=>row.classList.remove('dragover'));
    row.addEventListener('drop',e=>{ e.preventDefault(); const to=row.dataset.key; if(dragKey&&to&&dragKey!==to) reorderDeck(dragKey,to); });
    row.querySelector('.do-edit').onclick=()=>{ openCompEditor(row.dataset.key); };
    row.querySelector('.do-remove').onclick=()=>{ const k=row.dataset.key; _snapLabeled.delete(k); _snapOrder=_snapOrder.filter(x=>x!==k); if(_snapComposed){ snapExpandMarkers(); buildSnapLegend(); } buildDeckOrderList(); };
  });
}
function reorderDeck(fromKey,toKey){
  const arr=_snapOrder.slice();
  const fi=arr.indexOf(fromKey), ti=arr.indexOf(toKey);
  if(fi<0||ti<0||fi===ti) return;
  arr.splice(fi,1);
  const ti2=arr.indexOf(toKey);
  arr.splice(fi<ti ? ti2+1 : ti2, 0, fromKey);
  _snapOrder=arr;
  if(_snapComposed) snapExpandMarkers();
  buildDeckOrderList();
}
// Frame the map so every picked comp + subject site sits inside the snapshot crop with a margin.
// Uses ALL picks (not just in-view), and pads for the snapBox's position inside the container.
function snapFitPicks(){
  if(!_snapComposed) return;
  const pts=[];
  _snapLabeled.forEach(key=>{
    if(key.startsWith('cs:')){ const ck=key.slice(3); const c0=(_compsData||[]).find(x=>compKey(x)===ck); if(c0){ const ll=compLL(c0); if(ll&&ll[0]!=null) pts.push(ll); } }
    else if(key.startsWith('cp:')){ const id=key.slice(3); const c=(Comp.all()||[]).find(x=>x.id===id); if(c&&c.lat!=null) pts.push([c.lat,c.lng]); }
    else if(key.startsWith('poi:')){ const id=key.slice(4); const p=(PoiStore.all()||[]).find(x=>x.id===id); if(p&&p.la!=null) pts.push([p.la,p.lo]); }
  });
  if(pipelineOn && $('snapSiteCallout') && $('snapSiteCallout').checked){
    marketSites().forEach(s=>{ if(_snapSiteFilter && !_snapSiteFilter.has(s.id)) return; const c=siteCentroid(s); if(c) pts.push(c); });
  }
  if(!pts.length) return;
  if(pts.length===1){ map.setView(pts[0], Math.min(14, map.getZoom())); return; }
  const bounds=L.latLngBounds(pts);
  const box=$('snapBox').getBoundingClientRect(), cont=map.getContainer().getBoundingClientRect();
  const M=18;   // just enough to clear the badge at the edge; keeps the fit as tight as possible
  map.fitBounds(bounds, {
    paddingTopLeft:  [Math.max(0,box.left-cont.left)+M, Math.max(0,box.top-cont.top)+M],
    paddingBottomRight:[Math.max(0,cont.right-box.right)+M, Math.max(0,cont.bottom-box.bottom)+M],
    animate:true
  });
}
let _cpRows=[], _cpEditKey=null, _cpScope='view', _cpStatus='all';   // scope: view|all · status: all|pipeline|existing
function rowIsExisting(r){ return r.type==='cs' ? compStatusLabel((r.c||compView(r.c0)).s)==='Existing' : projStageOf(r.c).id==='existing'; }
function openCompPicker(){
  _cpEditKey=null; buildCompPickList();
  $('compPickOverlay').classList.add('open');
  setTimeout(()=>{ const s=$('cpSearch'); if(s) s.focus(); },50);
}
function closeCompPicker(){ $('compPickOverlay').classList.remove('open'); }
// ---- Attractions picker (mirrors the comp picker) ----
let _ppRows=[], _ppScope='view';
function openPoiPicker(){ buildPoiPickList(); $('poiPickOverlay').classList.add('open'); setTimeout(()=>{ const s=$('ppSearch'); if(s) s.focus(); },50); }
function closePoiPicker(){ $('poiPickOverlay').classList.remove('open'); }
function poiPickRows(){
  const b=map.getBounds(), q=($('ppSearch').value||'').toLowerCase(), inView=_ppScope==='view';
  return PoiStore.all().filter(p=>{
    if(p.m!==currentMarket || p.la==null) return false;
    if(inView && !b.contains([p.la,p.lo])) return false;
    if(q){ const cat=(POI_CATS[p.cat]||{}).label||''; if(![p.n,p.sub,cat,p.note].some(v=>(v||'').toString().toLowerCase().includes(q))) return false; }
    return true;
  }).sort((a,b2)=>(a.n||'').localeCompare(b2.n||''));
}
function poiPickRowHtml(p,i){
  const cat=POI_CATS[p.cat]||POI_CATS.employer, key='poi:'+p.id, shown=_snapLabeled.has(key);
  return `<tr data-idx="${i}" class="${shown?'picked':''}" style="--rc:${cat.color}">
    <td class="cpt-idcell"><div class="cpt-namecell"><span class="cpt-dot"></span><div><div class="cpt-nm">${esc(p.n||'Attraction')}</div><div class="cpt-sub">${esc(p.sub||cat.label)}</div></div></div></td>
    <td><span class="poi-catpill"><span class="poi-catdot" style="background:${cat.color}"></span>${esc(cat.label)}</span></td>
    <td class="cpt-dev">${p.note?esc(p.note):'<span class="cpt-mut">—</span>'}</td>
    <td class="cpt-actcell"><div class="cpt-actwrap"><button class="cpt-toggle ${shown?'on':''}" title="Show on the deck snapshot">${shown?'✓ On deck':'＋ Deck'}</button><button class="cp-zoom" title="Zoom to on map">⌖</button><button class="cp-editbtn">Edit</button></div></td>
  </tr>`;
}
function buildPoiPickList(){
  _ppRows=poiPickRows(); const list=$('ppList');
  if(!_ppRows.length){ list.innerHTML='<div class="cp-empty">No attractions '+(_ppScope==='view'?'in the current view':'in this market')+' yet. Use ＋ Add attraction to drop one.</div>'; $('ppCount').textContent='0 on deck'; return; }
  const head=`<thead><tr><th>Attraction</th><th>Category</th><th>Sub-label / note</th><th></th></tr></thead>`;
  list.innerHTML=`<table class="cp-table">${head}<tbody>${_ppRows.map((p,i)=>poiPickRowHtml(p,i)).join('')}</tbody></table>`;
  $('ppCount').textContent=_poiOnDeckCount()+' on deck';
  _ppRows.forEach((p,i)=>{
    const row=list.querySelector('tr[data-idx="'+i+'"]'); if(!row) return; const key='poi:'+p.id;
    const tg=row.querySelector('.cpt-toggle'); if(tg) tg.onclick=()=>{ const on=!_snapLabeled.has(key);
      if(on){_snapLabeled.add(key);row.classList.add('picked');tg.classList.add('on');tg.textContent='✓ On deck';}
      else{_snapLabeled.delete(key);row.classList.remove('picked');tg.classList.remove('on');tg.textContent='＋ Deck';}
      if(_snapComposed){snapExpandMarkers();buildSnapLegend();} $('ppCount').textContent=_poiOnDeckCount()+' on deck'; };
    const eb=row.querySelector('.cp-editbtn'); if(eb) eb.onclick=()=>{ closePoiPicker(); openPoiEditor(p.id); };
    const zm=row.querySelector('.cp-zoom'); if(zm) zm.onclick=()=>{ closePoiPicker(); map.setView([p.la,p.lo], Math.max(map.getZoom(),15), {animate:true}); };
  });
}
function _poiOnDeckCount(){ let n=0; _snapLabeled.forEach(k=>{ if(k.startsWith('poi:')) n++; }); return n; }
let _addPoiMode=false;
function startAddPoi(){ _addPoiMode=true; closePoiPicker(); const b=$('poiMoveBar'); if(b){ const n=$('poiMoveName'); if(n) n.textContent='new attraction'; b.classList.add('show'); } map.getContainer().style.cursor='crosshair'; }
function closeCompPickerNoop(){}
function compPickRows(){
  const b=map.getBounds(), q=($('cpSearch').value||'').toLowerCase(), rows=[], inView = _cpScope==='view';
  (_compsData||[]).forEach(c0=>{
    if(c0.m!==currentMarket || c0.la==null || _compHidden.has(compKey(c0)) || (inView && !b.contains(compLL(c0)))) return;
    const c=compView(c0);
    if(q && ![c.n,c.d,c.dev,c.sb,c.ci,c.a,c.o].some(v=>(v||'').toString().toLowerCase().includes(q))) return;
    rows.push({type:'cs', c0, c, key:'cs:'+compKey(c0)});
  });
  (Comp.all()||[]).forEach(c=>{
    if((c.market||'phoenix')!==currentMarket || c.lat==null || _snapHideCp.has(c.id) || (inView && !b.contains([c.lat,c.lng]))) return;
    if(q && ![c.name,c.developer,c.product].some(v=>(v||'').toString().toLowerCase().includes(q))) return;
    rows.push({type:'cp', c, key:'cp:'+c.id});
  });
  rows.sort((a,b)=>{ const an=(a.type==='cs'?a.c.n:a.c.name)||'', bn=(b.type==='cs'?b.c.n:b.c.name)||''; return an.localeCompare(bn); });
  if(_cpStatus==='existing') return rows.filter(rowIsExisting);
  if(_cpStatus==='pipeline') return rows.filter(r=>!rowIsExisting(r));
  return rows;
}
function compRowName(r){
  if(r.type==='cs'){ const c=r.c; return c.n || c.a || (c.sb?('Comp · '+c.sb):'Unnamed comp'); }
  return r.c.name || 'Unnamed project';
}
function compPickRowHtml(r,i){
  const shown=_snapLabeled.has(r.key);
  const name=esc(compRowName(r));
  let color,sub,dev,units,year,sf,ask,eff,occ;
  const num=v=>v!=null&&v!==''?Number(v).toLocaleString():'<span class="cpt-mut">—</span>';
  const money=v=>v!=null&&v!==''?'$'+Number(v).toFixed(2):'<span class="cpt-mut">—</span>';
  if(r.type==='cs'){ const c=r.c; color=compStatusColor(c.s);
    sub=[compStatusLabel(c.s), c.ci||''].filter(Boolean).join(' · ');
    dev=(c.d||c.dev)?esc(c.d||c.dev):'<span class="cpt-mut">—</span>';
    units=num(c.u); year=c.y?c.y:'<span class="cpt-mut">—</span>'; sf=c.usf!=null?num(c.usf):'<span class="cpt-mut">—</span>';
    ask=money(c.aps); eff=money(c.eps); occ=c.oc!=null?c.oc+'%':'<span class="cpt-mut">—</span>';
  } else { const c=r.c, st=compStageById[c.stage]||COMP_STAGES[0]; color=st.hex;
    sub=[st.label, c.delivery?'Est. '+c.delivery:''].filter(Boolean).join(' · ');
    dev=c.developer?esc(c.developer):'<span class="cpt-mut">—</span>';
    units=num(c.units); year='<span class="cpt-mut">—</span>'; sf='<span class="cpt-mut">—</span>';
    ask='<span class="cpt-mut">—</span>'; eff='<span class="cpt-mut">—</span>'; occ='<span class="cpt-mut">—</span>';
  }
  return `<tr data-idx="${i}" class="${shown?'picked':''}" style="--rc:${color}">
    <td class="cpt-idcell"><div class="cpt-namecell"><span class="cpt-dot"></span><div><div class="cpt-nm">${name}</div><div class="cpt-sub">${esc(sub)||'—'}</div></div></div></td>
    <td class="cpt-dev">${dev}</td>
    <td class="num cpt-num">${units}</td>
    <td class="num cpt-num">${year}</td>
    <td class="num cpt-num">${sf}</td>
    <td class="num cpt-num cpt-rent">${ask}</td>
    <td class="num cpt-num cpt-rent">${eff}</td>
    <td class="num cpt-num">${occ}</td>
    <td class="cpt-actcell"><div class="cpt-actwrap"><button class="cpt-toggle ${shown?'on':''}" title="Show on the deck snapshot">${shown?'✓ On deck':'＋ Deck'}</button><button class="cp-zoom" title="Zoom to on map">⌖</button><button class="cp-editbtn">Edit</button></div></td>
  </tr>`;
}
function zoomToComp(r){
  let ll; if(r.type==='cs') ll=compLL(r.c0); else ll=[r.c.lat,r.c.lng];
  if(ll[0]==null) return;
  closeCompPicker();
  map.setView(ll, Math.max(map.getZoom(),15), {animate:true});
}
function cpStatusSelect(cur){
  const lab=compStatusLabel(cur), opts=[['Existing','Existing'],['Under Construction','Under construction'],['Proposed','Proposed / planning']];
  return `<select class="cp-f" data-f="s">`+opts.map(([v,l])=>`<option value="${v}" ${lab===l?'selected':''}>${v}</option>`).join('')+`</select>`;
}
function cpStageSelect(cur){
  cur = _STAGE_ALIAS[cur]||cur;
  return `<select class="cp-f" data-f="stage">`+COMP_STAGES.map(s=>`<option value="${s.id}" ${s.id===cur?'selected':''}>${esc(s.label)}</option>`).join('')+`</select>`;
}
function compEditFields(type, c, ll){
  const dP = c.deliveryPeriod || parseDeliveryPeriod(c.delivery) || '';
  const dY = c.deliveryYear || parseDeliveryYear(c.delivery) || '';
  const perOpts = '<option value="">—</option>'+DELIVERY_PERIODS.map(p=>`<option value="${p}" ${dP===p?'selected':''}>${p}</option>`).join('');
  const deliveryRow = `<div class="cp-two"><label class="cp-fl">Delivery period<select class="cp-f" data-f="deliveryPeriod">${perOpts}</select></label><label class="cp-fl">Delivery year<input class="cp-f" data-f="deliveryYear" type="number" value="${esc(dY)}" placeholder="e.g. 2027"></label></div>`;
  if(type==='cs'){
    return `<label class="cp-fl">Name<input class="cp-f" data-f="n" value="${esc(c.n||'')}"></label>
      <div class="cp-two"><label class="cp-fl">Developer<input class="cp-f" data-f="d" value="${esc(c.d||c.dev||'')}" placeholder="e.g. Greystar"></label><label class="cp-fl">Status${cpStatusSelect(c.s)}</label></div>
      <div class="cp-three"><label class="cp-fl">Units<input class="cp-f" data-f="u" type="number" value="${c.u!=null?c.u:''}"></label><label class="cp-fl">Year<input class="cp-f" data-f="y" type="number" value="${c.y||''}"></label><label class="cp-fl">Avg SF<input class="cp-f" data-f="usf" type="number" value="${c.usf!=null?c.usf:''}"></label></div>
      ${deliveryRow}
      <div class="cp-two"><label class="cp-fl">Asking $/SF<input class="cp-f" data-f="aps" type="number" step="0.01" value="${c.aps!=null?c.aps:''}"></label><label class="cp-fl">Asking $/unit<input class="cp-f" data-f="apu" type="number" value="${c.apu!=null?c.apu:''}"></label></div>
      <div class="cp-two"><label class="cp-fl">Effective $/SF<input class="cp-f" data-f="eps" type="number" step="0.01" value="${c.eps!=null?c.eps:''}"></label><label class="cp-fl">Effective $/unit<input class="cp-f" data-f="epu" type="number" value="${c.epu!=null?c.epu:''}"></label></div>
      <div class="cp-two"><label class="cp-fl">Occupancy %<input class="cp-f" data-f="oc" type="number" step="0.1" value="${c.oc!=null?c.oc:''}"></label><label class="cp-fl">Submarket<input class="cp-f" data-f="sb" value="${esc(c.sb||'')}"></label></div>
      <div class="cp-two"><label class="cp-fl">Address<input class="cp-f" data-f="a" value="${esc(c.a||'')}"></label><label class="cp-fl">City<input class="cp-f" data-f="ci" value="${esc(c.ci||'')}"></label></div>
      <div class="cp-locblock"><button class="btn ghost full cp-relocate">⤢ Click to drop location on map</button><div class="cp-two" style="margin-top:6px"><label class="cp-fl">Latitude<input class="cp-f" data-f="la" type="number" step="0.000001" value="${ll[0]!=null?ll[0]:''}"></label><label class="cp-fl">Longitude<input class="cp-f" data-f="lo" type="number" step="0.000001" value="${ll[1]!=null?ll[1]:''}"></label></div></div>`;
  }
  return `<label class="cp-fl">Name<input class="cp-f" data-f="name" value="${esc(c.name||'')}"></label>
    <div class="cp-two"><label class="cp-fl">Developer<input class="cp-f" data-f="developer" value="${esc(c.developer||'')}"></label><label class="cp-fl">Stage${cpStageSelect(c.stage)}</label></div>
    <div class="cp-three"><label class="cp-fl">Units<input class="cp-f" data-f="units" type="number" value="${c.units!=null?c.units:''}"></label><label class="cp-fl">Year<input class="cp-f" data-f="year" value="${esc(c.year||'')}"></label><label class="cp-fl">Avg SF<input class="cp-f" data-f="usf" type="number" value="${c.usf!=null?c.usf:''}"></label></div>
    <div class="cp-two"><label class="cp-fl">Asking $/SF<input class="cp-f" data-f="rent" type="number" step="0.01" value="${c.rent!=null?c.rent:''}"></label><label class="cp-fl">Occupancy %<input class="cp-f" data-f="occ" type="number" step="0.1" value="${c.occ!=null?c.occ:''}"></label></div>
    ${deliveryRow}
    <label class="cp-fl">Product<input class="cp-f" data-f="product" value="${esc(c.product||'')}" placeholder="e.g. Garden / Wrap"></label>
    <div class="cp-locblock"><button class="btn ghost full cp-relocate">⤢ Click to drop location on map</button><div class="cp-two" style="margin-top:6px"><label class="cp-fl">Latitude<input class="cp-f" data-f="lat" type="number" step="0.000001" value="${c.lat!=null?c.lat:''}"></label><label class="cp-fl">Longitude<input class="cp-f" data-f="lng" type="number" step="0.000001" value="${c.lng!=null?c.lng:''}"></label></div></div>`;
}
// Individual comp editor — its own modal, opened from the map pencil or the master list
function openCompEditor(key){
  let type,c,c0,ll,name;
  if(key.startsWith('cs:')){ type='cs'; const ck=key.slice(3); c0=(_compsData||[]).find(x=>compKey(x)===ck); if(!c0) return; c=compView(c0); ll=compLL(c0); name=c.n||'Comp'; }
  else { type='cp'; const id=key.slice(3); c=(Comp.all()||[]).find(x=>x.id===id); if(!c) return; ll=[c.lat,c.lng]; name=c.name||'Project'; }
  const isShown=_snapLabeled.has(key);
  const actions = type==='cs'
    ? `<button class="btn ghost" id="ceReset">Reset to CoStar</button><button class="btn" id="ceSave">Save changes</button>`
    : `<button class="btn ghost cp-del" id="ceDel">Delete</button><button class="btn" id="ceSave">Save changes</button>`;
  showModal(name, `<div class="ce-form">
    <label class="cp-showrow"><input type="checkbox" id="ceShow" ${isShown?'checked':''}> Show on the deck snapshot</label>
    ${compEditFields(type,c,ll)}
    <div class="ce-actions">${actions}</div></div>`);
  const b=$('appModalBody');
  const gather=()=>{ const TEXT=new Set(['n','d','s','sb','a','ci','name','developer','stage','delivery','product','year','deliveryPeriod','deliveryYear']); const vals={}; b.querySelectorAll('.cp-f').forEach(f=>{ const k=f.dataset.f, v=(f.value||'').trim(); vals[k]= TEXT.has(k)?(v||null):(v===''?null:Number(v)); }); if(('deliveryPeriod' in vals)||('deliveryYear' in vals)){ vals.delivery=[vals.deliveryPeriod,vals.deliveryYear].filter(Boolean).join(' ')||null; } return vals; };
  const refresh=()=>{ refreshComps(); renderCompetitors(); if(_snapComposed){ snapExpandMarkers(); buildSnapLegend(); } if($('compPickOverlay')&&$('compPickOverlay').classList.contains('open')) buildCompPickList(); };
  const chk=$('ceShow'); if(chk) chk.onchange=()=>{ chk.checked?_snapLabeled.add(key):_snapLabeled.delete(key); refresh(); };
  $('ceSave').onclick=()=>{ const vals=gather(); if(type==='cs') saveCompOv(compKey(c0),vals); else Comp.update(c.id,vals); refresh(); hideModal(); };
  const rl=b.querySelector('.cp-relocate'); if(rl) rl.onclick=()=>{ hideModal(); startCompMove(key, name); };
  const rst=$('ceReset'); if(rst) rst.onclick=()=>{ delete _compOv[compKey(c0)]; try{localStorage.setItem(COMP_OV_KEY,JSON.stringify(_compOv));}catch(e){} refresh(); hideModal(); };
  const del=$('ceDel'); if(del) del.onclick=()=>{ if(confirm('Delete this competitive project?')){ Comp.remove(c.id); _snapLabeled.delete(key); refresh(); hideModal(); } };
}
function buildCompPickList(){
  _cpRows=compPickRows(); const list=$('cpList');
  if(!_cpRows.length){ list.innerHTML='<div class="cp-empty">No comps in the current view. Pan or zoom the map to bring comps into frame.</div>'; $('cpCount').textContent='0 on deck'; return; }
  const head=`<thead><tr><th></th><th>Comparable</th><th>Developer</th><th class="num">Units</th><th class="num">Year</th><th class="num">Avg SF</th><th class="num">Ask $/SF</th><th class="num">Eff $/SF</th><th class="num">Occ</th><th></th></tr></thead>`;
  list.innerHTML=`<table class="cp-table">${head}<tbody>${_cpRows.map((r,i)=>compPickRowHtml(r,i)).join('')}</tbody></table>`;
  $('cpCount').textContent=_snapLabeled.size+' on deck';
  _cpRows.forEach((r,i)=>{
    const row=list.querySelector('tr[data-idx="'+i+'"]'); if(!row) return;
    const tg=row.querySelector('.cpt-toggle'); if(tg) tg.onclick=()=>{
      const on=!_snapLabeled.has(r.key);
      if(on){_snapLabeled.add(r.key);row.classList.add('picked');tg.classList.add('on');tg.textContent='✓ On deck';}
      else{_snapLabeled.delete(r.key);row.classList.remove('picked');tg.classList.remove('on');tg.textContent='＋ Deck';}
      if(_snapComposed){snapExpandMarkers();buildSnapLegend();} $('cpCount').textContent=_snapLabeled.size+' on deck';
    };
    const eb=row.querySelector('.cp-editbtn'); if(eb) eb.onclick=()=>openCompEditor(r.key);
    const zm=row.querySelector('.cp-zoom'); if(zm) zm.onclick=()=>zoomToComp(r);
  });
}
function buildSnapLegend(){
  const rows = [], b=map.getBounds();
  const onlyLabeled = $('snapOnlyLabeled') && $('snapOnlyLabeled').checked;
  // subject site — match the callout CARD (always WB purple), not the parcel-highlight status
  // color, since at snapshot zoom the card is what's visible, not the tiny parcel outline
  if(pipelineOn){
    const present=new Set();
    Store.all().forEach(s=>{ if(_snapSiteFilter && !_snapSiteFilter.has(s.id)) return; const p0=s.parcels&&s.parcels[0]; if(p0&&p0._lat!=null&&b.contains([p0._lat,p0._lng])) present.add(s.status); });
    const list=STATUSES.filter(st=>present.has(st.id));
    if(list.length===1) rows.push(['#432890','Subject site · '+list[0].label]);
    else list.forEach(st=>rows.push(['#432890','Subject site · '+st.label]));
  }
  // CoStar comps and Competitive Projects share ONE status taxonomy — merge them, no prefix,
  // and only show a status if something with it is actually on the map (respecting the picked filter).
  const present=new Set();
  if(compsOn) (_compsData||[]).forEach(c=>{ const key='cs:'+compKey(c);
    if(c.m===currentMarket && !_compHidden.has(compKey(c)) && c.la!=null && b.contains(compLL(c)) && (!onlyLabeled || _snapLabeled.has(key)))
      present.add(compStatusLabel(compView(c).s)); });
  if(competitorsOn) (Comp.all()||[]).forEach(c=>{ const key='cp:'+c.id;
    if((c.market||'phoenix')===currentMarket && c.lat!=null && !_snapHideCp.has(c.id) && b.contains([c.lat,c.lng]) && (!onlyLabeled || _snapLabeled.has(key)))
      present.add(projStageOf(c).label); });
  COMP_STAGES.forEach(s=>{ if(present.has(s.label)) rows.push([s.hex, s.label]); });
  const el=$('snapFrLegend');
  if(!rows.length){ el.style.display='none'; el.innerHTML=''; return; }
  el.innerHTML = '<div class="snap-lg-title">Legend</div>' + rows.map(([c,l])=>`<div class="snap-lg-row"><span class="snap-lg-dot" style="background:${c}"></span>${l}</div>`).join('');
}
function updateSnapScale(){
  const y = map.getSize().y/2;
  const p1 = map.containerPointToLatLng([0,y]), p2 = map.containerPointToLatLng([100,y]);
  const feet = p1.distanceTo(p2) * 3.28084;
  const targets = [100,250,500,1000,2000,5280,10560,26400];
  let best = targets[0];
  for(const t of targets){ if(t <= feet*2.4) best = t; }
  const bar = $('snapFrScale').querySelector('.snap-scalebar');
  if(bar){ bar.style.width = Math.min(Math.round(best/feet*100),220)+'px'; }
  $('snapScaleLen').textContent = best>=5280 ? (best/5280)+' mi' : best+' ft';
}
map.on('zoomend moveend', ()=>{ if(_snapComposed){ if($('snapScale').checked) updateSnapScale(); snapExpandMarkers(); buildSnapSites(); } });
async function snapCapture(){
  map.closePopup();
  const box=$('snapBox'); box.classList.add('capturing');
  document.body.classList.add('snap-capturing');   // drop the map vignette during capture
  const wasEditing = map.getContainer().classList.contains('snap-editing');
  if(wasEditing) map.getContainer().classList.remove('snap-editing');   // no dashed outlines/handles in the export
  // Scale up the capture for a crisper deck asset (more supersampling when placed in a slide),
  // but cap the long edge to a safe pixel budget so wide 21:9 frames don't blow up memory.
  const _bx = $('snapBox').getBoundingClientRect();
  const scale = Math.max(2, Math.min(3.4, 4300 / Math.max(1, _bx.width)));
  const h2c = html2canvas($('mapWrap'), { useCORS:true, allowTaint:false, backgroundColor:'#0d0920', scale, logging:false, imageTimeout:15000, removeContainer:true,
    ignoreElements:(el)=> el.id==='mapControls'||el.id==='snapPanel'||el.id==='poiMoveBar'||el.id==='legend'||el.id==='toolBar'||(el.classList&&(el.classList.contains('leaflet-control-zoom')||el.classList.contains('leaflet-control-attribution')||el.classList.contains('snc-resize'))) });
  const timeout = new Promise((_,rej)=>setTimeout(()=>rej(new Error('capture-timeout')), 25000));
  let canvas;
  try{ canvas = await Promise.race([h2c, timeout]); }
  finally{ box.classList.remove('capturing'); document.body.classList.remove('snap-capturing'); if(wasEditing) map.getContainer().classList.add('snap-editing'); }
  const wrap=$('mapWrap').getBoundingClientRect(), r=box.getBoundingClientRect();
  const sx=Math.max(0,(r.left-wrap.left)*scale), sy=Math.max(0,(r.top-wrap.top)*scale), sw=r.width*scale, sh=r.height*scale;
  const out=document.createElement('canvas'); out.width=Math.round(sw); out.height=Math.round(sh);
  out.getContext('2d').drawImage(canvas, sx,sy,sw,sh, 0,0,out.width,out.height);
  return out;
}
function snapFileName(){ return 'sitescout-'+(($('snapTitle').value.trim()||'site').replace(/[^a-z0-9]+/gi,'-').toLowerCase())+'-'+new Date().toISOString().slice(0,10); }
function snapFail(){ return 'Auto-capture was blocked by the map tiles — the composed view is still deck-ready, use your screen tool (Win: Shift+Win+S · Mac: Shift+Cmd+4).'; }
function saveBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
}
async function snapPng(){
  const msg=$('snapMsg'); if(typeof html2canvas==='undefined'){ msg.innerHTML=snapFail(); return; }
  msg.textContent='Rendering PNG…';
  try{
    const c=await snapCapture();
    const blob = await new Promise(res=> c.toBlob(res, 'image/png') );
    if(blob){ saveBlob(blob, snapFileName()+'.png'); }
    else { const a=document.createElement('a'); a.download=snapFileName()+'.png'; a.href=c.toDataURL('image/png'); document.body.appendChild(a); a.click(); a.remove(); }
    msg.textContent='PNG saved.';
  }
  catch(e){ console.error('[snapshot png]', e); msg.innerHTML='<b style="color:#b1436b">Export error:</b> '+esc(String(e&&e.message||e))+'<br>'+snapFail(); }
}
async function snapPdf(){
  const msg=$('snapMsg'); if(typeof html2canvas==='undefined'||!window.jspdf){ msg.innerHTML=snapFail(); return; }
  msg.textContent='Rendering PDF…';
  try{
    const c=await snapCapture();
    const { jsPDF }=window.jspdf; const landscape=c.width>=c.height;
    const pdf=new jsPDF({orientation:landscape?'l':'p',unit:'pt',format:'letter'});
    const pw=pdf.internal.pageSize.getWidth(), ph=pdf.internal.pageSize.getHeight(), mgn=28;
    const ratio=Math.min((pw-mgn*2)/c.width,(ph-mgn*2)/c.height), iw=c.width*ratio, ih=c.height*ratio;
    pdf.addImage(c.toDataURL('image/png'),'PNG',(pw-iw)/2,(ph-ih)/2,iw,ih);
    pdf.save(snapFileName()+'.pdf'); msg.textContent='PDF saved.';
  }catch(e){ console.error('[snapshot pdf]', e); msg.innerHTML='<b style="color:#b1436b">Export error:</b> '+esc(String(e&&e.message||e))+'<br>'+snapFail(); }
}
function snapDone(){
  $('snapFrame').classList.remove('show'); snapCollapseMarkers();
  if(_snapEdit) toggleSnapEdit(false);
  _snapCardOffsets = {}; _snapWidths = {};
  { const a=$('snapArrange'); if(a) a.style.display='none'; }
  { const t=$('snapFrTable'); if(t){ t.style.display='none'; t.innerHTML=''; } }
  { const s=$('snapSites'); if(s){ s.style.display='none'; s.innerHTML=''; } }
  _snapSiteFilter=null;
  _snapComposed=false; $('snapCompose').textContent='Compose view';
  $('snapPng').style.display='none'; $('snapPdf').style.display='none'; $('snapDone').style.display='none'; $('snapMsg').textContent='';
  $('legend').style.display='';
  if(!map.hasLayer(compMarkerLayer)) map.addLayer(compMarkerLayer);   // restore competitor triangles
  if(_snapPrev){
    compsOn=_snapPrev.comps; poiOn=_snapPrev.poi; competitorsOn=_snapPrev.comp; pipelineOn=_snapPrev.pipeline;
    refreshComps(); refreshPoi(); renderCompetitors(); renderTracked();
    const tc=$('tglComps'); if(tc) tc.checked=compsOn; const tp=$('tglPoi'); if(tp) tp.checked=poiOn; const tpl=$('tglPipeline'); if(tpl) tpl.checked=pipelineOn;
    _snapPrev=null;
  }
}

function renderCompetitors(){
  compMarkerLayer.clearLayers();
  if(!competitorsOn) return;
  for(const c of marketComps()){
    if(c.lat==null) continue;
    competitorMarker(c).addTo(compMarkerLayer);
  }
}
function competitorMarker(c){
  const st = compStageById[c.stage] || COMP_STAGES[0], color = st.hex;
  const m = L.circleMarker([c.lat, c.lng], { radius:5, color:'#fff', weight:1, fillColor:color, fillOpacity:0.92, renderer:compsRenderer, pane:'siteMarkers' });
  const id='cpx_'+Math.random().toString(36).slice(2,9), eid='e'+id, rid='r'+id, cid='c'+id;
  const tiles=[];
  if(c.units!=null) tiles.push(`<div class="cpx-tile"><div class="cpx-v">${c.units}</div><div class="cpx-l">Units</div></div>`);
  if(c.delivery) tiles.push(`<div class="cpx-tile"><div class="cpx-v" style="font-size:14px">${esc(c.delivery)}</div><div class="cpx-l">Delivery</div></div>`);
  if(c.product) tiles.push(`<div class="cpx-tile"><div class="cpx-v" style="font-size:14px">${esc(c.product)}</div><div class="cpx-l">Product</div></div>`);
  const statGrid = tiles.length ? `<div class="cpx-grid">${tiles.join('')}</div>` : '';
  const detail=[['Developer',c.developer],['Stage',st.label],['Notes',c.notes]].filter(r=>r[1]!=null&&r[1]!=='')
    .map(r=>`<div class="cpx-row"><span class="cpx-k">${r[0]}</span><span class="cpx-val">${esc(String(r[1]))}</span></div>`).join('');
  const html=`<div class="cpx">
      <div class="cpx-head" style="--sc:${color}">
        <div class="cpx-htop"><span class="cpx-pill"><span class="cpx-pdot"></span>${esc(st.label)}</span>
          <div class="cpx-icons"><button class="cpx-edit" id="${eid}" title="Edit"><svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M11.6 1.6 14.4 4.4 5.3 13.5l-3.3.8.8-3.3 9.1-9.1zM10.5 2.7 3 10.2l-.4 1.9 1.9-.4 7.5-7.5-1.5-1.5z"/></svg></button><button class="cpx-close" id="${cid}" title="Close">✕</button></div></div>
        <div class="cpx-name">${esc(c.name||'Competitive project')}</div>
        ${c.developer?`<div class="cpx-sub">${esc(c.developer)}</div>`:''}
      </div>${statGrid}<div class="cpx-detail">${detail}</div>
      <div class="cpx-actions"><button class="cpx-act cpx-reloc" id="${rid}"><svg viewBox="0 0 16 16" width="12" height="12" style="vertical-align:-1px"><path fill="currentColor" d="M8 1 5.5 3.5h1.7v3.7H3.5V5.5L1 8l2.5 2.5V8.8h3.7v3.7H5.5L8 15l2.5-2.5H8.8V8.8h3.7v1.7L15 8l-2.5-2.5v1.7H8.8V3.5h1.7L8 1Z"/></svg> Relocate</button><button class="cpx-act cpx-del" id="${id}">Remove</button></div></div>`;
  m.bindPopup(html, {className:'comp-popup', maxWidth:288, minWidth:252, closeButton:false});
  m.on('popupopen', ()=>{
    const del=document.getElementById(id); if(del) del.onclick=()=>{ if(confirm('Delete this competitive project?')){ map.closePopup(); Comp.remove(c.id); _snapLabeled.delete('cp:'+c.id); renderCompetitors(); if(_snapComposed){snapExpandMarkers();buildSnapLegend();} } };
    const ed=document.getElementById(eid); if(ed) ed.onclick=()=>{ map.closePopup(); openCompEditor('cp:'+c.id); };
    const rl=document.getElementById(rid); if(rl) rl.onclick=()=>{ map.closePopup(); startCompMove('cp:'+c.id, c.name||'project'); };
    const cl=document.getElementById(cid); if(cl) cl.onclick=()=>map.closePopup();
  });
  return m;
}
const DELIVERY_PERIODS = ['Q1','Q2','Q3','Q4','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function parseDeliveryPeriod(s){ if(!s) return ''; const m=String(s).match(/\b(Q[1-4]|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i); if(!m) return ''; const t=m[1]; return /^q/i.test(t) ? t.toUpperCase() : t.charAt(0).toUpperCase()+t.slice(1,3).toLowerCase(); }
function parseDeliveryYear(s){ if(!s) return ''; const m=String(s).match(/\b(20\d{2})\b/); return m?m[1]:''; }
function compFormHtml(c){
  const curStage = _STAGE_ALIAS[c.stage]||c.stage;
  const stageOpts = COMP_STAGES.map(s=>'<option value="'+s.id+'" '+(curStage===s.id?'selected':'')+'>'+s.label+'</option>').join('');
  const dPeriod = c.deliveryPeriod || parseDeliveryPeriod(c.delivery) || '';
  const dYear = c.deliveryYear || parseDeliveryYear(c.delivery) || '';
  const periodOpts = '<option value="">—</option>' + DELIVERY_PERIODS.map(p=>'<option value="'+p+'" '+(dPeriod===p?'selected':'')+'>'+p+'</option>').join('');
  return '<div class="comp-form">'
    + '<label class="cf-row"><span>Project name</span><input id="cfName" value="'+esc(c.name||'')+'" placeholder="e.g. The Foundry"></label>'
    + '<label class="cf-row"><span>Stage</span><select id="cfStage">'+stageOpts+'</select></label>'
    + '<label class="cf-row"><span>Developer</span><input id="cfDev" value="'+esc(c.developer||'')+'" placeholder="e.g. Greystar"></label>'
    + '<div class="cf-two"><label class="cf-row"><span>Unit count</span><input id="cfUnits" type="number" value="'+(c.units||'')+'" placeholder="—"></label>'
    + '<label class="cf-row"><span>Product type</span><input id="cfProduct" value="'+esc(c.product||'')+'" placeholder="e.g. Garden"></label></div>'
    + '<div class="cf-two"><label class="cf-row"><span>Year built</span><input id="cfYear" value="'+esc(c.year||'')+'" placeholder="e.g. 2024"></label>'
    + '<label class="cf-row"><span>Avg unit SF</span><input id="cfUsf" type="number" value="'+(c.usf!=null?c.usf:'')+'" placeholder="—"></label></div>'
    + '<div class="cf-two"><label class="cf-row"><span>Asking rent $/SF</span><input id="cfRent" type="number" step="0.01" value="'+(c.rent!=null?c.rent:'')+'" placeholder="—"></label>'
    + '<label class="cf-row"><span>Occupancy %</span><input id="cfOcc" type="number" step="0.1" value="'+(c.occ!=null?c.occ:'')+'" placeholder="—"></label></div>'
    + '<div class="cf-two"><label class="cf-row"><span>Delivery period</span><select id="cfDeliveryPeriod">'+periodOpts+'</select></label>'
    + '<label class="cf-row"><span>Delivery year</span><input id="cfDeliveryYear" type="number" value="'+esc(dYear)+'" placeholder="e.g. 2027"></label></div>'
    + '<label class="cf-row"><span>Notes</span><textarea id="cfNotes" placeholder="Broker intel, pricing, source…">'+esc(c.notes||'')+'</textarea></label>'
    + '</div>';
}
function readCompForm(){
  const dp=$('cfDeliveryPeriod').value, dy=($('cfDeliveryYear').value||'').trim();
  return {
    name:$('cfName').value.trim(), stage:$('cfStage').value, developer:$('cfDev').value.trim(),
    units:+$('cfUnits').value||null, product:$('cfProduct').value.trim(),
    year:$('cfYear').value.trim(), usf:+$('cfUsf').value||null,
    rent:+$('cfRent').value||null, occ:+$('cfOcc').value||null,
    deliveryPeriod:dp, deliveryYear:dy, delivery:[dp,dy].filter(Boolean).join(' '),
    notes:$('cfNotes').value.trim(),
  };
}
function openCompetitorNew(lat, lng){
  showModal('New competitor', compFormHtml({stage:'entitlement'})
    + '<div class="cf-actions"><button class="btn full" id="cfSave">Add competitor</button></div>');
  $('cfSave').addEventListener('click', ()=>{
    const c = readCompForm();
    if(!c.name){ $('cfName').focus(); return; }
    c.lat=lat; c.lng=lng; c.market=currentMarket;
    Comp.add(c); renderCompetitors(); hideModal(); if(_snapComposed){ if(c.id) _snapLabeled.add('cp:'+c.id); snapExpandMarkers(); buildSnapLegend(); }
  });
  setTimeout(()=>{ const el=$('cfName'); if(el) el.focus(); }, 60);
}
function openCompetitor(id){
  const c = Comp.get(id); if(!c) return;
  const st = compStageById[c.stage] || COMP_STAGES[0];
  showModal(c.name || 'Competitor', compFormHtml(c)
    + '<div class="cf-actions"><button class="btn danger ghost-danger" id="cfDel">Delete</button><div style="flex:1"></div><button class="btn" id="cfSave">Save</button></div>');
  $('cfSave').addEventListener('click', ()=>{ Comp.update(id, readCompForm()); renderCompetitors(); hideModal(); if(_snapComposed){ snapExpandMarkers(); buildSnapLegend(); } });
  $('cfDel').addEventListener('click', ()=>{ if(confirm('Delete this competitor?')){ Comp.remove(id); renderCompetitors(); hideModal(); if(_snapComposed){ _snapLabeled.delete('cp:'+id); snapExpandMarkers(); buildSnapLegend(); } } });
}

function renderTracked(){
  trackedLayer.clearLayers();
  siteMarkerLayer.clearLayers();
  if(typeof updateReadout === "function") updateReadout();
  if(pipelineOn) for(const site of marketSites()){
    if(_snapSiteFilter && !_snapSiteFilter.has(site.id)) continue;   // snapshot: only chosen sites
    const st = statusById[site.status] || STATUSES[0];
    const cnt = (site.parcels||[]).length;
    // parcel polygons (visible when zoomed in)
    for(const parcel of (site.parcels||[])){
      if(!parcel.geometry){ ensureParcelGeometry(site, parcel); continue; }
      const lyr = L.geoJSON({type:'Feature', geometry:parcel.geometry, properties:{}}, {
        pane:'tracked', renderer:trackedRenderer,
        style:{color:st.hex, weight:2.5, opacity:1, fillColor:st.hex, fillOpacity:0.28}
      });
      lyr.bindTooltip(`<b>${esc(siteName(site))}</b><br>${st.label}${cnt>1?` · ${cnt} parcels`:''}`, {sticky:false, className:'parcel-tip'});
      lyr.on('click', ev => {
        if(_boundEdit){ return; }             // drawing a boundary — ignore
        L.DomEvent.stopPropagation(ev);
        window._lastParcelClick = ev.latlng || (parcel._lat!=null ? {lat:parcel._lat, lng:parcel._lng} : null);
        openParcel({type:'Feature', geometry:parcel.geometry, properties:{...(parcel.attrs||{APN:parcel.apn, APN_DASH:parcel.apnDash})}});
      });
      lyr.addTo(trackedLayer);
    }
    // big opportunity marker at the site centroid (visible at every zoom)
    const c = siteCentroid(site);
    // In a composed snapshot with the subject callout on, the callout card + its dot
    // is the clean anchor — the pulsing live marker would just collide with the card.
    const calloutShown = _snapComposed && $('snapSiteCallout') && $('snapSiteCallout').checked;
    if(c && !calloutShown){
      const icon = L.divIcon({className:'', iconSize:[0,0],
        html:`<div class="opp-marker" style="--c:${st.hex}"><div class="opp-pulse"></div><div class="opp-core">${cnt>1?cnt:''}</div></div>`});
      const m = L.marker(c, {icon, pane:'siteMarkers', riseOnHover:true});
      m.bindTooltip(`<b>${esc(siteName(site))}</b><br>${st.label} · ${siteAcres(site).toFixed(2)} ac${cnt>1?` · ${cnt} parcels`:''}`,
        {className:'parcel-tip', direction:'top', offset:[0,-12]});
      m.on('click', ()=> openSiteDetail(site.id));
      m.addTo(siteMarkerLayer);
    }
  }
  renderSitesHome();
  renderLegend();
}
function openSite(id){
  const s = Store.get(id); if(!s) return;
  const b = siteBounds(s); if(b) map.fitBounds(b.pad(0.5));
  const p0 = (s.parcels||[])[0];
  if(p0) openParcel({type:'Feature', geometry:p0.geometry, properties:{...(p0.attrs||{APN:p0.apn, APN_DASH:p0.apnDash})}});
}
function renderLegend(){
  const used = new Set(Store.all().map(s=>s.status));
  const lg = $('legend');
  if(!used.size){ lg.classList.remove('show'); return; }
  lg.innerHTML = STATUSES.filter(s=>used.has(s.id))
    .map(s=>`<div class="lg-row"><span class="dot" style="background:${s.hex}"></span>${s.label}</div>`).join('');
  lg.classList.add('show');
}
function renderSitesHome(){
  const body = $('sitesHomeBody');
  if(!body) return;
  const sites = marketSites().sort((a,b)=>b.updated-a.updated);
  const mktLabel = MARKETS[currentMarket] ? MARKETS[currentMarket].name : currentMarket;
  if(!sites.length){
    body.innerHTML = '<div class="sh-empty">No tracked sites in '+esc(mktLabel)+' yet.<br>Hit “＋ New site,” then click parcels on the map to build one.</div>';
    return;
  }
  const totalAc = sites.reduce((a,s)=>a+siteAcres(s),0);
  const totalP = sites.reduce((a,s)=>a+s.parcels.length,0);
  body.innerHTML = `
    <div class="sh-summary"><b>${sites.length}</b> ${esc(mktLabel)} sites · <b>${totalP}</b> parcels · <b>${totalAc.toFixed(1)}</b> acres tracked</div>
    <div class="sh-list">
      ${sites.map(s=>{
        const st = statusById[s.status]||STATUSES[0];
        const cities = [...new Set(s.parcels.map(p=>p.attrs&&p.attrs.PHYSICAL_CITY).filter(Boolean))].join(', ');
        const owners = [...new Set(s.parcels.map(p=>p.attrs&&p.attrs.OWNER_NAME).filter(Boolean))];
        const notes = (s.notes||[]).length;
        return `<div class="sh-banner" data-open="${s.id}">
          <div class="sh-banner-stripe" style="background:${st.hex}"></div>
          <div class="sh-banner-main">
            <div class="sh-banner-name">${esc(siteName(s))}</div>
            <div class="sh-banner-status" style="color:${st.hex}"><span class="dot" style="background:${st.hex}"></span>${st.label}</div>
            <div class="sh-banner-meta">
              <span class="m"><b>${s.parcels.length}</b> parcel${s.parcels.length>1?'s':''}</span>
              ${cities?`<span class="m">${esc(cities)}</span>`:''}
              ${s.flu?`<span class="m">FLU <b>${esc(s.flu)}</b></span>`:''}
              ${s.entitlement?`<span class="m">Entitlement <b>${esc(s.entitlement)}</b></span>`:''}
              ${notes?`<span class="m">${notes} note${notes>1?'s':''}</span>`:''}
            </div>
            <div class="sh-banner-owner">${owners.length ? esc(owners.slice(0,2).join('; ')) + (owners.length>2?` +${owners.length-2} more`:'') : 'Owner —'}</div>
          </div>
          <div class="sh-banner-side">
            <div class="sh-banner-ac">${siteAcres(s).toFixed(2)}<span> ac</span></div>
          </div>
          <button class="sh-banner-del mini-btn" data-del="${s.id}" title="Delete site">✕</button>
        </div>`;
      }).join('')}
    </div>
  `;
  body.querySelectorAll('.sh-banner').forEach(c=>c.addEventListener('click', ()=>{ $('sitesHomeOverlay').classList.remove('open'); openSiteDetail(c.dataset.open); }));
  body.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', ev=>{
    ev.stopPropagation();
    const s = Store.get(b.dataset.del);
    if(s && confirm(`Delete site “${siteName(s)}”?`)){ Store.remove(s.id); renderTracked(); renderSitesHome(); }
  }));
}
function homeOpen(){ return $('sitesHomeOverlay').classList.contains('open'); }

// ---------- Detail panel ----------
let currentFeature = null;
// ---- Entity classification + Colorado Secretary of State resolution ----
function classifyOwner(name){
  if(!name || !name.trim()) return {type:'unknown', label:'Unknown'};
  const n = ' ' + name.toUpperCase().replace(/[.,]/g,' ').replace(/\s+/g,' ') + ' ';
  if(/ (CITY|COUNTY|TOWN|STATE) OF | DISTRICT | AUTHORITY | DEPARTMENT | UNITED STATES | METROPOLITAN | SCHOOL | REGIONAL /.test(n))
    return {type:'public', label:'Public / Government'};
  if(/ TRUST | TRUSTEE | TRUSTEES | REVOCABLE | LIVING TRUST | FAMILY TRUST /.test(n))
    return {type:'trust', label:'Trust'};
  if(/ (LLC|LLLP|LLP|PLLC|LP|INC|CORP|CORPORATION|INCORPORATED|COMPANY|LTD|LIMITED|HOLDINGS|PROPERTIES|PARTNERS|PARTNERSHIP|ASSOCIATES|GROUP|ENTERPRISES|INVESTMENTS|VENTURES|CAPITAL|REALTY|DEVELOPMENT|BUILDERS|HOMES|FUND|BANK|MANAGEMENT|ASSOCIATION|HOA|CHURCH|MINISTRIES|FOUNDATION) /.test(n))
    return {type:'entity', label:'Entity'};
  return {type:'individual', label:'Individual'};
}
// Colorado SOS "Business Entities" open dataset (Socrata SODA — CORS-enabled, no key needed).
async function lookupEntity(name){
  const base = 'https://data.colorado.gov/resource/4ykn-tg5h.json';
  const clean = name.trim().replace(/\s+/g,' ');
  const esc = clean.replace(/'/g,"''");
  const stem = esc.split(' ').slice(0,4).join(' ');
  // strip the trailing entity-type word for a looser match (…ASSOCIATES LLC → …ASSOCIATES)
  const noType = esc.replace(/\s+(LLC|LLLP|LLP|PLLC|LP|INC|CORP|CORPORATION|INCORPORATED|COMPANY|LTD|LIMITED|CO)\.?$/i,'').trim();
  const queries = [
    `$where=upper(entityname)=upper('${esc}')&$limit=6`,
    `$where=upper(entityname) like upper('${stem}%')&$order=entitystatus&$limit=12`,
    `$where=upper(entityname) like upper('%${noType}%')&$limit=12`,
    `$q=${encodeURIComponent(clean)}&$limit=12`,
  ];
  for(let i=0;i<queries.length;i++){
    try{
      const r = await fetch(base + '?' + queries[i]);
      if(!r.ok){ console.warn('[sos] query',i,'HTTP',r.status); continue; }
      const rows = await r.json();
      if(Array.isArray(rows) && rows.length){
        console.log('[sos] matched on query',i,'\u2014',rows.length,'rows; fields:', Object.keys(rows[0]));
        return rows;
      }
      console.log('[sos] query',i,'returned 0 rows');
    }catch(e){ console.warn('[sos] query',i,'failed:', e.message); }
  }
  return [];
}
function entityAgent(row){
  const org = pickAttr(row,'agentorganizationname','agentorgname','agententityname');
  if(org) return org;
  const nm = [pickAttr(row,'agentfirstname','agentfirstnam')||'', pickAttr(row,'agentmiddlename')||'', pickAttr(row,'agentlastname','agentlastnam')||''].filter(Boolean).join(' ').trim();
  return nm || '';
}
function entityPrincipalAddr(row){
  const a = pickAttr(row,'principaladdress1','principaladdress','principalstreetaddress') || '';
  const c = pickAttr(row,'principalcity') || '';
  const s = pickAttr(row,'principalstate') || '';
  const z = pickAttr(row,'principalzipcode','principalzip') || '';
  return [a, [c,s].filter(Boolean).join(', '), z].filter(Boolean).join(' · ');
}
// Commercial registered-agent services and shared-office providers — mailboxes, not owners.
const AGENT_SERVICES = /(CT CORPORATION|CORPORATION SERVICE|CORPORATE CREATIONS|REGISTERED AGENT|NATIONAL REGISTERED|COGENCY|INCORP|LEGALZOOM|NORTHWEST REGISTERED|VCORP|HARVARD BUSINESS|UNITED STATES CORPORATION|PARACORP|CAPITOL SERVICES|INCFILE|ZENBUSINESS|REGUS|WEWORK|AGENT NETWORK|\bAGENTS?\b|BUSINESS FILINGS|REGISTERED OFFICE)/i;
// Single-purpose vehicles: what HOLDS the asset, not the shop that RUNS it.
const SPV_PATTERN = /(FUND|SPV|HOLDING|\bLP\b|\bLLLP\b|\bI{2,3}\b|\bIV\b|\d)/i;
// Words that don't distinguish a sponsor.
const STOPWORDS = /^(THE|A|AN|OF|AND|LLC|LP|INC|CORP|CO|COMPANY|LIMITED|LTD|TRUST|GROUP|HOLDINGS?|PROPERTIES|PROPERTY)$/i;

function addrKey(a){
  if(!a) return '';
  return String(a).toUpperCase()
    .replace(/[.,#]/g,' ')
    .replace(/\b(STE|SUITE|UNIT|APT|FL|FLOOR|BLDG)\b.*$/,'')
    .replace(/\s+/g,' ').trim();
}
// "SEMREF SLOAN'S LAKE LLC" -> "SEMREF".  The sponsor's stamp is almost always the first token.
function ownerPrefix(name){
  if(!name) return '';
  const tok = String(name).toUpperCase().replace(/[^A-Z0-9 ]/g,' ').split(/\s+/).filter(Boolean);
  const first = tok.find(t => t.length >= 4 && !STOPWORDS.test(t));
  return first || '';
}
async function socrata(where, limit){
  const url = 'https://data.colorado.gov/resource/4ykn-tg5h.json?'
    + '$where=' + encodeURIComponent(where) + '&$limit=' + (limit||30);
  const r = await fetch(url);
  if(!r.ok) throw new Error('SOS HTTP ' + r.status);
  return r.json();
}
const sosName = r => (pickAttr(r,'entityname')||'').trim();
async function sosByPrefix(prefix){
  if(!prefix || prefix.length < 4) return [];
  const e = prefix.replace(/'/g,"''");
  try{ return await socrata(`upper(entityname) like upper('${e}%')`, 50); }catch(err){ return []; }
}
async function sosAtAddress(addr){
  const key = addrKey(addr);
  if(!key || key.length < 6) return [];
  const e = key.replace(/'/g,"''");
  try{ return await socrata(`upper(principaladdress1) like upper('${e}%')`, 60); }catch(err){ return []; }
}

// Every parcel that mails to the same address. Pure assessor data — works in EVERY market,
// no Secretary of State required. This is the Phoenix answer.
async function mailboxFamily(svc, p){
  const mailKey = pickAttrKey(p, MAIL_KEYS) || 'MAIL_ADDR1';
  const mail = p.MAIL_ADDR1 || p[mailKey];
  if(!svc || !mail) return {mail:'', names:[], parcels:0};
  const feats = await assessorFieldSearch(svc, mailKey, mail, 150).catch(()=>[]);
  const names = [...new Set(feats.map(f=>(f.properties.OWNER_NAME||'').trim()).filter(Boolean))];
  return {mail, names, parcels:feats.length};
}
// Score a name as "the operating company" rather than a holding vehicle.
function operatorScore(name){
  const n = (name||'').toUpperCase();
  if(!n) return -99;
  let s = 0;
  if(!SPV_PATTERN.test(n)) s += 45;
  if(/(COMPANY|PROPERTIES|PROPERTY|GROUP|PARTNERS|MANAGEMENT|DEVELOPMENT|REALTY|CAPITAL|RESIDENTIAL|COMMUNITIES|REAL ESTATE|ADVISORS|EQUITIES)/.test(n)) s += 20;
  if(AGENT_SERVICES.test(n)) s -= 100;
  s -= Math.min(15, n.length/5);
  return s;
}

// A name blacklist will never be complete. The real test is behavioural: a commercial agent
// serves hundreds of unrelated entities; a sponsor's own agent serves a handful.
const agentCountCache = new Map();
async function agentIsService(name){
  if(!name) return true;
  if(AGENT_SERVICES.test(name)) return true;
  if(agentCountCache.has(name)) return agentCountCache.get(name) >= 25;
  const e = name.replace(/'/g,"''");
  let n = 0;
  try{
    const rows = await socrata(`upper(agentorganizationname)=upper('${e}')`, 40);
    n = rows.length;
  }catch(err){ n = 0; }
  agentCountCache.set(name, n);
  return n >= 25;              // serves a crowd → it's a mailbox, not the owner
}
// "C/O SEMINOLE REAL ESTATE FUND" on the deed is the owner telling you who they are.
function careOfName(...vals){
  for(const v of vals){
    const m = /(?:^|\s)(?:C\/O|C\.O\.|ATTN:?|CARE OF)\s+(.{3,})$/i.exec(String(v||'').trim());
    if(m) return m[1].replace(/\s{2,}/g,' ').trim();
  }
  return '';
}

// Resolve who is actually behind an ownership entity, using signals ranked by trustworthiness.
// Every candidate carries its evidence, and nothing gets asserted from a crowded address or a
// commercial registered agent — a confident wrong answer is worse than "not found".
// ---- Owner resolution — replicates the manual analyst process ----
// 1) pull the entity's REAL addresses from CO SOS (principal office, not the assessor's tax lockbox)
// 2) classify the principal address: agent/law office (many co-filers) · residential · commercial
// 3) return a verdict with its evidence, and hand over the office address for the final human call.

function fullPrincipal(row){
  const a = pickAttr(row,'principaladdress1','principaladdress','principalstreetaddress') || '';
  const a2= pickAttr(row,'principaladdress2') || '';
  const c = pickAttr(row,'principalcity') || '';
  const st= pickAttr(row,'principalstate') || '';
  const z = pickAttr(row,'principalzipcode','principalzip') || '';
  return { line:[a,a2].filter(Boolean).join(' '), city:c, state:st, zip:z,
           full:[[a,a2].filter(Boolean).join(' '), [c,st].filter(Boolean).join(', '), z].filter(Boolean).join(' \u00b7 ') };
}
function fullMailing(row){
  const a = pickAttr(row,'entitymailingaddress1','mailingaddress1','mailingaddress') || '';
  const c = pickAttr(row,'entitymailingcity','mailingcity') || '';
  const st= pickAttr(row,'entitymailingstate','mailingstate') || '';
  const z = pickAttr(row,'entitymailingzipcode','mailingzip') || '';
  if(!a) return '';
  return [a,[c,st].filter(Boolean).join(', '),z].filter(Boolean).join(' \u00b7 ');
}
// street part only, normalized to a suite-level key for matching (keeps the unit #, your key signal)
function suiteKey(line){
  if(!line) return '';
  return String(line).toUpperCase().replace(/[.,#]/g,' ')
    .replace(/\bSTE\b|\bSUITE\b|\bUNIT\b|\bAPT\b/g,'STE')
    .replace(/\s+/g,' ').trim();
}
function looksResidential(line){
  if(!line) return false;
  const n = line.toUpperCase();
  const hasUnit = /\b(STE|SUITE|UNIT|APT|FLOOR|FL|#)\b/.test(n);
  const homeish = /\b(ST|AVE|DR|CT|LN|WAY|PL|CIR|TER|RD|BLVD|TRL|LOOP)\b/.test(n);
  return homeish && !hasUnit && !/\bPO BOX\b/.test(n);
}
// How many OTHER entities file from the same principal street address?
async function entitiesAtPrincipal(line){
  const key = suiteKey(line);
  if(!key || key.length < 6) return [];
  const streetOnly = key.replace(/\bSTE\b.*$/,'').trim();      // match the building, count the suite crowd
  const e = streetOnly.replace(/'/g,"''");
  try{ return await socrata(`upper(principaladdress1) like upper('${e}%')`, 60); }
  catch(err){ return []; }
}

async function resolveOwnerIdentity(owner, mailAddr, svc, p){
  const out = { filing:null, verdict:null, name:null, why:null, principal:null, mailing:null,
                agent:null, agentAddr:null, coFilers:[], status:null, entityId:null, checked:[] };
  if(mkt().entityLookup !== 'co'){ out.verdict='no-api'; return out; }

  const rows = await lookupEntity(owner).catch(()=>[]);
  out.filing = rows.length ? bestEntityRow(rows, owner) : null;
  if(!out.filing){ out.verdict='not-found'; return out; }
  out.checked.push('CO SOS filing');

  const f = out.filing;
  const prin = fullPrincipal(f);
  out.principal = prin.full || null;
  out.mailing   = fullMailing(f) || null;
  out.agent     = entityAgent(f) || null;
  out.agentAddr = [pickAttr(f,'agentprincipaladdress1','agentaddress1','agentaddress')||'',
                   [pickAttr(f,'agentprincipalcity','agentcity')||'', pickAttr(f,'agentprincipalstate','agentstate')||''].filter(Boolean).join(', ')].filter(Boolean).join(' \u00b7 ') || null;
  out.status    = pickAttr(f,'entitystatus') || null;
  out.entityId  = pickAttr(f,'entityid') || null;

  // classify the principal office
  if(!prin.line){
    out.verdict = 'buried'; out.name = out.agent || null;
    out.why = 'No principal office on file' + (out.agent ? ' \u2014 only a registered agent' : '') + '.';
    return out;
  }
  if(looksResidential(prin.line)){
    out.verdict = 'individual';
    out.name = out.agent || null;
    out.why = 'Principal office is a residential address \u2014 owned by an individual.';
    out.checked.push('address type: residential');
    return out;
  }

  // Is the entity's "office" really just its lawyer/agent? Compare principal to agent address.
  const agentIsSvc = out.agent ? await agentIsService(out.agent).catch(()=>false) : false;
  const agentIsLaw = agentIsSvc || AGENT_SERVICES.test(out.agent||'') || /\\b(LAW|LEGAL|LLP|ATTORNEY|COUNSEL|PLLC)\\b/i.test(out.agent||'');
  const agentLine = pickAttr(out.filing,'agentprincipaladdress1','agentaddress1','agentaddress') || '';
  const officeIsAgent = agentLine && suiteKey(agentLine) && suiteKey(agentLine) === suiteKey(prin.line);

  if(agentIsLaw && officeIsAgent){
    out.verdict = 'buried';
    out.name = out.agent || null;
    out.why = 'The principal office is the registered agent / law office \\u2014 ownership is shielded behind counsel.';
    return out;
  }

  // A real, distinct operating office. This is the answer \u2014 the agent (CT Corp etc.) is irrelevant.
  const raw = await entitiesAtPrincipal(prin.line);
  const active = raw.filter(x=>/GOOD STANDING|EXISTS|ACTIVE/i.test(pickAttr(x,'entitystatus')||''));
  const pool = active.length ? active : raw;
  out.coFilers = [...new Set(pool.map(sosName).filter(n=>n && n.toUpperCase() !== (owner||'').toUpperCase()))];
  out.verdict = 'office';
  out.why = 'This is the operator\\u2019s office. Search the address to confirm the firm.';
  return out;
}

function bestEntityRow(rows, owner){
  const up = (owner||'').toUpperCase().trim();
  const score = r => {
    const nm = (pickAttr(r,'entityname')||'').toUpperCase().trim();
    const st = (pickAttr(r,'entitystatus')||'').toUpperCase();
    let s = 0;
    if(nm === up) s += 100;
    if(/GOOD STANDING|EXISTS|ACTIVE/.test(st)) s += 20;
    return s;
  };
  return rows.slice().sort((a,b)=>score(b)-score(a))[0];
}
function initEntitySection(owner, mailAddr){
  const el = $('entityBlock'); if(!el) return;
  const cls = classifyOwner(owner);
  const isBiz = cls.type === 'entity' || cls.type === 'trust';

  el.innerHTML = `<div class="ent-head"><span class="ent-owner">${esc(owner || '\u2014')}</span><span class="ent-badge ent-${cls.type}">${cls.label}</span></div>`
    + (cls.type === 'individual' ? `<div class="ent-note">Owned by an individual \u2014 no entity to look through.</div>` : '');

  const row = $('ownerActions'); if(row && isBiz){
    row.insertAdjacentHTML('afterbegin', `<button class="ent-btn2" id="entResolve">Who is behind this?</button>`);
  }
  const btn = $('entResolve');
  if(!btn) return;
  btn.addEventListener('click', async function(){
    this.textContent = 'Digging\u2026'; this.disabled = true;
    const res = $('entResult');
    const f = currentFeature;
    const svc = f ? xrefSvc(f) : null;
    const p = f ? (f.properties||{}) : {};

    let r;
    try{ r = await resolveOwnerIdentity(owner, mailAddr, svc, p); }
    catch(e){
      res.innerHTML = `<div class="ent-note">Lookup failed \u2014 try again.</div>`;
      this.disabled = false; this.textContent = 'Who is behind this?'; return;
    }

    let h = '<div class="ent-resolve-head"><span class="err-label">Who is behind this</span><button class="xref-close" id="entClose">Close \u00d7</button></div>';

    const V = r.verdict;
    if(V === 'no-api'){
      h += `<div class="ent-answer none"><div class="ea-name">No live lookup here</div>`
         + `<div class="ea-how">Owner resolution runs on the Colorado SOS. Arizona\u2019s Corporation Commission blocks automated search. `
         + `<a class="ext-link" href="https://ecorp.azcc.gov/EntitySearch/Index" target="_blank" rel="noopener">Search ACC \u2192</a></div></div>`;
    } else if(V === 'not-found'){
      h += `<div class="ent-answer none"><div class="ea-label">Real owner</div><div class="ea-name">Not found</div>`
         + `<div class="ea-how">No Colorado filing matches this entity name.</div></div>`;
    } else {
      // verdict card
      const badge = {office:'Operating office', company:'Operator', individual:'Individual owner', buried:'Buried'}[V] || 'Result';
      const cls = (V==='buried') ? 'warn' : (V==='individual') ? '' : 'ok';
      const headline = r.name ? r.name : (V==='office' ? 'Look up the office below' : V==='individual' ? (r.agent||'Individual') : 'Shielded');
      h += `<div class="ent-answer ${V==='office'||V==='company'||V==='individual'?'':'none'}">`
         + `<div class="ea-label">${badge}</div>`
         + `<div class="ea-name">${esc(headline)}</div>`
         + `<div class="ea-how">${esc(r.why||'')}</div></div>`;

      // THE address that matters — principal office, front and center
      if(r.principal){
        const addrPlain = r.principal.replace(/\s*\u00b7\s*/g,' ').replace(/\s+/g,' ').trim();
        const gq = encodeURIComponent(addrPlain);
        h += `<div class="addr-card"><div class="addr-label">Principal office</div>`
           + `<div class="addr-val">${esc(r.principal)}</div>`
           + `<div class="addr-actions">`
           + `<a class="ext-link" href="https://www.google.com/search?q=${gq}" target="_blank" rel="noopener">Search \u2192</a>`
           + `<a class="ext-link" href="https://www.google.com/maps/search/?api=1&query=${gq}" target="_blank" rel="noopener">Maps \u2192</a>`
           + `</div></div>`;
      }

      // co-filers — secondary, collapsed by default so it hides itself
      if(r.coFilers && r.coFilers.length){
        h += `<details class="ent-more"><summary>${r.coFilers.length} other ${r.coFilers.length===1?'entity':'entities'} at this address</summary>`
           + `<div class="ec-list">${r.coFilers.slice(0,14).map(n=>`<span class="ec-chip">${esc(n)}</span>`).join('')}`
           + (r.coFilers.length>14 ? `<span class="ec-more">+${r.coFilers.length-14}</span>` : '') + `</div></details>`;
      }

      // the filing, as supporting detail (agent, mailing, status, link)
      const kv = [
        r.agent ? ['Registered agent', r.agent] : null,
        r.agentAddr ? ['Agent address', r.agentAddr] : null,
        r.mailing ? ['Entity mailing', r.mailing] : null,
        r.status ? ['Status', r.status] : null,
      ].filter(Boolean);
      if(kv.length){
        h += `<div class="ent-card"><div class="ent-card-name">${esc(pickAttr(r.filing,'entityname')||owner)}</div>`
           + `<div class="kv">${kv.map(([k,v])=>`<div class="k">${k}</div><div class="v">${esc(v)}</div>`).join('')}</div>`
           + (r.entityId ? `<a class="ext-link" href="https://www.coloradosos.gov/biz/BusinessEntityDetail.do?quitButtonDestination=BusinessEntityResults&nameTyp=ENT&masterFileId=${encodeURIComponent(r.entityId)}&entityId2=${encodeURIComponent(r.entityId)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:8px">CO SOS filing \u2192</a>` : '')
           + `</div>`;
      }
    }
    res.innerHTML = h;
    const ec = $('entClose');
    if(ec) ec.addEventListener('click', ()=>{
      res.innerHTML = '';
      this.style.display = ''; this.disabled = false; this.textContent = 'Who is behind this?';
    });
    this.style.display = 'none';
  });
}

// ---- Owner portfolio: a portfolio is not "same name", it's "same owner" ----
// Sibling SPVs (Fund I / Fund II / a numbered LLC per asset) share a mailbox, so we union
// name-matches with mailing-address matches and group the result by entity.
function sourceForFeature(f){
  const m = mkt();
  if(m.parcelSvc) return {name:m.name, svc:m.parcelSvc};
  if(!m.counties) return null;
  let c;
  try{ c = f.geometry ? L.geoJSON(f).getBounds().getCenter() : map.getCenter(); }catch(e){ c = map.getCenter(); }
  const hit = m.counties.filter(ct=>ct.svc && ct.bounds
    && c.lat>=ct.bounds[0][0] && c.lat<=ct.bounds[1][0]
    && c.lng>=ct.bounds[0][1] && c.lng<=ct.bounds[1][1]);
  return hit[0] || null;
}
// Tiles have no query endpoint, so a portfolio search falls back to the market's live source.
function xrefSvc(f){
  const m = mkt();
  if(m.parcelSvc) return m.parcelSvc;
  const src = sourceForFeature(f);
  if(src && src.svc) return src.svc;
  return m.fallbackSvc || null;
}
async function assessorFieldSearch(svc, field, value, limit){
  const gj = await arcgisQuery(svc, {
    where: `UPPER(${field})=UPPER('${String(value).replace(/'/g,"''")}')`,
    outFields: mkt().parcelFields, returnGeometry:true, outSR:4326, resultRecordCount: limit||60
  });
  const nz = mkt().normalize;
  return (gj.features||[]).map(f=>{ f.properties = nz(f.properties); return f; });
}
async function ownerPortfolio(svc, p){
  const ownerKey = pickAttrKey(p, OWNER_KEYS) || 'OWNER_NAME';
  const mailKey  = pickAttrKey(p, MAIL_KEYS)  || 'MAIL_ADDR1';
  const owner    = p.OWNER_NAME;
  const mail     = p.MAIL_ADDR1 || (pickAttrKey(p, MAIL_KEYS) ? p[pickAttrKey(p, MAIL_KEYS)] : '');

  const jobs = [];
  if(owner) jobs.push(assessorFieldSearch(svc, ownerKey, owner, 80).catch(()=>[]));
  if(mail)  jobs.push(assessorFieldSearch(svc, mailKey,  mail, 120).catch(()=>[]));
  const parts = await Promise.all(jobs);

  const byApn = new Map();
  parts.flat().forEach(f=>{ const a = f.properties && f.properties.APN; if(a && !byApn.has(a)) byApn.set(a, f); });
  return [...byApn.values()];
}
let xrefResults = [];
function openFromXref(f){
  try{ if(f.geometry) map.fitBounds(L.geoJSON(f).getBounds().pad(1.0)); }catch(e){}
  f._full = true; openParcel(f);
}
function initOwnerXref(){
  const f = currentFeature; if(!f) return;
  const p = f.properties || {};
  const owner = p.OWNER_NAME;
  const res = $('xrefResult'); if(res) res.innerHTML = '';
  clearPortfolio();
  if(!owner) return;
  const svc = xrefSvc(f);
  const row = $('ownerActions'); if(!row) return;
  if(!svc){ row.insertAdjacentHTML('beforeend', `<span class="ent-note" style="flex:1">No searchable assessor source here.</span>`); return; }

  row.insertAdjacentHTML('beforeend', `<button class="ent-btn2" id="xrefOwner">Everything this owner holds</button>`);

  $('xrefOwner').addEventListener('click', async function(){
    this.textContent = 'Searching\u2026'; this.disabled = true;
    let feats = [];
    try{ feats = await ownerPortfolio(svc, p); }
    catch(e){
      res.innerHTML = `<div class="ent-note">Search failed on this county service.</div>`;
      this.disabled = false; this.textContent = 'Everything this owner holds'; return;
    }
    const rows = feats.filter(x => (x.properties.APN||'') !== p.APN);
    if(!rows.length){
      res.innerHTML = `<div class="ent-note">No other parcels under this owner or mailing address.</div>`;
      this.style.display = 'none'; return;
    }
    xrefResults = rows;
    showPortfolio(rows, currentFeature);   // paint them on the map, keeping the subject in view

    const groups = new Map();
    rows.forEach(x=>{ const o = x.properties.OWNER_NAME || 'Unknown'; if(!groups.has(o)) groups.set(o, []); groups.get(o).push(x); });
    const acres = rows.reduce((a,x)=> a + (geomAcres(x.geometry) || x.properties._acresAttr || 0), 0);
    const multi = groups.size > 1;

    let h = `<div class="xref-head"><div><b class="num">${rows.length}</b> other parcel${rows.length>1?'s':''}`
          + (acres ? ` \u00b7 <b class="num">${acres.toFixed(1)}</b> ac` : '')
          + (multi ? ` \u00b7 <b class="num">${groups.size}</b> entities share this mailbox` : '')
          + `</div><button class="xref-close" id="xrefClose" title="Clear from map">Close \u00d7</button></div>`;

    for(const [name, list] of groups){
      if(multi) h += `<div class="xref-group"><span>${esc(name)}</span><span class="num">${list.length}</span></div>`;
      h += list.slice(0,40).map(x=>{
        const q = x.properties;
        const addr = [q.PHYSICAL_ADDRESS, q.PHYSICAL_CITY].filter(Boolean).join(', ') || (q.APN_DASH || q.APN);
        const ac = geomAcres(x.geometry) || q._acresAttr;
        return `<div class="xref-row" data-i="${rows.indexOf(x)}"><div class="xref-addr">${esc(addr)}</div>`
             + `<div class="xref-sub">${ac ? ac.toFixed(2)+' ac' : esc(q.APN_DASH||q.APN||'')}</div></div>`;
      }).join('');
    }
    res.innerHTML = h;
    res.querySelectorAll('.xref-row').forEach(r=> r.addEventListener('click', ()=> openFromXref(rows[+r.dataset.i])));
    const cbtn = $('xrefClose');
    if(cbtn) cbtn.addEventListener('click', ()=>{
      res.innerHTML = ''; clearPortfolio();
      this.style.display = ''; this.disabled = false; this.textContent = 'Everything this owner holds';
    });
    this.style.display = 'none';
  });
}
function ownershipKv(p){
  // The assessor's owner-address is just a tax lockbox — not shown. The real office comes from
  // "Who is behind this?". Only surface a genuine second owner of record here.
  if(!p.OWNER_NAME2) return '';
  return `<div class="k">Second owner</div><div class="v">${esc(p.OWNER_NAME2)}</div>`;
}
function valueKv(p, acres){
  const salePsf = (p.SALE_PRICE > 0 && acres) ? p.SALE_PRICE / (acres*43560) : null;
  const salePerAcre = (p.SALE_PRICE > 0 && acres) ? p.SALE_PRICE / acres : null;
  return `<div class="k">Last sale</div><div class="v">${fmtUsd(p.SALE_PRICE)}${p.SALE_DATE ? ' · '+fmtDateMs(p.SALE_DATE) : ''}</div>
    <div class="k">Sale $/land SF</div><div class="v">${salePsf ? '$'+salePsf.toFixed(2) : '—'}</div>
    <div class="k">Sale $/acre</div><div class="v">${salePerAcre ? fmtUsd(salePerAcre) : '—'}</div>
    <div class="k">FCV (current)</div><div class="v">${fmtUsd(p.FCV_CUR)}</div>
    <div class="k">LPV (current)</div><div class="v">${fmtUsd(p.LPV_CUR)}</div>`;
}
async function fetchFullParcel(apn){
  const src = mkt().parcelSvc ? mkt().parcelSvc : (mkt().counties ? (mkt().counties.find(c=>c.svc)||{}).svc : null);
  if(!src) return null;
  try{
    const gj = await arcgisQuery(src, {
      where: mkt().apnSearch(apn), outFields:mkt().parcelFieldsFull, returnGeometry:false, outSR:4326, resultRecordCount:1
    });
    const f = gj.features && gj.features[0];
    return f ? mkt().normalize(f.properties) : null;
  }catch(e){ return null; }
}
function txnHistoryHtml(p, acres){
  const rows = [];
  if(p.SALE_DATE || p.SALE_PRICE>0){
    const psf = (p.SALE_PRICE>0 && acres) ? '$'+(p.SALE_PRICE/(acres*43560)).toFixed(2)+'/land SF' : '';
    const pac = (p.SALE_PRICE>0 && acres) ? '$'+Math.round(p.SALE_PRICE/acres).toLocaleString('en-US')+'/ac' : '';
    rows.push(`<div class="txn-row">
      <div><div class="txn-date">${p.SALE_DATE?fmtDateMs(p.SALE_DATE):'Recorded sale'}</div><div class="txn-sub">${[psf,pac].filter(Boolean).join(' · ')||'Most recent recorded sale'}</div></div>
      <div class="txn-price">${p.SALE_PRICE>0?'$'+Number(p.SALE_PRICE).toLocaleString('en-US'):'—'}</div>
    </div>`);
  }
  if(!rows.length) return '<div style="color:var(--text-faint);font-size:12px">No recorded sale on the assessor record.</div>';
  return rows.join('') + '<div class="txn-sub" style="margin-top:8px">Grantor/grantee chain and prior deeds are in the county records linked below.</div>';
}
// One place for the money. The last recorded sale leads (with the $/acre and $/SF an acquisitions
// read actually wants), assessed values follow. Replaces the old split Value / Transactions sections.
function valuationHtml(p, acres){
  const price = +p.SALE_PRICE || 0;
  const perAcre = (price > 0 && acres) ? price/acres : null;
  const perSf   = (price > 0 && acres) ? price/(acres*43560) : null;
  const rows = [];
  if(p.FCV_CUR)      rows.push(['Appraised value', fmtUsd(p.FCV_CUR)]);
  if(p.ASSESSED_VAL) rows.push(['Assessed value', fmtUsd(p.ASSESSED_VAL)]);
  if(p.LPV_CUR)      rows.push(['Limited value', fmtUsd(p.LPV_CUR)]);

  const sale = price > 0 || p.SALE_DATE
    ? `<div class="sale-card">
         <div class="sale-top">
           <div>
             <div class="sale-label">Last recorded sale</div>
             <div class="sale-price num">${price > 0 ? fmtUsd(price) : 'Price not recorded'}</div>
           </div>
           <div class="sale-date num">${p.SALE_DATE ? fmtDateMs(p.SALE_DATE) : '—'}</div>
         </div>
         ${(perAcre || perSf) ? `<div class="sale-unit">
           ${perAcre ? `<span><b class="num">${fmtUsd(perAcre)}</b> / acre</span>` : ''}
           ${perSf ? `<span><b class="num">$${perSf.toFixed(2)}</b> / land SF</span>` : ''}
         </div>` : ''}
       </div>`
    : `<div class="sale-card empty">No sale on the assessor record.</div>`;

  const kv = rows.length
    ? `<div class="kv" style="margin-top:12px">${rows.map(([k,v])=>`<div class="k">${k}</div><div class="v">${v}</div>`).join('')}</div>`
    : '';

  return sale + kv
    + `<button class="txn-history-btn" id="txnHistoryBtn">View full transaction history →</button>`;
}
// All recorded sales for a parcel, shown in a modal. Baked tiles carry only the latest sale, so
// this queries the county assessor's sales table live where one exists, and always offers the
// authoritative Clerk & Recorder search as the fallback.
const F_SALEDATE = ['SALE_DATE','SALEDATE','DEED_DATE','RECEPTION_DATE','REC_DATE','TRANSFER_DATE','saleDate','DATE_OF_SALE','DOC_DATE','recordingDate'];
const F_SALEPRICE = ['SALE_PRICE','SALEPRICE','SALE_AMT','PRICE','SALE_AMOUNT','CONSIDERATION','DEED_AMOUNT','salePrice','DOC_FEE_PRICE','ADJUSTED_SALE_PRICE'];
const F_DEEDTYPE = ['DEED_TYPE','DEEDTYPE','DOC_TYPE','INSTRUMENT','DEED','SALE_TYPE','TRANSFER_TYPE','doc_type'];
async function openTxnHistory(p){
  const county = p._county;
  const recorder = county && COUNTY_RECORDER[county];
  showModal('Transaction history', '<div class="txn-loading">Checking the county assessor for recorded sales…</div>');

  const txns = [];
  // the latest sale we already have from the tile
  if(+p.SALE_PRICE > 0 || p.SALE_DATE){
    txns.push({ date:p.SALE_DATE, price:+p.SALE_PRICE||0, type:'Most recent (assessor)', _tile:true });
  }
  // try the county detail service for a fuller sales list
  const reg = county && COUNTY_DETAIL[county];
  if(reg && reg.svc && window._lastParcelClick){
    try{
      const c = window._lastParcelClick;
      const pt = {x:c.lng, y:c.lat, spatialReference:{wkid:4326}};
      const gj = await arcgisQuery(reg.svc, {
        geometry: JSON.stringify(pt), geometryType:'esriGeometryPoint',
        inSR:4326, outSR:4326, spatialRel:'esriSpatialRelIntersects',
        outFields:'*', returnGeometry:false, resultRecordCount:1,
      }).catch(()=>null);
      const a = gj && gj.features && gj.features[0] && gj.features[0].attributes;
      if(a){
        const d = pickAttr(a, ...F_SALEDATE), pr = +pickAttr(a, ...F_SALEPRICE)||0, ty = pickAttr(a, ...F_DEEDTYPE);
        // only add if it's a different sale than the tile's
        if((d || pr) && !(txns[0] && String(d)===String(txns[0].date) && pr===txns[0].price)){
          txns.push({ date:d, price:pr, type:ty||'County record' });
        }
      }
    }catch(e){}
  }

  // render
  const rows = txns
    .filter(t=>t.date || t.price)
    .sort((a,b)=> (msOf(b.date)||0) - (msOf(a.date)||0))
    .map(t=>`<div class="txn-item">
        <div class="txn-item-main">
          <div class="txn-item-price num">${t.price>0?fmtUsd(t.price):'Price not recorded'}</div>
          <div class="txn-item-type">${esc(t.type||'Recorded sale')}</div>
        </div>
        <div class="txn-item-date num">${t.date?fmtDateMs(t.date):'—'}</div>
      </div>`).join('');

  const body = `
    ${rows || '<div class="txn-loading">No sale on the assessor record.</div>'}
    <div class="txn-foot">
      <p>The assessor carries only limited sale data. For the complete deed chain — every grantor, grantee, and instrument — search the county Clerk &amp; Recorder:</p>
      ${recorder ? `<a class="btn full" href="${recorder}" target="_blank" rel="noopener" style="margin-top:8px">${esc(county)} County Clerk &amp; Recorder →</a>` : '<p style="color:var(--text-faint)">No recorder link on file for this county.</p>'}
    </div>`;
  showModal('Transaction history', body);
}
// Building square footage for the hero cell. Three honest states:
//  · a real SF figure when the assessor carries it (Phoenix LIVING_SPACE, or any bldg-SF field)
//  · "Vacant" only when the record PROVES no improvements (vacant land use, or zero improved value)
//  · "—" when we simply don't have building data (most of CO) — absence isn't proof of vacancy
function buildingSf(p){
  const sf = +pickAttr(p,'LIVING_SPACE','BLDG_SF','buildingSqft','totalSqft','improvementSqft') || 0;
  return sf > 0 ? sf : 0;
}
function looksVacant(p){
  const use = (p.LAND_USE || p.PUC || '').toString().toUpperCase();
  if(/VACANT|UNIMPROVED|RAW LAND|\bLAND\b(?!SCAP)/.test(use)) return true;
  // improved value of zero (when we actually have a value field) implies no structure
  const imp = pickAttr(p,'IMPROVEMENT_VAL','improvval','improvementValue');
  if(imp != null && imp !== '' && +imp === 0) return true;
  return false;
}
function buildingSfHero(p){
  const sf = buildingSf(p);
  if(sf > 0) return fmtInt(sf) + ' SF';
  if(looksVacant(p)) return 'Vacant';
  return '—';
}
function buildingSfNote(p){
  const sf = buildingSf(p);
  if(sf > 0) return 'improved';
  if(looksVacant(p)) return 'no improvements';
  return 'not on county record';
}
function openParcelPending(){
  $('panel').classList.add('open');
  $('panelTitle').textContent = 'Loading parcel…';
  $('panelSub').textContent = '';
  $('panelBody').innerHTML = '<div class="ent-note" style="padding-top:16px">Pulling the record from the county assessor.</div>';
}
function openParcel(f){
  currentFeature = f;
  clearPortfolio();
  highlightParcel(f, window._lastParcelClick || null);
  const p = f.properties || {};
  const apn = p.APN || (p.APN_DASH||'').replace(/-/g,'');
  // If this parcel is tracked and you filled gaps (e.g. a purchase price the assessor lacked),
  // surface those overrides here too — two-way flow, gaps only.
  try{
    const tracked = Store.siteForApn(apn);
    if(tracked){
      const rec = (tracked.parcels||[]).find(x=>x.apn===apn);
      if(rec && rec.overrides){ for(const [k,v] of Object.entries(rec.overrides)){ if(p[k]==null||p[k]===''){ p[k]=v; } } }
    }
  }catch(e){}
  const acres = geomAcres(f.geometry) || (f.properties && f.properties._acresAttr) || null;
  // No acreage from tile/geometry → fetch the polygon to derive it (backfills the panel + parcel)
  if(!acres && window._lastParcelClick){ fetchParcelShape(window._lastParcelClick, apn); }
  // The address is the identity of the thing. The APN is how the county files it — subordinate.
  $('panelTitle').textContent = p.PHYSICAL_ADDRESS || 'No situs address on file';
  $('panelSub').innerHTML = [
    p.APN_DASH || p.APN,
    p.PHYSICAL_CITY,
    p._county ? p._county + ' County' : null,
  ].filter(Boolean).map(esc).join(' &middot; ');

  const assessor = assessorLinkFor(p, apn);
  const recorderUrl = mkt().counties
    ? (p._county && COUNTY_RECORDER[p._county]) || 'https://www.google.com/search?q='+encodeURIComponent((p._county?p._county+' County ':'')+'Colorado clerk recorder')
    : 'https://recorder.maricopa.gov/recdocdata/GetRecDataDetail.aspx';

  const body = $('panelBody');
  body.innerHTML = `
    <div class="panel-sec">
      <div class="stat-grid">
        <div class="stat zone-hero"><div class="s-label">Zoning</div><div class="s-val num" id="zoneVal">Looking up…</div><div class="s-note" id="zoneSrc"></div></div>
        <div class="stat"><div class="s-label">Site area</div><div class="s-val num" id="siteAreaVal">${acres ? acres.toFixed(2)+' ac' : '—'}</div><div class="s-note" id="siteAreaSub">${acres ? fmtInt(acres*43560)+' SF' : ''}</div></div>
        <div class="stat"><div class="s-label">Building SF</div><div class="s-val num" id="bldgSfVal" style="font-size:14px">${buildingSfHero(p)}</div><div class="s-note" id="bldgSfNote">${buildingSfNote(p)}</div></div>
        <div class="stat"><div class="s-label">Land use</div><div class="s-val num" style="font-size:13px" id="stPuc">${esc(p.LAND_USE || p.PUC || '—')}</div></div>
        <div class="stat"><div class="s-label">Subdivision</div><div class="s-val num" style="font-size:13px">${esc(p.SUBNAME || '—')}</div></div>
        <div class="stat" id="yearCell">${p.CONST_YEAR ? `<div class="s-label">Year built</div><div class="s-val num">${p.CONST_YEAR}</div>` : `<div class="s-label">Year built</div><div class="s-val num">—</div>`}</div>
      </div>
      <div id="zoneDiag" style="font-size:10px;color:var(--text-faint);margin-top:8px;letter-spacing:.02em"></div>
    </div>

    <div class="panel-sec">
      <h3>Ownership</h3>
      <div id="entityBlock"></div>
      <div class="kv" id="ownKv" style="margin-top:12px">${ownershipKv(p)}</div>
      <div class="owner-actions" id="ownerActions"></div>
      <div id="entResult"></div>
      <div id="xrefResult"></div>
    </div>

    <div class="panel-sec">
      <h3>Valuation &amp; sale</h3>
      <div id="valBlock">${valuationHtml(p, acres)}</div>
      <div class="rec-links">
        <a class="ext-link" href="${assessor.url}" target="_blank" rel="noopener">${esc(assessor.label)} →</a>
        <a class="ext-link" href="${recorderUrl}" target="_blank" rel="noopener">${mkt().counties ? (p._county ? esc(p._county)+' County Recorder' : 'County Recorder') : 'County Recorder'} →</a>
      </div>
    </div>

    <div class="panel-sec">
      <h3>Tract demographics <span class="h3-note">ACS ${ACS_YEAR} 5-yr</span></h3>
      <div id="demoBlock" class="demo-loading">Loading…</div>
    </div>

    <div class="panel-sec" id="trackBlock"></div>
  `;
  renderTrackBlock(apn, p, f.geometry, acres);
  { const tb = $('txnHistoryBtn'); if(tb) tb.addEventListener('click', ()=>openTxnHistory(p)); }

  // pull building SF / year / municipal zoning from the county assessor (fills in when it lands)
  if(mkt().counties && p._county){ enrichParcelDetail(f, p._county); }
  initEntitySection(p.OWNER_NAME, p.MAIL_ADDR1);
  initOwnerXref();
  $('panel').classList.add('open');

  const center = L.geoJSON(f).getBounds().getCenter();

  // enrich with full attributes if this parcel was loaded with the lite field set
  if(!f._full && apn && !p._regrid && !useRegrid()){
    fetchFullParcel(apn).then(full=>{
      if(full && currentFeature === f){
        Object.assign(p, full); f._full = true;
        if($('ownKv')) $('ownKv').innerHTML = ownershipKv(p);
        initEntitySection(p.OWNER_NAME, p.MAIL_ADDR1);
        initOwnerXref();
        if($('valBlock')) $('valBlock').innerHTML = valuationHtml(p, acres);
        if($('stPuc')) $('stPuc').textContent = p.PUC || '—';
        if($('stJuris')) $('stJuris').textContent = p.JURISDICTION || '';
      }
    }).catch(()=>{});
  }

  // zoning — the parcel record itself carries zoning in markets whose data includes it (e.g. the
  // CO master file baked into the tiles). Use it instantly; only hit live zoning services if absent.
  const ownZone = (p.CITY_ZONING && !/contact|see |jurisd/i.test(p.CITY_ZONING)) ? p.CITY_ZONING : null;
  if(ownZone){
    $('zoneVal').textContent = ownZone;
    $('zoneSrc').textContent = p.ZONING_DESC ? String(p.ZONING_DESC).slice(0,60) : 'assessor record';
    const diag0 = $('zoneDiag'); if(diag0) diag0.textContent = '';
  } else if(center) {
    lookupZoning(center).then(({hit, trace})=>{
      if(hit){
        $('zoneVal').textContent = hit.code;
        $('zoneSrc').textContent = hit.source + ' zoning · ' + hit.field;
      } else {
        $('zoneVal').textContent = 'Not on record';
        $('zoneVal').style.fontSize = '15px';
        $('zoneSrc').textContent = p.LAND_USE ? 'use: ' + String(p.LAND_USE).slice(0,40) : 'no county zoning layer';
      }
      const diag = $('zoneDiag');
      if(diag){
        const icon = s => s==='ok'?'✓':s==='error'?'⚠':s==='no-field'?'?':'·';
        diag.innerHTML = 'Sources: ' + trace.map(t=>`${esc(t.name)} ${icon(t.status)}`).join('  ·  ');
      }
    }).catch(()=>{ $('zoneVal').textContent = '—'; });
  } else {
    $('zoneVal').textContent = '—';
  }

  // demographics — centroid of bounds
  try{
    const c = center;
    if(!c){ $('demoBlock').innerHTML = '<span class="demo-loading">—</span>'; }
    else fetchDemographics(c.lat, c.lng).then(d=>{
      $('demoBlock').innerHTML = `
        <div class="stat-grid">
          <div class="stat"><div class="s-label">Median HH income</div><div class="s-val num">${fmtUsd(d.mhhi)}</div></div>
          <div class="stat"><div class="s-label">Median gross rent</div><div class="s-val num">${fmtUsd(d.medRent)}<span style="font-size:11px;color:var(--text-muted)">/mo</span></div></div>
          <div class="stat"><div class="s-label">Renter share</div><div class="s-val num">${d.renterPct!=null ? d.renterPct+'%' : '—'}</div></div>
          <div class="stat"><div class="s-label">Population</div><div class="s-val num">${fmtInt(d.pop)}</div></div>
          <div class="stat"><div class="s-label">Median home value</div><div class="s-val num">${fmtUsd(d.medHomeVal)}</div></div>
          <div class="stat"><div class="s-label">Census tract</div><div class="s-val num">${esc(d.tract)}</div></div>
        </div>`;
    }).catch(()=>{ $('demoBlock').innerHTML = '<span class="demo-loading">Demographics unavailable for this location.</span>'; });
  }catch(e){ $('demoBlock').innerHTML = '<span class="demo-loading">Demographics unavailable.</span>'; }
}

function renderTrackBlock(apn, attrs, geometry, acres){
  const el = $('trackBlock');
  const rec = parcelRec(apn, attrs, geometry, acres);
  const site = Store.siteForApn(apn);
  if(site){
    el.innerHTML = `<h3>Tracked</h3>
      <div class="site-summary" style="margin-top:0">Part of <b style="color:var(--text)">${esc(siteName(site))}</b> · ${site.parcels.length} parcel${site.parcels.length>1?'s':''} · ${siteAcres(site).toFixed(2)} ac</div>
      <button class="btn full" id="btnOpenSite">Open site</button>`;
    $('btnOpenSite').addEventListener('click', ()=> openSiteDetail(site.id));
  } else {
    el.innerHTML = `<h3>Track this parcel</h3><button class="btn full" id="btnAddToSite">＋ Add to a site</button>`;
    $('btnAddToSite').addEventListener('click', ()=> openAddChooser(rec));
  }
}

function closeParcelPanel(){ $('panel').classList.remove('open'); clearParcelHighlight(); currentFeature = null; }
$('panelClose').addEventListener('click', closeParcelPanel);
document.addEventListener('keydown', e=>{ if(e.key!=='Escape') return; if($('panel').classList.contains('open')) closeParcelPanel(); else clearParcelHighlight(); });

// ---------- Search: APN or address ----------
function looksLikeAPN(q){ return /^[\d]{3}[- ]?\d{2}[- ]?\d{3,4}[A-Z]?$/i.test(q.trim()) || /^\d{8,12}$/.test(q.trim()); }
async function searchAPN(q){
  const sources = mkt().counties ? mkt().counties.filter(c=>c.svc) : (mkt().parcelSvc ? [{svc:mkt().parcelSvc}] : []);
  for(const src of sources){
    const gj = await arcgisQuery(src.svc, {
      where: mkt().apnSearch(q), outFields:mkt().parcelFields, returnGeometry:true, outSR:4326, resultRecordCount:1
    }).catch(()=>null);
    if(gj && gj.features.length){
      const f = normalizeFeature(gj.features[0]);
      map.fitBounds(L.geoJSON(f).getBounds().pad(1.2));
      f._full = true; openParcel(f);
      return;
    }
  }
  throw new Error('Parcel not found');
}
async function searchAddress(q){
  const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
    q, format:'json', limit:1, countrycodes:'us',
    viewbox: mkt().searchViewbox, bounded:0
  });
  const res = await (await fetch(url)).json();
  if(!res.length) throw new Error('Address not found');
  const {lat, lon, display_name} = res[0];
  map.setView([+lat, +lon], 17);
  $('searchMsg').textContent = display_name.split(',').slice(0,3).join(',');
}
async function runSearch(){
  const q = $('searchInput').value.trim();
  if(!q) return;
  $('searchMsg').textContent = 'Searching…';
  try{
    if(looksLikeAPN(q)) await searchAPN(q);
    else await searchAddress(q);
    if(looksLikeAPN(q)) $('searchMsg').textContent = '';
  }catch(e){
    $('searchMsg').textContent = e.message || 'Not found';
  }
}
$('searchBtn').addEventListener('click', runSearch);
$('searchInput').addEventListener('keydown', e=>{ if(e.key==='Enter') runSearch(); });

// ---------- Export / import ----------
function download(name, text, mime){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], {type:mime}));
  a.download = name;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
}
$('exportJson').addEventListener('click', ()=>{
  download(`wb-sitescout-sites-${new Date().toISOString().slice(0,10)}.json`,
    JSON.stringify(Store.data, null, 2), 'application/json');
});
function exportSitesCsv(){
  const cols = ['Site','Status','Parcels','APNs','Total Acres','Cities','Owners','Notes'];
  const rows = Store.all().map(s=>{
    const apns = s.parcels.map(p=>p.apnDash||p.apn).join('; ');
    const cities = [...new Set(s.parcels.map(p=>p.attrs&&p.attrs.PHYSICAL_CITY).filter(Boolean))].join('; ');
    const owners = [...new Set(s.parcels.map(p=>p.attrs&&p.attrs.OWNER_NAME).filter(Boolean))].join('; ');
    const notes = (s.notes||[]).map(n=>`[${new Date(n.t).toLocaleDateString('en-US')}] ${n.text}`).join(' | ');
    return [ siteName(s), (statusById[s.status]||{}).label||s.status, s.parcels.length, apns,
      siteAcres(s).toFixed(3), cities, owners, notes ]
      .map(v=>{ v=String(v); return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; }).join(',');
  });
  download(`wb-sitescout-sites-${new Date().toISOString().slice(0,10)}.csv`, cols.join(',')+'\n'+rows.join('\n'), 'text/csv');
}
$('exportCsv').addEventListener('click', exportSitesCsv);
$('importJson').addEventListener('click', ()=> $('importFile').click());
$('importFile').addEventListener('change', e=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const incoming = JSON.parse(reader.result);
      if(!incoming.sites) throw new Error('Not a Site Scout backup');
      const n = Object.keys(incoming.sites).length;
      if(confirm(`Import ${n} site(s)? Sites with the same id will be overwritten.`)){
        Object.assign(Store.data.sites, incoming.sites);
        if(incoming.seq && incoming.seq > (Store.data.seq||0)) Store.data.seq = incoming.seq;
        Store.save(); Store.load(); renderTracked();
      }
    }catch(err){ alert('Import failed: ' + err.message); }
    e.target.value = '';
  };
  reader.readAsText(file);
});

// ---------- Sites review modal ----------
// ---------- Assembly mode: build a site by clicking parcels on the map ----------
const assembly = {active:false, siteId:null};
function startAssembly(siteId){
  assembly.active = true; assembly.siteId = siteId;
  $('panel').classList.remove('open');
  $('siteDetailOverlay').classList.remove('open');
  $('addChooserOverlay').classList.remove('open');
  updateAssemblyBanner();
  $('assemblyBanner').classList.add('show');
}
function stopAssembly(openDetail){
  const id = assembly.siteId;
  assembly.active = false; assembly.siteId = null;
  $('assemblyBanner').classList.remove('show');
  if(openDetail && id && Store.get(id)) openSiteDetail(id);
}
function updateAssemblyBanner(){
  const s = Store.get(assembly.siteId);
  const n = s ? s.parcels.length : 0;
  $('assemblyText').innerHTML = 'Building <b>' + esc(s ? siteName(s) : 'site') + '</b> \u2014 click parcels to add or remove \u00b7 ' + n + ' selected';
}
function parcelAcres(f){
  let ac = geomAcres(f.geometry) || (f.properties && f.properties._acresAttr) || 0;
  // if the async highlight has fetched the real polygon, use its area
  if(!ac){ try{ const b = selectedParcelLayer.toGeoJSON(); if(b && b.features && b.features[0]) ac = geomAcres(b.features[0].geometry) || 0; }catch(e){} }
  return ac;
}
// After the polygon backfill lands, patch the acreage into any stored parcel with this APN.
function backfillParcelAcres(apn, acres){
  if(!apn || !(acres>0)) return;
  let touched = false;
  Store.all().forEach(s=>{
    (s.parcels||[]).forEach(p=>{ if(p.apn===apn && !(p.acres>0)){ p.acres = acres; touched = true; } });
    if(touched) Store.upsert(s);
  });
  if(touched){ renderTracked(); if(sdCurrentId && Store.get(sdCurrentId)) renderSiteDetailBody(Store.get(sdCurrentId)); }
}
function addParcelToActiveSite(f){
  const s = Store.get(assembly.siteId); if(!s) return;
  const p = f.properties; const apn = p.APN || (p.APN_DASH||'').replace(/-/g,'');
  if(s.parcels.some(x=>x.apn===apn)) s.parcels = s.parcels.filter(x=>x.apn!==apn);
  else {
    const ac = parcelAcres(f);
    s.parcels.push(parcelRec(apn, p, f.geometry, ac));
    s.acresOverride = null;   // adding a parcel → total should auto-sum again
    // tile clicks carry no geometry → acreage is 0 until we fetch the polygon.
    // Backfill it (into this parcel + the site total) the same way the single-parcel flow does.
    if(!(ac > 0)){
      const c = window._lastParcelClick;
      if(c) fetchParcelShape(c, apn);
    }
  }
  Store.upsert(s); renderTracked(); updateAssemblyBanner();
}
$('assemblyDone').addEventListener('click', ()=> stopAssembly(true));
function startNewSite(){
  if(!marketReady()){ $('searchMsg').textContent = 'Switch to a wired market first.'; return; }
  const id = Store.newId();
  Store.upsert({id, name:'Untitled site', status:'prospect', notes:[], created:Date.now(), updated:Date.now(), parcels:[]});
  renderTracked();
  $('sitesHomeOverlay').classList.remove('open');
  startAssembly(id);
}
$('openSitesHome').addEventListener('click', ()=>{ renderSitesHome(); $('sitesHomeOverlay').classList.add('open'); });
$('sitesHomeClose').addEventListener('click', ()=> $('sitesHomeOverlay').classList.remove('open'));
$('sitesHomeOverlay').addEventListener('click', e=>{ if(e.target === $('sitesHomeOverlay')) $('sitesHomeOverlay').classList.remove('open'); });
$('homeNewSite').addEventListener('click', startNewSite);

// ---------- Site detail modal ----------
let sdCurrentId = null;
let sdEditing = false;
// A parcel's effective value: your override wins, else the assessor attribute.
function pv(p, field){
  const o = p.overrides || {};
  return (o[field] != null && o[field] !== '') ? o[field] : (p.attrs ? p.attrs[field] : undefined);
}
function setSdEditing(on){
  sdEditing = on;
  const s = Store.get(sdCurrentId); if(s) renderSiteDetailBody(s);
  syncSdChrome();
}
// header name/status + footer buttons reflect edit vs read-only
function syncSdChrome(){
  const nm=$('sdName'), st=$('sdStatus');
  if(nm){ nm.readOnly = !sdEditing; nm.classList.toggle('ro', !sdEditing); }
  if(st){ st.disabled = !sdEditing; }
  const foot=$('siteDetailFoot'); if(foot) foot.classList.toggle('editing', sdEditing);
  const hd=$('siteDetailHead'); if(hd) hd.classList.toggle('sd-editing', sdEditing);
  const menu=$('sdOptionsMenu'); if(menu) menu.classList.remove('open');
}
function openSiteDetail(id){
  const s = Store.get(id); if(!s) return;
  // Heal the pre-fill-freeze bug: an override that matches the first parcel while more parcels
  // exist is almost certainly a stale single-parcel total, not a deliberate override. Re-sum.
  if(s.acresOverride != null && (s.parcels||[]).length > 1
     && Math.abs((+s.acresOverride||0) - ((s.parcels[0]||{}).acres||0)) < 0.01){
    s.acresOverride = null; Store.upsert(s);
  }
  sdCurrentId = id;
  sdEditing = false;
  $('sdName').value = siteName(s);
  $('sdStatus').innerHTML = STATUSES.map(st=>'<option value="'+st.id+'" '+(st.id===s.status?'selected':'')+'>'+st.label+'</option>').join('');
  renderSiteDetailBody(s);
  syncSdChrome();
  $('siteDetailOverlay').classList.add('open');
}
// ---- Institutional deal sheet ----
function dealStageBar(s){
  const pipeline = STATUSES.filter(x=>x.pipeline);
  const disp = STATUSES.filter(x=>!x.pipeline);
  const isDisp = disp.some(d=>d.id===s.status);
  const idx = isDisp ? -1 : pipeline.findIndex(x=>x.id===s.status);
  const line = '<div class="ds-stage'+(isDisp?' muted':'')+'">' + pipeline.map((st,i)=>{
    const state = idx<0?'todo':(i<idx?'done':i===idx?'now':'todo');
    return '<button class="ds-stagestep '+state+'" data-stage="'+st.id+'" style="--sc:'+st.hex+'">'
      + '<span class="ds-dot"></span><span class="ds-slabel">'+st.label+'</span></button>'
      + (i<pipeline.length-1?'<span class="ds-line '+(idx>=0&&i<idx?'done':'')+'"></span>':'');
  }).join('') + '</div>';
  const chips = '<div class="ds-disp">' + disp.map(d=>
    '<button class="ds-chip'+(s.status===d.id?' active':'')+'" data-stage="'+d.id+'" style="--sc:'+d.hex+'">'
    + '<span class="ds-chipdot"></span>'+d.label+'</button>').join('') + '</div>';
  return line + chips;
}
function sdSummaryStrip(s){
  const z = (s.parcels.map(p=>pv(p,'CITY_ZONING')).filter(Boolean)[0]) || '…';
  let lastSale=null;
  s.parcels.forEach(p=>{ const d=pv(p,'SALE_DATE'), pr=pv(p,'SALE_PRICE'); if(d){ const t=+new Date(d); if(!lastSale||t>lastSale.t) lastSale={t,price:pr,date:d}; } });
  const saleTxt = lastSale ? ((lastSale.price>0?'$'+Number(lastSale.price).toLocaleString('en-US'):'—')) : '—';
  const ed = sdEditing;
  const acVal = ed
    ? '<div class="ac-edit"><input class="ac-input num" id="heroAcres" type="number" step="0.01" min="0" value="'+(siteAcres(s)?siteAcres(s).toFixed(2):'')+'" placeholder="'+(computedAcres(s)?computedAcres(s).toFixed(2):'—')+'"><span class="ac-unit">ac</span></div>'
    : '<div class="dss-v">'+(siteAcres(s)?siteAcres(s).toFixed(2):'—')+'<span class="dss-u"> ac</span></div>';
  const priceVal = ed
    ? '<input class="dss-input" id="heroPricing" value="'+esc(s.pricing||'')+'" placeholder="e.g. ~$250k/unit">'
    : '<div class="dss-v sm'+(s.pricing?'':' faint')+'">'+(s.pricing?esc(s.pricing):'—')+'</div>';
  return '<div class="dss">'
    + '<div class="dss-cell"><div class="dss-k">Acreage</div>'+acVal+'</div>'
    + '<div class="dss-cell"><div class="dss-k">Zoning</div><div class="dss-v sm" id="heroZone">'+esc(z)+'</div></div>'
    + '<div class="dss-cell"><div class="dss-k">Last sale</div><div class="dss-v sm">'+esc(saleTxt)+'</div></div>'
    + '<div class="dss-cell"><div class="dss-k">Pricing guidance</div>'+priceVal+'</div>'
    + '</div>';
}
function ownershipContact(s){
  const recorded = [...new Set(s.parcels.map(p=>(p.attrs&&p.attrs.OWNER_NAME)).filter(Boolean))];
  const recordedTxt = recorded.length ? recorded.join(' · ') : '—';
  const trueOwners = [...new Set(s.parcels.map(p=> p.trueOwner || (p.overrides&&p.overrides.OWNER_NAME)).filter(Boolean))];
  const trueTxt = trueOwners.length ? trueOwners.join(' · ') : '';
  const c = s.contact || {};
  const ed = sdEditing;
  const field = (id, val, ph)=> ed
    ? '<input class="ct-input" id="'+id+'" value="'+esc(val||'')+'" placeholder="'+ph+'">'
    : '<div class="ct-val">'+(val?esc(val):'<span class="ct-empty">—</span>')+'</div>';
  const typeSel = ed
    ? '<select class="ct-input" id="ctType"><option value="">Not determined</option>'
      + ['Operator','Individual','Institutional','Family trust','Undetermined'].map(o=>'<option '+((c.ownerType===o)?'selected':'')+'>'+o+'</option>').join('')+'</select>'
    : '<div class="ct-val">'+(c.ownerType?esc(c.ownerType):'<span class="ct-empty">Not determined</span>')+'</div>';
  // True owner is the headline (the real answer); recorded owner is the assessor's entity.
  const ownerBlock = trueTxt
    ? '<div class="oc-ownerrow"><span class="oc-ownername">'+esc(trueTxt)+'</span><span class="oc-badge oc-badge-true">True owner</span></div>'
      + '<div class="oc-recorded">Recorded: '+esc(recordedTxt)+'</div>'
    : '<div class="oc-ownerrow"><span class="oc-ownername">'+esc(recordedTxt)+'</span><span class="oc-badge">Recorded owner</span></div>'
      + '<div class="oc-recorded oc-faint">True owner not yet verified — edit a parcel below to set it.</div>';
  return '<div class="ds-sec">'
    + '<div class="ds-seclabel">Ownership &amp; contact</div>'
    + '<div class="oc-owner">'+ownerBlock
    + '<div class="oc-typeline"><span class="ct-k">Owner type</span>'+typeSel+'</div></div>'
    + '<div class="oc-contact">'
    + '<div class="oc-cgrid">'
    + '<div class="ct-cell"><div class="ct-k">Contact name</div>'+field('ctName', c.name, 'Who to call')+'</div>'
    + '<div class="ct-cell"><div class="ct-k">Role / title</div>'+field('ctRole', c.role, 'e.g. Managing partner')+'</div>'
    + '<div class="ct-cell"><div class="ct-k">Phone</div>'+field('ctPhone', c.phone, 'Phone')+'</div>'
    + '<div class="ct-cell"><div class="ct-k">Email</div>'+field('ctEmail', c.email, 'Email')+'</div>'
    + '</div></div></div>';
}
function planningSection(s){
  const ed = sdEditing;
  const flu = ed ? '<input class="flu-input" id="heroFlu" value="'+esc(s.flu||'')+'" placeholder="e.g. High-density res">' : '<div class="pl-v">'+(s.flu?esc(s.flu):'—')+'</div>';
  const ent = ed ? '<input class="flu-input" id="heroEnt" value="'+esc(s.entitlement||'')+'" placeholder="e.g. Rezone filed">' : '<div class="pl-v">'+(s.entitlement?esc(s.entitlement):'—')+'</div>';
  return '<div class="ds-sec"><div class="ds-seclabel">Planning &amp; entitlement</div>'
    + '<div class="pl-grid">'
    + '<div class="pl-cell"><div class="pl-k">Future land use</div>'+flu+'</div>'
    + '<div class="pl-cell"><div class="pl-k">Entitlement status</div>'+ent+'</div>'
    + '</div></div>';
}
function siteParcelCard(p, i){
  const ed = sdEditing;
  const fld = (label, field, opts={})=>{
    const raw = pv(p, field);
    const disp = opts.fmt ? opts.fmt(raw) : (raw==null||raw===''?'\u2014':raw);
    if(!ed) return '<div><div class="k">'+label+'</div><div class="v">'+esc(String(disp))+'</div></div>';
    const val = raw==null?'':raw;
    return '<div><div class="k">'+label+'</div><input class="pf-input" data-pi="'+i+'" data-pf="'+field+'" type="'+(opts.type||'text')+'" value="'+esc(String(val))+'" placeholder="'+(opts.ph||'\u2014')+'"></div>';
  };
  const acresCell = ed
    ? '<div><div class="k">Acres</div><input class="pf-input" data-pi="'+i+'" data-pf="_acres" type="number" step="0.01" value="'+(p.acres||'')+'" placeholder="0.00"></div>'
    : '<div><div class="k">Acres</div><div class="v">'+(p.acres||0).toFixed(2)+'</div></div>';
  return '<div class="sd-parcel">'
    + '<div class="sd-parcel-top">'
    + '<div><div class="sd-parcel-apn">'+esc(p.apnDash || p.apn)+'</div>'
    + '<div class="sd-parcel-addr">'+esc((pv(p,'PHYSICAL_ADDRESS') || 'No situs address'))+(pv(p,'PHYSICAL_CITY') ? ', '+esc(pv(p,'PHYSICAL_CITY')) : '')+'</div></div>'
    + (ed ? '<div class="sd-parcel-btns"><button class="mini-btn" data-editbound="'+i+'">✏ Boundary</button><button class="mini-btn" data-rm="'+esc(p.apn)+'">Remove</button></div>' : '')
    + '</div>'
    + '<div class="sd-kv">'
    + (ed ? fld('Zoning','CITY_ZONING') : '<div><div class="k">Zoning</div><div class="v" id="sdzone'+i+'">'+(pv(p,'CITY_ZONING')||'\u2026')+'</div></div>')
    + acresCell
    + '<div><div class="k">Recorded owner</div><div class="v">'+esc((p.attrs&&p.attrs.OWNER_NAME) || '\u2014')+'</div></div>'
    + (function(){
        const tv = p.trueOwner || (p.overrides && p.overrides.OWNER_NAME) || '';
        if(ed) return '<div><div class="k">True owner</div><input class="pf-input to-input" data-pi="'+i+'" data-pf="_trueOwner" value="'+esc(tv)+'" placeholder="Verified / CoStar owner"></div>';
        return '<div><div class="k">True owner</div><div class="v'+(tv?'':' to-empty')+'">'+(tv?esc(tv):'Not verified')+'</div></div>';
      })()
    + fld('Year built','CONST_YEAR',{type:'number'})
    + fld('Purchase price','SALE_PRICE',{type:'number',fmt:v=>+v>0?'$'+Number(v).toLocaleString('en-US'):'\u2014',ph:'$'})
    + fld('Sale date','SALE_DATE',{fmt:v=>v?fmtDateMs(v):'\u2014',ph:'YYYY-MM-DD'})
    + fld('Full cash value','FCV_CUR',{type:'number',fmt:v=>+v>0?'$'+Number(v).toLocaleString('en-US'):'\u2014',ph:'$'})
    + '</div></div>';
}
function renderSiteDetailBody(s){
  const body = $('siteDetailBody');
  // header subtitle: location + acreage + parcels
  const city = s.parcels.map(p=>pv(p,'PHYSICAL_CITY')).filter(Boolean)[0];
  const mkLabel = MARKETS[siteMarket(s)] ? MARKETS[siteMarket(s)].name.replace(/&amp;/g,'&') : '';
  const sub = [city || mkLabel, siteAcres(s)?siteAcres(s).toFixed(2)+' ac':null, s.parcels.length+' parcel'+(s.parcels.length!==1?'s':'')].filter(Boolean).join('  ·  ');
  { const h=$('sdHeadSub'); if(h) h.textContent = sub; }

  const activity = (s.notes||[]).slice().reverse().map(n=>
    '<div class="act-item"><div class="act-date">'+new Date(n.t).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})+'</div><div class="act-text">'+esc(n.text)+'</div></div>'
  ).join('') || '<div class="ds-empty">No activity yet. Log a call, a broker conversation, or a status note.</div>';

  body.innerHTML =
    dealStageBar(s)
    + sdSummaryStrip(s)
    + ownershipContact(s)
    + planningSection(s)
    + '<div class="ds-sec"><div class="ds-seclabel">Activity</div>'
      + '<div class="act-compose"><textarea id="sdNote" placeholder="Log a call, broker intel, pricing, or a status update\u2026"></textarea>'
      + '<button class="btn" id="sdAddNote">Log entry</button></div>'
      + '<div class="act-list">'+activity+'</div></div>'
    + '<div class="ds-sec"><div class="ds-seclabel">Parcels <span class="ds-count">'+s.parcels.length+'</span></div>'
      + (s.parcels.length ? s.parcels.map((p,i)=>siteParcelCard(p,i)).join('') : '<div class="ds-empty">No parcels yet \u2014 use \u201cAdd parcels\u201d to click them on the map.</div>')
      + '</div>'
    + '<div class="ds-sec"><div class="ds-seclabel">Documents</div>'
      + '<div class="sd-docs">' + renderDocsList(s)
      + '<label class="doc-add" id="docAddLabel">＋ Attach a file<input type="file" id="docInput" accept=".xlsx,.xls,.csv,.pdf,.doc,.docx,.png,.jpg,.jpeg" hidden></label></div></div>';

  wireDocs(s);
  // stage bar → status
  body.querySelectorAll('[data-stage]').forEach(b=>b.addEventListener('click', ()=>{
    const site=Store.get(sdCurrentId); if(!site) return;
    site.status=b.dataset.stage; const sel=$('sdStatus'); if(sel) sel.value=b.dataset.stage;
    Store.upsert(site); renderTracked(); renderSiteDetailBody(site);
  }));
  // site-level field autosave (edit mode inputs)
  { const el=$('heroFlu'); if(el) el.addEventListener('change', e=>{ const st=Store.get(sdCurrentId); if(st){ st.flu=e.target.value.trim(); Store.upsert(st); } }); }
  { const el=$('heroEnt'); if(el) el.addEventListener('change', e=>{ const st=Store.get(sdCurrentId); if(st){ st.entitlement=e.target.value.trim(); Store.upsert(st); } }); }
  { const el=$('heroPricing'); if(el) el.addEventListener('change', e=>{ const st=Store.get(sdCurrentId); if(st){ st.pricing=e.target.value.trim(); Store.upsert(st); } }); }
  { const ha=$('heroAcres'); if(ha) ha.addEventListener('change', e=>{ const st=Store.get(sdCurrentId); if(st){ const v=e.target.value.trim(); const comp=computedAcres(st); st.acresOverride=(v===''||Math.abs((+v||0)-comp)<0.01)?null:(+v||0); Store.upsert(st); } }); }
  body.querySelectorAll('[data-rm]').forEach(b=>b.addEventListener('click', ()=>{
    const site = Store.get(sdCurrentId); if(!site) return;
    site.parcels = site.parcels.filter(x=>x.apn!==b.dataset.rm);
    if(!site.parcels.length){ Store.remove(site.id); renderTracked(); $('siteDetailOverlay').classList.remove('open'); }
    else { Store.upsert(site); renderTracked(); renderSiteDetailBody(site); }
  }));
  body.querySelectorAll('[data-editbound]').forEach(b=>b.addEventListener('click', ()=> startBoundaryEdit(sdCurrentId, +b.dataset.editbound)));
  $('sdAddNote').addEventListener('click', ()=>{
    const t = $('sdNote').value.trim(); if(!t) return;
    const site = Store.get(sdCurrentId); site.notes = site.notes||[]; site.notes.push({t:Date.now(), text:t});
    Store.upsert(site); renderSiteDetailBody(site);
  });
  // per-parcel + aggregate zoning
  const zoneCodes = new Set();
  const paintHero = ()=>{ const hz=document.getElementById('heroZone'); if(hz) hz.textContent = zoneCodes.size ? [...zoneCodes].join(', ') : '—'; };
  s.parcels.forEach((p,i)=>{
    const own = pv(p,'CITY_ZONING');
    if(own){ zoneCodes.add(String(own)); const el=document.getElementById('sdzone'+i); if(el && !sdEditing) el.innerHTML='<span class="sd-zone-pill">'+esc(own)+'</span>'; paintHero(); return; }
    if(!p.geometry) return;
    let c; try{ c=L.geoJSON(p.geometry).getBounds().getCenter(); }catch(e){ return; }
    lookupZoning(c).then(function(r){
      const el=document.getElementById('sdzone'+i);
      if(el) el.innerHTML = r.hit ? '<span class="sd-zone-pill">'+esc(r.hit.code)+'</span>' : '<span style="color:var(--text-faint)">\u2014</span>';
      if(r.hit && r.hit.code){ zoneCodes.add(r.hit.code); paintHero(); }
    }).catch(function(){ const el=document.getElementById('sdzone'+i); if(el) el.textContent='\u2014'; });
  });
  paintHero();
  setTimeout(()=>{ const hz=document.getElementById('heroZone'); if(hz && hz.textContent==='…') hz.textContent = zoneCodes.size?[...zoneCodes].join(', '):'—'; }, 4000);
}
$('sdName').addEventListener('change', ()=>{ const s=Store.get(sdCurrentId); if(!s) return; s.name = $('sdName').value.trim() || siteName(s); Store.upsert(s); renderTracked(); });
$('sdStatus').addEventListener('change', ()=>{ const s=Store.get(sdCurrentId); if(!s) return; s.status = $('sdStatus').value; Store.upsert(s); renderTracked(); });
$('siteDetailClose').addEventListener('click', ()=> $('siteDetailOverlay').classList.remove('open'));
$('sdBack').addEventListener('click', ()=>{ $('siteDetailOverlay').classList.remove('open'); renderSitesHome(); $('sitesHomeOverlay').classList.add('open'); });
$('siteDetailOverlay').addEventListener('click', e=>{ if(e.target === $('siteDetailOverlay')) $('siteDetailOverlay').classList.remove('open'); });
$('sdAddParcels').addEventListener('click', ()=>{ if(sdCurrentId) startAssembly(sdCurrentId); });
$('sdZoom').addEventListener('click', ()=>{
  const s = Store.get(sdCurrentId); if(!s) return;
  const b = siteBounds(s);
  $('siteDetailOverlay').classList.remove('open');
  $('sitesHomeOverlay').classList.remove('open');   // also close the Pipeline modal so the map is visible
  console.log('[zoom] bounds valid:', !!b, b ? b.toBBoxString() : '(none)');
  // wait for the overlays to finish closing, refresh the map's size, then move it
  setTimeout(()=>{
    try{ map.invalidateSize(); }catch(e){}
    if(b){ map.fitBounds(b.pad(0.5), {animate:true}); console.log('[zoom] fitBounds fired'); }
    else {
      const p = (s.parcels||[]).find(x=>x._lat!=null);
      if(p){ map.setView([p._lat, p._lng], 17); console.log('[zoom] setView to click point'); }
      (s.parcels||[]).forEach(x=>{ if(!x.geometry) ensureParcelGeometry(s, x); });
    }
  }, 260);
});
$('sdDelete').addEventListener('click', ()=>{ const s=Store.get(sdCurrentId); if(s && confirm('Delete site \u201c'+siteName(s)+'\u201d?')){ Store.remove(s.id); renderTracked(); $('siteDetailOverlay').classList.remove('open'); } });
$('sdEdit').addEventListener('click', ()=> setSdEditing(true));
{ const ob=$('sdOptions'), menu=$('sdOptionsMenu');
  if(ob) ob.addEventListener('click', e=>{ e.stopPropagation(); if(menu) menu.classList.toggle('open'); });
  document.addEventListener('click', e=>{ if(menu && menu.classList.contains('open') && !e.target.closest('.sd-head-actions')) menu.classList.remove('open'); });
  const ed=$('sdEdit'), de=$('sdDelete');
  if(ed) ed.addEventListener('click', ()=>{ if(menu) menu.classList.remove('open'); });
  if(de) de.addEventListener('click', ()=>{ if(menu) menu.classList.remove('open'); });
}
$('sdCancel').addEventListener('click', ()=>{ const s=Store.get(sdCurrentId); if(s){ $('sdName').value=siteName(s); $('sdStatus').value=s.status; } setSdEditing(false); });
$('sdSave').addEventListener('click', function(){
  const s = Store.get(sdCurrentId); if(!s) return;
  const nm = $('sdName'); if(nm && nm.value.trim()) s.name = nm.value.trim();
  const st = $('sdStatus'); if(st) s.status = st.value;
  const ha = $('heroAcres'); if(ha){ const v = ha.value.trim(); const comp = computedAcres(s); s.acresOverride = (v==='' || Math.abs((+v||0)-comp) < 0.01) ? null : (+v||0); }
  const fl = $('heroFlu'); if(fl) s.flu = fl.value.trim();
  const en = $('heroEnt'); if(en) s.entitlement = en.value.trim();
  const pg = $('heroPricing'); if(pg) s.pricing = pg.value.trim();
  // ownership & contact
  s.contact = s.contact || {};
  const cn=$('ctName'), cr=$('ctRole'), cp=$('ctPhone'), ce=$('ctEmail'), ct=$('ctType');
  if(cn) s.contact.name = cn.value.trim();
  if(cr) s.contact.role = cr.value.trim();
  if(cp) s.contact.phone = cp.value.trim();
  if(ce) s.contact.email = ce.value.trim();
  if(ct) s.contact.ownerType = ct.value;
  // per-parcel field overrides
  document.querySelectorAll('.pf-input').forEach(inp=>{
    const i = +inp.dataset.pi, field = inp.dataset.pf, val = inp.value.trim();
    const p = s.parcels[i]; if(!p) return;
    if(field === '_acres'){ p.acres = val===''?0:(+val||0); return; }
    if(field === '_trueOwner'){ p.trueOwner = val; if(p.overrides) delete p.overrides.OWNER_NAME; return; }
    p.overrides = p.overrides || {};
    const assessor = p.attrs ? p.attrs[field] : undefined;
    // store an override only when it differs from (or fills a gap in) the assessor value
    if(val === ''){ delete p.overrides[field]; }
    else if(String(assessor??'') !== val){ p.overrides[field] = (inp.type==='number') ? (+val||val) : val; }
  });
  Store.upsert(s); renderTracked();
  setSdEditing(false);
  this.textContent = 'Saved ✓'; this.disabled = true;
  setTimeout(()=>{ this.textContent = 'Save'; this.disabled = false; }, 900);
});

// ---------- Add-to-site chooser (from the property panel) ----------
function openAddChooser(rec){
  // acreage may have backfilled after the panel rendered — capture the current value now
  const freshAcres = (currentFeature && parcelAcres(currentFeature)) || rec.acres || 0;
  if(freshAcres > 0) rec.acres = freshAcres;
  const others = marketSites().sort((a,b)=>b.updated-a.updated);
  $('addChooserBody').innerHTML =
    '<button class="btn full" id="acNew">\uFF0B New site from this parcel</button>'
    + (others.length ? '<div class="sd-section-label">Or add to an existing site</div>'
      + others.map(s=>'<div class="site-card" data-add="'+s.id+'"><div class="sc-apn">'+esc(siteName(s))+'</div>'
        + '<div class="sc-meta">'+s.parcels.length+' parcel'+(s.parcels.length>1?'s':'')+' \u00b7 '+siteAcres(s).toFixed(2)+' ac</div></div>').join('') : '');
  $('acNew').addEventListener('click', ()=>{
    const id = Store.newId();
    Store.upsert({id, name:rec.apnDash||'Untitled site', status:'prospect', market:currentMarket, notes:[], created:Date.now(), updated:Date.now(), parcels:[rec]});
    renderTracked(); $('addChooserOverlay').classList.remove('open'); openSiteDetail(id);
  });
  $('addChooserBody').querySelectorAll('[data-add]').forEach(b=>b.addEventListener('click', ()=>{
    const s = Store.get(b.dataset.add); if(!s) return;
    if(!s.parcels.some(x=>x.apn===rec.apn)) s.parcels.push(rec);
    Store.upsert(s); renderTracked(); $('addChooserOverlay').classList.remove('open'); openSiteDetail(s.id);
  }));
  $('addChooserOverlay').classList.add('open');
}
$('acClose').addEventListener('click', ()=> $('addChooserOverlay').classList.remove('open'));
$('addChooserOverlay').addEventListener('click', e=>{ if(e.target === $('addChooserOverlay')) $('addChooserOverlay').classList.remove('open'); });
document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ $('siteDetailOverlay').classList.remove('open'); $('addChooserOverlay').classList.remove('open'); } });

// ---------- Collapsible sidebar sections ----------
const SEC_KEY = 'wb_sitescout_sections';
let secState = {};
try{ secState = JSON.parse(localStorage.getItem(SEC_KEY) || '{}'); }catch(e){}
document.querySelectorAll('#sideScroll .section').forEach(sec=>{
  const id = sec.dataset.sec;
  if(secState[id] === true) sec.classList.add('collapsed');
  sec.querySelector('.sec-toggle').addEventListener('click', ()=>{
    sec.classList.toggle('collapsed');
    secState[id] = sec.classList.contains('collapsed');
    localStorage.setItem(SEC_KEY, JSON.stringify(secState));
  });
});

// ---------- Settings modal ----------
// ---- Regrid token settings ----
(function(){
  const inp = $('regridTokenInput'), msg = $('regridTokenMsg'), btn = $('regridTokenSave');
  if(inp){
    if(regridToken()){ inp.value = regridToken(); msg.textContent = 'Token saved on this device.'; }
    btn.addEventListener('click', ()=>{
      const v = inp.value.trim();
      try{ if(v) localStorage.setItem(REGRID_TOKEN_KEY, v); else localStorage.removeItem(REGRID_TOKEN_KEY); }catch(e){}
      msg.textContent = v ? 'Saved. Denver now uses Regrid.' : 'Cleared. Denver uses the statewide fallback.';
      lastParcelKey = ''; loadedAPNs.clear(); clearVectorParcels(); loadParcels();
    });
  }
})();
$('settingsBtn').addEventListener('click', ()=>{ if(typeof updateSyncStatus==='function') updateSyncStatus(); $('settingsOverlay').classList.add('open'); });
{ const b=$('exportBackup'); if(b) b.addEventListener('click', ()=>{
    try{
      const snap = { exported: new Date().toISOString(), version: 'site-scout', sites: Store.all() };
      const blob = new Blob([JSON.stringify(snap, null, 2)], {type:'application/json'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'site-scout-backup-' + new Date().toISOString().slice(0,10) + '.json';
      a.click(); URL.revokeObjectURL(a.href);
      const m=$('backupMsg'); if(m){ m.textContent = Store.all().length + ' sites saved.'; setTimeout(()=>{ m.textContent=''; }, 4000); }
    }catch(e){ const m=$('backupMsg'); if(m) m.textContent='Backup failed.'; }
  }); }
{ const t=$('tglCompetitors'); if(t) t.addEventListener('change', e=>{ competitorsOn = e.target.checked; renderCompetitors(); }); }
{ const t=$('tglPipeline'); if(t) t.addEventListener('change', e=>{ pipelineOn = e.target.checked; renderTracked(); }); }
// POI detail modal
{ const b=$('pdClose'); if(b) b.addEventListener('click', closePoiDetail); }
{ const b=$('pdSave'); if(b) b.addEventListener('click', savePoiDesc); }
{ const b=$('pdEdit'); if(b) b.addEventListener('click', ()=>{ const id=_pdId; closePoiDetail(); if(id) openPoiEditor(id); }); }
{ const o=$('poiDetailOverlay'); if(o) o.addEventListener('click', e=>{ if(e.target===o) closePoiDetail(); }); }
// Snapshot composer
{ const b=$('snapTrigger'); if(b) b.addEventListener('click', openSnap); }
{ const b=$('compsTrigger'); if(b) b.addEventListener('click', ()=>{ $('toolsCluster').classList.remove('open'); if(!_compsData){ loadComps().then(()=>openCompPicker()); } else openCompPicker(); }); }
{ const b=$('snapClose'); if(b) b.addEventListener('click', closeSnap); }
{ const b=$('snapCompose'); if(b) b.addEventListener('click', snapCompose); }
{ const b=$('snapArrange'); if(b) b.addEventListener('click', ()=>toggleSnapEdit()); }
{ const b=$('snapPng'); if(b) b.addEventListener('click', snapPng); }
{ const b=$('snapPdf'); if(b) b.addEventListener('click', snapPdf); }
{ const b=$('snapDone'); if(b) b.addEventListener('click', ()=>{ snapDone(); }); }
document.querySelectorAll('#snapAspect button').forEach(b=>b.addEventListener('click', ()=>{
  document.querySelectorAll('#snapAspect button').forEach(x=>x.classList.remove('active')); b.classList.add('active');
  _snapAR = parseFloat(b.dataset.ar)||1.6;
  if(_snapComposed){ sizeSnapBox(); snapExpandMarkers(); updateSnapScale(); }
}));
{ const b=$('snapCompetitors'); if(b) b.addEventListener('change', ()=>{ if(_snapComposed){ competitorsOn=b.checked; snapExpandMarkers(); buildSnapLegend(); } }); }
{ const b=$('snapComps'); if(b) b.addEventListener('change', ()=>{ if(_snapComposed){ compsOn=competitorsOn=b.checked; refreshComps().then(()=>{ snapExpandMarkers(); buildSnapLegend(); }); } }); }
{ const b=$('snapPoi'); if(b) b.addEventListener('change', ()=>{ if(_snapComposed){ poiOn=b.checked; snapExpandMarkers(); } }); }
{ const b=$('cpAdd'); if(b) b.addEventListener('click', startAddComp); }
document.querySelectorAll('#cpScope button').forEach(btn=>btn.addEventListener('click',()=>{ document.querySelectorAll('#cpScope button').forEach(x=>x.classList.remove('active')); btn.classList.add('active'); _cpScope=btn.dataset.scope; buildCompPickList(); }));
document.querySelectorAll('#cpStatus button').forEach(btn=>btn.addEventListener('click',()=>{ document.querySelectorAll('#cpStatus button').forEach(x=>x.classList.remove('active')); btn.classList.add('active'); _cpStatus=btn.dataset.st; buildCompPickList(); }));
{ const b=$('snapOnlyLabeled'); if(b) b.addEventListener('change', ()=>{ if(_snapComposed) snapExpandMarkers(); }); }
{ const b=$('snapPickEdit'); if(b) b.addEventListener('click', openCompPicker); }
{ const b=$('snapDeckOrder'); if(b) b.addEventListener('click', openDeckOrder); }
{ const b=$('snapFitPicks'); if(b) b.addEventListener('click', snapFitPicks); }
{ const b=$('doClose'); if(b) b.addEventListener('click', closeDeckOrder); }
{ const b=$('doDone'); if(b) b.addEventListener('click', closeDeckOrder); }
{ const b=$('doSpatial'); if(b) b.addEventListener('click', ()=>{ _snapOrder=[]; if(_snapComposed) snapExpandMarkers(); buildDeckOrderList(); }); }
{ const o=$('deckOrderOverlay'); if(o) o.addEventListener('click', e=>{ if(e.target===o) closeDeckOrder(); }); }
{ const b=$('snapPickPoi'); if(b) b.addEventListener('click', async ()=>{ await ensurePoiData(); openPoiPicker(); }); }
{ const b=$('snapUnhide'); if(b) b.addEventListener('click', snapUnhideAll); }
document.querySelectorAll('#snapFields input[data-fld]').forEach(chk=>chk.addEventListener('change',()=>{ _snapFields[chk.dataset.fld]=chk.checked; if(_snapComposed) snapExpandMarkers(); }));
document.querySelectorAll('#snapStyle button').forEach(btn=>btn.addEventListener('click',()=>{ document.querySelectorAll('#snapStyle button').forEach(x=>x.classList.remove('active')); btn.classList.add('active'); _snapStyle=btn.dataset.style; if(_snapComposed) snapExpandMarkers(); }));
{ const b=$('cpClose'); if(b) b.addEventListener('click', closeCompPicker); }
{ const b=$('cpDone'); if(b) b.addEventListener('click', closeCompPicker); }
{ const b=$('cpSearch'); if(b) b.addEventListener('input', buildCompPickList); }
{ const b=$('cpAll'); if(b) b.addEventListener('click', ()=>{ compPickRows().forEach(r=>_snapLabeled.add(r.key)); if(_snapComposed){snapExpandMarkers();buildSnapLegend();} buildCompPickList(); }); }
{ const b=$('cpNone'); if(b) b.addEventListener('click', ()=>{ [..._snapLabeled].forEach(k=>{ if(!k.startsWith('poi:')) _snapLabeled.delete(k); }); if(_snapComposed){snapExpandMarkers();buildSnapLegend();} buildCompPickList(); }); }
{ const b=$('ppClose'); if(b) b.addEventListener('click', closePoiPicker); }
{ const b=$('ppDone'); if(b) b.addEventListener('click', closePoiPicker); }
{ const b=$('ppSearch'); if(b) b.addEventListener('input', debounce(buildPoiPickList,140)); }
{ const b=$('ppAdd'); if(b) b.addEventListener('click', startAddPoi); }
{ const b=$('ppAll'); if(b) b.addEventListener('click', ()=>{ poiPickRows().forEach(p=>_snapLabeled.add('poi:'+p.id)); if(_snapComposed){snapExpandMarkers();buildSnapLegend();} buildPoiPickList(); }); }
{ const b=$('ppNone'); if(b) b.addEventListener('click', ()=>{ [..._snapLabeled].forEach(k=>{ if(k.startsWith('poi:')) _snapLabeled.delete(k); }); if(_snapComposed){snapExpandMarkers();buildSnapLegend();} buildPoiPickList(); }); }
document.querySelectorAll('#ppScope button').forEach(btn=>btn.addEventListener('click',()=>{ document.querySelectorAll('#ppScope button').forEach(x=>x.classList.remove('active')); btn.classList.add('active'); _ppScope=btn.dataset.scope; buildPoiPickList(); }));
document.addEventListener('keydown', e=>{ if(e.key==='Escape' && _addPoiMode){ _addPoiMode=false; const b=$('poiMoveBar'); if(b) b.classList.remove('show'); map.getContainer().style.cursor=''; } });
{ const o=$('compPickOverlay'); if(o) o.addEventListener('click', e=>{ if(e.target===o) closeCompPicker(); }); }
{ const b=$('snapClearLabels'); if(b) b.addEventListener('click', ()=>{ _snapLabeled.clear(); snapExpandMarkers(); }); }
{ const b=$('snapSiteCallout'); if(b) b.addEventListener('change', ()=>{ if(_snapComposed) snapExpandMarkers(); }); }
{ const b=$('snapHeader'); if(b) b.addEventListener('change', ()=>{ if(_snapComposed) document.querySelector('.snap-titleblock').style.display = b.checked ? '' : 'none'; }); }
{ const b=$('snapLegend'); if(b) b.addEventListener('change', ()=>{ if(_snapComposed) $('snapFrLegend').style.display = b.checked ? '' : 'none'; }); }
{ const b=$('snapScale'); if(b) b.addEventListener('change', ()=>{ if(_snapComposed) $('snapFrScale').style.display = b.checked ? '' : 'none'; }); }
{ const t=$('tglComps'); if(t) t.addEventListener('change', e=>{ compsOn = competitorsOn = e.target.checked; refreshComps(); renderCompetitors(); }); }
{ const t=$('tglPoi'); if(t) t.addEventListener('change', async e=>{ poiOn = e.target.checked; if(poiOn) await ensurePoiData(); refreshPoi(); }); }
{ const cp=$('ctxPoi'); if(cp) cp.addEventListener('click', ()=>{ hideCtxMenu(); if(_ctxLatLng) addPoiAt(_ctxLatLng.lat, _ctxLatLng.lng); }); }
{ const b=$('peSave'); if(b) b.addEventListener('click', savePoiEditor); }
{ const b=$('peRelocate'); if(b) b.addEventListener('click', ()=>{ if(_poiEditDraft){ const id=_poiEditDraft.id, nm=_poiEditDraft.n||'attraction'; if(!PoiStore.get(id)){ savePoiEditor(); } closePoiEditor(); startPoiMove(id); } }); }
{ const b=$('peCancel'); if(b) b.addEventListener('click', closePoiEditor); }
{ const b=$('poiEditClose'); if(b) b.addEventListener('click', closePoiEditor); }
{ const b=$('peName'); if(b) b.addEventListener('keydown', e=>{ if(e.key==='Enter') savePoiEditor(); }); }
{ const b=$('peDelete'); if(b) b.addEventListener('click', ()=>{ if(_poiEditDraft && PoiStore.get(_poiEditDraft.id) && confirm('Delete "'+(_poiEditDraft.n||'this attraction')+'"?')){ PoiStore.remove(_poiEditDraft.id); closePoiEditor(); refreshPoi(); } }); }
const LAYER_NOTES = {
  comps: 'CoStar existing (blue) & pipeline (orange) comps for this market. Click a dot for details or to remove a bad row.',
  competitors: 'Deals not yet in CoStar. Right-click the map to add one — same idea, your own intel.',
  poi: 'Demand drivers — employers, hospitals, universities, venues. Each pin shows its size (beds, employees, seats). Click a pin to Edit, Move, or Remove it; right-click the map to add one. Zoom in if pins are grouped into number circles. Team-shared — edits sync to everyone.',
};
{ const b=$('compListBtn'); if(b) b.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); if(!_compsData){ loadComps().then(()=>openCompPicker()); } else openCompPicker(); }); }
{ const b=$('poiListBtn'); if(b) b.addEventListener('click', async (e)=>{ e.preventDefault(); e.stopPropagation(); await ensurePoiData(); openPoiPicker(); }); }
document.querySelectorAll('.ov-info').forEach(b=>b.addEventListener('click', (e)=>{
  e.preventDefault(); e.stopPropagation();
  const existing = document.querySelector('.ov-pop');
  if(existing){ const wasSame = existing.dataset.for === b.dataset.info; existing.remove(); if(wasSame) return; }
  const pop = document.createElement('div');
  pop.className = 'ov-pop'; pop.dataset.for = b.dataset.info;
  pop.textContent = LAYER_NOTES[b.dataset.info] || '';
  b.parentElement.appendChild(pop);
  const close = (ev)=>{ if(!pop.contains(ev.target) && ev.target!==b){ pop.remove(); document.removeEventListener('click', close); } };
  setTimeout(()=>document.addEventListener('click', close), 0);
}));
$('bbSave').addEventListener('click', ()=> endBoundaryEdit(true));
$('bbCancel').addEventListener('click', ()=> endBoundaryEdit(false));
document.querySelectorAll('#mapTools button[data-tool]').forEach(b=>b.addEventListener('click', ()=>{ setTool(b.dataset.tool); $('toolsCluster').classList.remove('open'); }));
$('toolsTrigger').addEventListener('click', ()=>{ $('basemapCluster').classList.remove('open'); $('toolsCluster').classList.toggle('open'); });
$('basemapTrigger').addEventListener('click', ()=>{ $('toolsCluster').classList.remove('open'); $('basemapCluster').classList.toggle('open'); });
map.on('dblclick', (e)=>{ if(_activeTool==='measure'){ L.DomEvent.stop(e); } });
function setRail(collapsed){
  document.body.classList.toggle('rail-collapsed', collapsed);
  setTimeout(()=>{ try{ map.invalidateSize(); }catch(e){} }, 300);
}
$('railCollapse').addEventListener('click', ()=> setRail(true));
$('railToggle').addEventListener('click', ()=> setRail(false));
(function(){
  const p=$('tilesPhoenix'), d=$('tilesDenver'), btn=$('tilesSave'), msg=$('tilesMsg');
  if(!btn) return;
  if(p) p.value = tilesUrlFor('phoenix');
  if(d) d.value = tilesUrlFor('denver');
  if(typeof protomapsL === 'undefined' && msg) msg.textContent = 'Tile library didn\u2019t load — check connection.';
  btn.addEventListener('click', ()=>{
    try{
      const pv=(p.value||'').trim(), dv=(d.value||'').trim();
      if(pv) localStorage.setItem('wb_tiles_phoenix', pv); else localStorage.removeItem('wb_tiles_phoenix');
      if(dv) localStorage.setItem('wb_tiles_denver', dv); else localStorage.removeItem('wb_tiles_denver');
    }catch(e){}
    msg.textContent = 'Saved. Applying tiles…';
    lastParcelKey=''; loadedAPNs.clear(); clearVectorParcels(); refreshTileLayer(); loadParcels();
    $('zoomHint').classList.toggle('show', !useTiles() && map.getZoom() < parcelFloorZoom());
  });
})();
(function(){
  const inp=$('basemapUrl'), btn=$('basemapSave'), msg=$('basemapMsg');
  if(!btn) return;
  try{ inp.value = localStorage.getItem('wb_basemap_url') || ''; }catch(e){}
  inp.placeholder = 'Basemap vector URL (default: …/basemap.pmtiles)';
  btn.addEventListener('click', ()=>{
    try{
      const v=(inp.value||'').trim();
      if(v) localStorage.setItem('wb_basemap_url', v); else localStorage.removeItem('wb_basemap_url');
    }catch(e){}
    // rebuild the vector layer against the new URL and re-apply if we're in hybrid
    if(_vectorLayer){ try{ map.removeLayer(_vectorLayer); }catch(e){} }
    _vectorLayer = null; _vectorBuiltFor = null;
    msg.textContent = 'Saved. Switch to Hybrid to see vector labels.';
    if(currentBM==='hybrid') applyBasemap('hybrid');
  });
})();
(function(){
  const btn = $('cacheClear'), msg = $('cacheMsg');
  if(btn){
    async function refresh(){ try{ msg.textContent = (await PCACHE.count()).toLocaleString('en-US') + ' parcels cached'; }catch(e){} }
    $('settingsBtn').addEventListener('click', refresh);
    btn.addEventListener('click', async ()=>{ await PCACHE.clear(); msg.textContent = 'Cache cleared.'; });
  }
})();
$('settingsClose').addEventListener('click', ()=> $('settingsOverlay').classList.remove('open'));
$('settingsOverlay').addEventListener('click', e=>{ if(e.target === $('settingsOverlay')) $('settingsOverlay').classList.remove('open'); });
document.addEventListener('keydown', e=>{ if(e.key==='Escape') $('settingsOverlay').classList.remove('open'); });

// ---------- Market switcher ----------
function setMarket(mkt){
  if(!MARKETS[mkt] || mkt === currentMarket) return;
  currentMarket = mkt;
  const m = MARKETS[mkt];
  if($('brandSub')) $('brandSub').innerHTML = m.sub;
  document.querySelectorAll('#marketSeg button, #marketSegModal button')
    .forEach(b => b.classList.toggle('active', b.dataset.mkt === mkt));
  // clear the outgoing market's data
  clearVectorParcels();
  zoneLayer.clearLayers(); localZoneLayer.clearLayers(); zoneLoadedIds.clear(); lastZoneKey='';
  for(const k in zoneFieldCache) delete zoneFieldCache[k];
  $('zoneStatus').style.display = 'none';
  $('fCity').innerHTML = '<option value="">Any city</option>';
  // swap parcel tiles to this market's cache, or drop them if it has none
  if(m.tileUrl){ parcelTiles.setUrl(m.tileUrl); if(m.ready && parcelsOn && !map.hasLayer(parcelTiles)) map.addLayer(parcelTiles); }
  else if(map.hasLayer(parcelTiles)){ map.removeLayer(parcelTiles); }
  refreshTileLayer();
  if(!m.ready){ $('searchMsg').textContent = m.name.replace(/&amp;/g,'&') + ' data isn\u2019t wired up yet.'; }
  else { $('searchMsg').textContent = ''; }
  map.setView(m.center, m.zoom);
  $('zoomHint').classList.toggle('show', parcelsOn && !useTiles() && map.getZoom() < parcelFloorZoom());
  renderTracked();          // re-scope markers, readout, and pipeline to the new market
  renderCompetitors();      // re-scope competitors to the new market
  refreshComps();           // re-scope CoStar comps to the new market
  refreshPoi();             // re-scope attractions to the new market
  if(typeof syncMobMarket==='function') syncMobMarket();
  document.body.classList.remove('drawer-open');
}
document.querySelectorAll('#marketSeg button, #marketSegModal button').forEach(b=>{
  b.addEventListener('click', ()=> setMarket(b.dataset.mkt));
});

// ---------- Boot ----------
renderTracked();
renderCompetitors();
refreshComps();          // unified "Comps" defaults on — show CoStar comps too
refreshTileLayer();
loadParcels();
updateReadout();
// auth gate + cloud sync (falls back to local-only if backend is unreachable)
initAuth();
{ const b=$('loginBtn'); if(b) b.addEventListener('click', doLogin); }
{ const t=$('loginPwToggle'); if(t) t.addEventListener('click', ()=>{ const p=$('loginPass'); if(!p) return; const show = p.type==='password'; p.type = show?'text':'password'; t.textContent = show?'Hide':'Show'; }); }
{ const p=$('loginPass'); if(p) p.addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); }); }
{ const e2=$('loginEmail'); if(e2) e2.addEventListener('keydown', e=>{ if(e.key==='Enter'){ const p=$('loginPass'); if(p) p.focus(); } }); }
{ const so=$('signOutBtn'); if(so) so.addEventListener('click', ()=>{ if(confirm('Sign out of Site Scout?')) sbSignOut(); }); }

// ---- Mobile: drawer, market pill, locate-me ----
function closeDrawer(){ document.body.classList.remove('drawer-open'); }
{ const m=$('mobMenu'); if(m) m.addEventListener('click', ()=> document.body.classList.toggle('drawer-open')); }
{ const s=$('mobScrim'); if(s) s.addEventListener('click', closeDrawer); }
{ const mm=$('mobMarket'); if(mm) mm.addEventListener('click', ()=>{ setMarket(currentMarket==='phoenix'?'denver':'phoenix'); }); }
function syncMobMarket(){ const mm=$('mobMarket'); if(mm && MARKETS[currentMarket]) mm.textContent = currentMarket==='denver' ? 'Denver' : 'Phoenix'; }
syncMobMarket();

let _locMarker=null, _locCircle=null;
function locateMe(){
  const btn=$('locateBtn');
  if(!navigator.geolocation){ if(btn) alert('Location isn\u2019t available on this device.'); return; }
  if(btn) btn.classList.add('locating');
  navigator.geolocation.getCurrentPosition(pos=>{
    const {latitude,longitude,accuracy}=pos.coords, ll=[latitude,longitude];
    if(_locMarker){ try{ map.removeLayer(_locMarker); }catch(e){} }
    if(_locCircle){ try{ map.removeLayer(_locCircle); }catch(e){} }
    _locCircle=L.circle(ll,{radius:Math.max(accuracy,8),color:'#2E9E8F',weight:1,fillColor:'#2E9E8F',fillOpacity:.12,pane:'siteMarkers',interactive:false}).addTo(map);
    _locMarker=L.circleMarker(ll,{radius:7,color:'#fff',weight:2.5,fillColor:'#2E9E8F',fillOpacity:1,pane:'siteMarkers'}).addTo(map);
    map.setView(ll, Math.max(map.getZoom(), 16));
    if(btn) btn.classList.remove('locating');
  }, err=>{
    if(btn) btn.classList.remove('locating');
    alert('Couldn\u2019t get your location: ' + (err.message||'permission denied'));
  }, {enableHighAccuracy:true, timeout:10000, maximumAge:5000});
}
{ const lb=$('locateBtn'); if(lb) lb.addEventListener('click', locateMe); }
$('zoomHint').classList.toggle('show', !useTiles() && map.getZoom() < parcelFloorZoom());
