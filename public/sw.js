/*
 * Icons and the offline notice. Nothing else.
 *
 * This used to cache the pages too, so a cold phone opened instantly. The
 * trouble is that a cached page names JavaScript files by content hash, and a
 * deploy replaces every one of them — so the cached page survives, asks for
 * files that no longer exist, and the wall shows a build from last week or a
 * screen that will not load at all. That happened three times.
 *
 * It bought very little to begin with. Everything on the dashboard arrives
 * from /api, which is never cached, so a "working" offline page is an empty
 * frame. The wall's server is on the wall's own machine, where there is no
 * network to lose. So pages now always come from the network, and the only
 * thing kept is what makes it installable and an offline notice that cannot go
 * stale, because it has no build in it.
 */
const CACHE = "household-shell-v3";
const KEEP = [
  "/capture.webmanifest",
  "/dashboard.webmanifest",
  "/icons/capture-192.png",
  "/icons/dashboard-192.png",
];

const OFFLINE = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Household</title>
<style>
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center;
         background: #f7f3ec; color: #241d16; font: 16px/1.5 system-ui, sans-serif; padding: 24px; }
  div { max-width: 22rem; text-align: center; }
  h1 { font-size: 1.3rem; margin: 0 0 .5rem; }
  p { color: #5f544a; margin: 0 0 1.25rem; }
  button { font: inherit; padding: .7rem 1.4rem; border: 0; border-radius: 999px;
           background: #bd5a24; color: #fff; }
</style>
<div>
  <h1>Can&rsquo;t reach home</h1>
  <p>The household display is on the Surface, and this device can&rsquo;t see it right now.</p>
  <button onclick="location.reload()">Try again</button>
</div>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(KEEP))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages are never served from the cache. If the server cannot be reached,
  // say so plainly rather than showing a version of the app that no longer
  // exists.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(OFFLINE, {
            status: 503,
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      ),
    );
    return;
  }

  // Icons are content-addressed by name and change about once a year.
  if (url.pathname.startsWith("/icons/") || url.pathname.endsWith(".webmanifest")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
