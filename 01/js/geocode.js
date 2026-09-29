import { CONFIG } from "./config.js";
import { sleep } from "./utils.js";

const CACHE_KEY = "cwf.geocode.v1";
let lastRequestAt = 0;

function getCache(){
  try{return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}")}catch{return {}}
}
function setCache(cache){
  try{localStorage.setItem(CACHE_KEY,JSON.stringify(cache))}catch{}
}

export async function searchPlace(query){
  const q = query.trim();
  if(!q) throw new Error("キャンプ場名を入力してください。");

  const cache = getCache();
  const key = q.toLowerCase();
  if(cache[key]?.length) return cache[key];

  // Public Nominatim policy: explicit user-triggered search only, <=1 request/sec, cache results.
  const wait = Math.max(0, 1100 - (Date.now() - lastRequestAt));
  if(wait) await sleep(wait);

  const url = new URL(CONFIG.geocode.nominatim);
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "6");
  url.searchParams.set("countrycodes", "jp");
  url.searchParams.set("accept-language", "ja");
  url.searchParams.set("addressdetails", "1");

  let results = [];
  try{
    lastRequestAt = Date.now();
    const res = await fetch(url);
    if(!res.ok) throw new Error(`Nominatim ${res.status}`);
    const data = await res.json();
    results = data.map(x=>({
      name: x.name || q,
      displayName: x.display_name || x.name || q,
      lat: Number(x.lat),
      lon: Number(x.lon),
      source: "OpenStreetMap"
    }));
  }catch(err){
    console.warn("Nominatim search failed; fallback to Open-Meteo geocoding.", err);
  }

  if(!results.length){
    const fallback = new URL(CONFIG.geocode.openMeteo);
    fallback.searchParams.set("name", q);
    fallback.searchParams.set("count","6");
    fallback.searchParams.set("language","ja");
    fallback.searchParams.set("countryCode","JP");
    const res = await fetch(fallback);
    if(res.ok){
      const data = await res.json();
      results = (data.results || []).map(x=>({
        name:x.name,
        displayName:[x.name,x.admin2,x.admin1,x.country].filter(Boolean).join(", "),
        lat:Number(x.latitude),
        lon:Number(x.longitude),
        source:"Open-Meteo GeoNames"
      }));
    }
  }

  cache[key] = results;
  setCache(cache);
  return results;
}
