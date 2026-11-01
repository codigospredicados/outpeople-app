const CACHE = 'ourpeople-shell-v5';
const SHELL = ['/app/', '/app/styles.css', '/app/app.js', '/app/map.js', '/app/map.css', '/app/street-alerts.js', '/app/leaflet.js', '/app/administrative-layers.js', '/app/vendor/vectorgrid/Leaflet.VectorGrid.bundled.min.js', '/app/vendor/leaflet/leaflet-src.esm.js', '/app/vendor/leaflet/leaflet.css', '/app/vendor/leaflet/images/layers.png', '/app/vendor/leaflet/images/layers-2x.png', '/app/icon.svg', '/app/icon-192.png', '/app/icon-512.png', '/app/manifest.webmanifest'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('ourpeople-shell-') && key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Cache only the static shell; never API responses, personal data or OAuth redirects.
  if (event.request.method !== 'GET' || url.origin !== location.origin || !SHELL.includes(url.pathname) || url.search) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && response.type === 'basic' && !response.redirected) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)));
    }
    return response;
  }).catch(() => caches.match(event.request)));
});
