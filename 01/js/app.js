import { CONFIG } from './config.js';
import { searchPlace } from './geocode.js';
import { fetchForecast, fetchHistoricalTrend, isForecastRange, forecastBoundary } from './weather.js';
import { analyzeWindow } from './scoring.js';
import { renderComparison, renderDetail, renderProfile, copySummaryText } from './ui.js';
import { nextFriday, addDays, isoDate, daysBetweenInclusive, parseDateLocal, downloadJson, formatRange } from './utils.js';

const $=s=>document.querySelector(s);
const els={
  tabCamp:$('#tab-campsite'),tabCoords:$('#tab-coords'),campGroup:$('#campsite-input-group'),coordsGroup:$('#coords-input-group'),
  placeInput:$('#placeInput'),placeSearch:$('#placeSearchBtn'),placeResults:$('#placeResults'),lat:$('#latInput'),lon:$('#lonInput'),geo:$('#geoBtn'),
  coordStatus:$('#coordStatus'),elevationStatus:$('#elevationStatus'),headerPlace:$('#headerPlace'),headerCoords:$('#headerCoords'),headerElevation:$('#headerElevation'),headerTime:$('#headerTime'),headerStatus:$('#headerStatus'),
  candidateEditor:$('#candidateEditor'),addRange:$('#addRangeBtn'),history:$('#historyFallback'),analyze:$('#analyzeBtn'),analyzePulse:$('#analyzePulse'),analyzeLabel:$('#analyzeLabel'),error:$('#errorBox'),
  comparisonGrid:$('#comparisonGrid'),comparisonTable:$('#comparisonTableBody'),bestBadge:$('#bestBadge'),comparisonPlace:$('#comparisonPlace'),detail:$('#detailContent'),
  profileMode:$('#profileMode'),profilePlace:$('#profilePlace'),profileCoords:$('#profileCoords'),profileMetrics:$('#profileMetrics'),gear:$('#gearRecommendations'),
  copy:$('#copyBtn'),export:$('#exportBtn'),bottomCopy:$('#bottomCopyBtn'),bottomExport:$('#bottomExportBtn')
};

let selectedPlace=null;
let candidateRanges=[];
let results=[];
let selectedCandidateIndex=0;
let lastExport=null;

function invalidateResults(){
  results=[];
  selectedCandidateIndex=0;
  lastExport=null;
  [els.copy,els.export,els.bottomCopy,els.bottomExport].forEach(b=>b.disabled=true);
}

function setClock(){
  els.headerTime.textContent=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date())+' JST';
}
setClock(); setInterval(setClock,30000);

function setError(msg=''){
  els.error.classList.toggle('hidden',!msg);
  els.error.innerHTML=msg?`<div class="flex items-start gap-2"><span class="material-symbols-outlined text-error">error</span><div><strong class="block mb-1">確認してください</strong>${msg}</div></div>`:'';
}

function setBusy(on,text='キャンプ指数計算 (気象解析実行)'){
  els.analyze.disabled=on;
  els.analyzeLabel.textContent=on?'気象データ解析中...':text;
  els.analyzePulse.innerHTML=on?'<span class="material-symbols-outlined animate-spin text-[18px]">refresh</span>':'<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-on-primary-container opacity-75"></span><span class="relative inline-flex rounded-full h-3 w-3 bg-on-primary-container"></span>';
  els.headerStatus.textContent=on?'取得・解析中':'解析待ち';
}

function switchInputMode(mode){
  const camp=mode==='camp';
  els.campGroup.classList.toggle('hidden',!camp);
  els.coordsGroup.classList.toggle('hidden',camp);
  els.tabCamp.className=`px-space-md py-1.5 rounded ${camp?'text-on-surface bg-surface-bright shadow-sm':'text-on-surface-variant hover:text-on-surface'} font-headline-sm text-headline-sm transition-all flex items-center gap-space-xs`;
  els.tabCoords.className=`px-space-md py-1.5 rounded ${!camp?'text-on-surface bg-surface-bright shadow-sm':'text-on-surface-variant hover:text-on-surface'} font-headline-sm text-headline-sm transition-all flex items-center gap-space-xs`;
}

function updatePlaceUi(elevation=null){
  if(!selectedPlace){
    els.coordStatus.textContent='未設定';
    els.headerPlace.textContent='場所未選択';
    els.headerCoords.textContent='[-]';
    els.profilePlace.textContent='場所未選択';
    els.profileCoords.textContent='--';
    els.elevationStatus.textContent='標高 --';
    els.headerElevation.textContent='標高 --';
    return;
  }
  const coords=`${selectedPlace.lat.toFixed(5)}° N, ${selectedPlace.lon.toFixed(5)}° E`;
  els.coordStatus.textContent=coords;
  els.headerPlace.textContent=selectedPlace.name;
  els.headerCoords.textContent=`[${coords}]`;
  els.profilePlace.textContent=selectedPlace.name;
  els.profileCoords.textContent=coords;
  if(elevation!=null){
    els.elevationStatus.textContent=`標高 ${Math.round(elevation)}m`;
    els.headerElevation.textContent=`標高 ${Math.round(elevation)}m`;
  }else{
    els.elevationStatus.textContent='標高 取得待ち';
    els.headerElevation.textContent='標高 取得待ち';
  }
}

function clearSelectedPlaceForSearch(){
  selectedPlace=null;
  els.lat.value='';
  els.lon.value='';
  els.placeResults.classList.add('hidden');
  invalidateResults();
  updatePlaceUi();
  els.headerStatus.textContent='検索結果から場所を選択';
}

function setSelectedPlace(p,{hideResults=true}={}){
  const lat=Number(p?.lat),lon=Number(p?.lon);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180){
    selectedPlace=null;
    updatePlaceUi();
    return false;
  }
  selectedPlace={name:p.name||'指定地点',displayName:p.displayName||p.name||'指定地点',lat,lon,source:p.source||'search'};
  els.lat.value=lat;
  els.lon.value=lon;
  els.placeInput.value=selectedPlace.name;
  if(hideResults) els.placeResults.classList.add('hidden');
  invalidateResults();
  updatePlaceUi();
  setError();
  els.headerStatus.textContent='場所セット済み';
  return true;
}

function selectPlace(p){
  setSelectedPlace(p,{hideResults:true});
}

async function doPlaceSearch(){
  setError();
  const q=els.placeInput.value.trim();
  if(!q){setError('キャンプ場名を入力してください。');return;}

  // 再検索中に前回地点が計算へ使われないよう、検索開始時点で場所を未確定に戻す。
  clearSelectedPlaceForSearch();
  els.placeSearch.disabled=true; els.placeSearch.textContent='検索中';
  try{
    const found=await searchPlace(q);

    // 検索中に入力文字が変わった場合、古い検索結果は表示しない。
    if(els.placeInput.value.trim()!==q) return;

    if(!found.length){
      els.placeResults.classList.add('hidden');
      setError('場所が見つかりませんでした。市区町村名を付けて再検索するか、緯度・経度で指定してください。');
      return;
    }
    els.placeResults.innerHTML=found.map((p,i)=>`<button type="button" data-place-index="${i}" class="w-full text-left px-4 py-3 hover:bg-surface-container border-b border-outline-variant/20 last:border-b-0"><span class="block text-on-surface font-semibold text-body-sm">${p.name}${i===0?' <span class=\"text-primary font-label-sm\">(自動選択)</span>':''}</span><span class="block text-outline font-label-sm mt-0.5 truncate">${p.displayName}</span></button>`).join('');

    // 検索成功時は最上位候補を即座に場所として確定する。
    // 一覧は残し、別候補をクリックすれば上書きできる。
    setSelectedPlace(found[0],{hideResults:false});
    els.placeResults.classList.remove('hidden');
    els.headerStatus.textContent='最上位候補をセット済み';
    els.placeResults.querySelectorAll('[data-place-index]').forEach(btn=>btn.addEventListener('click',()=>selectPlace(found[Number(btn.dataset.placeIndex)])));
  }catch(err){setError(`場所検索に失敗しました: ${err.message}`);}
  finally{els.placeSearch.disabled=false;els.placeSearch.textContent='検索';}
}

function applyManualCoords(){
  const latRaw=String(els.lat.value ?? '').trim();
  const lonRaw=String(els.lon.value ?? '').trim();

  // Number('') は 0 になるため、空欄を必ず先に除外する。
  if(!latRaw || !lonRaw){
    if(selectedPlace?.source==='manual'){
      selectedPlace=null;
      invalidateResults();
      updatePlaceUi();
    }
    return false;
  }

  const lat=Number(latRaw),lon=Number(lonRaw);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180){
    selectedPlace=null;
    invalidateResults();
    updatePlaceUi();
    return false;
  }

  const changed=!selectedPlace || Math.abs(selectedPlace.lat-lat)>1e-8 || Math.abs(selectedPlace.lon-lon)>1e-8;
  selectedPlace={name:els.placeInput.value.trim()||'緯度経度指定地点',displayName:'緯度経度による直接指定',lat,lon,source:'manual'};
  if(changed) invalidateResults();
  updatePlaceUi();
  return true;
}

function useCurrentLocation(){
  setError();
  if(!navigator.geolocation){setError('このブラウザでは現在地取得を利用できません。');return;}
  els.geo.disabled=true; els.geo.innerHTML='<span class="material-symbols-outlined animate-spin text-[14px]">refresh</span>取得中';
  navigator.geolocation.getCurrentPosition(pos=>{
    selectedPlace={name:'現在地',displayName:'ブラウザの現在地',lat:pos.coords.latitude,lon:pos.coords.longitude,source:'browser-geolocation'};
    els.lat.value=selectedPlace.lat.toFixed(6);els.lon.value=selectedPlace.lon.toFixed(6);els.placeInput.value='現在地';
    invalidateResults();
    updatePlaceUi();
    els.geo.disabled=false;els.geo.innerHTML='<span class="material-symbols-outlined text-[14px]">my_location</span>現在地から取得';
  },err=>{
    setError(`現在地を取得できませんでした: ${err.message}`);
    els.geo.disabled=false;els.geo.innerHTML='<span class="material-symbols-outlined text-[14px]">my_location</span>現在地から取得';
  },{enableHighAccuracy:false,timeout:10000,maximumAge:300000});
}

function initRanges(){
  const fri=nextFriday();
  candidateRanges=[0,7,14].map(offset=>({start:isoDate(addDays(fri,offset)),end:isoDate(addDays(fri,offset+2))}));
  renderCandidateEditor();
}

function renderCandidateEditor(){
  els.candidateEditor.innerHTML=candidateRanges.map((r,i)=>{
    const result=results[i];
    return `<div class="candidate-input bg-surface-container p-2 rounded-lg border ${result?'border-secondary/40':'border-outline-variant/30'} flex items-center gap-2" data-range-index="${i}">
      <span class="${result?'bg-secondary-container text-secondary':'bg-primary/20 text-primary'} font-label-sm text-label-sm px-1.5 py-0.5 rounded font-bold shrink-0">候補#${i+1}</span>
      <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-1 flex-1 min-w-0"><input class="start-date bg-surface-container-highest text-on-surface font-label-sm px-2 py-1.5 rounded min-w-0 w-full" type="date" value="${r.start}"><span class="text-outline">〜</span><input class="end-date bg-surface-container-highest text-on-surface font-label-sm px-2 py-1.5 rounded min-w-0 w-full" type="date" value="${r.end}"></div>
      <div class="hidden sm:flex flex-col text-right shrink-0 min-w-[88px]"><span class="font-label-sm text-outline">${result?result.mode==='forecast'?'実予報':'過去傾向':'未解析'}</span><span class="font-telemetry-md ${result?'text-secondary':'text-on-surface-variant'}">${result?result.analysis.overall+'点':'--'}</span></div>
      <button class="remove-range bg-surface-container-highest hover:bg-surface-bright text-on-surface px-2 py-1.5 rounded transition-colors" ${candidateRanges.length<=1?'disabled':''}><span class="material-symbols-outlined text-[14px]">close</span></button>
    </div>`;
  }).join('');
  els.candidateEditor.querySelectorAll('.candidate-input').forEach(row=>{
    const i=Number(row.dataset.rangeIndex),start=row.querySelector('.start-date'),end=row.querySelector('.end-date');
    start.addEventListener('change',()=>{candidateRanges[i].start=start.value;invalidateResults();renderCandidateEditor();});
    end.addEventListener('change',()=>{candidateRanges[i].end=end.value;invalidateResults();renderCandidateEditor();});
    row.querySelector('.remove-range').addEventListener('click',()=>{if(candidateRanges.length<=1)return;candidateRanges.splice(i,1);invalidateResults();renderCandidateEditor();});
  });
}

function addRange(){
  const last=candidateRanges.at(-1);
  if(last?.start&&last?.end){candidateRanges.push({start:isoDate(addDays(parseDateLocal(last.start),7)),end:isoDate(addDays(parseDateLocal(last.end),7))});}
  else candidateRanges.push({start:'',end:''});
  renderCandidateEditor();
}

function validate(){
  // 検索で確定済みの場所はそのまま使う。
  // selectedPlace が無い場合だけ、緯度経度の手入力を場所として確定する。
  if(!selectedPlace) applyManualCoords();
  if(!selectedPlace) throw new Error('キャンプ場を検索するか、緯度・経度を入力してください。');
  if(!candidateRanges.length) throw new Error('候補日程を追加してください。');
  candidateRanges.forEach((r,i)=>{
    if(!r.start||!r.end) throw new Error(`候補#${i+1}の日付を入力してください。`);
    if(parseDateLocal(r.end)<parseDateLocal(r.start)) throw new Error(`候補#${i+1}のチェックアウト日がチェックイン日より前です。`);
    if(daysBetweenInclusive(r.start,r.end)>CONFIG.maxCandidateDays) throw new Error(`候補#${i+1}は最大${CONFIG.maxCandidateDays}日間までです。`);
  });
}

async function analyze(){
  setError();
  try{validate();}catch(err){setError(err.message);return;}
  setBusy(true);
  invalidateResults();
  renderCandidateEditor();
  await new Promise(requestAnimationFrame);
  try{
    for(let i=0;i<candidateRanges.length;i++){
      const r=candidateRanges[i];
      els.analyzeLabel.textContent=`候補#${i+1} 取得中 (${formatRange(r.start,r.end)})`;
      let data;
      if(isForecastRange(r.start,r.end)) data=await fetchForecast(selectedPlace.lat,selectedPlace.lon,r.start,r.end,true);
      else{
        if(!els.history.checked){const limit=isoDate(forecastBoundary());throw new Error(`${r.start}〜${r.end}は実予報範囲外です（目安 ${limit}頃まで）。「16日以降は過去5年」をONにしてください。`);}
        data=await fetchHistoricalTrend(selectedPlace.lat,selectedPlace.lon,r.start,r.end,CONFIG.historicalYears,true);
      }
      if(!data.rows.length) throw new Error(`候補#${i+1}の天気データを取得できませんでした。`);
      results.push({...r,...data,analysis:analyzeWindow(data,r.start,r.end)});
    }
    renderCandidateEditor();
    renderAll();
    const elevation=results.find(x=>x.elevation!=null)?.elevation;
    updatePlaceUi(elevation);
    els.headerStatus.textContent=`${results.length}日程 解析済`;
    lastExport={generatedAt:new Date().toISOString(),place:selectedPlace,candidates:results.map(x=>({start:x.start,end:x.end,mode:x.mode,years:x.years,timezone:x.timezone,elevation:x.elevation,overall:x.analysis.overall,scores:x.analysis.scores,condensation:x.analysis.condensation,drying:x.analysis.drying,stats:x.analysis.stats}))};
    [els.copy,els.export,els.bottomCopy,els.bottomExport].forEach(b=>b.disabled=false);
    document.querySelector('#comparison').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(err){console.error(err);setError(err.message||'解析に失敗しました。');els.headerStatus.textContent='解析エラー';}
  finally{setBusy(false);}
}

function renderAll(){
  if(!results.length)return;
  renderComparison(els.comparisonGrid,els.comparisonTable,els.bestBadge,results,selectedCandidateIndex);
  els.comparisonPlace.innerHTML=`<div class="font-headline-sm text-headline-sm font-semibold text-on-surface">${selectedPlace.name}</div><div class="font-label-sm text-label-sm text-outline">${selectedPlace.lat.toFixed(5)}° N, ${selectedPlace.lon.toFixed(5)}° E</div>`;
  bindCandidateSelection();
  renderSelectedCandidate();
}

function bindCandidateSelection(){
  els.comparisonGrid.querySelectorAll('[data-candidate-index]').forEach(btn=>btn.addEventListener('click',()=>{
    selectedCandidateIndex=Number(btn.dataset.candidateIndex);
    renderComparison(els.comparisonGrid,els.comparisonTable,els.bestBadge,results,selectedCandidateIndex);
    bindCandidateSelection();
    renderSelectedCandidate();
    document.querySelector('#detail').scrollIntoView({behavior:'smooth',block:'start'});
  }));
}

function renderSelectedCandidate(){
  const item=results[selectedCandidateIndex]; if(!item)return;
  renderDetail(els.detail,item,selectedCandidateIndex);
  renderProfile(els.profileMetrics,els.gear,item);
  els.profileMode.textContent=item.mode==='forecast'?'実予報データ':'過去5年傾向';
  els.profilePlace.textContent=selectedPlace.name;
  els.profileCoords.textContent=`${selectedPlace.lat.toFixed(5)}° N, ${selectedPlace.lon.toFixed(5)}° E`;
}

async function copyResults(){
  if(!results.length)return;
  try{await navigator.clipboard.writeText(copySummaryText(selectedPlace,results));
    els.headerStatus.textContent='結果をコピーしました'; setTimeout(()=>els.headerStatus.textContent=`${results.length}日程 解析済`,1500);
  }catch{setError('クリップボードへのコピーに失敗しました。');}
}
function exportResults(){if(lastExport)downloadJson(`camp-window-${new Date().toISOString().slice(0,10)}.json`,lastExport);}

els.tabCamp.addEventListener('click',()=>switchInputMode('camp'));
els.tabCoords.addEventListener('click',()=>switchInputMode('coords'));
els.placeSearch.addEventListener('click',doPlaceSearch);
els.placeInput.addEventListener('keydown',e=>{if(e.key==='Enter')doPlaceSearch();});
els.placeInput.addEventListener('input',()=>{
  selectedPlace=null;
  els.lat.value='';
  els.lon.value='';
  els.placeResults.classList.add('hidden');
  invalidateResults();
  updatePlaceUi();
  els.headerStatus.textContent='場所を再選択';
});
els.lat.addEventListener('change',applyManualCoords);els.lon.addEventListener('change',applyManualCoords);
els.geo.addEventListener('click',useCurrentLocation);
els.addRange.addEventListener('click',addRange);
els.analyze.addEventListener('click',analyze);
els.copy.addEventListener('click',copyResults);els.bottomCopy.addEventListener('click',copyResults);
els.export.addEventListener('click',exportResults);els.bottomExport.addEventListener('click',exportResults);
document.querySelectorAll('.preset-btn').forEach(btn=>btn.addEventListener('click',()=>{els.placeInput.value=btn.dataset.name;doPlaceSearch();}));

initRanges();updatePlaceUi();
if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
