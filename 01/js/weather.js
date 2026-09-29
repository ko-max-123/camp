import { CONFIG } from "./config.js";
import { addDays, isoDate, parseDateLocal, ymdParts, avg, median, round } from "./utils.js";

const cache = new Map();

async function getJson(url, forceRefresh=false){
  const key = url.toString();
  if(!forceRefresh && cache.has(key)) return cache.get(key);
  const res = await fetch(url,{cache:forceRefresh?"no-store":"default"});
  if(!res.ok){
    let msg = `${res.status}`;
    try{ const j=await res.json(); msg=j.reason || msg; }catch{}
    throw new Error(`天気APIエラー: ${msg}`);
  }
  const data = await res.json();
  cache.set(key,data);
  return data;
}

function normalizeHourly(data, historical=false){
  const h = data.hourly || {};
  return (h.time || []).map((time,i)=>({
    time,
    temperature: h.temperature_2m?.[i] ?? null,
    apparentTemperature: h.apparent_temperature?.[i] ?? null,
    humidity: h.relative_humidity_2m?.[i] ?? null,
    dewPoint: h.dew_point_2m?.[i] ?? null,
    precipitation: h.precipitation?.[i] ?? 0,
    precipitationProbability: historical ? null : (h.precipitation_probability?.[i] ?? null),
    weatherCode: h.weather_code?.[i] ?? null,
    wind: h.wind_speed_10m?.[i] ?? null,
    gust: h.wind_gusts_10m?.[i] ?? null,
    radiation: h.shortwave_radiation?.[i] ?? null
  }));
}

export function forecastBoundary(today = new Date()){
  const start = new Date(today);
  start.setHours(12,0,0,0);
  return addDays(start, CONFIG.forecastDays - 1);
}

export function isForecastRange(startDate, endDate, today = new Date()){
  const start = parseDateLocal(startDate), end = parseDateLocal(endDate);
  const t = new Date(today); t.setHours(12,0,0,0);
  return start >= t && end <= forecastBoundary(t);
}

export async function fetchForecast(lat, lon, startDate, endDate, forceRefresh=false){
  const url = new URL(CONFIG.forecastApi);
  url.searchParams.set("latitude",lat);
  url.searchParams.set("longitude",lon);
  url.searchParams.set("hourly",CONFIG.weatherHourly.join(","));
  url.searchParams.set("timezone","auto");
  url.searchParams.set("start_date",startDate);
  url.searchParams.set("end_date",endDate);
  url.searchParams.set("wind_speed_unit","kmh");
  url.searchParams.set("precipitation_unit","mm");
  const data = await getJson(url,forceRefresh);
  return {
    mode:"forecast",
    timezone:data.timezone,
    elevation:data.elevation,
    rows:normalizeHourly(data,false)
  };
}

function historicalEquivalent(startDate, durationDays, year){
  const [,m,d] = ymdParts(startDate);
  const start = new Date(year,m-1,d,12);
  const end = addDays(start,durationDays-1);
  return {start:isoDate(start), end:isoDate(end)};
}

export async function fetchHistoricalTrend(lat, lon, startDate, endDate, years = CONFIG.historicalYears, forceRefresh=false){
  const duration = Math.round((parseDateLocal(endDate)-parseDateLocal(startDate))/86400000)+1;
  const baseYear = new Date().getFullYear();
  const all = [];

  for(let i=1;i<=years;i++){
    const range = historicalEquivalent(startDate,duration,baseYear-i);
    const url = new URL(CONFIG.archiveApi);
    url.searchParams.set("latitude",lat);
    url.searchParams.set("longitude",lon);
    url.searchParams.set("hourly",CONFIG.historicalHourly.join(","));
    url.searchParams.set("timezone","auto");
    url.searchParams.set("start_date",range.start);
    url.searchParams.set("end_date",range.end);
    url.searchParams.set("wind_speed_unit","kmh");
    url.searchParams.set("precipitation_unit","mm");
    const data = await getJson(url,forceRefresh);
    all.push({
      year:baseYear-i,
      timezone:data.timezone,
      elevation:data.elevation,
      rows:normalizeHourly(data,true)
    });
  }

  // Merge same day-offset + hour using medians; precipitation is mean to preserve repeated-rain tendency.
  const buckets = new Map();
  all.forEach(sample=>{
    const sampleStart = parseDateLocal(sample.rows[0].time.slice(0,10));
    sample.rows.forEach(r=>{
      const d = parseDateLocal(r.time.slice(0,10));
      const dayOffset = Math.round((d-sampleStart)/86400000);
      const hour = Number(r.time.slice(11,13));
      const key = `${dayOffset}:${hour}`;
      if(!buckets.has(key)) buckets.set(key,[]);
      buckets.get(key).push(r);
    });
  });

  const targetStart = parseDateLocal(startDate);
  const rows = [];
  for(let day=0;day<duration;day++){
    const targetDate = isoDate(addDays(targetStart,day));
    for(let hour=0;hour<24;hour++){
      const items = buckets.get(`${day}:${hour}`) || [];
      if(!items.length) continue;
      const vals = k => items.map(x=>x[k]).filter(v=>v!=null && Number.isFinite(v));
      rows.push({
        time:`${targetDate}T${String(hour).padStart(2,"0")}:00`,
        temperature:round(median(vals("temperature")),1),
        apparentTemperature:round(median(vals("apparentTemperature")),1),
        humidity:round(median(vals("humidity")),0),
        dewPoint:round(median(vals("dewPoint")),1),
        precipitation:round(avg(vals("precipitation")) || 0,2),
        precipitationProbability:null,
        weatherCode:Math.round(median(vals("weatherCode")) || 0),
        wind:round(median(vals("wind")),1),
        gust:round(median(vals("gust")),1),
        radiation:round(median(vals("radiation")),0),
        historicalSpread:{
          rainyYears:items.filter(x=>(x.precipitation||0) >= 0.2).length,
          years:items.length
        }
      });
    }
  }

  return {
    mode:"historical",
    years:all.map(x=>x.year),
    timezone:all[0]?.timezone || "auto",
    elevation:all[0]?.elevation ?? null,
    rows
  };
}
