/*
 * Service worker: guarda la aplicación (HTML, JavaScript, estilos, fuentes,
 * íconos) para que se pueda abrir sin conexión en las veredas. NUNCA guarda
 * respuestas de la API (/api): los datos de la campaña no quedan en esta caché.
 *
 * - Páginas: primero la red; sin conexión, la última versión guardada.
 * - Archivos de /assets (llevan un hash en el nombre y no cambian): de la caché.
 */
const CACHE = 'campana-app-v1';
const FIJOS = ['/favicon.svg', '/manifest.webmanifest', '/icono-192.png', '/icono-512.png'];

async function precargar() {
  const cache = await caches.open(CACHE);
  const respuesta = await fetch('/index.html', { cache: 'no-store' });
  const html = await respuesta.clone().text();
  await cache.put('/index.html', respuesta);
  // Los archivos que index.html necesita para arrancar.
  const archivos = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  await cache.addAll([...FIJOS, ...new Set(archivos)]);
}

self.addEventListener('install', (evento) => {
  evento.waitUntil(precargar().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

function guardarCopia(pedido, respuesta) {
  if (respuesta.ok) {
    const copia = respuesta.clone();
    caches.open(CACHE).then((cache) => cache.put(pedido, copia));
  }
  return respuesta;
}

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;
  const url = new URL(pedido.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (pedido.mode === 'navigate') {
    evento.respondWith(
      fetch(pedido)
        .then((respuesta) => guardarCopia('/index.html', respuesta))
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || FIJOS.includes(url.pathname)) {
    evento.respondWith(caches.match(pedido).then((guardada) => guardada || fetch(pedido).then((respuesta) => guardarCopia(pedido, respuesta))));
  }
});
