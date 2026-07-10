// Service Worker v2.6 — sin caché, no intercepta requests externos
var CACHE_NAME = 'laroca-crm-v2.6';

self.addEventListener('install', function(e) {
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(key) { return caches.delete(key); }));
    }).then(function() { return self.clients.claim(); })
  );
});

// Solo interceptar requests del mismo origen (GitHub Pages), dejar pasar todo lo demás
self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // dejar pasar ngrok, supabase, etc.
  e.respondWith(fetch(e.request));
});
