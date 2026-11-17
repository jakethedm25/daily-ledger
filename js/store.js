// store.js: thin IndexedDB wrapper. db "ledger", version 1. Everything stays on the device.

const SCHEMA = {
  habits: { keyPath: 'id' },
  checkins: { keyPath: ['date', 'habitId'], idx: [['byDate', 'date']] },
  wins: { keyPath: 'id', idx: [['byDate', 'date']] },
  reflections: { keyPath: 'date' },
  settings: { keyPath: 'key' },
  setback: { keyPath: 'key' },
  sessions: { keyPath: 'id', auto: true, idx: [['byDate', 'date']] },
};
export const STORE_NAMES = Object.keys(SCHEMA);

let db = null;
const wrap = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const txDone = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });

export function open(name = 'ledger') {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const [n, s] of Object.entries(SCHEMA)) {
        const os = d.createObjectStore(n, { keyPath: s.keyPath, autoIncrement: !!s.auto });
        (s.idx || []).forEach(([i, k]) => os.createIndex(i, k));
      }
    };
    r.onsuccess = () => { db = r.result; resolve(db); };
    r.onerror = () => reject(r.error);
  });
}

export const get = (s, key) => wrap(db.transaction(s).objectStore(s).get(key));
export const all = (s) => wrap(db.transaction(s).objectStore(s).getAll());
export const byDate = (s, date) => wrap(db.transaction(s).objectStore(s).index('byDate').getAll(date));
export const count = (s) => wrap(db.transaction(s).objectStore(s).count());
export async function put(s, val) { const tx = db.transaction(s, 'readwrite'); const k = await wrap(tx.objectStore(s).put(val)); await txDone(tx); return k; }
export async function putMany(s, arr) { const tx = db.transaction(s, 'readwrite'); arr.forEach((v) => tx.objectStore(s).put(v)); await txDone(tx); }
export async function del(s, key) { const tx = db.transaction(s, 'readwrite'); tx.objectStore(s).delete(key); await txDone(tx); }
export async function clear(s) { const tx = db.transaction(s, 'readwrite'); tx.objectStore(s).clear(); await txDone(tx); }

export async function getSetting(key, fallback = null) {
  const r = await get('settings', key);
  return r ? r.value : fallback;
}
export const setSetting = (key, value) => put('settings', { key, value });
export async function settingsMap() {
  const m = {};
  for (const r of await all('settings')) m[r.key] = r.value;
  return m;
}

export async function snapshot() {
  const out = {};
  for (const n of STORE_NAMES) out[n] = await all(n);
  return out;
}
/** Replace every store in a single transaction. */
export async function replaceAll(snap) {
  const tx = db.transaction(STORE_NAMES, 'readwrite');
  for (const n of STORE_NAMES) {
    const os = tx.objectStore(n);
    os.clear();
    (snap[n] || []).forEach((v) => os.put(v));
  }
  await txDone(tx);
}
export function newId() {
  return (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
