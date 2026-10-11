// Service worker: makes the game work offline after the first visit.
// Written to dist/sw.js by the "offline" plugin in vite.config.ts, which fills in VERSION and FILES
// (every file of the build). Map tiles are never stored: their providers do not allow offline
// copies, and the game draws its own plan when tiles cannot load.
const VERSION = "__VERSION__";
const FILES = __FILES__;
const CACHE = `guardian-${VERSION}`;

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
  if (request.mode === "navigate") {
    // The page: newest when online, the stored copy when offline. Query strings (?class=...) share it.
    event.respondWith(
      fetch(request).catch(() => caches.match("./index.html", { cacheName: CACHE }).then((r) => r || Response.error())),
    );
    return;
  }
  // Built files have content hashes and the data pack changes only with a new version: stored first.
  event.respondWith(caches.match(request, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit || fetch(request)));
});
