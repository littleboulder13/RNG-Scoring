/* =============================================================
   IndexedDB — Database Operations
   ============================================================= */
const DB_NAME    = 'RNGScoringDB';
const DB_VERSION = 1;
const STORE_NAME = 'scores';
let db;

let resolveDbReady;
const dbReady = new Promise(r => { resolveDbReady = r; });

function initDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onerror   = () => reject(req.error);
        req.onsuccess = () => { db = req.result; resolve(db); };
        req.onupgradeneeded = (e) => {
            const store = e.target.result.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            store.createIndex('timestamp', 'timestamp');
            store.createIndex('synced', 'synced');
        };
    });
}

function saveScore(score) {
    return new Promise((resolve, reject) => {
        score.timestamp = new Date().toISOString();
        score.synced = 0;  // Use 0/1, NOT boolean — IDB rejects booleans as index keys
        const req = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).add(score);
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
}

function getAllScores() {
    return new Promise((resolve, reject) => {
        const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
}

async function getPendingScores() {
    return (await getAllScores()).filter(s => !s.synced);
}

function markAsSynced(id) {
    return new Promise((resolve, reject) => {
        const store = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => {
            const score = req.result;
            score.synced = 1;  // Use 0/1, NOT boolean
            const put = store.put(score);
            put.onsuccess = () => resolve();
            put.onerror   = () => reject(put.error);
        };
        req.onerror = () => reject(req.error);
    });
}

async function migrateScoresToEvent(eventId) {
    const scores = await getAllScores();
    const toMigrate = scores.filter(s => !s.eventId);
    if (!toMigrate.length) return;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        for (const score of toMigrate) {
            score.eventId = eventId;
            store.put(score);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
