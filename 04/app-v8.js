import * as maplibregl from 'https://unpkg.com/maplibre-gl@6.11.2/dist/maplibre-gl.mjs';
import * as SunCalc from 'https://cdn.jsdelivr.net/npm/suncalc@2.0.2/+esm';

const TYPES = {
  car:    { label:'車',       model:'car-model',    size:100 },
  tent:   { label:'テント',   model:'tent-model',   size:100 },
  tarp:   { label:'タープ',   model:'tarp-model',   size:115 },
  fire:   { label:'焚き火',   model:'fire-model',   size:90 },
  living: { label:'リビング', model:'living-model', size:105 },
  cargo:  { label:'荷物',     model:'cargo-model',  size:90 }
};

const DEFAULT_LOCATION = { lat: 37.071, lng: 140.001, name: '那須高原サンプル' };
const state = {
  mode: 'map',
  dimension: '3d',
  selectedId: null,
  location: { ...DEFAULT_LOCATION },
  site: { width: 12, height: 10 },
  wind: { from: 315, speed: 4, gust: null },
  weather: { key:'', hourly:null, available:false, timezone:'', loading:false, requestSeq:0, source:'', resolution:'' },
  items: [],
  mapMarkers: new Map(),
  baseMarker: null,
  mapPickMode: false,
  lastSearchAt: 0
};

const $ = id => document.getElementById(id);
const refs = Object.fromEntries([
  'palette','map','stageWrap','siteBoard','siteItems','siteOverlay','latInput','lngInput','mapLocationSection','siteSizeSection',
  'siteWidthInput','siteHeightInput','siteWidthLabel','siteHeightLabel','dateInput','timeSlider','timeText','sunriseText',
  'sunsetText','sunAzimuthText','sunAltitudeText','windDirInput','windDirOutput','windSpeedInput','windSpeedOutput','windAutoInput',
  'windGustOutput','weatherStatus','weatherRefreshBtn','sunNeedle','windNeedle','sunBearingText','windBearingText','emptySelection','selectionEditor','selectedName','selectedPreview',
  'rotationInput','rotationOutput','sizeInput','sizeOutput','riskList','importInput','locationLabel','terrainBadge','viewHint',
  'placeSearchInput','placeSearchBtn','placeResults','searchStatus','pickOnMapBtn','mapPickNotice','locationPanelLabel','diagnosticInfo'
].map(x => [x, $(x)]));

const today = new Date();
refs.dateInput.value = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
refs.latInput.value = state.location.lat;
refs.lngInput.value = state.location.lng;
refs.locationLabel.textContent = state.location.name;
refs.locationPanelLabel.textContent = state.location.name;

const gsiStyle = {
  version: 8,
  sources: {
    terrainSource: {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      tileSize: 256,
      minzoom: 0,
      maxzoom: 15,
      attribution: 'AWS Terrain Tiles'
    },
    gsi: {
      type: 'raster',
      tiles: ['https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 18,
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル</a>'
    }
  },
  layers: [
    { id:'gsi', type:'raster', source:'gsi', paint:{'raster-saturation':-.12,'raster-contrast':.05} },
    { id:'terrain-shade', type:'hillshade', source:'terrainSource', paint:{
      'hillshade-exaggeration':.22,
      'hillshade-shadow-color':'#566154',
      'hillshade-highlight-color':'#f5f0df',
      'hillshade-accent-color':'#7e876f'
    }}
  ]
};

const map = new maplibregl.Map({
  container: 'map',
  style: gsiStyle,
  center: [state.location.lng, state.location.lat],
  zoom: 17,
  pitch: 58,
  bearing: -18,
  maxPitch: 75,
  attributionControl: true
});
map.addControl(new maplibregl.NavigationControl({showCompass:true,visualizePitch:true}), 'bottom-right');

const BUILD_VERSION='8.0.0';
window.CAMP_LAYOUT_VERSION=BUILD_VERSION;
if(refs.diagnosticInfo) refs.diagnosticInfo.textContent=`Build V${BUILD_VERSION}\nAPI: 未取得`;
console.info(`[CampLayout V${BUILD_VERSION}] loaded`, location.href);
if(location.protocol==='https:' && !/app-v8\.js/.test(import.meta.url)){ console.warn('V8 warning: unexpected module URL', import.meta.url); }
console.info('[CampLayout V8] module', import.meta.url);

map.on('load', () => {
  map.addSource('sun-ray', { type:'geojson', data: emptyFC() });
  map.addSource('shadow-ray', { type:'geojson', data: emptyFC() });
  map.addSource('wind-ray', { type:'geojson', data: emptyFC() });
  map.addSource('smoke-zones', { type:'geojson', data: emptyFC() });
  map.addLayer({id:'shadow-ray',type:'line',source:'shadow-ray',paint:{'line-color':'#554f58','line-width':4,'line-opacity':.68,'line-dasharray':[2,2]}});
  map.addLayer({id:'sun-ray',type:'line',source:'sun-ray',paint:{'line-color':'#f0a43c','line-width':5,'line-opacity':.92}});
  map.addLayer({id:'smoke-zones',type:'fill',source:'smoke-zones',paint:{'fill-color':'#4f8f9e','fill-opacity':.19,'fill-outline-color':'#4f8f9e'}});
  map.addLayer({id:'wind-ray',type:'line',source:'wind-ray',paint:{'line-color':'#4f8f9e','line-width':4,'line-opacity':.88,'line-dasharray':[1,1.5]}});

  restoreLocal();
  if (!state.items.length) seedDemo();
  applyDimension(false);
  renderItems();
  updateBaseMarker();
  syncAll();
  scheduleWeatherFetch(50);
});

map.on('rotate', () => updateAllMapVisuals());
map.on('click', e => {
  if (state.mapPickMode) {
    setLocation(e.lngLat.lat, e.lngLat.lng, `地図で選択 ${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`, true);
    setMapPickMode(false);
    return;
  }
  clearSelection();
});

map.on('error', e => {
  const msg = String(e?.error?.message || '');
  if (msg.toLowerCase().includes('terrain') || msg.toLowerCase().includes('amazonaws') || msg.toLowerCase().includes('elevation-tiles-prod')) {
    refs.terrainBadge.textContent = '3D PERSPECTIVE';
    if(refs.diagnosticInfo) refs.diagnosticInfo.textContent += `\nTerrain: ${msg.slice(0,180)}`;
  }
});

function emptyFC(){ return {type:'FeatureCollection',features:[]}; }
function uid(){ return `i_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`; }
function clamp(n,a,b){ return Math.max(a,Math.min(b,n)); }
function rad(d){ return d*Math.PI/180; }
function deg(r){ return r*180/Math.PI; }
function normBearing(d){ return (d%360+360)%360; }
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function destination(lat,lng,bearing,distanceM){
  const R=6371000, br=rad(bearing), p1=rad(lat), l1=rad(lng), dr=distanceM/R;
  const p2=Math.asin(Math.sin(p1)*Math.cos(dr)+Math.cos(p1)*Math.sin(dr)*Math.cos(br));
  const l2=l1+Math.atan2(Math.sin(br)*Math.sin(dr)*Math.cos(p1),Math.cos(dr)-Math.sin(p1)*Math.sin(p2));
  return [deg(l2),deg(p2)];
}

function haversine(a,b){
  const R=6371000, p1=rad(a.lat), p2=rad(b.lat), dp=rad(b.lat-a.lat), dl=rad(b.lng-a.lng);
  const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}

function bearingBetween(a,b){
  const p1=rad(a.lat),p2=rad(b.lat),dl=rad(b.lng-a.lng);
  return normBearing(deg(Math.atan2(Math.sin(dl)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl))));
}

function compassName(value){
  const names=['北','北北東','北東','東北東','東','東南東','南東','南南東','南','南南西','南西','西南西','西','西北西','北西','北北西'];
  return names[Math.round(normBearing(value)/22.5)%16];
}

function selected(){ return state.items.find(i => i.id === state.selectedId) || null; }

function modelMarkup(type){
  const cls = TYPES[type].model;
  const inner = {
    tent:'<i class="tent-side"></i><i class="tent-face"></i><i class="tent-door"></i>',
    car:'<i class="car-roof"></i><i class="car-window"></i><i class="car-body"></i><i class="wheel a"></i><i class="wheel b"></i>',
    tarp:'<i class="tarp-sheet"></i><i class="pole a"></i><i class="pole b"></i><i class="rope a"></i><i class="rope b"></i>',
    fire:'<i class="log a"></i><i class="log b"></i><i class="flame"></i>',
    living:'<i class="chair a"></i><i class="chair b"></i><i class="table-top"></i><i class="table-leg a"></i><i class="table-leg b"></i>',
    cargo:'<i class="box a"></i><i class="box b"></i>'
  }[type];
  return `<div class="model ${cls}">${inner}</div>`;
}

Object.entries(TYPES).forEach(([key,t]) => {
  const b = document.createElement('button');
  b.innerHTML = `<span class="tool-thumb">${modelMarkup(key)}</span><span>${t.label}</span>`;
  b.addEventListener('click', () => addItem(key));
  refs.palette.appendChild(b);
});

function addItem(type){
  const c = map.getCenter();
  const offset = state.items.length * 0.00001;
  const item = {
    id:uid(), type, rotation:0, size:TYPES[type].size,
    map:{lat:c.lat+offset,lng:c.lng+offset},
    site:{x:50+Math.min(14,state.items.length*2),y:50+Math.min(14,state.items.length*2)}
  };
  state.items.push(item);
  state.selectedId = item.id;
  renderItems();
  updateSelectionEditor();
  syncOverlays();
  saveLocal();
}

function seedDemo(){
  const {lng,lat} = state.location;
  state.items = [
    {id:uid(),type:'car',rotation:90,size:100,map:{lat:lat+.00016,lng:lng-.00010},site:{x:20,y:27}},
    {id:uid(),type:'tent',rotation:15,size:105,map:{lat:lat+.00002,lng:lng-.00003},site:{x:45,y:46}},
    {id:uid(),type:'tarp',rotation:20,size:125,map:{lat:lat-.00005,lng:lng+.00004},site:{x:58,y:58}},
    {id:uid(),type:'fire',rotation:0,size:90,map:{lat:lat-.00010,lng:lng+.00013},site:{x:75,y:64}},
    {id:uid(),type:'living',rotation:0,size:105,map:{lat:lat-.00003,lng:lng+.00009},site:{x:66,y:52}}
  ];
}

function markerElement(item, site=false){
  const el = document.createElement('div');
  el.className = `camp-object ${site?'site-item':'item-marker'}`;
  el.dataset.id = item.id;
  el.innerHTML = `<div class="object-base"></div><div class="heading-arrow"></div><div class="object-rotator">${modelMarkup(item.type)}</div><div class="item-label">${TYPES[item.type].label}</div>`;
  if (item.id === state.selectedId) el.classList.add('selected');
  applyVisualToElement(el,item,site);
  el.addEventListener('click', e => { e.stopPropagation(); selectItem(item.id); });
  return el;
}

function applyVisualToElement(el,item,site){
  const displayRotation = site ? item.rotation : normBearing(item.rotation - map.getBearing());
  el.style.setProperty('--inner-rotation', `${displayRotation}deg`);
  el.style.setProperty('--object-scale', String(item.size/100));
}

function renderItems(){
  renderMapItems();
  renderSiteItems();
  refreshSelectionStyles();
}

function renderMapItems(){
  for (const m of state.mapMarkers.values()) m.remove();
  state.mapMarkers.clear();
  if (state.mode !== 'map' || !map.loaded()) return;

  for (const item of state.items) {
    const el = markerElement(item,false);
    const marker = new maplibregl.Marker({element:el,draggable:true,anchor:'center'})
      .setLngLat([item.map.lng,item.map.lat]).addTo(map);

    marker.on('dragstart', () => {
      selectItem(item.id);
      el.classList.add('dragging');
    });
    marker.on('drag', () => {
      const p = marker.getLngLat();
      item.map = {lat:p.lat,lng:p.lng};
      syncOverlays();
    });
    marker.on('dragend', () => {
      const p = marker.getLngLat();
      item.map = {lat:p.lat,lng:p.lng};
      el.classList.remove('dragging');
      syncOverlays();
      saveLocal();
    });
    state.mapMarkers.set(item.id,marker);
  }
}

function renderSiteItems(){
  refs.siteItems.innerHTML = '';
  for (const item of state.items) {
    const el = markerElement(item,true);
    el.style.left = `${item.site.x}%`;
    el.style.top = `${item.site.y}%`;
    attachSiteDrag(el,item);
    refs.siteItems.appendChild(el);
  }
}

function attachSiteDrag(el,item){
  let dragging = false;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    dragging = true;
    selectItem(item.id);
    el.classList.add('dragging');
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  el.addEventListener('pointermove', e => {
    if (!dragging) return;
    const r = refs.siteItems.getBoundingClientRect();
    item.site.x = clamp((e.clientX-r.left)/r.width*100,0,100);
    item.site.y = clamp((e.clientY-r.top)/r.height*100,0,100);
    el.style.left = `${item.site.x}%`;
    el.style.top = `${item.site.y}%`;
    syncOverlays();
  });
  const finish = () => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('dragging');
    saveLocal();
  };
  el.addEventListener('pointerup',finish);
  el.addEventListener('pointercancel',finish);
}

function selectItem(id){
  state.selectedId = id;
  refreshSelectionStyles();
  updateSelectionEditor();
}

function clearSelection(){
  state.selectedId = null;
  refreshSelectionStyles();
  updateSelectionEditor();
}

function refreshSelectionStyles(){
  document.querySelectorAll('.camp-object').forEach(el => el.classList.toggle('selected', el.dataset.id === state.selectedId));
}

function updateItemVisual(id){
  const item = state.items.find(i=>i.id===id);
  if (!item) return;
  const mapEl = state.mapMarkers.get(id)?.getElement();
  if (mapEl) applyVisualToElement(mapEl,item,false);
  const siteEl = refs.siteItems.querySelector(`[data-id="${id}"]`);
  if (siteEl) applyVisualToElement(siteEl,item,true);
}

function updateAllMapVisuals(){
  for (const item of state.items) {
    const el = state.mapMarkers.get(item.id)?.getElement();
    if (el) applyVisualToElement(el,item,false);
  }
}

function updateSelectionEditor(){
  const item = selected();
  refs.emptySelection.classList.toggle('hidden',!!item);
  refs.selectionEditor.classList.toggle('hidden',!item);
  if (!item) return;
  refs.selectedName.textContent = TYPES[item.type].label;
  refs.selectedPreview.innerHTML = modelMarkup(item.type);
  refs.rotationInput.value = item.rotation;
  refs.rotationOutput.value = `${item.rotation}°`;
  refs.sizeInput.value = item.size;
  refs.sizeOutput.value = `${item.size}%`;
}

function setMode(mode){
  state.mode = mode;
  document.querySelectorAll('#modeSwitch button').forEach(b => b.classList.toggle('active',b.dataset.mode===mode));
  refs.map.classList.toggle('hidden',mode!=='map');
  refs.siteBoard.classList.toggle('hidden',mode!=='site');
  refs.mapLocationSection.classList.remove('hidden');
  refs.siteSizeSection.classList.toggle('hidden',mode!=='site');
  refs.viewHint.querySelector('strong').textContent = state.dimension==='3d' ? (mode==='map'?'3D地形表示':'立体サイト表示') : '2D表示';
  renderItems();
  syncOverlays();
  if (mode==='map') setTimeout(()=>map.resize(),50);
}

document.querySelectorAll('#modeSwitch button').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));

document.querySelectorAll('#dimensionSwitch button').forEach(b=>b.addEventListener('click',()=>{
  state.dimension = b.dataset.dimension;
  applyDimension();
  saveLocal();
}));

function applyDimension(animate=true){
  document.querySelectorAll('#dimensionSwitch button').forEach(b=>b.classList.toggle('active',b.dataset.dimension===state.dimension));
  refs.stageWrap.classList.toggle('dimension-3d',state.dimension==='3d');
  refs.terrainBadge.classList.toggle('hidden',state.dimension!=='3d');
  refs.viewHint.querySelector('strong').textContent = state.dimension==='3d' ? (state.mode==='map'?'3D地形表示':'立体サイト表示') : '2D表示';
  refs.viewHint.querySelector('span').textContent = state.dimension==='3d' && state.mode==='map' ? '右ドラッグ / Ctrl+ドラッグでも地図を傾けられます' : '配置物はそのままドラッグできます';
  if (!map.loaded()) return;
  try { map.setTerrain(state.dimension==='3d' ? {source:'terrainSource',exaggeration:1.2} : null); } catch(e) { console.warn('terrain fallback',e); }
  const opts = state.dimension==='3d' ? {pitch:58,bearing:-18,duration:animate?650:0} : {pitch:0,bearing:0,duration:animate?500:0};
  map.easeTo(opts);
  setTimeout(updateAllMapVisuals,animate?680:10);
}

function setLocation(lat,lng,name,fly=true){
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  state.location = {lat,lng,name:name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`};
  refs.latInput.value = lat.toFixed(6);
  refs.lngInput.value = lng.toFixed(6);
  refs.locationLabel.textContent = state.location.name;
  refs.locationPanelLabel.textContent = state.location.name;
  state.weather.key = '';
  state.weather.available = false;
  if (fly) map.flyTo({center:[lng,lat],zoom:17,essential:true});
  updateBaseMarker();
  syncAll();
  scheduleWeatherFetch(80);
  saveLocal();
}

function updateBaseMarker(){
  if (!map.loaded()) return;
  if (!state.baseMarker) {
    const el = document.createElement('div');
    el.style.cssText = 'width:14px;height:14px;border-radius:50%;background:#244c3b;border:3px solid white;box-shadow:0 0 0 3px rgba(36,76,59,.25),0 5px 12px rgba(0,0,0,.22);pointer-events:none';
    state.baseMarker = new maplibregl.Marker({element:el,anchor:'center'}).setLngLat([state.location.lng,state.location.lat]).addTo(map);
  } else {
    state.baseMarker.setLngLat([state.location.lng,state.location.lat]);
  }
}

$('moveMapBtn').addEventListener('click',()=>{
  const lat=Number(refs.latInput.value),lng=Number(refs.lngInput.value);
  setLocation(lat,lng,`${lat.toFixed(5)}, ${lng.toFixed(5)}`,true);
});
$('useCenterBtn').addEventListener('click',()=>{
  const c=map.getCenter();
  setLocation(c.lat,c.lng,`地図中央 ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`,false);
});

refs.pickOnMapBtn.addEventListener('click',()=>{
  if(state.mode!=='map'){ setMode('map'); setTimeout(()=>setMapPickMode(true),80); return; }
  setMapPickMode(!state.mapPickMode);
});
function setMapPickMode(on){
  state.mapPickMode = on;
  refs.pickOnMapBtn.classList.toggle('active',on);
  refs.pickOnMapBtn.textContent = on ? '× 場所選択を解除' : '＋ 地図をクリックして場所を選択';
  refs.mapPickNotice.classList.toggle('hidden',!on);
  map.getCanvas().style.cursor = on ? 'crosshair' : '';
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.mapPickMode)setMapPickMode(false);});

refs.placeSearchInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();performPlaceSearch();}});
refs.placeSearchBtn.addEventListener('click',performPlaceSearch);

async function performPlaceSearch(){
  const q = refs.placeSearchInput.value.trim();
  if (!q) { refs.searchStatus.textContent='場所名・施設名・住所を入力してください。'; return; }
  refs.placeSearchBtn.disabled = true;
  refs.searchStatus.textContent = 'キャンプ場・施設・地名を検索中…';
  refs.placeResults.classList.add('hidden');
  refs.placeResults.innerHTML = '';

  const coord = parseCoordinateQuery(q);
  if (coord) {
    showPlaceResults([{lat:coord.lat,lng:coord.lng,title:`緯度経度 ${coord.lat.toFixed(6)}, ${coord.lng.toFixed(6)}`,subtitle:'入力された座標',provider:'座標'}]);
    refs.placeSearchBtn.disabled = false;
    return;
  }

  try {
    const cacheKey = `camp-geocode-v3:${q}`;
    const cached = localStorage.getItem(cacheKey);
    let merged = null;
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now()-parsed.time < 24*60*60*1000) merged = parsed.data;
    }
    if (!merged) {
      const [osm, gsi, meteo] = await Promise.allSettled([searchNominatim(q), searchGsi(q), searchOpenMeteo(q)]);
      const osmRows = osm.status==='fulfilled' ? osm.value : [];
      const gsiRows = gsi.status==='fulfilled' ? gsi.value : [];
      const meteoRows = meteo.status==='fulfilled' ? meteo.value : [];
      merged = dedupePlaces([...osmRows,...gsiRows,...meteoRows]).slice(0,10);
      if (!merged.length && osm.status==='rejected' && gsi.status==='rejected' && meteo.status==='rejected') {
        throw new Error('all geocoders failed');
      }
      localStorage.setItem(cacheKey,JSON.stringify({time:Date.now(),data:merged}));
    }
    showPlaceResults(merged);
  } catch(e) {
    console.warn(e);
    refs.searchStatus.textContent = '場所検索APIに接続できませんでした。地図クリックまたは緯度経度指定は使用できます。';
  } finally {
    refs.placeSearchBtn.disabled = false;
  }
}

async function searchNominatim(q){
  // Nominatim public API: user-triggered search only, cached, no autocomplete.
  const wait=Math.max(0,1000-(Date.now()-state.lastSearchAt));
  if(wait)await sleep(wait);
  state.lastSearchAt=Date.now();
  const url=new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q',q);
  url.searchParams.set('format','jsonv2');
  url.searchParams.set('limit','8');
  url.searchParams.set('countrycodes','jp');
  url.searchParams.set('addressdetails','1');
  url.searchParams.set('accept-language','ja');
  const res=await fetch(url.toString(),{headers:{'Accept':'application/json'}});
  if(!res.ok)throw new Error(`Nominatim HTTP ${res.status}`);
  const data=await res.json();
  return (Array.isArray(data)?data:[]).map(r=>{
    const lat=Number(r.lat),lng=Number(r.lon);
    const a=r.address||{};
    const area=[a.city||a.town||a.village||a.county,a.state].filter(Boolean).join(' / ');
    const title=String(r.name||String(r.display_name||q).split(',')[0]);
    return {lat,lng,title,subtitle:area||String(r.display_name||'OpenStreetMap'),provider:'OSM'};
  }).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lng));
}

async function searchGsi(q){
  const url = new URL('https://msearch.gsi.go.jp/address-search/AddressSearch');
  url.searchParams.set('q',q.replace(/\s+/g,' '));
  const res = await fetch(url.toString(), {headers:{'Accept':'application/json'}});
  if (!res.ok) throw new Error(`GSI HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.slice(0,10).map(f=>{
    const c=f?.geometry?.coordinates||[];
    const title=String(f?.properties?.title||q);
    return {lat:Number(c[1]),lng:Number(c[0]),title,subtitle:'国土地理院 地名・住所検索',provider:'地理院'};
  }).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lng));
}

async function searchOpenMeteo(q){
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name',q);
  url.searchParams.set('count','8');
  url.searchParams.set('language','ja');
  url.searchParams.set('countryCode','JP');
  const res = await fetch(url.toString(), {headers:{'Accept':'application/json'}});
  if (!res.ok) throw new Error(`Open-Meteo Geocoding HTTP ${res.status}`);
  const data = await res.json();
  return (data?.results||[]).map(r=>{
    const area=[r.admin2,r.admin1,r.country].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' / ');
    return {lat:Number(r.latitude),lng:Number(r.longitude),title:String(r.name||q),subtitle:area||'Open-Meteo Geocoding',provider:'Open-Meteo'};
  }).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lng));
}

function parseCoordinateQuery(q){
  const m=q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if(!m)return null;
  const lat=Number(m[1]),lng=Number(m[2]);
  return lat>=-90&&lat<=90&&lng>=-180&&lng<=180?{lat,lng}:null;
}
function dedupePlaces(rows){
  const seen=new Set();
  return rows.filter(r=>{
    const k=`${r.lat.toFixed(4)},${r.lng.toFixed(4)}`;
    if(seen.has(k))return false;
    seen.add(k);return true;
  });
}
function showPlaceResults(results){
  refs.placeResults.innerHTML='';
  if (!Array.isArray(results) || !results.length) {
    refs.searchStatus.textContent='候補が見つかりませんでした。施設名を短くするか、住所・市町村名でも試してください。';
    return;
  }
  refs.searchStatus.textContent=`${results.length}件の候補が見つかりました。使う場所を選んでください。`;
  refs.placeResults.classList.remove('hidden');
  results.forEach(r=>{
    const btn=document.createElement('button');
    btn.className='place-result';
    btn.innerHTML=`<strong>${escapeHtml(r.title)} <span class="provider">${escapeHtml(r.provider||'検索')}</span></strong><span>${escapeHtml(r.subtitle||`${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`)}</span>`;
    btn.addEventListener('click',()=>{
      setLocation(r.lat,r.lng,r.title,true);
      refs.placeResults.classList.add('hidden');
      refs.searchStatus.textContent=`「${r.title}」を基準地点に設定しました。風データを取得します。`;
    });
    refs.placeResults.appendChild(btn);
  });
}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

refs.siteWidthInput.addEventListener('input',()=>{state.site.width=Number(refs.siteWidthInput.value)||12;syncAll();saveLocal();});
refs.siteHeightInput.addEventListener('input',()=>{state.site.height=Number(refs.siteHeightInput.value)||10;syncAll();saveLocal();});
refs.dateInput.addEventListener('change',()=>{state.weather.key='';state.weather.available=false;syncAll();scheduleWeatherFetch(80);saveLocal();});
refs.timeSlider.addEventListener('input',()=>{applyWeatherForTime();syncAll();});
refs.timeSlider.addEventListener('change',saveLocal);
refs.windAutoInput.addEventListener('change',()=>{
  state.weather.available = refs.windAutoInput.checked ? false : true;
  updateWindControlState();
  if(refs.windAutoInput.checked) scheduleWeatherFetch(20); else { setWeatherStatus('手動設定モードです。',''); syncAll(); }
  saveLocal();
});
refs.weatherRefreshBtn.addEventListener('click',()=>{state.weather.key='';loadWeatherForSelectedDate(true);});
refs.windDirInput.addEventListener('input',()=>{if(refs.windAutoInput.checked)return;state.wind.from=Number(refs.windDirInput.value);state.weather.available=true;syncAll();saveLocal();});
refs.windSpeedInput.addEventListener('input',()=>{if(refs.windAutoInput.checked)return;state.wind.speed=Number(refs.windSpeedInput.value);state.weather.available=true;syncAll();saveLocal();});
refs.rotationInput.addEventListener('input',()=>{
  const i=selected();if(!i)return;
  i.rotation=Number(refs.rotationInput.value);
  refs.rotationOutput.value=`${i.rotation}°`;
  updateItemVisual(i.id);
  saveLocal();
});
refs.sizeInput.addEventListener('input',()=>{
  const i=selected();if(!i)return;
  i.size=Number(refs.sizeInput.value);
  refs.sizeOutput.value=`${i.size}%`;
  updateItemVisual(i.id);
  syncOverlays();
  saveLocal();
});
$('deleteItemBtn').addEventListener('click',()=>{
  if(!state.selectedId)return;
  state.items=state.items.filter(i=>i.id!==state.selectedId);
  state.selectedId=null;
  renderItems();
  updateSelectionEditor();
  syncOverlays();
  saveLocal();
});
refs.siteBoard.addEventListener('click',e=>{if(e.target===refs.siteBoard||e.target.classList.contains('site-ground')||e.target===refs.siteItems)clearSelection();});

let weatherTimer = null;
function scheduleWeatherFetch(delay=180){
  clearTimeout(weatherTimer);
  weatherTimer=setTimeout(()=>loadWeatherForSelectedDate(false),delay);
}
function updateWindControlState(){
  const auto=refs.windAutoInput.checked;
  refs.windDirInput.disabled=auto;
  refs.windSpeedInput.disabled=auto;
  refs.weatherRefreshBtn.disabled=!auto;
}
function setWeatherStatus(message,kind=''){
  refs.weatherStatus.className=`weather-status ${kind}`.trim();
  refs.weatherStatus.innerHTML=`<span class="weather-dot ${kind==='loading'?'loading':''}"></span><span>${escapeHtml(message)}</span>`;
}
function localTodayString(){
  const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function dayNumber(iso){
  const [y,m,d]=iso.split('-').map(Number);return Math.floor(Date.UTC(y,m-1,d)/86400000);
}
function windIsUsable(){return !refs.windAutoInput.checked || state.weather.available;}

async function loadWeatherForSelectedDate(force=false){
  updateWindControlState();
  if(!refs.windAutoInput.checked)return;
  const date=refs.dateInput.value;
  if(!date)return;

  const diff=dayNumber(date)-dayNumber(localTodayString());
  if(diff>217){
    state.weather.available=false;state.weather.hourly=null;state.weather.key='';
    setWeatherStatus(`${date} は長期予報の取得範囲外です（最大217日先）。`,'out');
    if(refs.diagnosticInfo) refs.diagnosticInfo.textContent=`Build V${BUILD_VERSION}\n選択日: ${date}\nAPI: 範囲外`;
    syncAll();return;
  }

  const key=`${state.location.lat.toFixed(4)},${state.location.lng.toFixed(4)},${date}`;
  if(!force && state.weather.key===key && state.weather.hourly){
    applyWeatherForTime();syncAll();return;
  }

  const seq=++state.weather.requestSeq;
  state.weather.loading=true;state.weather.available=false;
  setWeatherStatus(`${state.location.name} / ${date} の風データを取得中…`,'loading');
  syncAll();

  const requests=buildWeatherRequests(date,diff);
  let lastError=null;

  for(let attempt=0;attempt<requests.length;attempt++){
    const req=requests[attempt];
    try{
      console.info('[CampLayout V8] weather request', attempt+1, req.source, req.url);
      if(refs.diagnosticInfo){
        const head=`Build V${BUILD_VERSION}\n配信: ${location.protocol==='https:'?'GitHub Pages/HTTPS':'ローカルまたはHTTP'}\n選択日: ${date}\n試行: ${attempt+1}/${requests.length}\n種別: ${req.source}\nGET ${req.url}`;
        refs.diagnosticInfo.textContent=head;
      }

      const res=await fetch(req.url,{headers:{'Accept':'application/json'},cache:'no-store',credentials:'omit'});
      const raw=await res.text();
      let data=null;
      try{data=raw?JSON.parse(raw):null;}catch{/* raw text is kept for diagnostics */}

      if(!res.ok){
        const reason=data?.reason||data?.error||raw||`HTTP ${res.status}`;
        if(refs.diagnosticInfo) refs.diagnosticInfo.textContent += `\nHTTP: ${res.status}\n応答: ${String(reason).slice(0,500)}`;
        throw new Error(`Open-Meteo HTTP ${res.status}: ${String(reason).slice(0,180)}`);
      }
      if(seq!==state.weather.requestSeq)return;
      if(!data?.hourly?.time?.length)throw new Error('時間別の風データがありません');

      state.weather={
        ...state.weather,
        key,
        hourly:data.hourly,
        available:true,
        timezone:data.timezone||'',
        loading:false,
        source:req.source,
        resolution:req.resolution
      };
      if(refs.diagnosticInfo) refs.diagnosticInfo.textContent += `\nHTTP: ${res.status}\nTimezone: ${data.timezone||'-'}\n件数: ${data.hourly.time.length}\n結果: 成功`;
      applyWeatherForTime();
      syncAll();
      return;
    }catch(e){
      if(seq!==state.weather.requestSeq)return;
      lastError=e;
      console.warn('weather fetch attempt failed',attempt+1,e);
      if(attempt<requests.length-1){
        setWeatherStatus(`風APIの別方式で再試行しています… (${attempt+2}/${requests.length})`,'loading');
      }
    }
  }

  state.weather.available=false;state.weather.hourly=null;state.weather.loading=false;
  const detail=String(lastError?.message||lastError||'不明なエラー').slice(0,240);
  setWeatherStatus(`風データを取得できませんでした：${detail}`,'error');
  if(refs.diagnosticInfo && !refs.diagnosticInfo.textContent.includes('応答:')) refs.diagnosticInfo.textContent += `\nERROR: ${detail}`;
  syncAll();
}

function baseWeatherParams(){
  const p=new URLSearchParams();
  p.set('latitude',state.location.lat.toFixed(6));
  p.set('longitude',state.location.lng.toFixed(6));
  p.set('timezone','auto');
  p.set('wind_speed_unit','ms');
  return p;
}

function makeWeatherUrl(endpoint,params){return `${endpoint}?${params.toString()}`;}

function buildWeatherRequests(date,diff){
  const exact=(endpoint,source,resolution,vars,extra={})=>{
    const p=baseWeatherParams();
    p.set('hourly',vars);
    p.set('start_date',date);
    p.set('end_date',date);
    Object.entries(extra).forEach(([k,v])=>p.set(k,String(v)));
    return {url:makeWeatherUrl(endpoint,p),source,resolution};
  };

  const range=(endpoint,source,resolution,vars,days,extra={})=>{
    const p=baseWeatherParams();
    p.set('hourly',vars);
    p.set('forecast_days',String(days));
    Object.entries(extra).forEach(([k,v])=>p.set(k,String(v)));
    return {url:makeWeatherUrl(endpoint,p),source,resolution};
  };

  if(diff>=0 && diff<=15){
    const vars='wind_speed_10m,wind_direction_10m,wind_gusts_10m';
    return [
      exact('https://api.open-meteo.com/v1/forecast','Open-Meteo 短期予報','1時間間隔',vars),
      range('https://api.open-meteo.com/v1/forecast','Open-Meteo 短期予報（フォールバック）','1時間間隔',vars,16)
    ];
  }

  if(diff>15){
    const vars=diff<=46
      ? 'wind_speed_10m,wind_direction_10m,wind_gusts_10m'
      : 'wind_speed_10m,wind_direction_10m';
    const extra={models:'ecmwf_seasonal_ensemble_mean_seamless'};
    const days=Math.min(217,Math.max(17,diff+1));
    return [
      exact('https://seasonal-api.open-meteo.com/v1/seasonal','Open-Meteo 長期予報（ECMWF ensemble mean）','6時間間隔・36km広域予報',vars,extra),
      range('https://seasonal-api.open-meteo.com/v1/seasonal','Open-Meteo 長期予報（フォールバック）','6時間間隔・36km広域予報',vars,days,extra)
    ];
  }

  const vars='wind_speed_10m,wind_direction_10m,wind_gusts_10m';
  if(date>='2022-01-01'){
    return [
      exact('https://historical-forecast-api.open-meteo.com/v1/forecast','Open-Meteo 過去予報','1時間間隔',vars),
      exact('https://archive-api.open-meteo.com/v1/archive','Open-Meteo 過去気象（フォールバック）','1時間間隔',vars)
    ];
  }
  return [exact('https://archive-api.open-meteo.com/v1/archive','Open-Meteo 過去気象','1時間間隔',vars)];
}

function applyWeatherForTime(){
  if(!refs.windAutoInput.checked || !state.weather.hourly)return;
  const h=state.weather.hourly;
  const targetDate=refs.dateInput.value;
  const target=Number(refs.timeSlider.value);
  let best=-1,bestDiff=Infinity;

  for(let i=0;i<h.time.length;i++){
    const raw=String(h.time[i]);
    const [dpart,tpart=''] = raw.split('T');
    if(dpart!==targetDate)continue;
    const tm=tpart.slice(0,5).split(':').map(Number);
    if(tm.length<2||!Number.isFinite(tm[0])||!Number.isFinite(tm[1]))continue;
    const mins=tm[0]*60+tm[1],delta=Math.abs(mins-target);
    if(delta<bestDiff){bestDiff=delta;best=i;}
  }

  if(best<0){
    state.weather.available=false;
    setWeatherStatus(`${targetDate} の風データがAPI応答内に見つかりません。`,'error');
    return;
  }

  const speed=Number(h.wind_speed_10m?.[best]);
  const dir=Number(h.wind_direction_10m?.[best]);
  const gust=Number(h.wind_gusts_10m?.[best]);
  if(!Number.isFinite(speed)||!Number.isFinite(dir)){
    state.weather.available=false;
    setWeatherStatus('取得した風データに風速または風向がありません。','error');
    return;
  }

  state.wind.speed=speed;
  state.wind.from=normBearing(dir);
  state.wind.gust=Number.isFinite(gust)?gust:null;
  state.weather.available=true;
  refs.windDirInput.value=Math.round(state.wind.from/5)*5%360;
  refs.windSpeedInput.value=clamp(state.wind.speed,0,25);
  const apiTime=String(h.time[best]).slice(11,16);
  const resText=state.weather.resolution?` / ${state.weather.resolution}`:'';
  setWeatherStatus(`${state.weather.source} / ${apiTime} / ${compassName(state.wind.from)}から ${state.wind.speed.toFixed(1)} m/s${state.weather.timezone?` / ${state.weather.timezone}`:''}${resText}`,'ok');
}

function getDateTime(){
  const [y,m,d]=refs.dateInput.value.split('-').map(Number), mins=Number(refs.timeSlider.value);
  return new Date(y,m-1,d,Math.floor(mins/60),mins%60,0,0);
}
function fmtTime(d){return d instanceof Date&&!Number.isNaN(d.valueOf())?`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`:'--:--';}

function syncAll(){
  const mins=Number(refs.timeSlider.value), usable=windIsUsable();
  refs.timeText.textContent=`${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
  refs.windDirOutput.value=usable?`${compassName(state.wind.from)} ${state.wind.from.toFixed(0)}°`:'--';
  refs.windSpeedOutput.value=usable?`${state.wind.speed.toFixed(1)} m/s`:'-- m/s';
  refs.windGustOutput.textContent=usable&&Number.isFinite(state.wind.gust)?`${state.wind.gust.toFixed(1)} m/s`:'-- m/s';
  refs.siteWidthLabel.textContent=`${state.site.width} m`;
  refs.siteHeightLabel.textContent=`${state.site.height} m`;
  updateWindControlState();
  updateSun();
  syncOverlays();
  updateRisks();
}

function updateSun(){
  const dt=getDateTime(), {lat,lng}=state.location;
  const pos=SunCalc.getPosition(dt,lat,lng), times=SunCalc.getTimes(dt,lat,lng);
  const az=normBearing(pos.azimuth), alt=pos.altitude;
  refs.sunriseText.textContent=fmtTime(times.sunrise);
  refs.sunsetText.textContent=fmtTime(times.sunset);
  refs.sunAzimuthText.textContent=`${az.toFixed(1)}° ${compassName(az)}`;
  refs.sunAltitudeText.textContent=`${alt.toFixed(1)}°`;
  refs.sunNeedle.style.transform=`rotate(${az}deg)`;
  const usable=windIsUsable(),downwind=normBearing(state.wind.from+180);
  refs.windNeedle.style.transform=`rotate(${downwind}deg)`;
  refs.windNeedle.style.opacity=usable?'1':'0';
  refs.sunBearingText.textContent=`☀ ${az.toFixed(0)}°`;
  refs.windBearingText.textContent=usable?`風下 ${downwind.toFixed(0)}°`:'風 --';
}

function syncOverlays(){
  if(!map.loaded())return;
  const dt=getDateTime(),pos=SunCalc.getPosition(dt,state.location.lat,state.location.lng),az=normBearing(pos.azimuth),alt=pos.altitude;
  const center=[state.location.lng,state.location.lat];
  const sunEnd=destination(state.location.lat,state.location.lng,az,120);
  const shadowLen=alt>2?clamp(65/Math.tan(rad(alt)),18,150):150;
  const shadowEnd=destination(state.location.lat,state.location.lng,normBearing(az+180),shadowLen);
  const usable=windIsUsable(),down=normBearing(state.wind.from+180),windEnd=destination(state.location.lat,state.location.lng,down,100);
  map.getSource('sun-ray')?.setData(lineFC(center,sunEnd));
  map.getSource('shadow-ray')?.setData(lineFC(center,shadowEnd));
  map.getSource('wind-ray')?.setData(usable?lineFC(center,windEnd):emptyFC());
  map.getSource('smoke-zones')?.setData(usable?mapSmokeZones(down):emptyFC());
  drawSiteOverlay(az,alt,usable?down:null);
  updateRisks();
}

function lineFC(a,b){return {type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[a,b]}}]};}
function mapSmokeZones(down){
  const feats=[];
  for(const fire of state.items.filter(i=>i.type==='fire')){
    const p=fire.map;
    const len=14+state.wind.speed*2.2;
    const a=destination(p.lat,p.lng,down-18,len),b=destination(p.lat,p.lng,down+18,len);
    feats.push({type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[p.lng,p.lat],a,b,[p.lng,p.lat]]]}});
  }
  return {type:'FeatureCollection',features:feats};
}

function drawSiteOverlay(sunAz,sunAlt,down){
  const svg=refs.siteOverlay;svg.innerHTML='';
  const cx=500,cy=350;
  addSvgLine(svg,cx,cy,...svgPoint(cx,cy,sunAz,245),'#f0a43c',7,'');
  const shadowLen=sunAlt>2?clamp(160/Math.tan(rad(sunAlt)),90,250):250;
  addSvgLine(svg,cx,cy,...svgPoint(cx,cy,normBearing(sunAz+180),shadowLen),'#554f58',6,'12 10');
  if(Number.isFinite(down)) addSvgLine(svg,cx,cy,...svgPoint(cx,cy,down,220),'#4f8f9e',6,'5 9');
  if(!Number.isFinite(down)) return;
  for(const fire of state.items.filter(i=>i.type==='fire')){
    const fx=28/Math.max(1,refs.siteBoard.clientWidth)*1000+(fire.site.x/100)*(1000-56/Math.max(1,refs.siteBoard.clientWidth)*1000);
    const fy=28/Math.max(1,refs.siteBoard.clientHeight)*700+(fire.site.y/100)*(700-56/Math.max(1,refs.siteBoard.clientHeight)*700);
    const len=110+state.wind.speed*8,p1=svgPoint(fx,fy,down-20,len),p2=svgPoint(fx,fy,down+20,len);
    const poly=document.createElementNS('http://www.w3.org/2000/svg','polygon');
    poly.setAttribute('points',`${fx},${fy} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`);poly.setAttribute('fill','#4f8f9e');poly.setAttribute('fill-opacity','.16');svg.appendChild(poly);
  }
}
function svgPoint(x,y,bearing,len){const r=rad(bearing);return [x+Math.sin(r)*len,y-Math.cos(r)*len];}
function addSvgLine(svg,x1,y1,x2,y2,color,width,dash){const l=document.createElementNS('http://www.w3.org/2000/svg','line');Object.entries({x1,y1,x2,y2,stroke:color,'stroke-width':width,'stroke-linecap':'round'}).forEach(([k,v])=>l.setAttribute(k,v));if(dash)l.setAttribute('stroke-dasharray',dash);svg.appendChild(l);}

function distanceItems(a,b){
  if(state.mode==='map')return haversine(a.map,b.map);
  const dx=(a.site.x-b.site.x)/100*state.site.width,dy=(a.site.y-b.site.y)/100*state.site.height;
  return Math.hypot(dx,dy);
}
function bearingItems(a,b){
  if(state.mode==='map')return bearingBetween(a.map,b.map);
  const dx=(b.site.x-a.site.x)/100*state.site.width,dy=-(b.site.y-a.site.y)/100*state.site.height;
  return normBearing(deg(Math.atan2(dx,dy)));
}
function angleDiff(a,b){let d=Math.abs(normBearing(a)-normBearing(b));return d>180?360-d:d;}

function updateRisks(){
  const risks=[],fires=state.items.filter(i=>i.type==='fire'),shelters=state.items.filter(i=>['tent','tarp','living'].includes(i.type)),usable=windIsUsable(),down=normBearing(state.wind.from+180);
  if(refs.windAutoInput.checked&&!usable)risks.push({kind:'',title:'風データ未取得',body:'風向が取得できるまで煙の風下判定は表示しません。'});
  for(const f of fires){
    for(const s of shelters){
      const d=distanceItems(f,s),bear=bearingItems(f,s);
      if(d<3.5)risks.push({kind:'warn',title:`焚き火と${TYPES[s.type].label}が近い`,body:`距離 約${d.toFixed(1)}m。火の粉や輻射熱を考えて間隔を確認してください。`});
      if(usable&&d<15&&angleDiff(bear,down)<25)risks.push({kind:'warn',title:`煙が${TYPES[s.type].label}へ流れやすい`,body:`現在の風向では焚き火の風下約${d.toFixed(1)}mにあります。`});
    }
  }
  const tents=state.items.filter(i=>i.type==='tent'),cars=state.items.filter(i=>i.type==='car');
  for(const t of tents)for(const c of cars){const d=distanceItems(t,c);if(d<1.5)risks.push({kind:'warn',title:'車とテントの間隔が小さい',body:`距離 約${d.toFixed(1)}m。出入りやロープ位置を確認してください。`});}
  if(!risks.length)risks.push({kind:'good',title:'大きな配置警告はありません',body:'現在の簡易ルールでは、火元距離と煙の風下配置に目立つ衝突はありません。'});
  refs.riskList.innerHTML=risks.slice(0,6).map(r=>`<div class="risk ${r.kind}"><strong>${r.title}</strong>${r.body}</div>`).join('');
}

function serializable(){
  return {version:7,location:state.location,site:state.site,wind:state.wind,windAuto:refs.windAutoInput.checked,mode:state.mode,dimension:state.dimension,date:refs.dateInput.value,timeMinutes:Number(refs.timeSlider.value),items:state.items};
}
function applyData(data){
  if(!data||!Array.isArray(data.items))throw new Error('invalid');
  state.location={...state.location,...(data.location||{})};
  if(!state.location.name)state.location.name=`${state.location.lat.toFixed(5)}, ${state.location.lng.toFixed(5)}`;
  state.site=data.site||state.site;state.wind={...state.wind,...(data.wind||{})};state.items=data.items;state.selectedId=null;state.dimension=data.dimension==='2d'?'2d':'3d';
  state.weather.key='';state.weather.hourly=null;state.weather.available=false;
  refs.latInput.value=state.location.lat;refs.lngInput.value=state.location.lng;refs.locationLabel.textContent=state.location.name;refs.locationPanelLabel.textContent=state.location.name;
  refs.siteWidthInput.value=state.site.width;refs.siteHeightInput.value=state.site.height;refs.windDirInput.value=state.wind.from;refs.windSpeedInput.value=state.wind.speed;
  refs.windAutoInput.checked=data.windAuto!==false;
  if(data.date)refs.dateInput.value=data.date;if(Number.isFinite(data.timeMinutes))refs.timeSlider.value=data.timeMinutes;
  if(map.loaded())map.jumpTo({center:[state.location.lng,state.location.lat]});
  setMode(data.mode==='site'?'site':'map');
  applyDimension(false);
  updateBaseMarker();
  renderItems();updateSelectionEditor();syncAll();
  scheduleWeatherFetch(100);
}
function saveLocal(){localStorage.setItem('camp-layout-lab-v7',JSON.stringify(serializable()));}
function restoreLocal(){try{const raw=localStorage.getItem('camp-layout-lab-v7');if(raw)applyData(JSON.parse(raw));}catch(e){console.warn(e);}}

$('saveLocalBtn').addEventListener('click',()=>{saveLocal();const b=$('saveLocalBtn'),old=b.textContent;b.textContent='保存しました';setTimeout(()=>b.textContent=old,900);});
$('exportBtn').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(serializable(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`camp-layout-${refs.dateInput.value}.json`;a.click();URL.revokeObjectURL(url);});
refs.importInput.addEventListener('change',async()=>{const f=refs.importInput.files?.[0];if(!f)return;try{applyData(JSON.parse(await f.text()));saveLocal();}catch{alert('JSONを読み込めませんでした。');}refs.importInput.value='';});
$('resetBtn').addEventListener('click',()=>{
  localStorage.removeItem('camp-layout-lab-v7');
  state.location={...DEFAULT_LOCATION};state.items=[];state.selectedId=null;state.mode='map';state.dimension='3d';state.weather={key:'',hourly:null,available:false,timezone:'',loading:false,requestSeq:state.weather.requestSeq+1,source:'',resolution:''};
  refs.windAutoInput.checked=true;
  seedDemo();refs.latInput.value=state.location.lat;refs.lngInput.value=state.location.lng;refs.locationLabel.textContent=state.location.name;refs.locationPanelLabel.textContent=state.location.name;
  map.jumpTo({center:[state.location.lng,state.location.lat],zoom:17});setMode('map');applyDimension(false);updateBaseMarker();renderItems();updateSelectionEditor();syncAll();scheduleWeatherFetch(50);saveLocal();
});

window.addEventListener('resize',()=>{map.resize();syncOverlays();});
