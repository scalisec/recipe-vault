/* Recipe Vault service worker: keeps the app working offline.
   Network first (so updates arrive as soon as you are online), cache as the fallback. */
var CACHE = 'recipe-vault-v3';
var SHARE_CACHE = 'rv-share'; // screenshots shared to the app wait here until the page picks them up
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
      return Promise.all(keys.filter(function (k) { return k !== CACHE && k !== SHARE_CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Android's Share menu posts links and screenshots here. Keep the images, then open the Add screen.
function receiveShare(req) {
  return req.formData().then(function (fd) {
    var files = fd.getAll('shots').filter(function (f) { return f && typeof f === 'object' && f.size; });
    return caches.open(SHARE_CACHE).then(function (c) {
      return c.keys().then(function (old) { return Promise.all(old.map(function (k) { return c.delete(k); })); }).then(function () {
        return Promise.all(files.map(function (f, i) {
          var key = new URL('./shared/' + i, self.registration.scope).href;
          return c.put(key, new Response(f, { headers: { 'content-type': f.type || 'image/png', 'x-name': encodeURIComponent(f.name || ('shot' + i + '.png')) } }));
        }));
      });
    }).then(function () {
      var q = new URLSearchParams();
      ['title', 'text', 'url'].forEach(function (k) { var v = fd.get(k); if (typeof v === 'string' && v) q.set(k, v); });
      if (files.length) q.set('shots', String(files.length));
      var qs = q.toString();
      return Response.redirect(new URL('./index.html' + (qs ? '?' + qs : '') + '#/add', self.registration.scope).href, 303);
    });
  }).catch(function () {
    return Response.redirect(new URL('./index.html#/add', self.registration.scope).href, 303);
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method === 'POST' && /\/share-target$/.test(new URL(req.url).pathname)) { e.respondWith(receiveShare(req)); return; }
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
