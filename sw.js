const CACHE='snake-shell-v9';
const SHELL=['./','./index.html','./style.css?v=field-document-1','./frame-guard.js','./app.js?v=field-document-1','./data-service.js','./schedule-import.js','./schedule-metrics.js','./network-diagram.js','./schedule-engine.js','./field-dashboard.js','./field-operations.js','./offline-store.js','./config.js','./snake-site.gif','./manifest.webmanifest','./fonts/ibm-plex-sans-jp-400.woff2','./fonts/ibm-plex-sans-jp-700.woff2','./fonts/ibm-plex-mono-400.woff2','./fonts/ibm-plex-mono-600.woff2','./fonts/shippori-mincho-600.woff2','./vendor/xlsx.full.min.js','./vendor/qrcode.min.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy))}return response}).catch(()=>caches.match(event.request).then(response=>response||caches.match('./index.html'))));
});
