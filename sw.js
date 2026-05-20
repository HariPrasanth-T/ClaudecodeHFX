/* HSE Tracker Service Worker */
const CACHE = 'hse-tracker-v1';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(req, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

/* Periodic background expiry checks (when supported via Periodic Background Sync) */
self.addEventListener('periodicsync', event => {
  if (event.tag === 'expiry-check') {
    event.waitUntil(checkExpiriesAndNotify());
  }
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'CHECK_EXPIRIES') {
    event.waitUntil(checkExpiriesAndNotify());
  }
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag, data } = event.data;
    self.registration.showNotification(title, { body, tag, data, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' });
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) return c.focus(); }
    if (clients.openWindow) return clients.openWindow('./index.html#alerts');
  })());
});

async function checkExpiriesAndNotify() {
  /* Service worker cannot directly access IndexedDB data with all the same APIs.
     We open the same DB and read minimal records. */
  try {
    const db = await openDB();
    const items = await readAll(db, 'expiryIndex');
    const now = Date.now();
    const thresholds = [45, 30, 15, 10, 5, 3, 1, 0];
    for (const it of items) {
      if (!it.expiry) continue;
      const daysLeft = Math.ceil((new Date(it.expiry).getTime() - now) / (1000*60*60*24));
      if (thresholds.includes(daysLeft)) {
        const alreadyKey = `${it.id}:${daysLeft}`;
        const fired = await get(db, 'firedAlerts', alreadyKey);
        if (!fired) {
          self.registration.showNotification(
            daysLeft <= 0 ? 'Expired: ' + it.title : `Expires in ${daysLeft} day${daysLeft===1?'':'s'}: ` + it.title,
            { body: it.subtitle || '', tag: alreadyKey, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' }
          );
          await put(db, 'firedAlerts', { key: alreadyKey, t: Date.now() });
        }
      }
    }
  } catch (e) {
    /* ignore */
  }
}

function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('hse-tracker', 1);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('expiryIndex')) db.createObjectStore('expiryIndex', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('firedAlerts')) db.createObjectStore('firedAlerts', { keyPath: 'key' });
    };
  });
}
function readAll(db, store) {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(store)) return resolve([]);
    const tx = db.transaction(store, 'readonly');
    const r = tx.objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}
function get(db, store, key) {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(store)) return resolve(null);
    const tx = db.transaction(store, 'readonly');
    const r = tx.objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function put(db, store, val) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(val);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
