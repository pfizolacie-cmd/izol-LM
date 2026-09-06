// Service worker pre Izol L&M.
//
// Cieľ: appka sa dá spustiť aj bez signálu (v kotolni, v suteréne) a zároveň
// sa nová verzia dostane k ľuďom hneď po nahratí na GitHub - bez toho, aby si
// museli čokoľvek mazať alebo preinštalovať.
//
// Preto dve rôzne stratégie:
//   - samotná appka (HTML): najprv sieť, pri výpadku záloha z cache
//     (inak by ľudia týždne behali na starej verzii)
//   - knižnice z CDN a ikony: najprv cache (sú nemenné, adresa obsahuje verziu)
//   - Firebase/Firestore a AI: NIKDY neukladať - dáta si Firestore rieši sám
//     vlastným offline režimom a odpovede AI nemá zmysel cachovať

const VERZIA = 'izol-v2';
const CACHE_APPKA = 'appka-' + VERZIA;
const CACHE_KNIZNICE = 'kniznice-' + VERZIA;

// Minimum, ktoré musí byť po ruke, aby sa appka offline vôbec otvorila.
const ZAKLAD = [
  './',
  './index.html',
  './manifest.json',
  './ikony/icon-192.png',
  './ikony/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_APPKA)
      // Zámerne po jednom, nie addAll: to je všetko-alebo-nič a jediná adresa,
      // ktorá sa nepodarí, by zhodila celé ukladanie a appka by offline nenabehla.
      .then(c => Promise.all(ZAKLAD.map(u =>
        c.add(new Request(u, { cache: 'reload' }))
          .catch(err => console.warn('[sw] neuložené:', u, err && err.message))
      )))
      .then(() => self.skipWaiting())   // nová verzia nečaká na zatvorenie všetkých kariet
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(k => Promise.all(k.filter(n => !n.endsWith(VERZIA)).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Adresy, ktoré sa nikdy neukladajú do cache.
function nikdyNecachovat(url) {
  return /firestore\.googleapis|firebaseio|identitytoolkit|googleapis\.com\/identitytoolkit|workers\.dev|google-analytics|firebaseinstallations/.test(url);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // zápisy idú vždy rovno na sieť
  const url = req.url;
  if (nikdyNecachovat(url)) return;
  if (!url.startsWith('http')) return;

  const jeKniznica = /cdnjs\.cloudflare\.com|gstatic\.com\/firebasejs/.test(url);

  if (jeKniznica) {
    // Nemenné súbory s verziou v adrese - stačí ich stiahnuť raz.
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        // <script src> z cudzej domény vracia "opaque" odpoveď: status je 0 a res.ok
        // je false, hoci sa stiahla v poriadku. Bez tejto vetvy by sa Firebase SDK
        // nikdy neuložilo a appka by sa offline vôbec nespustila.
        if (res && (res.ok || res.type === 'opaque')) {
          const k = res.clone();
          caches.open(CACHE_KNIZNICE).then(c => c.put(req, k));
        }
        return res;
      }))
    );
    return;
  }

  // Vlastné súbory appky: najprv skús sieť, nech je vždy najnovšia verzia.
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) { const k = res.clone(); caches.open(CACHE_APPKA).then(c => c.put(req, k)); }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
