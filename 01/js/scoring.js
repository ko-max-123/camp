import { clamp, avg, sum, round, dateKey, hourOf, addDays, parseDateLocal, isoDate } from "./utils.js";

function select(rows, predicate){ return rows.filter(r=>predicate(r, dateKey(r.time), hourOf(r.time))); }
const valid = v => v != null && Number.isFinite(Number(v));
const mean = (rows,key,fallback=0) => {
  const a=rows.map(r=>r[key]).filter(valid).map(Number);
  return a.length ? avg(a) : fallback;
};
const total = (rows,key) => sum(rows.map(r=>Number(r[key]||0)));
const maxv = (rows,key,fallback=0) => {
  const values=rows.map(r=>r[key]).filter(valid).map(Number);
  return values.length ? Math.max(...values) : fallback;
};
const minv = (rows,key,fallback=0) => {
  const values=rows.map(r=>r[key]).filter(valid).map(Number);
  return values.length ? Math.min(...values) : fallback;
};

// 旧版の「一定範囲なら全て100点」をやめ、気象値の差が連続的に指数へ反映されるようにする。
// 100 / (1 + (距離/scale)^2) は中心値から離れるほど滑らかに低下する。
function comfort(value, ideal, scale){
  if(!valid(value)) return 60;
  const d=(Number(value)-ideal)/scale;
  return clamp(100/(1+d*d));
}

function lowIsGood(value, scale){
  if(!valid(value)) return 60;
  const x=Math.max(0,Number(value));
  return clamp(100/(1+(x/scale)**2));
}

function rainAmountScore(mm){
  if(!valid(mm)) return 70;
  // 小雨でもキャンプでは影響するため指数関数で連続評価。
  return clamp(100*Math.exp(-1.15*Math.max(0,Number(mm))));
}

function rainRiskPercent(row){
  if(valid(row.precipitationProbability)) return clamp(Number(row.precipitationProbability),0,100);
  if(row.historicalSpread?.years){
    return clamp((row.historicalSpread.rainyYears/row.historicalSpread.years)*100,0,100);
  }
  return 0;
}

function rainScore(row){
  const amount=rainAmountScore(row.precipitation||0);
  // 実予報では降水確率、過去傾向では「過去何年で雨だったか」も反映。
  const risk=100-rainRiskPercent(row)*0.72;
  return clamp(amount*0.72+risk*0.28);
}

function radiationScore(value){
  if(!valid(value)) return 45;
  const r=Math.max(0,Number(value));
  return clamp(100*(1-Math.exp(-r/180)));
}

function hourlySetup(r){
  const temp=(valid(r.apparentTemperature) ? Number(r.temperature)*0.65+Number(r.apparentTemperature)*0.35 : Number(r.temperature));
  const components={
    rain:rainScore(r),
    temp:comfort(temp,20,8),
    wind:lowIsGood(r.wind,15),
    gust:lowIsGood(r.gust,24),
    humidity:comfort(r.humidity,58,30)
  };
  return components.rain*.31+components.temp*.24+components.wind*.17+components.gust*.20+components.humidity*.08;
}

function hourlyFire(r){
  const temp=(valid(r.apparentTemperature) ? Number(r.temperature)*0.55+Number(r.apparentTemperature)*0.45 : Number(r.temperature));
  const components={
    rain:rainScore(r),
    temp:comfort(temp,15,8),
    wind:lowIsGood(r.wind,9),
    gust:lowIsGood(r.gust,16),
    humidity:comfort(r.humidity,60,30)
  };
  return components.rain*.31+components.temp*.13+components.wind*.20+components.gust*.29+components.humidity*.07;
}

function hourlyNight(r){
  const feels=valid(r.apparentTemperature) ? Number(r.apparentTemperature) : Number(r.temperature);
  const components={
    rain:rainScore(r),
    temp:comfort(feels,12,8),
    humidity:comfort(r.humidity,72,24),
    gust:lowIsGood(r.gust,24)
  };
  return components.rain*.25+components.temp*.38+components.humidity*.25+components.gust*.12;
}

function hourlyPack(r){
  const temp=(valid(r.apparentTemperature) ? Number(r.temperature)*0.7+Number(r.apparentTemperature)*0.3 : Number(r.temperature));
  const components={
    rain:rainScore(r),
    humidity:comfort(r.humidity,58,27),
    radiation:radiationScore(r.radiation),
    wind:comfort(r.wind,7,10),
    temp:comfort(temp,18,9)
  };
  return components.rain*.32+components.humidity*.21+components.radiation*.20+components.wind*.12+components.temp*.15;
}

function aggregateHourly(rows, scorer, safetyKind){
  if(!rows.length) return 0;
  const hourly=rows.map(scorer);
  let base=avg(hourly);

  // 平均だけでは短時間の強風・雨を埋もれさせるため、最悪時間を少し反映する。
  const worst=Math.min(...hourly);
  base=base*.88+worst*.12;

  // キャンプでは突風が行動可否を左右すため、用途別に連続的な安全係数を掛ける。
  const gust=maxv(rows,"gust",0);
  const gustScale=safetyKind==="fire" ? 18 : safetyKind==="setup" ? 28 : 34;
  const gustFactor=0.88+0.12*(lowIsGood(gust,gustScale)/100);

  // 期間中に実際の降水量が積み上がるほど少し追加減点。
  const rainMm=total(rows,"precipitation");
  const rainFactor=0.90+0.10*Math.exp(-rainMm/2.2);

  return clamp(base*gustFactor*rainFactor);
}

function scoreSetup(rows){ return aggregateHourly(rows,hourlySetup,"setup"); }
function scoreFire(rows){ return aggregateHourly(rows,hourlyFire,"fire"); }
function scoreNight(rows){ return aggregateHourly(rows,hourlyNight,"night"); }
function scorePack(rows){ return aggregateHourly(rows,hourlyPack,"pack"); }

function condensationRisk(rows){
  if(!rows.length) return {level:"不明",cls:""};
  const spreads=rows.map(r=>(valid(r.temperature)&&valid(r.dewPoint))?Number(r.temperature)-Number(r.dewPoint):null).filter(valid);
  const spread=avg(spreads) ?? 9;
  const hum=mean(rows,"humidity",70);
  if(hum>=90 || spread<=2) return {level:"高",cls:"risk-high",detail:`平均湿度 ${round(hum)}% / 露点差 ${round(spread,1)}℃`};
  if(hum>=80 || spread<=4) return {level:"中",cls:"risk-mid",detail:`平均湿度 ${round(hum)}% / 露点差 ${round(spread,1)}℃`};
  return {level:"低",cls:"risk-low",detail:`平均湿度 ${round(hum)}% / 露点差 ${round(spread,1)}℃`};
}

function dryingPrediction(rows,lastDate){
  const morning=rows.filter(r=>dateKey(r.time)===lastDate && hourOf(r.time)>=6 && hourOf(r.time)<=11);
  for(let i=0;i<morning.length-1;i++){
    const a=morning[i], b=morning[i+1];
    const ok=x=>(x.precipitation||0)<=.1 && (x.humidity??100)<=80 && (x.radiation??0)>=80;
    if(ok(a)&&ok(b)) return `${String(hourOf(a.time)).padStart(2,"0")}:00ごろ`;
  }
  const possible=morning.find(x=>(x.precipitation||0)<=.1 && (x.humidity??100)<=85 && (x.radiation??0)>=40);
  return possible ? `${String(hourOf(possible.time)).padStart(2,"0")}:00以降` : "11時まで乾きにくい";
}

function rainyTendency(rows){
  const hist = rows.filter(r=>r.historicalSpread);
  if(!hist.length) return null;
  const values=hist.map(r=>r.historicalSpread.years ? r.historicalSpread.rainyYears/r.historicalSpread.years : 0);
  return round(avg(values)*100);
}

export function analyzeWindow(data,startDate,endDate){
  const rows=data.rows;
  const setup=select(rows,(r,d,h)=>d===startDate && h>=13 && h<=16);
  const fire=select(rows,(r,d,h)=>{
    const firstTwo=[startDate,isoDate(addDays(parseDateLocal(startDate),1))];
    return firstTwo.includes(d) && h>=17 && h<=22;
  });
  const night=select(rows,(r,d,h)=>h>=21 || h<=7);
  const pack=select(rows,(r,d,h)=>d===endDate && h>=7 && h<=11);

  // 内部では小数を保持し、表示直前にだけ整数化する。
  const rawScores={
    setup:scoreSetup(setup),
    fire:scoreFire(fire),
    night:scoreNight(night),
    pack:scorePack(pack)
  };
  const rawOverall=rawScores.setup*.30+rawScores.fire*.25+rawScores.night*.20+rawScores.pack*.25;
  const scores={
    setup:round(rawScores.setup),
    fire:round(rawScores.fire),
    night:round(rawScores.night),
    pack:round(rawScores.pack)
  };
  const overall=round(rawOverall);
  const overnight=select(rows,(r,d,h)=>h>=21||h<=7);

  const tempValues=rows.map(r=>r.temperature).filter(valid).map(Number);
  return {
    overall,
    scores,
    // 将来のデバッグや比較用。UIは変更せずJSON出力時に保持可能。
    scorePrecision:{
      overall:round(rawOverall,2),
      setup:round(rawScores.setup,2),
      fire:round(rawScores.fire,2),
      night:round(rawScores.night,2),
      pack:round(rawScores.pack,2)
    },
    condensation:condensationRisk(overnight),
    drying:dryingPrediction(rows,endDate),
    stats:{
      totalRain:round(total(rows,"precipitation"),1),
      maxGust:round(maxv(rows,"gust"),1),
      minTemp:round(tempValues.length?Math.min(...tempValues):0,1),
      maxTemp:round(tempValues.length?Math.max(...tempValues):0,1),
      meanHumidity:round(mean(rows,"humidity",0))
    },
    historicalRainTendency:rainyTendency(rows),
    rows
  };
}

export function weatherLabel(code){
  if(code===0) return "快晴";
  if([1,2].includes(code)) return "晴れ";
  if(code===3) return "曇り";
  if([45,48].includes(code)) return "霧";
  if([51,53,55,56,57].includes(code)) return "霧雨";
  if([61,63,65,66,67,80,81,82].includes(code)) return "雨";
  if([71,73,75,77,85,86].includes(code)) return "雪";
  if([95,96,99].includes(code)) return "雷雨";
  return "変化あり";
}
