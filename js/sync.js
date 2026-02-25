/* =============================================================
   Network Sync — Google Sheets via Apps Script
   ============================================================= */
const DEFAULT_SYNC_URL = 'https://script.google.com/macros/s/AKfycbxoD1vYRzXA6-gHyaBMmEhUx4_7NWbQQmSbCFdwMSmlCT-0Xj8aD5jach-g1rxGI9jP/exec';

function getSyncUrl() {
    return localStorage.getItem('rng_sync_url') || DEFAULT_SYNC_URL;
}

function setSyncUrl(url) {
    localStorage.setItem('rng_sync_url', url);
}

function promptSyncUrl() {
    if (!promptAdminPin('change the sync URL')) return;
    const current = getSyncUrl();
    const url = prompt('Enter the Google Apps Script deployment URL:', current);
    if (url === null) return;  // cancelled
    const trimmed = url.trim();
    if (!trimmed) {
        alert('URL cannot be empty.');
        return;
    }
    if (!trimmed.startsWith('https://script.google.com/')) {
        if (!confirm('This doesn\u2019t look like a Google Apps Script URL. Save anyway?')) return;
    }
    setSyncUrl(trimmed);
    // Push the new URL to the cloud so other devices pick it up
    _postToAppsScript({ action: 'pushConfig', config: { syncUrl: trimmed } })
        .then(() => console.log('Sync URL pushed to cloud'))
        .catch(err => console.warn('Failed to push sync URL to cloud:', err.message));
    alert('\u2713 Sync URL updated!');
}

/* --- Auto-sync URL on app load --- */
async function autoSyncUrl() {
    if (!navigator.onLine) return;
    try {
        const data = await _getFromAppsScript('action=pullConfig');
        if (data && data.syncUrl && data.syncUrl.startsWith('https://script.google.com/')) {
            const current = getSyncUrl();
            if (data.syncUrl !== current) {
                setSyncUrl(data.syncUrl);
                console.log('Sync URL auto-updated from cloud:', data.syncUrl);
            }
        }
    } catch (err) {
        console.warn('Auto-sync URL check failed:', err.message);
    }
}

/* --- Helper: POST to Apps Script via XHR (reliable on iOS PWAs) --- */
function _postToAppsScript(payload) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', getSyncUrl());
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

/* --- Helper: GET from Apps Script via XHR (reliable on iOS PWAs) --- */
function _getFromAppsScript(params) {
    return new Promise((resolve, reject) => {
        const url = getSyncUrl() + '?' + params + '&_t=' + Date.now();
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) {
                try { resolve(JSON.parse(xhr.responseText)); }
                catch (_) { reject(new Error('Invalid response: ' + xhr.responseText.substring(0, 200))); }
            } else {
                reject(new Error('Server returned ' + xhr.status));
            }
        };
        xhr.onerror = function () { reject(new Error('Network request failed')); };
        xhr.ontimeout = function () { reject(new Error('Request timed out')); };
        xhr.timeout = 30000;
        xhr.send();
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
            console.warn('Event push response:', JSON.stringify(result).substring(0, 200));
        }
    } catch (err) {
        console.warn('Event push failed (will retry):', err.message);
    }
}

/* --- Push ALL local events to the cloud --- */
async function pushAllEvents() {
    if (!navigator.onLine) return alert('Cannot push events while offline.');

    const events = getEvents();
    if (!events.length) return alert('No local events to push.');

    const pushBtn = $('push-events-btn');
    if (pushBtn) { pushBtn.disabled = true; pushBtn.textContent = 'Pushing\u2026'; }

    let success = 0, failed = 0;
    for (const ev of events) {
        try {
            const result = await _postToAppsScript({ action: 'pushEvent', event: ev });
            if (result && result.success) {
                success++;
            } else {
                failed++;
                console.warn('Push failed for', ev.name, ':', JSON.stringify(result).substring(0, 200));
            }
        } catch (err) {
            failed++;
            console.warn('Push error for', ev.name, ':', err.message);
        }
    }

    if (failed === 0) {
        alert(`\u2713 Pushed ${success} event(s) to the cloud!`);
    } else {
        alert(`Pushed ${success} event(s). ${failed} failed \u2014 check your connection and try again.`);
    }

    if (pushBtn) { pushBtn.disabled = false; pushBtn.textContent = '\u2B06 Push Events to Cloud'; }
}

/* --- Pull all events from the cloud and merge into localStorage --- */
async function pullEvents() {
    if (!navigator.onLine) return alert('Cannot pull events while offline.');

    const pullBtn = $('pull-events-btn');
    if (pullBtn) { pullBtn.disabled = true; pullBtn.textContent = 'Pulling\u2026'; }

    try {
        const data = await _getFromAppsScript('action=pullEvents');

        if (!data.events || !data.events.length) {
            alert('No events found in the cloud yet.');
            return;
        }

        const local = getEvents();
        let added = 0, updated = 0;

        for (const remote of data.events) {
            const idx = local.findIndex(e => e.id === remote.id);
            if (idx === -1) {
                local.push(remote);
                added++;
            } else {
                local[idx].name = remote.name;
                local[idx].stages = remote.stages;
                local[idx].competitors = remote.competitors;
                updated++;
            }
        }

        saveEvents(local);
        renderEventOverlay();

        const parts = [];
        if (added)   parts.push(`${added} new`);
        if (updated) parts.push(`${updated} updated`);
        alert(`\u2713 Pulled events from cloud: ${parts.join(', ') || 'already up to date'}`);
    } catch (err) {
        console.error('Pull error:', err);
        alert('Failed to pull events: ' + err.message);
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

    const syncBtn = $('sync-btn');
    if (syncBtn) { syncBtn.disabled = true; syncBtn.textContent = 'Syncing\u2026'; }

    try {
        await _postToAppsScript({ action: 'syncScores', eventName, scores: pending });

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
