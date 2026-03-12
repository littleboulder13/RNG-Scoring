/* =============================================================
   Pending Starts — Save / Restore Run Time start times
   
   Stores partial Run Time entries in localStorage so a user can
   record a shooter's start time, leave, and return later to
   enter the finish time.
   
   Storage key: rng_pending_starts
   Value: { "eventId|stageName|playerName": { startHms, savedAt } }
   ============================================================= */

const PENDING_STARTS_KEY = 'rng_pending_starts';

function _pendingStartKey(eventId, stageName, playerName) {
    return `${eventId}|${stageName}|${playerName}`;
}

function getAllPendingStartsRaw() {
    try {
        return JSON.parse(localStorage.getItem(PENDING_STARTS_KEY)) || {};
    } catch { return {}; }
}

function _savePendingStartsRaw(data) {
    localStorage.setItem(PENDING_STARTS_KEY, JSON.stringify(data));
}

/**
 * Save a shooter's start time (HH:MM:SS string) for later finish-time entry.
 */
function savePendingStart(eventId, stageName, playerName, startHms) {
    const data = getAllPendingStartsRaw();
    data[_pendingStartKey(eventId, stageName, playerName)] = {
        startHms,
        savedAt: Date.now()
    };
    _savePendingStartsRaw(data);
}

/**
 * Retrieve a saved start time for a specific shooter/stage.
 * Returns { startHms, savedAt } or null.
 */
function getPendingStart(eventId, stageName, playerName) {
    const data = getAllPendingStartsRaw();
    return data[_pendingStartKey(eventId, stageName, playerName)] || null;
}

/**
 * Clear the pending start after a score has been submitted.
 */
function clearPendingStart(eventId, stageName, playerName) {
    const data = getAllPendingStartsRaw();
    delete data[_pendingStartKey(eventId, stageName, playerName)];
    _savePendingStartsRaw(data);
}

/**
 * Get all pending starts for a given event + stage.
 * Returns array of { playerName, startHms, savedAt }.
 */
function getPendingStartsForStage(eventId, stageName) {
    const data = getAllPendingStartsRaw();
    const prefix = `${eventId}|${stageName}|`;
    const results = [];
    for (const key of Object.keys(data)) {
        if (key.startsWith(prefix)) {
            const playerName = key.slice(prefix.length);
            results.push({ playerName, ...data[key] });
        }
    }
    return results.sort((a, b) => a.savedAt - b.savedAt);
}
