const CACHE_NAME = 'rng-scoring-v48';
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

// Fetch from cache first, then network (skip cache for API calls)
self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // Always go to network for Google Apps Script API calls (including redirects)
    if (url.includes('script.google.com') || url.includes('googleusercontent.com')) {
        // Don't intercept — let the browser handle it natively
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                if (response) {
                    return response;
                }
                return fetch(event.request);
            })
            .catch(() => caches.match('./index.html'))
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
