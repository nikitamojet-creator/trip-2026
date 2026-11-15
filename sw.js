// Офлайн-режим: страница, библиотеки и карта хранятся на устройстве.
// Свои файлы: сначала сеть (чтобы обновления приходили сразу), без сети или при долгом ответе берём из кэша.
// Библиотеки с CDN (версии зафиксированы): сначала кэш. Тайлы карты: кэш, не больше 800 штук.
const V = 'v1', SHELL = 'shell-' + V;
const CORE = ['./', './index.html', './config.js', './manifest.webmanifest', './icon-192.png'];
const LIB = /(^|\.)(gstatic\.com|unpkg\.com|telegram\.org)$/;
const TILE = /(^|\.)tile\.openstreetmap\.org$/;

self.addEventListener('install', e => e.waitUntil(caches.open(SHELL).then(c => c.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim())));

async function trim(c, max) { const ks = await c.keys(); for (let i = 0; i < ks.length - max; i++) await c.delete(ks[i]); }

self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin === location.origin) {
    if (u.pathname.includes('/__f/')) return;
    const key = r.mode === 'navigate' ? new URL('./index.html', location.href).href : u.origin + u.pathname;
    e.respondWith((async () => {
      const c = await caches.open(SHELL), cached = await c.match(key);
      const net = fetch(r).then(res => { if (res.ok) c.put(key, res.clone()); return res; });
      if (!cached) return net.catch(() => new Response('Нет сети', { status: 503 }));
      // есть копия: ждём сеть не дольше 3 секунд
      return Promise.race([net.catch(() => cached), new Promise(ok => setTimeout(() => ok(cached), 3000))]);
    })());
    return;
  }
  if (LIB.test(u.hostname) || TILE.test(u.hostname)) {
    const name = TILE.test(u.hostname) ? 'tiles' : 'lib';
    e.respondWith((async () => {
      const c = await caches.open(name), m = await c.match(r);
      if (m) return m;
      try { const res = await fetch(r); if (res.ok || res.type === 'opaque') { c.put(r, res.clone()); if (name === 'tiles') trim(c, 800); } return res; }
      catch { return new Response('', { status: 504 }); }
    })());
  }
});
