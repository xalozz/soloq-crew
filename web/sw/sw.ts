/// <reference lib="webworker" />
// Service worker. El código (assets/ con hash en el nombre) no cambia nunca: se sirve de la caché.
// Todo lo demás (la página, los datos, el latido, iconos…) va primero a la red y, sin conexión,
// se sirve la última copia guardada. Cada versión compilada tiene su caché y borra las anteriores,
// así nunca se queda una versión vieja del código.
declare const self: ServiceWorkerGlobalScope;
declare const __VERSION__: string;
declare const __PRECACHE__: string[];

const CACHE = `soloq-crew-${__VERSION__}`;
const ASSETS = new URL('assets/', self.registration.scope).pathname;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.allSettled(__PRECACHE__.map((u) => c.add(new Request(new URL(u, self.registration.scope).href, { cache: 'reload' })))))
    .catch(() => {})
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const store = (key: Request, res: Response) => {
  if (res.ok && res.type === 'basic') {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {});
  }
  return res;
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // imágenes de Riot, GitHub…: tal cual
  // La caché se guarda sin "?t=…" para no acumular copias de cada carga
  const key = new Request(url.origin + url.pathname);
  if (url.pathname.startsWith(ASSETS)) {
    e.respondWith(caches.match(key).then((hit) => hit ?? fetch(req).then((res) => store(key, res))));
    return;
  }
  e.respondWith(fetch(req).then((res) => store(key, res)).catch(async () => (await caches.match(key))
    ?? (req.mode === 'navigate' ? await caches.match(new Request(new URL('./', self.registration.scope).href)) : undefined)
    ?? Response.error()));
});
