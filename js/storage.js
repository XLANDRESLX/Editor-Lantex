import { Store } from './util.js';

const DB_NAME = 'lantex-editor';
const DB_VERSION = 1;
const STORE_NAME = 'documents';
const DOC_KEY = 'current';
const LS_KEY = 'editor-document-v2';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB no disponible'));
      return;
    }
    let request;
    try { request = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (e) { reject(e); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('No se pudo abrir IndexedDB'));
    request.onblocked = () => reject(new Error('IndexedDB bloqueado'));
  });
}

async function withStore(mode, fn) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      let result;
      try { result = fn(store); }
      catch (e) { reject(e); db.close(); return; }
      tx.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
      tx.onerror = () => reject(tx.error || new Error('Error de IndexedDB'));
      tx.onabort = () => reject(tx.error || new Error('Transacción cancelada'));
      if (result && result.onsuccess === undefined && result.then) {
        result.then(resolve).catch(reject);
      }
    });
  } finally {
    try { db.close(); } catch (e) { /* noop */ }
  }
}

export const DocStorage = {
  async load() {
    try {
      const db = await openDatabase();
      try {
        const record = await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const req = tx.objectStore(STORE_NAME).get(DOC_KEY);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        });
        if (record && record.data) return record.data;
      } finally {
        try { db.close(); } catch (e) { /* noop */ }
      }
    } catch (e) {
      console.warn('[Lantex] IndexedDB no disponible, usando LocalStorage:', e);
    }
    return this.loadLocal();
  },

  loadLocal() {
    try {
      const raw = Store.get(LS_KEY, null);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  async save(doc) {
    const record = { id: DOC_KEY, data: doc, updatedAt: Date.now() };
    try {
      await withStore('readwrite', (store) => store.put(record, DOC_KEY));
      return { ok: true, backend: 'idb' };
    } catch (e) {
      console.warn('[Lantex] No se pudo guardar en IndexedDB:', e);
      const ok = this.saveLocal(doc);
      return ok ? { ok: true, backend: 'local' } : { ok: false, backend: 'none', error: e };
    }
  },

  saveLocal(doc) {
    try {
      return Store.set(LS_KEY, JSON.stringify(doc));
    } catch (e) {
      return false;
    }
  },

  async clear() {
    try {
      await withStore('readwrite', (store) => store.delete(DOC_KEY));
    } catch (e) { /* noop */ }
    Store.remove(LS_KEY);
  },

  /** Guardado síncrono de emergencia antes de cerrar la pestaña. */
  saveSync(doc) {
    try {
      const serialized = JSON.stringify(doc);
      // LocalStorage suele limitar a ~5 MB. Si no cabe, se ignora sin romper la página.
      return Store.set(LS_KEY, serialized);
    } catch (e) {
      return false;
    }
  }
};
