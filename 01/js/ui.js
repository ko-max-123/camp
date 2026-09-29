import { grade, formatRange, formatDateJa, dateKey, hourOf, round } from './utils.js';
import { weatherLabel } from './scoring.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
const ms = kmh => round((Number(kmh || 0) / 3.6), 1);

function scoreTone(score){
  if(score >= 85) return {text:'text-secondary', bg:'bg-secondary-container', bar:'bg-secondary', symbol:'◎'};
  if(score >= 70) return {text:'text-secondary', bg:'bg-secondary-container', bar:'bg-secondary', symbol:'○'};
  if(score >= 55) return {text:'text-primary', bg:'bg-primary/20', bar:'bg-primary-container', symbol:'△'};
  return {text:'text-error', bg:'bg-error-container', bar:'bg-error', symbol:'!'};
}

function modeBadge(item){
  return item.mode === 'forecast'
    ? '<span class="bg-secondary-container text-secondary font-label-sm text-label-sm px-2 py-0.5 rounded font-bold">実予報</span>'
    : `<span class="bg-surface-container-highest text-on-surface-variant font-label-sm text-label-sm px-2 py-0.5 rounded">過去${item.years?.length || 5}年傾向</span>`;
}

function cautionText(item){
  const a=item.analysis;
  const c=[];
  if(a.stats.maxGust >= 35) c.push(`突風 ${a.stats.maxGust}km/h`);
  if(a.stats.minTemp <= 8) c.push(`最低 ${a.stats.minTemp}℃`);
  if(a.condensation.level === '高') c.push('結露高');
  if(a.stats.totalRain >= 5) c.push(`降水 ${a.stats.totalRain}mm`);
  return c.length ? c.join(' / ') : '大きな注意要因は少なめ';
}

function candidateCard(item,index,bestIndex,selectedIndex){
  const a=item.analysis, g=grade(a.overall), tone=scoreTone(a.overall);
  const isBest=index===bestIndex, isSelected=index===selectedIndex;
  return `<button data-candidate-index="${index}" class="candidate-card text-left bg-surface-container-low rounded-xl p-space-lg shadow-lg ${isBest?'border-2 border-secondary/60':'border border-outline-variant/30'} ${isSelected?'ring-1 ring-primary/70':''} flex flex-col justify-between gap-space-md relative overflow-hidden transition-all hover:bg-surface-container">
    ${isBest?'<div class="absolute -right-8 -top-8 w-32 h-32 bg-secondary/10 rounded-full blur-2xl pointer-events-none"></div>':''}
    <div class="flex items-center justify-between gap-3"><div class="flex items-center gap-space-sm"><span class="${isBest?'bg-secondary-container text-secondary':'bg-surface-container-highest text-outline'} font-label-md text-label-md px-2 py-0.5 rounded font-bold">候補 #${index+1}</span><span class="font-headline-md text-headline-md font-bold text-on-surface">${formatRange(item.start,item.end)}</span></div><span class="${tone.bg} ${tone.text} font-label-sm text-label-sm px-2 py-0.5 rounded font-semibold">${tone.symbol} ${esc(g.label)}</span></div>
    <div class="flex items-center justify-between gap-4 py-2 border-y border-outline-variant/20"><div class="flex items-baseline gap-1"><span class="font-telemetry-xl text-telemetry-xl font-bold ${isBest?'text-secondary':'text-on-surface'}">${a.overall}</span><span class="font-label-md text-label-md text-outline">/100</span></div><div class="flex-1 max-w-xs flex flex-col gap-1"><div class="h-2.5 w-full bg-surface-container-highest rounded-full overflow-hidden"><div class="h-full ${tone.bar} rounded-full" style="width:${a.overall}%"></div></div><div class="flex justify-between font-label-sm text-label-sm text-outline"><span>注意 0</span><span>慎重 55</span><span>好適 70</span><span>100</span></div></div><div class="w-10 h-10 rounded-lg ${isBest?'bg-secondary/20 text-secondary':'bg-surface-container text-primary'} flex items-center justify-center"><span class="material-symbols-outlined text-[20px]">${isBest?'verified':'monitoring'}</span></div></div>
    <div class="grid grid-cols-4 gap-2 text-center">
      ${miniMetric('設営',a.scores.setup,`雨風評価`,scoreTone(a.scores.setup))}
      ${miniMetric('焚き火',a.scores.fire,`突風 ${ms(a.stats.maxGust)}m/s`,scoreTone(a.scores.fire))}
      ${miniMetric('夜快適',a.scores.night,`${a.stats.minTemp}℃ / 結露${a.condensation.level}`,scoreTone(a.scores.night))}
      ${miniMetric('撤収',a.scores.pack,`${a.drying}`,scoreTone(a.scores.pack))}
    </div>
    <div class="flex items-center justify-between text-body-sm text-body-sm bg-surface-container p-2.5 rounded"><span class="text-outline">主な判断材料:</span><span class="${isBest?'text-secondary':'text-on-surface-variant'} font-medium">${esc(cautionText(item))}</span></div>
  </button>`;
}

function miniMetric(label,score,sub,tone){
  return `<div class="bg-surface-container p-2 rounded"><div class="font-label-sm text-label-sm text-outline">${label}</div><div class="font-telemetry-md text-telemetry-md font-bold ${tone.text} mt-0.5">${score}</div><div class="font-label-sm text-label-sm text-on-surface-variant truncate">${esc(sub)}</div></div>`;
}

export function renderComparison(grid,tbody,badge,items,selectedIndex=0){
  if(!items.length) return;
  const bestIndex=items.reduce((best,x,i)=>x.analysis.overall>items[best].analysis.overall?i:best,0);
  grid.innerHTML=items.map((x,i)=>candidateCard(x,i,bestIndex,selectedIndex)).join('');
  badge.classList.remove('hidden');
  badge.textContent=`BEST SCORE: 候補#${bestIndex+1}`;
  tbody.innerHTML=items.map((x,i)=>{
    const a=x.analysis, tone=scoreTone(a.overall);
    return `<tr class="hover:bg-surface-container/40 ${i%2?'bg-surface-container/20':''}"><td class="py-2.5 px-4 font-bold text-on-surface">候補 #${i+1}</td><td class="py-2.5 px-4">${formatRange(x.start,x.end)} ${modeBadge(x)}</td><td class="py-2.5 px-4 ${tone.text} font-bold">${a.overall} / 100</td><td class="py-2.5 px-4">${a.scores.setup}</td><td class="py-2.5 px-4">${a.scores.fire}</td><td class="py-2.5 px-4">${a.scores.night}</td><td class="py-2.5 px-4">${a.scores.pack}</td><td class="py-2.5 px-4 text-on-surface-variant">${esc(cautionText(x))}</td></tr>`;
  }).join('');
  return {bestIndex};
}

function iconForWeather(code){
  if(code===0) return 'sunny';
  if([1,2].includes(code)) return 'partly_cloudy_day';
  if(code===3) return 'cloud';
  if([45,48].includes(code)) return 'foggy';
  if([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code)) return 'rainy';
  if([71,73,75,77,85,86].includes(code)) return 'weather_snowy';
  if([95,96,99].includes(code)) return 'thunderstorm';
  return 'cloud';
}

function activityForHour(h){
  if(h>=13 && h<=16) return {name:'設営重要帯',row:'bg-primary/5 hover:bg-primary/10 border-l-4 border-l-primary',pill:'bg-primary text-on-primary',tone:'text-primary'};
  if(h>=17 && h<=22) return {name:'焚火注意帯',row:'bg-error-container/20 hover:bg-error-container/30 border-l-4 border-l-error',pill:'bg-error text-on-error',tone:'text-error'};
  if(h>=21 || h<=7) return {name:'夜間帯',row:'bg-tertiary/5 hover:bg-tertiary/10 border-l-4 border-l-tertiary',pill:'bg-tertiary text-on-tertiary',tone:'text-tertiary'};
  if(h>=8 && h<=11) return {name:'乾燥・撤収',row:'bg-secondary/5 hover:bg-secondary/10 border-l-4 border-l-secondary',pill:'bg-secondary text-on-secondary',tone:'text-secondary'};
  return {name:'通常',row:'hover:bg-surface-container/60',pill:'bg-surface-variant text-on-surface-variant',tone:'text-on-surface'};
}

function hourAdvice(r){
  const h=hourOf(r.time), a=activityForHour(h), parts=[];
  if((r.precipitation||0)>=1) parts.push('雨対策');
  if((r.gust||0)>=35) parts.push('強風警戒');
  if((r.humidity||0)>=90) parts.push('結露注意');
  if((r.temperature||99)<=8) parts.push('防寒');
  if(!parts.length){
    if(h>=13&&h<=16) parts.push('設営しやすい');
    else if(h>=17&&h<=22) parts.push('焚き火条件確認');
    else if(h>=8&&h<=11) parts.push('乾燥・撤収確認');
    else parts.push('大きな警戒なし');
  }
  return {activity:a, text:parts.join(' / ')};
}

function telemetryRow(r){
  const h=hourOf(r.time), adv=hourAdvice(r), dewDiff=round((r.temperature??0)-(r.dewPoint??0),1);
  return `<tr class="${adv.activity.row} transition-colors"><td class="py-3 px-3.5 font-bold text-on-surface"><div class="flex items-center gap-2"><span>${String(h).padStart(2,'0')}:00</span><span class="${adv.activity.pill} font-label-sm text-label-sm px-1.5 py-0.5 rounded font-bold">${adv.activity.name}</span></div></td><td class="py-3 px-3.5"><div class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-[20px]">${iconForWeather(r.weatherCode)}</span><span class="text-on-surface font-semibold">${weatherLabel(r.weatherCode)}</span></div></td><td class="py-3 px-3.5 text-on-surface font-semibold">${round(r.temperature,1)}℃ <span class="text-outline text-label-sm font-label-sm font-normal">(体感 ${round(r.apparentTemperature,1)}℃)</span></td><td class="py-3 px-3.5 text-on-surface-variant">${round(r.precipitation,1)} mm/h</td><td class="py-3 px-3.5 text-secondary font-semibold">${ms(r.wind)} m/s</td><td class="py-3 px-3.5 ${(r.gust||0)>=35?'text-error font-bold':'text-on-surface'}">${ms(r.gust)} m/s</td><td class="py-3 px-3.5 text-on-surface-variant">${round(r.humidity)}% / 露点差 ${dewDiff}℃</td><td class="py-3 px-3.5 text-center"><span class="bg-surface-container-highest ${adv.activity.tone} font-label-sm text-label-sm px-2.5 py-1 rounded-full font-bold">${esc(adv.text)}</span></td></tr>`;
}

function detailActivityCard(icon,title,score,note,sub){
  const tone=scoreTone(score);
  return `<div class="bg-surface-container rounded-lg p-space-md flex flex-col justify-between space-y-space-md"><div class="space-y-space-xs"><div class="flex items-center justify-between"><span class="font-headline-sm text-headline-sm text-on-surface font-semibold flex items-center gap-1.5"><span class="material-symbols-outlined text-primary text-[20px]">${icon}</span>${title}</span><span class="font-telemetry-md text-telemetry-md font-bold ${tone.text}">${score}</span></div><div class="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden"><div class="h-full ${tone.bar} rounded-full" style="width:${score}%"></div></div><p class="font-body-sm text-body-sm text-outline leading-tight pt-1">${note}</p></div><div class="bg-surface-container-low p-2 rounded flex items-center justify-between font-label-sm text-label-sm text-on-surface-variant"><span>${sub}</span></div></div>`;
}

export function renderDetail(container,item,index){
  const a=item.analysis,g=grade(a.overall),tone=scoreTone(a.overall);
  const days=[...new Set(a.rows.map(r=>dateKey(r.time)))];
  const firstDay=days[0];
  container.innerHTML=`
    <div class="flex flex-wrap items-center justify-between gap-space-md pb-space-md"><div class="flex flex-col gap-1"><div class="flex items-center gap-space-sm"><span class="font-headline-md text-headline-md font-bold text-on-surface tracking-tight">#${index+1} ${formatRange(item.start,item.end)}</span>${modeBadge(item)}</div><p class="font-body-sm text-body-sm text-outline">${item.mode==='forecast'?'現在の時間別予報から評価':'過去 '+(item.years||[]).join(' / ')+' 年の同時期を集約した参考評価'}</p></div><div class="flex items-baseline gap-2"><span class="font-telemetry-xl text-telemetry-xl font-bold ${tone.text}">${a.overall}</span><span class="font-headline-sm text-headline-sm text-outline">/100</span><span class="${tone.text} font-headline-sm text-headline-sm font-semibold ml-2">・ ${tone.symbol} ${esc(g.label)}</span></div></div>
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-space-md">
      ${detailActivityCard('hardware','設営しやすさ',a.scores.setup,'初日13–16時。雨・風・突風・暑さ寒さを重視。',`期間最大突風 ${ms(a.stats.maxGust)}m/s`)}
      ${detailActivityCard('local_fire_department','焚き火',a.scores.fire,'17–22時。雨と風・突風を強めに減点。',`降水合計 ${a.stats.totalRain}mm`)}
      ${detailActivityCard('bedtime','夜の快適性',a.scores.night,'21–翌7時。最低気温・湿度・降水を評価。',`最低 ${a.stats.minTemp}℃ / 結露 ${a.condensation.level}`)}
      ${detailActivityCard('inventory_2','撤収',a.scores.pack,'最終日7–11時。降水・湿度・乾燥条件を評価。',`乾燥 ${a.drying}`)}
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-space-md pt-space-xs">
      <div class="bg-surface-container rounded-xl p-space-lg flex flex-col justify-between gap-space-md shadow-sm"><div class="flex items-center justify-between"><div class="flex items-center gap-2"><span class="material-symbols-outlined text-tertiary text-[20px]">water_drop</span><span class="font-body-md text-body-md text-on-surface-variant">結露リスク</span></div><span class="bg-primary/20 text-primary font-label-md text-label-md px-2 py-0.5 rounded font-bold">${a.condensation.level}</span></div><div><span class="font-headline-sm text-headline-sm text-on-surface font-semibold">${esc(a.condensation.detail)}</span><p class="font-body-sm text-body-sm text-outline mt-1">湿度と気温・露点差から算出した簡易リスクです。</p></div></div>
      <div class="bg-surface-container rounded-xl p-space-lg flex flex-col justify-between gap-space-md shadow-sm"><div class="flex items-center justify-between"><div class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-[20px]">wb_sunny</span><span class="font-body-md text-body-md text-on-surface-variant">テント乾燥開始目安</span></div><span class="bg-secondary-container text-secondary font-label-md text-label-md px-2 py-0.5 rounded font-bold">${esc(a.drying)}</span></div><div><span class="font-body-sm text-body-sm text-on-surface">降水・湿度・日射を使った簡易目安です。</span><p class="font-body-sm text-body-sm text-outline mt-1">サイトの日陰・樹林・地面状態によって実際の乾燥は変わります。</p></div></div>
      <div class="bg-surface-container rounded-xl p-space-lg flex flex-col justify-between gap-space-md shadow-sm"><div class="flex items-center justify-between"><div class="flex items-center gap-2"><span class="material-symbols-outlined text-outline text-[20px]">analytics</span><span class="font-body-md text-body-md text-on-surface-variant">期間サマリー</span></div><span class="font-label-sm text-label-sm text-outline bg-surface-container-highest px-2 py-0.5 rounded">STATISTICS</span></div><div><span class="font-telemetry-md text-telemetry-md text-on-surface font-semibold">${a.stats.minTemp}〜${a.stats.maxTemp}℃ / 突風最大 ${a.stats.maxGust}km/h</span><p class="font-body-sm text-body-sm text-outline mt-1">期間降水 ${a.stats.totalRain}mm / 平均湿度 ${a.stats.meanHumidity}%</p></div></div>
    </div>
    <div class="pt-space-sm"><div class="w-full bg-surface-container py-3.5 px-space-lg rounded-t-xl flex items-center justify-between text-on-surface border-b border-outline-variant/30"><div class="flex items-center gap-space-sm"><span class="material-symbols-outlined text-primary">schedule</span><span class="font-headline-sm text-headline-sm font-bold tracking-tight">時間別詳細キャンプ気象テレメトリー</span><span class="bg-surface-container-highest text-secondary font-label-sm text-label-sm px-2 py-0.5 rounded font-bold">時間別データ</span></div><span class="font-label-sm text-label-sm text-outline">Open-Meteo</span></div>
      <div class="bg-surface-container-low p-space-md rounded-b-xl border border-t-0 border-outline-variant/30 space-y-space-md">
        <div class="flex flex-wrap items-center justify-between gap-space-md"><div id="detailDayButtons" class="flex items-center gap-2 overflow-x-auto pb-1">${days.map((d,i)=>`<button data-day="${d}" class="detail-day-btn ${i===0?'bg-primary text-on-primary font-semibold':'bg-surface-container hover:bg-surface-container-high text-on-surface-variant'} font-headline-sm text-headline-sm px-4 py-2 rounded-lg shrink-0 transition-colors">${i+1}日目: ${formatDateJa(d)}</button>`).join('')}</div><div class="flex items-center gap-3 text-label-sm font-label-sm"><span class="flex items-center gap-1.5 text-primary">設営</span><span class="flex items-center gap-1.5 text-error">焚火</span><span class="flex items-center gap-1.5 text-tertiary">夜間</span><span class="flex items-center gap-1.5 text-secondary">撤収</span></div></div>
        <div class="overflow-x-auto rounded-xl bg-surface-container-lowest border border-outline-variant/30"><table class="w-full text-left font-body-sm text-body-sm min-w-[980px]"><thead class="bg-surface-container text-outline font-label-sm text-label-sm tracking-wider uppercase"><tr><th class="py-3 px-3.5">時間 (JST) / 帯域</th><th class="py-3 px-3.5">気象</th><th class="py-3 px-3.5">気温 / 体感</th><th class="py-3 px-3.5">降水量</th><th class="py-3 px-3.5">平均風速</th><th class="py-3 px-3.5">最大突風</th><th class="py-3 px-3.5">湿度 / 露点差</th><th class="py-3 px-3.5 text-center">キャンプ活動指標</th></tr></thead><tbody id="telemetryBody" class="divide-y divide-transparent font-label-md text-label-md"></tbody></table></div>
        <div class="bg-surface-container p-space-md rounded-lg flex items-start gap-space-md"><span class="material-symbols-outlined text-primary text-[22px] shrink-0 mt-0.5">tips_and_updates</span><div><span class="font-headline-sm text-headline-sm text-on-surface font-semibold">Camp Window 分析メモ</span><p class="font-body-sm text-body-sm text-on-surface-variant leading-relaxed mt-1">${esc(buildMemo(item))}</p></div></div>
      </div>
    </div>`;
  bindDayButtons(container,item,firstDay);
}

function bindDayButtons(container,item,day){
  const body=container.querySelector('#telemetryBody');
  const renderDay=d=>{
    const desired=new Set([0,3,6,7,9,12,13,15,17,18,21]);
    let rows=item.analysis.rows.filter(r=>dateKey(r.time)===d && desired.has(hourOf(r.time)));
    if(!rows.length) rows=item.analysis.rows.filter(r=>dateKey(r.time)===d);
    body.innerHTML=rows.map(telemetryRow).join('') || '<tr><td colspan="8" class="py-8 text-center text-outline">データがありません。</td></tr>';
    container.querySelectorAll('.detail-day-btn').forEach(btn=>{
      const active=btn.dataset.day===d;
      btn.className=`detail-day-btn ${active?'bg-primary text-on-primary font-semibold':'bg-surface-container hover:bg-surface-container-high text-on-surface-variant'} font-headline-sm text-headline-sm px-4 py-2 rounded-lg shrink-0 transition-colors`;
    });
  };
  container.querySelectorAll('.detail-day-btn').forEach(btn=>btn.addEventListener('click',()=>renderDay(btn.dataset.day)));
  renderDay(day);
}

function buildMemo(item){
  const a=item.analysis, parts=[];
  if(a.stats.maxGust>=35) parts.push(`最大突風 ${a.stats.maxGust}km/h が見込まれるため、設営・焚き火時は風対策を優先。`);
  else parts.push('強風リスクは比較的低めです。');
  if(a.stats.minTemp<=8) parts.push(`最低気温は ${a.stats.minTemp}℃。就寝時の防寒装備を厚めに。`);
  if(a.condensation.level==='高') parts.push('夜間の結露リスクが高いため、換気と朝の拭き取りを想定。');
  parts.push(`撤収時の乾燥開始目安は ${a.drying}。`);
  return parts.join(' ');
}

export function renderProfile(profileMetrics,gearBox,item){
  const a=item.analysis;
  profileMetrics.innerHTML=`<div class="bg-surface-container p-space-md rounded-lg"><div class="font-label-sm text-label-sm text-outline">最低 / 最高気温</div><div class="font-headline-sm text-headline-sm font-bold text-on-surface mt-1">${a.stats.minTemp}℃ / ${a.stats.maxTemp}℃</div><div class="font-body-sm text-body-sm text-secondary mt-0.5">夜間防寒の目安</div></div><div class="bg-surface-container p-space-md rounded-lg"><div class="font-label-sm text-label-sm text-outline">最大突風</div><div class="font-headline-sm text-headline-sm font-bold text-primary mt-1">${a.stats.maxGust} km/h (${ms(a.stats.maxGust)}m/s)</div><div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">ペグ・張綱・焚き火判断に使用</div></div><div class="bg-surface-container p-space-md rounded-lg"><div class="font-label-sm text-label-sm text-outline">テント乾燥開始目安</div><div class="font-headline-sm text-headline-sm font-bold text-tertiary mt-1">${esc(a.drying)}</div><div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">日射・湿度・降水から推定</div></div>`;
  const recs=[];
  if(a.stats.maxGust>=35) recs.push(['shield','text-secondary','風対策','長めのペグ・張綱を再確認','重要']);
  else recs.push(['shield','text-secondary','設営固定','通常の張綱・ペグ確認','確認']);
  if(a.stats.minTemp<=8) recs.push(['thermostat','text-tertiary','防寒装備',`最低 ${a.stats.minTemp}℃ を想定した寝具`,'推奨']);
  else recs.push(['thermostat','text-tertiary','夜間装備',`最低 ${a.stats.minTemp}℃ を基準に調整`,'確認']);
  if(a.condensation.level==='高') recs.push(['dry_cleaning','text-primary','結露・朝露対策','吸水タオル / 換気 / 乾燥時間確保','推奨']);
  else recs.push(['wb_sunny','text-primary','撤収乾燥',`乾燥開始 ${a.drying}`,'確認']);
  gearBox.innerHTML=recs.map(([icon,color,title,sub,badge])=>`<div class="bg-surface-container p-3 rounded-lg flex items-center justify-between"><div class="flex items-center gap-2"><span class="material-symbols-outlined ${color} text-[20px]">${icon}</span><div class="flex flex-col"><span class="font-body-sm text-body-sm text-on-surface font-semibold">${title}</span><span class="font-label-sm text-label-sm text-outline">${sub}</span></div></div><span class="${color} font-label-sm text-label-sm font-bold">${badge}</span></div>`).join('');
}

export function copySummaryText(place,items){
  const lines=[`Camp Window Finder - ${place.name}`,`位置: ${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}`,''];
  items.forEach((x,i)=>{const a=x.analysis,g=grade(a.overall); lines.push(`#${i+1} ${formatRange(x.start,x.end)} ${a.overall}/100 ${g.symbol} ${g.label}`);lines.push(`設営 ${a.scores.setup} / 焚き火 ${a.scores.fire} / 夜 ${a.scores.night} / 撤収 ${a.scores.pack}`);lines.push(`気温 ${a.stats.minTemp}〜${a.stats.maxTemp}℃ / 降水 ${a.stats.totalRain}mm / 最大突風 ${a.stats.maxGust}km/h / 結露 ${a.condensation.level}`,'');});
  return lines.join('\n');
}
