/* sw.js — 将棋AIと対局（アプリ化）の service worker。tools/build_pwa.js が書く（手で直さない。設計 §14）。
 * 一式（ASSETS）を版の名前つきの cache に入れ、ネットにつながっていなくても開けるようにする。
 * 版（VERSION）は一式の中身から決まる。公開を更新すると sw.js も変わり、ブラウザが新しい版を取り込む：
 *   install  新しい版の cache に一式を取り直して入れ、待たずに入れ替わる（skipWaiting）
 *   activate 古い版の cache を消し、開いているページを引き受ける（ページの側は1回だけ読み直す）
 *   fetch    一式の中の物は cache から返す（ページを開くとき・アイコンなど）。無い物だけネットへ。
 *            どちらの応答にも COOP・COEP の見出しを付け直す（クロスオリジン分離。並列の読みのため） */
'use strict';
const VERSION = "d33ea2f1e8a0";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

const PREFIX = 'shogi-ai-';
const CACHE = PREFIX + VERSION;

// クロスオリジン分離（設計 §15）：自分のページへの応答に COOP・COEP の見出しを付け直す（GitHub Pages では付けられないため）。
// 分離されたページでは SharedArrayBuffer が使え、AI が複数の Worker で並列に読む。中身は変えない。
const COI = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
function withCoi(res) {
  if (!res || res.type === 'opaque' || res.type === 'opaqueredirect' || !(res.status >= 200 && res.status <= 599)) return res;
  const headers = new Headers(res.headers);
  for (const k of Object.keys(COI)) headers.set(k, COI[k]);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// 取り直すときは HTTP の cache を通さない（古い版を新しい版の名前で入れないため）。
// 転送（redirect）を経た応答は、ページを開く応答に使えないので中身だけの応答に作り直す。
async function fetchFresh(url) {
  const res = await fetch(new Request(url, { cache: 'reload' }));
  if (!res.ok) throw new Error(url + ' を取れませんでした（' + res.status + '）');
  if (!res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

// './'（開くときの URL）と './index.html' は同じページ（大きい）。取るのは1回だけにして、両方の鍵で入れる
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const got = await Promise.all(ASSETS.filter((u) => u !== './').map(async (url) => [url, await fetchFresh(url)]));
    for (const [url, res] of got) {
      if (url === './index.html') await cache.put('./', res.clone());
      await cache.put(url, res);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const scope = new URL((self.registration && self.registration.scope) || './', self.location.href);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const rest = url.pathname.slice(scope.pathname.length);
  const isPage = req.mode === 'navigate' && (rest === '' || rest === 'index.html');
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = isPage
      ? (await cache.match('./')) || (await cache.match('./index.html'))
      : await cache.match(req, { ignoreSearch: true });
    return withCoi(hit || (await fetch(req)));
  })());
});
