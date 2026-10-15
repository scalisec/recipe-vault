/* Recipe Vault service worker: keeps the app working offline.
   Network first (so updates arrive as soon as you are online), cache as the fallback. */
var CACHE = 'recipe-vault-v2';
var SHELL = [
  './', './index.html', './styles.css', './parser.js', './drive.js', './app.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Google sign-in, Drive, fonts: always the network

  // A shared link opens index.html?url=...; cache and serve the plain page for it.
  var key = (req.mode === 'navigate') ? new Request(new URL('./index.html', self.location).href) : req;

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(key, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(key).then(function (hit) { return hit || caches.match('./index.html'); });
    })
  );
});
