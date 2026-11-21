/* =============================================================
 * TradeDocs Service Worker — 离线缓存
 * 策略：
 *   1) 应用外壳（HTML/CSS/JS/图标/manifest）预缓存，离线秒开
 *   2) 导航请求：network-first 回退缓存（保证拿到最新版又能离线）
 *   3) 静态资源：cache-first
 *   4) 绝不缓存任何业务数据（业务数据在 IndexedDB 本机）
 * ============================================================= */

/**
 * ⚠️ 改版本号时必须同步改 VERSION，否则老用户升级后**会一直用旧缓存**。
 *
 * 原理：浏览器只在 sw.js 的**字节内容**变化时才安装新的 Service Worker。
 * 如果代码更新了但 VERSION 字符串没动、sw.js 又有可能被浏览器判定为"没变化"，
 * 旧的 SW 会继续用 cache-first 吐旧文件 —— 表现就是"更新了版本但界面还是老的"。
 * 这里让 VERSION 跟 package.json 版本对齐（1.1.0 对应 tradedocs-v5.0.0）。
 */
const VERSION = 'tradedocs-1.10.9';
const SHELL_CACHE = `${VERSION}-shell`;

/** 应用外壳资源（相对路径，兼容子目录部署） */
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/shot-wide.png',
  './js/app.js',
  './js/core/util.js',
  './js/core/db.js',
  './js/core/i18n.js',
  './js/core/templates.js',
  './js/core/templates-intl.js',
  './js/core/schema.js',
  './js/core/sample.js',
  './js/core/calc.js',
  './js/core/store.js',
  './js/core/validate.js',
  './js/ui/toast.js',
  './js/ui/modal.js',
  './js/ui/toolbox.js',
  './js/ui/form.js',
  './js/doc/render.js',
  './js/doc/pdf.js',
  './js/doc/export.js',
  './js/doc/docx.js',
  './js/doc/zip.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // 单个资源失败不阻塞整体安装
      await Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      if (self.registration.navigationPreload) {
        try { await self.registration.navigationPreload.disable(); } catch { /* 忽略 */ }
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 跨域一律不接管

  // 导航请求：network-first
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(SHELL_CACHE);
          cache.put('./index.html', fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (
            (await cache.match(req)) ||
            (await cache.match('./index.html')) ||
            (await cache.match('./')) ||
            new Response('离线且无缓存', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
          );
        }
      })()
    );
    return;
  }

  // 静态资源：cache-first，后台更新
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) {
        fetch(req)
          .then((res) => { if (res && res.ok) cache.put(req, res.clone()); })
          .catch(() => null);
        return cached;
      }
      try {
        const res = await fetch(req);
        if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      } catch {
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })()
  );
});
