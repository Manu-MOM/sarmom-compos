/**
 * SAR×MOM Compos — Service Worker
 * Stratégie : network-first pour index.html (pour récupérer les MAJ),
 *             cache-first pour les ressources statiques (icônes, manifest, libs CDN).
 */

// IMPORTANT : changer ce numéro à chaque déploiement pour forcer le rafraîchissement du cache.
const CACHE_VERSION = 'v26';
const CACHE_NAME = 'sarmom-' + CACHE_VERSION;

// Ressources à mettre en cache au premier chargement
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './pwa/icon-192.png',
  './pwa/icon-256.png',
  './pwa/icon-384.png',
  './pwa/icon-512.png',
  './pwa/apple-touch-icon.png',
  './pwa/apple-touch-icon-180.png',
  './pwa/apple-touch-icon-167.png',
  './pwa/apple-touch-icon-152.png',
  './pwa/apple-touch-icon-120.png',
  './pwa/favicon-32.png',
  './pwa/favicon-16.png',
  './pwa/icon-maskable-512.png'
];

// Domaines des libs externes (CDN) qu'on met en cache à la volée
const RUNTIME_CACHE_HOSTS = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

// ─────────────────────────── INSTALL ───────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Pré-cacher les ressources critiques. On utilise add() un par un pour ne
      // pas tout faire échouer si une seule ressource est absente.
      return Promise.all(
        PRECACHE_URLS.map(url => cache.add(url).catch(err => {
          console.warn('[SW] Pré-cache échoué pour', url, err);
        }))
      );
    }).then(() => self.skipWaiting())
  );
});

// ─────────────────────────── ACTIVATE ──────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k.startsWith('sarmom-') && k !== CACHE_NAME)
          .map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// ─────────────────────────── FETCH ─────────────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;
  // On ne traite que les GET HTTP(S)
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // ⚠️ Ne JAMAIS mettre en cache les appels Google APIs (Drive, OAuth)
  // Ces requêtes sont authentifiées et leurs réponses dépendent du token,
  // donc le cache pourrait servir des données obsolètes ou erronées.
  if (url.host.includes('googleapis.com') ||
      url.host.includes('google.com') ||
      url.host.includes('googleusercontent.com') ||
      url.host.includes('accounts.google.com') ||
      url.host.includes('gstatic.com') && url.pathname.includes('accounts')) {
    return; // Laisser passer normalement (network only)
  }

  // index.html / racine : network-first pour récupérer les MAJ rapidement
  const isAppShell = url.origin === self.location.origin &&
    (url.pathname === '/' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'));

  if (isAppShell) {
    event.respondWith(
      fetch(req).then(resp => {
        // Mettre en cache la nouvelle version
        if (resp && resp.ok) {
          const respClone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, respClone));
        }
        return resp;
      }).catch(() => caches.match(req).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  // Ressources externes whitelistées (CDN libs) : cache-first avec fallback réseau
  const isWhitelistedCDN = RUNTIME_CACHE_HOSTS.some(h => url.host.endsWith(h));

  // Ressources locales (pwa/, manifest, icônes) : cache-first
  const isSameOrigin = url.origin === self.location.origin;

  if (isSameOrigin || isWhitelistedCDN) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(resp => {
          if (resp && resp.ok && (resp.type === 'basic' || resp.type === 'cors')) {
            const respClone = resp.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, respClone));
          }
          return resp;
        }).catch(() => cached);
      })
    );
  }
  // Autres : laisser passer normalement (network only)
});

// ─────────────────── MESSAGES (skipWaiting) ────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
