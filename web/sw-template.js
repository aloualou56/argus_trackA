// Service worker: makes the game work offline after the first visit.
// Written to dist/sw.js by the "offline" plugin in vite.config.ts, which fills in VERSION and FILES
// (every file of the build). Map tiles are never stored: their providers do not allow offline
// copies, and the game draws its own plan when tiles cannot load.
const VERSION = "__VERSION__";
const FILES = __FILES__;
const CACHE = `guardian-${VERSION}`;
// Recorded narration, kept across versions: clip names are hashes of their words, so a kept clip is
// never out of date (its name is not "guardian-..." so a new version does not delete it).
const AUDIO_CACHE = "narration-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("guardian-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return; // tiles, shared store: network only
  // The newest from ARGUS (written by the Pi every 2 hours): network only, never stored, so an
  // old copy is never shown as new; offline, the first screen simply goes without it.
  if (url.pathname.includes("/live/")) return;
  if (request.mode === "navigate") {
    // The page: newest when online, the stored copy when offline. Query strings (?class=...) share it.
    event.respondWith(
      fetch(request).catch(() => caches.match("./index.html", { cacheName: CACHE }).then((r) => r || Response.error())),
    );
    return;
  }
  // Narration: the list of clips is newest-first like the data; a clip is fetched the first time it
  // is played (the game fetches it whole, not in ranges) and then kept for offline use.
  if (url.pathname.includes("/audio/")) {
    if (url.pathname.endsWith("/manifest.json")) {
      event.respondWith(
        fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(AUDIO_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
            }
            return response;
          })
          .catch(() => caches.match(request, { cacheName: AUDIO_CACHE }).then((r) => r || Response.error())),
      );
      return;
    }
    event.respondWith(
      caches.open(AUDIO_CACHE).then((cache) =>
        cache.match(request).then(
          (hit) =>
            hit ||
            fetch(request).then((response) => {
              if (response.status === 200) cache.put(request, response.clone()).catch(() => {});
              return response;
            }),
        ),
      ),
    );
    return;
  }
  // The data pack has no content hash, so it must come with the page that reads it: newest when
  // online (as the page is), the stored copy when offline (as the stored page is).
  if (url.pathname.includes("/data/")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() =>
          caches.match(request, { cacheName: CACHE, ignoreSearch: true }).then((r) => r || Response.error()),
        ),
    );
    return;
  }
  // Built files have content hashes, so a stored copy is never out of date: stored first. (The 3D
  // view's code is not stored up front, vite.config.ts: it comes from the network when opened.)
  event.respondWith(caches.match(request, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit || fetch(request)));
});
