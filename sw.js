/* Service worker — caches the app shell & frames so the booth loads instantly.
 * Bump VERSION whenever you change files on GitHub so devices pick up the update. */
const VERSION = 'spooky-booth-v8';
const SHELL = [
  './', 'index.html', 'download.html', 'styles.css', 'app.js', 'config.js', 'manifest.webmanifest',
  'frames/frame1.png', 'frames/frame2.png', 'frames/frame1-thumb.jpg', 'frames/frame2-thumb.jpg',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Never cache the backend (PINs, AI images, photos).
  if (/script\.google(usercontent)?\.com$/.test(url.hostname)) return;

  // Same-origin: network-first for HTML/JS/CSS (fresh updates), cache-first for images.
  if (url.origin === location.origin) {
    const isAsset = /\.(png|jpg|jpeg|webp|svg)$/i.test(url.pathname);
    if (isAsset) {
      e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => put(e.request, res))));
    } else {
      e.respondWith(fetch(e.request).then(res => put(e.request, res)).catch(() => caches.match(e.request, { ignoreSearch: true })));
    }
    return;
  }
  // Fonts & QR library from CDNs: stale-while-revalidate.
  if (/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com/.test(url.hostname)) {
    e.respondWith(caches.match(e.request).then(hit => {
      const net = fetch(e.request).then(res => put(e.request, res)).catch(() => hit);
      return hit || net;
    }));
  }
});

function put(req, res) {
  if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
  return res;
}
