const CACHE='camp-window-finder-v6-place-fix';
const APP=['./','./index.html','./assets/icon.svg','./js/app.js','./js/config.js','./js/geocode.js','./js/weather.js','./js/scoring.js','./js/ui.js','./js/utils.js','./manifest.webmanifest'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(APP))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request)));});
