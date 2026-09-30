const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const state = {
  place: null,
  weather: null,
  day: 0,
  settings: loadSettings()
};

const WMO = {
  0:["快晴","☀"],1:["晴れ","☀"],2:["一部くもり","⛅"],3:["くもり","☁"],
  45:["霧","≋"],48:["霧","≋"],51:["弱い霧雨","☂"],53:["霧雨","☂"],55:["強い霧雨","☂"],
  61:["弱い雨","☂"],63:["雨","☂"],65:["強い雨","☂"],66:["着氷性雨","☂"],67:["着氷性雨","☂"],
  71:["弱い雪","❄"],73:["雪","❄"],75:["強い雪","❄"],77:["霧雪","❄"],80:["にわか雨","☂"],81:["にわか雨","☂"],82:["激しい雨","☂"],
  85:["にわか雪","❄"],86:["強いにわか雪","❄"],95:["雷雨","ϟ"],96:["雷雨・雹","ϟ"],99:["激しい雷雨","ϟ"]
};

function loadSettings(){
  try { return {...{capacity:768,battery:80,load:45,solar:160,eff:70}, ...JSON.parse(localStorage.getItem("campPower")||"{}")}; }
  catch { return {capacity:768,battery:80,load:45,solar:160,eff:70}; }
}
function saveSettings(){ localStorage.setItem("campPower", JSON.stringify(state.settings)); }
function esc(s){ return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m])); }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function num(v,d=0){ return Number.isFinite(+v) ? (+v).toFixed(d) : "—"; }
function hhmm(iso){ if(!iso) return "—"; return iso.slice(11,16); }
function dateOnly(iso){ return iso?.slice(0,10); }
function degArrow(d){ if(!Number.isFinite(+d)) return "→"; return `<span class="wind-arrow" style="transform:rotate(${(+d)+180}deg)">↑</span>`; }
function fmtDate(iso, long=false){
  const d = new Date(iso+"T12:00:00");
  return new Intl.DateTimeFormat("ja-JP", long?{month:"numeric",day:"numeric",weekday:"short"}:{month:"numeric",day:"numeric"}).format(d);
}
function distanceKm(a,b,c,d){
  const R=6371, rad=x=>x*Math.PI/180;
  const p1=rad(a),p2=rad(c),dp=rad(c-a),dl=rad(d-b);
  const q=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return R*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));
}
async function getJSON(url, options){
  const r=await fetch(url,options);
  if(!r.ok) throw new Error(`通信エラー (${r.status})`);
  return r.json();
}
function showNotice(msg,type=""){
  const el=$("#notice"); el.hidden=!msg; el.className="notice"+(type?` ${type}`:""); el.textContent=msg||"";
}

async function searchPlaces(){
  const q=$("#placeInput").value.trim(); if(!q) return;
  const btn=$("#searchBtn"); btn.disabled=true; btn.textContent="検索中"; showNotice("");
  try{
    let results=[];
    try{
      const g=await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=ja&format=json`);
      results=(g.results||[]).map(x=>({name:x.name,display:[x.admin1,x.country].filter(Boolean).join(" / "),lat:x.latitude,lon:x.longitude,elevation:x.elevation,source:"Open-Meteo"}));
    }catch{}
    if(!results.length){
      await new Promise(r=>setTimeout(r,1050));
      const n=await getJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=ja&q=${encodeURIComponent(q)}`);
      results=(n||[]).map(x=>({name:(x.name||x.display_name.split(",")[0]),display:x.display_name,lat:+x.lat,lon:+x.lon,source:"OpenStreetMap"}));
    }
    renderSearchResults(results);
    if(!results.length) showNotice("地点が見つかりませんでした。市町村名や都道府県名を含めて試してください。","error");
  }catch(e){ showNotice(`地点検索に失敗しました: ${e.message}`,"error"); }
  finally{btn.disabled=false;btn.textContent="検索";}
}
function renderSearchResults(results){
  const box=$("#searchResults");
  if(!results.length){box.hidden=true;box.innerHTML="";return;}
  box.innerHTML=results.map((r,i)=>`<button class="search-result" data-i="${i}"><b>${esc(r.name)}</b><span>${esc(r.display)} · ${r.source}</span></button>`).join("");
  box.hidden=false;
  $$(".search-result").forEach(b=>b.onclick=()=>selectPlace(results[+b.dataset.i]));
}
async function useGeolocation(){
  if(!navigator.geolocation){showNotice("このブラウザは位置情報に対応していません。","error");return;}
  const btn=$("#geoBtn");btn.disabled=true;btn.textContent="取得中";
  navigator.geolocation.getCurrentPosition(async p=>{
    btn.disabled=false;btn.textContent="現在地";
    const place={name:"現在地",display:`${p.coords.latitude.toFixed(4)}, ${p.coords.longitude.toFixed(4)}`,lat:p.coords.latitude,lon:p.coords.longitude,source:"GPS"};
    await selectPlace(place);
  },err=>{btn.disabled=false;btn.textContent="現在地";showNotice(`位置情報を取得できませんでした: ${err.message}`,"error");},{enableHighAccuracy:true,timeout:10000});
}
async function selectPlace(place){
  state.place=place; $("#searchResults").hidden=true; showNotice("気象データを取得しています…");
  try{
    const hourly=["temperature_2m","apparent_temperature","relative_humidity_2m","dew_point_2m","precipitation_probability","precipitation","weather_code","cloud_cover","wind_speed_10m","wind_gusts_10m","wind_direction_10m","shortwave_radiation"].join(",");
    const current=["temperature_2m","apparent_temperature","relative_humidity_2m","precipitation","weather_code","wind_speed_10m","wind_gusts_10m","wind_direction_10m"].join(",");
    const daily=["weather_code","temperature_2m_max","temperature_2m_min","precipitation_probability_max","sunrise","sunset","wind_speed_10m_max","wind_gusts_10m_max"].join(",");
    const url=`https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&current=${current}&hourly=${hourly}&daily=${daily}&timezone=auto&forecast_days=7`;
    state.weather=await getJSON(url); state.day=0;
    showNotice(""); setupDayPicker(); renderAll();
    $("#dashboard").hidden=false; $("#emptyState").hidden=true;
  }catch(e){ showNotice(`気象データを取得できませんでした: ${e.message}`,"error"); }
}
function setupDayPicker(){
  const d=state.weather.daily.time; const sel=$("#dayPicker");
  sel.innerHTML=d.map((x,i)=>`<option value="${i}">${i===0?"今日 ":""}${fmtDate(x,true)}</option>`).join("");
  sel.value=state.day; sel.onchange=()=>{state.day=+sel.value;renderAll();};
}
function dayHours(index){
  const w=state.weather,h=w.hourly,target=w.daily.time[index];
  const idx=h.time.map((t,i)=>dateOnly(t)===target?i:-1).filter(i=>i>=0);
  return idx.map(i=>hourObj(i));
}
function hourObj(i){
  const h=state.weather.hourly;
  return {i,time:h.time[i],temp:h.temperature_2m[i],feel:h.apparent_temperature[i],hum:h.relative_humidity_2m[i],dew:h.dew_point_2m[i],pop:h.precipitation_probability[i],precip:h.precipitation[i],code:h.weather_code[i],cloud:h.cloud_cover[i],wind:h.wind_speed_10m[i],gust:h.wind_gusts_10m[i],dir:h.wind_direction_10m[i],solar:h.shortwave_radiation[i]};
}
function selectedStartHour(){
  const arr=dayHours(state.day); if(!arr.length)return 0;
  if(state.day!==0) return 12;
  const localNow=state.weather.current.time.slice(11,13); return +localNow;
}
function windowHours(startHour,count){
  const startDate=state.weather.daily.time[state.day];
  const all=state.weather.hourly.time;
  let start=all.findIndex(t=>dateOnly(t)===startDate && +t.slice(11,13)>=startHour);
  if(start<0) start=0;
  return Array.from({length:count},(_,k)=>start+k).filter(i=>i<all.length).map(hourObj);
}
function campScore(){
  const d=state.day, daily=state.weather.daily, hours=dayHours(d); let s=100, reasons=[];
  const rain=daily.precipitation_probability_max[d]||0, gust=daily.wind_gusts_10m_max[d]||0;
  if(rain>=70){s-=30;reasons.push("雨の可能性が高い");} else if(rain>=40){s-=15;reasons.push("雨に注意");}
  if(gust>=45){s-=28;reasons.push("突風が強い");} else if(gust>=32){s-=14;reasons.push("突風に注意");}
  const night=nightHours(); const min=Math.min(...night.map(x=>x.temp).filter(Number.isFinite));
  if(min<0){s-=18;reasons.push("夜間は氷点下");} else if(min<5){s-=10;reasons.push("夜はかなり冷える");}
  const avgCloud=night.reduce((a,x)=>a+(x.cloud||0),0)/Math.max(1,night.length);
  if(avgCloud<35) reasons.push("夜は星空期待");
  s=clamp(Math.round(s),0,100);
  return {s,label:s>=85?"かなり好条件":s>=70?"まずまず":s>=50?"注意点あり":s>=30?"条件厳しめ":"見直し推奨",reasons};
}
function nightHours(){
  const day=state.weather.daily.time[state.day], all=state.weather.hourly.time; const next=state.weather.daily.time[state.day+1];
  const ids=[];
  all.forEach((t,i)=>{const date=dateOnly(t),hr=+t.slice(11,13); if((date===day&&hr>=18)||(next&&date===next&&hr<=7)) ids.push(i);});
  return ids.map(hourObj);
}
function renderAll(){
  renderLocation(); renderHero(); renderStatus(); renderTimeline(); renderFire(); renderNight(); renderPower(); renderWeek();
}
function renderLocation(){
  const p=state.place,w=state.weather,d=state.day;
  $("#locationName").textContent=p.name;
  $("#locationMeta").textContent=`${p.display||""} · ${w.timezone} · 標高 ${Math.round(w.elevation||p.elevation||0)}m`;
  const daily=w.daily; if(daily.time[d]) $("#dayPicker").value=d;
}
function renderHero(){
  const w=state.weather,c=w.current; const info=WMO[c.weather_code]||["天気","◌"];
  $("#currentTemp").textContent=num(c.temperature_2m,1); $("#currentCondition").textContent=info[0]; $("#weatherGlyph").textContent=info[1];
  $("#feelsLike").textContent=`${num(c.apparent_temperature,1)}°`; $("#humidity").textContent=`${num(c.relative_humidity_2m)}%`;
  $("#wind").textContent=`${num(c.wind_speed_10m)} km/h`; $("#gust").textContent=`${num(c.wind_gusts_10m)} km/h`;
  const cs=campScore(); $("#overallScore").style.setProperty("--score",cs.s); $("#overallScore span").textContent=cs.s;
  $("#overallLabel").textContent=cs.label; $("#overallCopy").textContent=cs.reasons.slice(0,3).join(" / ") || "目立ったマイナス要因は少なめです。";
}
function renderStatus(){
  const d=state.day, daily=state.weather.daily, hours=dayHours(d), night=nightHours();
  const rain=daily.precipitation_probability_max[d]||0;
  const rainy=hours.filter(x=>(x.pop||0)>=50); $("#rainHeadline").textContent=rain>=70?"雨対策必須":rain>=40?"雨に注意":"雨リスク低め";
  $("#rainDetail").textContent=rainy.length?`${hhmm(rainy[0].time)}頃から確率上昇`:`最大 ${rain}%`;
  const fires=fireHours(); const good=fires.filter(x=>fireEval(x).level==="good");
  $("#fireHeadline").textContent=good.length?`${good.length}時間 好条件`:(fires.some(x=>fireEval(x).level==="mid")?"注意しながら判断":"気象条件厳しめ");
  $("#sunsetHeadline").textContent=hhmm(daily.sunset[d]); $("#sunsetDetail").textContent=`日の出 ${hhmm(daily.sunrise[d])}`;
  const star=bestStar(); $("#starHeadline").textContent=star?`${hhmm(star.h.time)} ★${star.stars}`:"判定不可"; $("#starDetail").textContent=star?`雲量 ${num(star.h.cloud)}% / 降水 ${num(star.h.pop)}%`:"—";
  const dew=dewEval(); $("#dewHeadline").textContent=dew.label; $("#dewDetail").textContent=dew.detail;
  const pow=powerEstimate(); $("#powerHeadline").textContent=`翌朝 ${Math.round(pow.endPct)}%`; $("#powerDetail").textContent=pow.net>=0?`発電込み +${Math.round(pow.net)}Wh`:`収支 ${Math.round(pow.net)}Wh`;
}
function renderTimeline(){
  const arr=windowHours(selectedStartHour(),12); const maxPop=Math.max(1,...arr.map(x=>x.pop||0));
  $("#timeline").innerHTML=arr.map(h=>`<div class="hour-col"><div class="hour-label">${hhmm(h.time)}</div><div class="rain-bar-wrap"><div class="rain-bar" style="height:${Math.max(3,(h.pop||0))}%"></div></div><div class="hour-temp">${num(h.temp)}°</div><div class="hour-wind">風 ${num(h.wind)}<br>${num(h.pop)}%</div></div>`).join("");
}
function fireHours(){
  const arr=dayHours(state.day); return arr.filter(h=>{const hr=+h.time.slice(11,13); return hr>=16&&hr<=23;});
}
function fireEval(h){
  let score=100,notes=[];
  if((h.precip||0)>0.2 || (h.pop||0)>=60){score-=45;notes.push("降水");}
  else if((h.pop||0)>=35){score-=18;notes.push("雨の可能性");}
  if((h.gust||0)>=40){score-=55;notes.push("強い突風");}
  else if((h.gust||0)>=30){score-=28;notes.push("突風注意");}
  else if((h.wind||0)>=18){score-=18;notes.push("風強め");}
  if((h.hum||100)<35){score-=12;notes.push("乾燥");}
  const level=score>=75?"good":score>=45?"mid":"bad";
  return {score,level,label:level==="good"?"○":level==="mid"?"△":"×",notes:notes.length?notes.join("・"):"穏やか"};
}
function renderFire(){
  const arr=fireHours();
  $("#fireTimeline").innerHTML=arr.map(h=>{const e=fireEval(h);return `<div class="fire-row"><div class="time">${hhmm(h.time)}</div><div class="fire-badge ${e.level}">${e.label}</div><small>${e.notes} / 風 ${num(h.wind)}・突風 ${num(h.gust)} km/h</small><div title="風が流れる方向の概略">${degArrow(h.dir)}</div></div>`}).join("") || `<div class="nearby-state">この日の時間別データがありません。</div>`;
}
function moonInfo(dateStr){
  const known=new Date("2000-01-06T18:14:00Z").getTime(); const t=new Date(dateStr+"T12:00:00Z").getTime(); const syn=29.53058867*86400000;
  let phase=((t-known)%syn+syn)%syn/syn; const illum=(1-Math.cos(2*Math.PI*phase))/2;
  let name=""; if(phase<.03||phase>.97)name="新月付近"; else if(phase<.22)name="三日月〜上弦前"; else if(phase<.28)name="上弦付近"; else if(phase<.47)name="満ちていく月"; else if(phase<.53)name="満月付近"; else if(phase<.72)name="欠けていく月"; else if(phase<.78)name="下弦付近"; else name="細い月";
  return {phase,illum,name};
}
function bestStar(){
  const n=nightHours().filter(h=>{const hr=+h.time.slice(11,13); return hr>=20||hr<=2;}); if(!n.length)return null;
  const moon=moonInfo(state.weather.daily.time[state.day]);
  const scored=n.map(h=>{let s=100-(h.cloud||0)*.75-(h.pop||0)*.35; if((h.precip||0)>0)s-=30; s-=moon.illum*18; return {h,s};}).sort((a,b)=>b.s-a.s)[0];
  return {...scored,stars:clamp(Math.round(scored.s/20),1,5)};
}
function dewEval(){
  const n=nightHours(); if(!n.length)return {label:"—",detail:"夜間データなし"};
  const minSpread=Math.min(...n.map(h=>(h.temp??99)-(h.dew??-99))); const maxHum=Math.max(...n.map(h=>h.hum||0));
  if(minSpread<=1.5||maxHum>=95)return {label:"高い",detail:`露点差 最小 ${num(minSpread,1)}℃`};
  if(minSpread<=3||maxHum>=88)return {label:"やや高い",detail:`露点差 最小 ${num(minSpread,1)}℃`};
  return {label:"低め",detail:`露点差 最小 ${num(minSpread,1)}℃`};
}
function renderNight(){
  const n=nightHours(); const star=bestStar(), moon=moonInfo(state.weather.daily.time[state.day]);
  $("#bestStarTime").textContent=star?hhmm(star.h.time):"—"; $("#bestStarReason").textContent=star?`雲量 ${num(star.h.cloud)}% / ★${star.stars}`:"—";
  $("#nightMinTemp").textContent=n.length?`${num(Math.min(...n.map(x=>x.temp)),1)}°C`:"—";
  $("#nightMaxHumidity").textContent=n.length?`${num(Math.max(...n.map(x=>x.hum)))}%`:"—";
  $("#moonLight").textContent=`${Math.round(moon.illum*100)}%`; $("#moonPhase").textContent=moon.name;
}
function powerEstimate(){
  const s=state.settings, day=state.weather.daily.time[state.day], all=state.weather.hourly.time;
  let start=all.findIndex(t=>dateOnly(t)===day && +t.slice(11,13)>=(state.day===0?selectedStartHour():16)); if(start<0)start=0;
  let end=start+15; const next=state.weather.daily.time[state.day+1]; if(next){const idx=all.findIndex(t=>dateOnly(t)===next&&+t.slice(11,13)===7); if(idx>start)end=idx;}
  end=Math.min(end,all.length-1); let wh=s.capacity*s.battery/100, solar=0, consumed=0;
  for(let i=start;i<=end;i++){const rad=state.weather.hourly.shortwave_radiation[i]||0; const gen=Math.min(s.solar*.9,s.solar*(rad/1000)*(s.eff/100)); solar+=gen; consumed+=s.load; wh=clamp(wh+gen-s.load,0,s.capacity);}
  return {endPct:clamp(wh/s.capacity*100,0,100),solar,consumed,net:solar-consumed,hours:end-start+1};
}
function renderPower(){
  const s=state.settings,p=powerEstimate(); $("#batteryFill").style.width=`${p.endPct}%`; $("#batteryPercent").textContent=`${Math.round(p.endPct)}%`;
  $("#batteryEndLabel").textContent=`翌朝まで ${p.hours}h / 発電 ${Math.round(p.solar)}Wh`;
  $("#capacityDisplay").textContent=`${s.capacity}Wh`; $("#loadDisplay").textContent=`${s.load}W`; $("#solarDisplay").textContent=`${s.solar}W`;
}
function renderWeek(){
  const d=state.weather.daily;
  $("#weekForecast").innerHTML=d.time.map((date,i)=>{const info=WMO[d.weather_code[i]]||["天気","◌"]; const score=(()=>{let s=100-(d.precipitation_probability_max[i]||0)*.35; if((d.wind_gusts_10m_max[i]||0)>35)s-=20;return clamp(Math.round(s),0,100)})(); return `<button class="week-day" data-day="${i}" type="button"><div class="date">${i===0?"今日 · ":""}${fmtDate(date,true)}</div><div class="wx">${info[1]} ${info[0]}</div><div class="temps">${num(d.temperature_2m_max[i])}° / ${num(d.temperature_2m_min[i])}°</div><div class="sub">雨 ${num(d.precipitation_probability_max[i])}%<br>突風 ${num(d.wind_gusts_10m_max[i])} km/h<br>目安 ${score}/100</div></button>`}).join("");
  $$(".week-day").forEach(b=>b.onclick=()=>{state.day=+b.dataset.day;$("#dayPicker").value=state.day;renderAll();scrollTo({top:0,behavior:"smooth"});});
}
async function loadNearby(){
  if(!state.place)return; const btn=$("#nearbyBtn"), box=$("#nearbyGrid"), msg=$("#nearbyState"); btn.disabled=true;btn.textContent="取得中";msg.textContent="OpenStreetMapから必要な施設だけ検索しています…";box.innerHTML="";
  const {lat,lon}=state.place;
  const q=`[out:json][timeout:20];(nwr(around:8000,${lat},${lon})[amenity=fuel];nwr(around:8000,${lat},${lon})[shop=supermarket];nwr(around:8000,${lat},${lon})[shop=convenience];nwr(around:8000,${lat},${lon})[amenity=hospital];nwr(around:8000,${lat},${lon})[shop=doityourself];nwr(around:8000,${lat},${lon})[natural=hot_spring];nwr(around:8000,${lat},${lon})[leisure=spa];);out center tags;`;
  try{
    const data=await getJSON(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`);
    const arr=(data.elements||[]).map(e=>{const la=e.lat??e.center?.lat,lo=e.lon??e.center?.lon,t=e.tags||{}; let type="その他"; if(t.amenity==="fuel")type="ガソリン";else if(t.shop==="supermarket")type="スーパー";else if(t.shop==="convenience")type="コンビニ";else if(t.amenity==="hospital")type="病院";else if(t.shop==="doityourself")type="ホームセンター";else if(t.natural==="hot_spring"||t.leisure==="spa")type="温泉・入浴"; return {...e,lat:la,lon:lo,type,name:t.name||t["name:ja"]||`${type}（名称不明）`,dist:distanceKm(lat,lon,la,lo)};}).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon)).sort((a,b)=>a.dist-b.dist);
    const best=[]; for(const type of ["スーパー","コンビニ","ガソリン","温泉・入浴","病院","ホームセンター"]){best.push(...arr.filter(x=>x.type===type).slice(0,2));}
    msg.textContent=best.length?`${best.length}件表示（各カテゴリ近い順に最大2件）`:"8km以内に対象施設が見つかりませんでした。";
    box.innerHTML=best.map(x=>`<div class="poi-card"><div class="poi-type">${esc(x.type)}</div><b>${esc(x.name)}</b><small>${x.dist.toFixed(1)} km</small><br><a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${x.lat}&mlon=${x.lon}#map=16/${x.lat}/${x.lon}">地図を開く ↗</a></div>`).join("");
  }catch(e){msg.textContent=`周辺施設を取得できませんでした。公開APIが混雑している可能性があります。 (${e.message})`;}
  finally{btn.disabled=false;btn.textContent="8km以内を取得";}
}
function openSettings(){
  const s=state.settings; $("#capacityInput").value=s.capacity;$("#batteryInput").value=s.battery;$("#loadInput").value=s.load;$("#solarInput").value=s.solar;$("#solarEffInput").value=s.eff;$("#settingsDialog").showModal();
}
function applySettings(){
  state.settings={capacity:+$("#capacityInput").value||768,battery:clamp(+$("#batteryInput").value||0,0,100),load:+$("#loadInput").value||0,solar:+$("#solarInput").value||0,eff:clamp(+$("#solarEffInput").value||70,20,95)};saveSettings(); if(state.weather){renderPower();renderStatus();}
}

$("#searchBtn").onclick=searchPlaces; $("#placeInput").addEventListener("keydown",e=>{if(e.key==="Enter")searchPlaces();}); $("#geoBtn").onclick=useGeolocation; $("#nearbyBtn").onclick=loadNearby; $("#settingsBtn").onclick=openSettings; $("#recalcPower").onclick=renderPower; $("#saveSettingsBtn").onclick=applySettings;
if("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./sw.js").catch(()=>{});
