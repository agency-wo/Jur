// Service worker — offline app shell + runtime caching for law pages, data, and fonts.
// Strategy:
//   • Precache: hub pages + all 18 law pages + core JS/CSS; law-article JSON (data/*) is
//     added at install from the manifest when the build produced it (no guaranteed-404 entry).
//   • config.js and page navigations: NETWORK-FIRST (fresh content/keys right after a deploy),
//     falling back to cache offline.
//   • CDN OCR libs (cdnjs/jsDelivr): CACHE-FIRST — versioned URLs, so OCR works offline
//     after first use. AI API calls are never cached and just fail gracefully offline.
//   • Everything else same-origin + Google Fonts: stale-while-revalidate.
// Bump VERSION to force a fresh shell + drop old caches on the next visit.
'use strict';

var VERSION = 'v6';
var SHELL = 'shell-' + VERSION;
var RUNTIME = 'runtime-' + VERSION;

// Stable app shell — precached on install (relative URLs resolve against the SW scope,
// so this works under the GitHub project-page base path /Jur/ too).
var SHELL_ASSETS = [
  'index.html', 'ligjet.html', 'mjete-ai.html',
  'site.css', 'site.js', 'ai.js', 'mjete-ai.js', 'style.css', 'app.js',
  'home.js', 'ligjet-search.js', 'ligjet-search-worker.js',
  'manifest.webmanifest', 'icon.svg',
  // the 18 law pages — offline-readable without a prior visit
  'kushtetuta.html', 'kodi-civil.html', 'kodi-penal.html',
  'kodi-procedure-civile.html', 'kodi-procedure-penale.html', 'kodi-familjes.html',
  'kodi-rrugor.html', 'kodi-ajror.html', 'kodi-doganor.html',
  'drejtesia-penale-mitur.html', 'dispozita-zbatuese-kodi-doganor.html',
  'shoqerite-tregtare.html', 'falimentimi.html', 'statusi-gjyqtareve-prokuroreve.html',
  'organizimi-pushtetit-gjyqesor.html', 'organizimi-pushtetit-gjyqesor-v2.html',
  'noteria.html', 'sherbimi-permbarimor.html'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL).then(function (c) {
      // Per-asset add() so one missing file doesn't abort the whole install.
      return Promise.all(SHELL_ASSETS.map(function (u) { return c.add(u).catch(function () {}); }))
        .then(function () {
          // Law-article data exists only when build.py produced it — add what the manifest lists.
          return fetch('data/laws.json').then(function (r) {
            if (!r.ok) return;
            return r.clone().json().then(function (laws) {
              return c.put('data/laws.json', r).then(function () {
                return Promise.all((laws || []).map(function (l) {
                  return c.add('data/' + String(l.file || '').replace(/\.html$/, '.json')).catch(function () {});
                }));
              });
            });
          }).catch(function () {});
        });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== SHELL && k !== RUNTIME) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  var sameOrigin = url.origin === self.location.origin;
  var isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.host);
  var isCdnLib = /(^|\.)(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)$/.test(url.host);
  if (!sameOrigin && !isFont && !isCdnLib) return; // AI APIs etc. → straight to network, never cached.

  // Write the refreshed copy back into whichever cache actually ANSWERS for this request.
  // caches.match() searches SHELL first (it is created first), so a precached asset whose
  // background refresh only ever landed in RUNTIME was served stale forever — a shipped fix
  // could never reach a returning visitor without a VERSION bump. Now the shell self-heals.
  function putCache(res) {
    if (res && (res.status === 200 || res.type === 'opaque')) {
      var copy = res.clone();
      caches.open(SHELL).then(function (sc) {
        return sc.match(req).then(function (inShell) {
          return caches.open(inShell ? SHELL : RUNTIME).then(function (c) { return c.put(req, copy); });
        });
      }).catch(function () {});
    }
    return res;
  }

  // Versioned CDN libraries (pdf.js / tesseract): cache-first — immutable URLs.
  if (isCdnLib) {
    e.respondWith(
      caches.match(req).then(function (cached) {
        return cached || fetch(req).then(putCache).catch(function () { return cached; });
      })
    );
    return;
  }

  // config.js and navigations: network-first so a fresh deploy shows up immediately;
  // cache is only the offline fallback.
  var isConfig = sameOrigin && /\/config\.js$/.test(url.pathname);
  if (isConfig || req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(putCache).catch(function () {
        return caches.match(req).then(function (cached) {
          return cached || (req.mode === 'navigate' ? caches.match('index.html') : Promise.reject(new Error('offline')));
        });
      })
    );
    return;
  }

  // Everything else: stale-while-revalidate — serve cache instantly, refresh in background.
  e.respondWith(
    caches.match(req).then(function (cached) {
      var network = fetch(req).then(putCache).catch(function () { return cached; });
      return cached || network;
    })
  );
});
