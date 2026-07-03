/* EcoInforme — Service Worker
   ---------------------------------------------------------------------------
   Estrategia deliberadamente conservadora para una app clínica:

   1. NETWORK-FIRST para el documento (HTML) y recursos propios: siempre se
      intenta traer la versión más nueva desde la red; el caché es solo el
      respaldo para cuando NO hay conexión. Así, una versión nueva desplegada
      en Vercel se toma apenas hay internet y nunca queda "pegada" una vieja.

   2. Supabase y cualquier origen externo (CDN de html2canvas/jsPDF) NUNCA se
      cachean por el SW: se dejan pasar directo a la red. Los datos de pacientes
      siempre son frescos.

   3. skipWaiting + clients.claim: un SW nuevo reemplaza al viejo de inmediato,
      evitando que quede una versión intermedia sirviendo archivos desactualizados.

   Para forzar una purga de caché al publicar cambios, subí el número de versión.
*/
const VERSION = '2026-07-02-r39';
const CACHE = 'ecoinforme-' + VERSION;

/* Solo se precachean recursos propios y estáticos (íconos, manifest, shell).
   El HTML se cachea en tiempo de ejecución vía network-first. */
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './icon-180.png'
];

self.addEventListener('install', function(event){
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(function(cache){
      /* addAll falla si un solo recurso falla; usamos add individual tolerante */
      return Promise.all(PRECACHE.map(function(url){
        return cache.add(url).catch(function(){ /* ignorar recurso ausente */ });
      }));
    })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        if(k !== CACHE) return caches.delete(k); /* purga versiones viejas */
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event){
  const req = event.request;

  /* Solo GET; el resto (POST/PATCH a Supabase, etc.) pasa directo a la red. */
  if(req.method !== 'GET') return;

  const url = new URL(req.url);

  /* Distinto origen (Supabase, CDNs): no interceptar, siempre red. */
  if(url.origin !== self.location.origin) return;

  /* Extra seguridad: nunca cachear la API REST de Supabase aunque cambie el host. */
  if(url.hostname.indexOf('supabase') !== -1) return;

  /* NETWORK-FIRST: intentamos red; si falla (offline), servimos caché. */
  event.respondWith(
    fetch(req).then(function(res){
      /* Guardamos una copia fresca en caché para uso offline futuro. */
      if(res && res.status === 200 && res.type === 'basic'){
        const copy = res.clone();
        caches.open(CACHE).then(function(cache){ cache.put(req, copy); });
      }
      return res;
    }).catch(function(){
      return caches.match(req).then(function(cached){
        if(cached) return cached;
        /* Fallback de navegación offline: servir el shell. */
        if(req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'Offline' });
      });
    })
  );
});
