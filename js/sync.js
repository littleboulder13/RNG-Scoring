/* =============================================================
   Network Sync — Google Sheets via Apps Script
   ============================================================= */
const APP_VERSION = 'v125';
const DEFAULT_SYNC_URL = 'https://script.google.com/macros/s/AKfycbxDwug8yxfGbuqVKWUb7WTZh89NJQzp5ZaIIC3aPs4w4iiWogk0Yvg7M9ASgy70NOkW/exec';

function getSyncUrl() {
    // Clear stale old deployment URL so we use the new one
    var stored = localStorage.getItem('rng_sync_url');
    if (stored && stored.indexOf('AKfycbxl5_JrmYOV') !== -1) {
        localStorage.removeItem('rng_sync_url');
        stored = null;
    }
    return stored || DEFAULT_SYNC_URL;
}

function setSyncUrl(url) {
    localStorage.setItem('rng_sync_url', url);
}

function openSettingsModal() {
    const modal   = $('settings-modal');
    const gate    = $('settings-pin-gate');
    const body    = $('settings-body');
    const pinIn   = $('settings-pin-input');
    const pinErr  = $('settings-pin-error');
    const noPin   = $('settings-no-pin-msg');
    const saveMsg = $('settings-save-msg');

    // Reset state
    pinIn.value = '';
    pinErr.style.display = 'none';
    saveMsg.style.display = 'none';
    $('settings-admin-pin').value = '';

    if (hasAdminPin() && !isAdminLoggedIn()) {
        // PIN is set and not admin — show the PIN gate
        gate.style.display = '';
        body.style.display = 'none';
        noPin.style.display = 'none';
    } else {
        // No PIN set or already admin — skip gate, go straight to settings
        gate.style.display = 'none';
        body.style.display = '';
    }

    // Pre-fill current URL
    $('settings-sync-url').value = getSyncUrl();

    modal.style.display = 'flex';
}

function closeSettingsModal() {
    $('settings-modal').style.display = 'none';
}

function unlockSettings() {
    const entered = $('settings-pin-input').value;
    if (verifyAdminPin(entered)) {
        $('settings-pin-gate').style.display = 'none';
        $('settings-body').style.display = '';
        $('settings-pin-error').style.display = 'none';
    } else {
        $('settings-pin-error').style.display = 'block';
    }
}

function saveSettings() {
    const urlVal = ($('settings-sync-url').value || '').trim();
    const pinVal = ($('settings-admin-pin').value || '').trim();
    const msgEl  = $('settings-save-msg');

    if (!urlVal) {
        msgEl.textContent = 'URL cannot be empty.';
        msgEl.style.color = 'var(--error-color)';
        msgEl.style.display = 'block';
        return;
    }

    // Save URL
    setSyncUrl(urlVal);

    // Save PIN if provided
    if (pinVal) setAdminPin(pinVal);

    // Push URL to cloud so other devices pick it up
    _postToAppsScript({ action: 'pushConfig', config: { syncUrl: urlVal } })
        .then(() => console.log('Sync URL pushed to cloud'))
        .catch(err => console.warn('Failed to push sync URL to cloud:', err.message));

    msgEl.textContent = '✓ Settings saved!';
    msgEl.style.color = 'var(--secondary-color)';
    msgEl.style.display = 'block';
    setTimeout(() => closeSettingsModal(), 1200);
}

// Legacy alias — both gear buttons call this
function promptSyncUrl() {
    openSettingsModal();
}

/* --- Helper: POST to Apps Script via XHR --- */
function _postToAppsScript(payload, queryString) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', getSyncUrl() + (queryString || ''));
        xhr.setRequestHeader('Content-Type', 'text/plain');
        xhr.onload = function () {
            try { resolve(JSON.parse(xhr.responseText)); }
            catch (_) { resolve({ _raw: xhr.responseText }); }
        };
        xhr.onerror = function () { reject(new Error('Network request failed')); };
        xhr.ontimeout = function () { reject(new Error('Request timed out')); };
        xhr.timeout = 30000;
        xhr.send(JSON.stringify(payload));
    });
}

/* --- Helper: Pull data from Apps Script via form-encoded POST --- */
/* Form-encoded POST avoids CORS preflight AND puts form fields directly   */
/* into e.parameter on the server, so e.parameter.action = 'pullEvents'.   */
function _fetchFromAppsScript(action) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', getSyncUrl());
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        xhr.onload = function () {
            try {
                resolve(JSON.parse(xhr.responseText));
            } catch (_) {
                reject(new Error('Invalid response'));
            }
        };
        xhr.onerror = function () { reject(new Error('Network request failed')); };
        xhr.ontimeout = function () { reject(new Error('Request timed out')); };
        xhr.timeout = 30000;
        xhr.send('action=' + encodeURIComponent(action));
    });
}

function updateSyncStatus() {
    const badge = $('sync-status-badge');
    if (!badge) return;
    badge.textContent = '☁ Connected';
    badge.className = 'sync-status-badge connected';
}

/* --- Push a single event's config (stages & competitors) to the cloud --- */
async function pushEventConfig(eventId) {
    if (!navigator.onLine) return;
    const ev = getEventById(eventId);
    if (!ev) return;

    try {
        const result = await _postToAppsScript({ action: 'pushEvent', event: ev });
        if (!result || !result.success) {
            console.warn('Event push response:', JSON.stringify(result).substring(0, 300));
        } else {
            console.log('Event pushed OK, spreadsheetId:', result.spreadsheetId || '(none)');
        }
    } catch (err) {
        console.warn('Event push failed (will retry):', err.message);
    }
}

/* --- Push archive / restore / permanent-delete actions to the cloud --- */
async function pushArchiveEvent(eventId) {
    if (!navigator.onLine) return;
    try {
        await _postToAppsScript({ action: 'archiveEvent', eventId });
    } catch (err) {
        console.warn('Archive push failed:', err.message);
    }
}

async function pushRestoreEvent(eventId) {
    if (!navigator.onLine) return;
    try {
        await _postToAppsScript({ action: 'restoreEvent', eventId });
    } catch (err) {
        console.warn('Restore push failed:', err.message);
    }
}

async function pushPermanentlyDeleteEvent(eventId, event) {
    if (!navigator.onLine) return;
    try {
        var payload = { action: 'permanentlyDeleteEvent', eventId: eventId };
        if (event) {
            payload.eventName = event.name || '';
            payload.stages = (event.stages || []).map(function(s) { return s.name || s; });
        }
        await _postToAppsScript(payload);
    } catch (err) {
        console.warn('Permanent delete push failed:', err.message);
    }
}

/* --- Pull all events from the cloud and merge into localStorage --- */
async function pullEvents() {
    if (!navigator.onLine) return alert('Cannot pull events while offline.');

    const pullBtn = $('pull-events-btn');
    if (pullBtn) { pullBtn.disabled = true; pullBtn.textContent = 'Pulling\u2026'; }

    try {
        const data = await _fetchFromAppsScript('pullEvents');

        const local = getEvents();
        let added = 0, updated = 0;

        if (data.events && data.events.length) {
            for (const remote of data.events) {
                const idx = local.findIndex(e => e.id === remote.id);
                if (idx === -1) {
                    local.push(remote);
                    added++;
                } else {
                    local[idx].name = remote.name;
                    local[idx].stages = remote.stages;
                    local[idx].competitors = remote.competitors;
                    if (remote.password !== undefined)      local[idx].password      = remote.password;
                    if (remote.scoringMethod !== undefined)  local[idx].scoringMethod  = remote.scoringMethod;
                    if (remote.eventType !== undefined)      local[idx].eventType      = remote.eventType;
                    updated++;
                }
            }
            saveEvents(local);
        }

        // Also pull archived events from cloud
        let archivedPulled = 0;
        try {
            const archiveData = await _fetchFromAppsScript('pullArchivedEvents');
            if (archiveData.events && archiveData.events.length) {
                const localArchived = getArchivedEvents();
                for (const remote of archiveData.events) {
                    if (!localArchived.find(e => e.id === remote.id)) {
                        localArchived.push(remote);
                        archivedPulled++;
                    }
                }
                saveArchivedEvents(localArchived);
            }
        } catch (archErr) {
            console.warn('Failed to pull archived events:', archErr.message);
        }

        // Pull deleted-event IDs from cloud and purge local data
        let cleaned = 0;
        try {
            const delData = await _fetchFromAppsScript('pullDeletedEventIds');
            if (delData.deletedEventIds && delData.deletedEventIds.length) {
                // Convert to strings for reliable comparison (sheet may return numbers)
                const deletedSet = new Set(delData.deletedEventIds.map(String));

                // Remove from active events list
                const freshLocal = getEvents().filter(e => !deletedSet.has(String(e.id)));
                saveEvents(freshLocal);

                // Remove from archived events list
                const freshArchived = getArchivedEvents().filter(e => !deletedSet.has(String(e.id)));
                saveArchivedEvents(freshArchived);

                // Clear active event if it was deleted
                if (deletedSet.has(String(getActiveEventId()))) clearActiveEvent();

                // Delete scores from IndexedDB for each deleted event
                for (const eid of delData.deletedEventIds) {
                    try {
                        await deleteScoresByEventId(eid);
                        cleaned++;
                    } catch (_) { /* ignore — may have no scores for this event */ }
                }
            }
        } catch (delErr) {
            console.warn('Failed to pull deleted-event list:', delErr.message);
        }

        renderEventOverlay();

        const parts = [];
        if (added)   parts.push(`${added} new`);
        if (updated) parts.push(`${updated} updated`);
        if (archivedPulled) parts.push(`${archivedPulled} old`);
        if (cleaned) parts.push(`${cleaned} cleaned up`);
        alert(`\u2713 Pulled events from cloud: ${parts.join(', ') || 'already up to date'}`);
    } catch (err) {
        console.error('Pull error:', err);
        alert('Failed to pull events: ' + err.message +
            '\n\nApp: ' + APP_VERSION +
            '\nURL: ' + getSyncUrl().substring(0, 60) + '...' +
            '\nOnline: ' + navigator.onLine +
            '\nStandalone: ' + (window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches) +
            '\n\nTry opening in Safari (not the app) to sync.');
    } finally {
        if (pullBtn) { pullBtn.disabled = false; pullBtn.textContent = '\u2b07 Pull Events from Cloud'; }
    }
}

/* --- Sync scores to Google Sheets --- */
async function syncScores() {
    if (!navigator.onLine) return alert('Cannot sync while offline.');

    const pending = await getPendingScores();
    if (!pending.length) return alert('No scores to sync \u2014 all up to date!');

    const event = getActiveEvent();
    const eventName = event ? event.name : 'Unknown Event';
    const competitors = event ? (event.competitors || []) : [];
    const stages = event ? (event.stages || []) : [];

    const syncBtn = $('sync-btn');
    if (syncBtn) { syncBtn.disabled = true; syncBtn.textContent = 'Syncing\u2026'; }

    try {
        const result = await _postToAppsScript({
            action: 'syncScores',
            eventId: event ? event.id : '',
            eventName,
            scoringMethod: event ? (event.scoringMethod || 'percentile_dnf0') : 'percentile_dnf0',
            scores: pending,
            competitors,
            stages
        });

        if (result && result.success === false) {
            throw new Error(result.error || 'Server returned an error');
        }

        for (const s of pending) await markAsSynced(s.id);
        await updateUI();
        alert(`\u2713 Synced ${pending.length} score(s) to Google Sheets!`);
    } catch (err) {
        console.error('Sync error:', err);
        alert('Sync failed: ' + err.message + '\n\nScores are saved locally and you can retry.');
    } finally {
        if (syncBtn) { syncBtn.disabled = false; syncBtn.textContent = 'Sync Now'; }
    }
}
