export const clamp = (n, min = 0, max = 100) => Math.min(max, Math.max(min, n));
export const round = (n, digits = 0) => {
  const p = 10 ** digits;
  return Math.round((Number(n) + Number.EPSILON) * p) / p;
};
export const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0) / arr.length : null;
export const sum = arr => arr.reduce((a,b)=>a+b,0);
export const median = arr => {
  if (!arr.length) return null;
  const a = [...arr].sort((x,y)=>x-y), m = Math.floor(a.length/2);
  return a.length % 2 ? a[m] : (a[m-1]+a[m])/2;
};
export const pad = n => String(n).padStart(2,"0");
export const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
export const parseDateLocal = s => {
  const [y,m,d] = s.split("-").map(Number);
  return new Date(y,m-1,d,12,0,0,0);
};
export const addDays = (d,n) => {
  const x = new Date(d);
  x.setDate(x.getDate()+n);
  return x;
};
export const daysBetweenInclusive = (a,b) => Math.floor((parseDateLocal(b)-parseDateLocal(a))/86400000)+1;
export const formatMd = s => {
  const d = parseDateLocal(s);
  return `${d.getMonth()+1}/${d.getDate()}`;
};
export const formatDateJa = s => {
  const d = parseDateLocal(s);
  return `${d.getMonth()+1}月${d.getDate()}日`;
};
export const formatRange = (a,b) => `${formatMd(a)}〜${formatMd(b)}`;
export const dateKey = dt => dt.slice(0,10);
export const hourOf = dt => Number(dt.slice(11,13));
export const ymdParts = s => s.split("-").map(Number);
export const sleep = ms => new Promise(r=>setTimeout(r,ms));
export const safeNum = v => Number.isFinite(Number(v)) ? Number(v) : null;

export function grade(score){
  if(score >= 85) return {symbol:"◎", label:"かなり快適", cls:"excellent"};
  if(score >= 70) return {symbol:"○", label:"快適", cls:"good"};
  if(score >= 55) return {symbol:"△", label:"条件付き", cls:"fair"};
  return {symbol:"!", label:"注意", cls:"poor"};
}

export function nextFriday(base = new Date()){
  const d = new Date(base);
  d.setHours(12,0,0,0);
  let delta = (5 - d.getDay() + 7) % 7;
  if(delta === 0) delta = 7;
  d.setDate(d.getDate()+delta);
  return d;
}

export function downloadJson(filename, data){
  const blob = new Blob([JSON.stringify(data,null,2)],{type:"application/json;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url;a.download=filename;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
