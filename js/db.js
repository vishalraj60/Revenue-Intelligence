/**
 * db.js — IndexedDB persistence layer
 *
 * Stores are:
 *   source_records   — original source data keyed by (source_type, source_id)
 *   analysis         — automated routing analysis, keyed by record_key
 *   manual_decisions — user overrides, keyed by record_key
 *   import_history   — batch import log
 *   audit_events     — field-level change trail
 */

const DB_NAME    = 'revenue-intelligence';
const DB_VERSION = 1;

let _db = null;

export async function openDB() {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains('source_records')) {
        const s = db.createObjectStore('source_records', { keyPath: 'record_key' });
        s.createIndex('by_type',   'source_type', { unique: false });
        s.createIndex('by_person', 'person',      { unique: false });
      }

      if (!db.objectStoreNames.contains('analysis')) {
        db.createObjectStore('analysis', { keyPath: 'record_key' });
      }

      if (!db.objectStoreNames.contains('manual_decisions')) {
        db.createObjectStore('manual_decisions', { keyPath: 'record_key' });
      }

      if (!db.objectStoreNames.contains('import_history')) {
        db.createObjectStore('import_history', { keyPath: 'id', autoIncrement: true });
      }

      if (!db.objectStoreNames.contains('audit_events')) {
        const a = db.createObjectStore('audit_events', { keyPath: 'id', autoIncrement: true });
        a.createIndex('by_record', 'record_key', { unique: false });
      }
    };

    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror   = (e) => reject(e.target.error);
  });
}

/** Generic helpers */
function txStore(storeName, mode = 'readonly') {
  return _db.transaction([storeName], mode).objectStore(storeName);
}

function promisify(req) {
  return new Promise((res, rej) => {
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

export async function getAllFromStore(storeName) {
  await openDB();
  return promisify(txStore(storeName).getAll());
}

export async function getFromStore(storeName, key) {
  await openDB();
  return promisify(txStore(storeName).get(key));
}

export async function putToStore(storeName, record) {
  await openDB();
  return promisify(txStore(storeName, 'readwrite').put(record));
}

export async function deleteFromStore(storeName, key) {
  await openDB();
  return promisify(txStore(storeName, 'readwrite').delete(key));
}

export async function clearStore(storeName) {
  await openDB();
  return promisify(txStore(storeName, 'readwrite').clear());
}

export async function clearAllStores() {
  await openDB();
  const stores = ['source_records', 'analysis', 'manual_decisions', 'import_history', 'audit_events'];
  await Promise.all(stores.map(s => clearStore(s)));
}

/** Convenience wrappers */
export const db = {
  // Source records
  async getRecord(key)          { return getFromStore('source_records', key); },
  async putRecord(rec)          { return putToStore('source_records', rec); },
  async getAllRecords()         { return getAllFromStore('source_records'); },

  // Analysis
  async getAnalysis(key)       { return getFromStore('analysis', key); },
  async putAnalysis(a)         { return putToStore('analysis', a); },
  async getAllAnalysis()        { return getAllFromStore('analysis'); },

  // Manual decisions
  async getDecision(key)       { return getFromStore('manual_decisions', key); },
  async putDecision(d)         { return putToStore('manual_decisions', d); },
  async getAllDecisions()       { return getAllFromStore('manual_decisions'); },

  // Import history
  async addImportBatch(batch)  { return putToStore('import_history', batch); },
  async getImportHistory()     { return getAllFromStore('import_history'); },

  // Audit
  async addAuditEvent(ev)      { return putToStore('audit_events', ev); },
  async getAuditForRecord(key) {
    await openDB();
    const idx = txStore('audit_events').index('by_record');
    return promisify(idx.getAll(key));
  },
  async getAllAuditEvents()    { return getAllFromStore('audit_events'); },
};
