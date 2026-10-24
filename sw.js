// Service worker: siempre busca primero la versión nueva en la red y, si no hay conexión,
// sirve la última copia guardada (la web, los estilos, el código y los datos).
const CACHE = 'soloq-crew-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'data/data.json', 'favicon.svg', 'apple-touch-icon.png', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // imágenes de Riot, GitHub…: tal cual
  // La caché se guarda sin "?v=…" / "?t=…" para no acumular copias de cada carga
  const key = new Request(url.origin + url.pathname);
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {});
    }
    return res;
  }).catch(async () => (await caches.match(key)) ?? (req.mode === 'navigate' ? caches.match(new Request(`${url.origin}${url.pathname.replace(/[^/]*$/, '')}`)) : undefined) ?? Response.error()));
});
