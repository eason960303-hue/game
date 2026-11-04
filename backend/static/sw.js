// Keeps the app's interface available offline. Only interface files are ever stored:
// anything under /api/ holds someone's private data and always goes to the server.
const SHELL_CACHE = "life-logger-shell-v2";
const NETWORK_WAIT_MS = 3000;
const PAGE_KEY = "/";

// The page's own tags list the files, so a new stylesheet or script needs no change here.
async function storeShell() {
  const page = await fetch(PAGE_KEY, { cache: "no-cache" });
  const html = await page.clone().text();
  const assets = Array.from(
    html.matchAll(/(?:href|src)="((?:css|js|icons)\/[^"]+|manifest\.webmanifest)"/g),
    (match) => `/${match[1]}`,
  );
  const cache = await caches.open(SHELL_CACHE);
  await cache.addAll(assets);
  await cache.put(PAGE_KEY, page);
}

self.addEventListener("install", (event) => {
  event.waitUntil(storeShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((name) => name !== SHELL_CACHE).map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Newest version first, so an update shows on the next open; the stored copy
// covers no signal and a server too slow to wait for.
async function latestOrStored(request, key) {
  const cache = await caches.open(SHELL_CACHE);
  const fromNetwork = fetch(request).then((response) => {
    if (response.ok) cache.put(key, response.clone());
    return response;
  });
  const stored = await cache.match(key);
  if (!stored) return fromNetwork;
  const tooSlow = new Promise((resolve) => {
    setTimeout(() => resolve(stored), NETWORK_WAIT_MS);
  });
  return Promise.race([fromNetwork.catch(() => stored), tooSlow]);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  ) {
    return;
  }
  // Verification and reset links are this same page with a query string.
  const key = request.mode === "navigate" ? PAGE_KEY : url.pathname;
  event.respondWith(latestOrStored(request, key));
});
