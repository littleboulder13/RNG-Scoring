const CACHE_NAME = 'rng-scoring-v90';
const urlsToCache = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './js/db.js',
    './js/events.js',
    './js/players.js',
    './js/stages.js',
    './js/ui.js',
    './js/excel.js',
    './js/sync.js',
    './manifest.json',
    './logo.png',
    './icon-192.png',
    './icon-512.png'
];

// Install service worker and cache files
self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(urlsToCache))
    );
});

// Network-first strategy: try network, fall back to cache for offline use
self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // API calls: pass through to network, no caching.
    // MUST call respondWith (not just return) due to iOS WebKit bug
    // where return; without respondWith breaks cross-origin XHR.
    // .catch() prevents respondWith from throwing if the fetch fails.
    if (url.includes('script.google.com') || url.includes('googleusercontent.com')) {
        event.respondWith(
            fetch(event.request.clone())
                .catch(() => new Response(JSON.stringify({ error: 'network' }), {
                    status: 502,
                    headers: { 'Content-Type': 'application/json' }
                }))
        );
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Got a fresh response — update the cache
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                return response;
            })
            .catch(() => {
                // Offline — serve from cache
                return caches.match(event.request)
                    .then((cached) => cached || caches.match('./index.html'));
            })
    );
});

// Update service worker — claim all clients immediately
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});
