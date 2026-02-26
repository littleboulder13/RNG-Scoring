/* =============================================================
   Network Sync — Google Sheets via Apps Script
   ============================================================= */
const APP_VERSION = 'v92';
const DEFAULT_SYNC_URL = 'https://script.google.com/macros/s/AKfycbxl5_JrmYOV_oOW0COYUlGa_XrEFNT57CHJyTOznHQbO_FivjN_KYv2zkgqbD3N4nwz/exec';

function getSyncUrl() {
    return localStorage.getItem('rng_sync_url') || DEFAULT_SYNC_URL;
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

/* --- Auto-sync URL on app load --- */
async function autoSyncUrl() {
    if (!navigator.onLine) return;
    try {
        const data = await _fetchFromAppsScript('pullConfig');
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
function _postToAppsScript(payload, queryString) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', getSyncUrl() + (queryString || ''));
        xhr.setRequestHeader('Content-Type', 'text/plain');
        xhr.onload = function () {
            if (xhr.status >= 400) {
                reject(new Error('HTTP ' + xhr.status + ': ' + xhr.responseText.substring(0, 200)));
                return;
            }
            try { resolve(JSON.parse(xhr.responseText)); }
            catch (_) { resolve({ _raw: xhr.responseText }); }
        };
        xhr.onerror = function () { reject(new Error('XHR POST onerror (readyState=' + xhr.readyState + ', status=' + xhr.status + ')')); };
        xhr.ontimeout = function () { reject(new Error('XHR POST timeout after 15s')); };
        xhr.timeout = 15000;
        xhr.send(JSON.stringify(payload));
    });
}

/* --- Helper: Pull data from Apps Script via XHR GET --- */
/* GET avoids the POST→GET redirect body-stripping issue on iOS.           */
/* doGet() on the server already handles pullEvents/pullConfig/etc.         */
function _fetchFromAppsScript(action) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const url = getSyncUrl() + '?action=' + encodeURIComponent(action);
        xhr.open('GET', url);
        xhr.onload = function () {
            if (xhr.status >= 400) {
                reject(new Error('HTTP ' + xhr.status + ': ' + xhr.responseText.substring(0, 200)));
                return;
            }
            try {
                resolve(JSON.parse(xhr.responseText));
            } catch (_) {
                reject(new Error('Invalid JSON (status ' + xhr.status + '): ' + xhr.responseText.substring(0, 200)));
            }
        };
        xhr.onerror = function () { reject(new Error('XHR onerror (readyState=' + xhr.readyState + ', status=' + xhr.status + ')')); };
        xhr.ontimeout = function () { reject(new Error('XHR timeout after 10s')); };
        xhr.timeout = 10000;
        xhr.send();
    });
}

/* --- Manual Pull from Cloud — diagnostic button on event overlay --- */
async function manualPullFromCloud() {
    const btn = $('pull-cloud-btn');
    const status = $('pull-status');
    if (btn) btn.disabled = true;
    if (status) status.textContent = 'Pulling…';

    const url = getSyncUrl() + '?action=pullEvents';

    try {
        const data = await _fetchFromAppsScript('pullEvents');

        if (!data || !Array.isArray(data.events)) {
            const raw = JSON.stringify(data).substring(0, 300);
            if (status) { status.textContent = '✗ Bad response: ' + raw; status.style.color = '#f44'; }
            if (btn) btn.disabled = false;
            return;
        }

        // Merge into local storage (cloud is source of truth)
        const local = getEvents();
        const cloudIds = new Set(data.events.map(e => e.id));
        const merged = local.filter(e => cloudIds.has(e.id));

        for (const remote of data.events) {
            const idx = merged.findIndex(e => e.id === remote.id);
            if (idx === -1) {
                merged.push(remote);
            } else {
                merged[idx].name = remote.name;
                merged[idx].stages = remote.stages;
                merged[idx].competitors = remote.competitors;
                merged[idx].password = remote.password || '';
            }
        }

        saveEvents(merged);
        renderEventOverlay();
        if (status) { status.textContent = '✓ Got ' + data.events.length + ' event(s)'; status.style.color = '#4f4'; }
        showSyncToast('✓ Pulled ' + data.events.length + ' event(s)');
    } catch (err) {
        if (status) { status.textContent = '✗ ' + err.message; status.style.color = '#f44'; }
        showSyncToast('✗ Pull failed: ' + err.message, true);
    } finally {
        if (btn) btn.disabled = false;
    }
}

function updateSyncStatus() {
    const badge = $('sync-status-badge');
    if (!badge) return;
    badge.textContent = '☁ Connected';
    badge.className = 'sync-status-badge connected';
}

/* --- Show a visible toast so user can see sync status on mobile --- */
function showSyncToast(message, isError) {
    let toast = $('sync-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'sync-toast';
        toast.style.cssText = 'position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);' +
            'padding:8px 18px;border-radius:8px;font-size:0.85rem;z-index:99999;' +
            'transition:opacity 0.4s;pointer-events:none;font-weight:600;';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.background = isError ? '#c62828' : '#2e7d32';
    toast.style.color = '#fff';
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
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

/* --- Silent auto-push: push all local events to cloud without alerts --- */
async function autoPushAllEvents() {
    if (!navigator.onLine) return;
    const events = getEvents();
    if (!events.length) return;

    for (const ev of events) {
        try {
            await _postToAppsScript({ action: 'pushEvent', event: ev });
        } catch (err) {
            console.warn('Auto-push failed for', ev.name, ':', err.message);
        }
    }
    console.log('Auto-push complete:', events.length, 'event(s)');
}

/* --- Silent auto-pull: merge cloud events without user alerts --- */
async function autoPullEvents() {
    if (!navigator.onLine) return;
    try {
        const data = await _fetchFromAppsScript('pullEvents');

        // Validate the response looks like an events response
        if (!data || !Array.isArray(data.events)) {
            const raw = JSON.stringify(data).substring(0, 100);
            console.warn('Auto-pull: unexpected response:', raw);
            showSyncToast('✗ Bad response: ' + raw, true);
            return;
        }

        const cloudEvents = data.events;
        const local = getEvents();
        let changed = false;

        // Cloud is source of truth — build a set of cloud event IDs
        const cloudIds = new Set(cloudEvents.map(e => e.id));

        // Remove local events that no longer exist in the cloud
        const filtered = local.filter(e => {
            if (!cloudIds.has(e.id)) { changed = true; return false; }
            return true;
        });

        // Add or update events from cloud
        for (const remote of cloudEvents) {
            const idx = filtered.findIndex(e => e.id === remote.id);
            if (idx === -1) {
                filtered.push(remote);
                changed = true;
            } else {
                // Update if remote has newer data (including password)
                if (filtered[idx].name !== remote.name ||
                    filtered[idx].password !== (remote.password || '') ||
                    JSON.stringify(filtered[idx].stages) !== JSON.stringify(remote.stages) ||
                    JSON.stringify(filtered[idx].competitors) !== JSON.stringify(remote.competitors)) {
                    filtered[idx].name = remote.name;
                    filtered[idx].stages = remote.stages;
                    filtered[idx].competitors = remote.competitors;
                    filtered[idx].password = remote.password || '';
                    changed = true;
                }
            }
        }

        if (changed) {
            saveEvents(filtered);

            // Clear active event if it was removed from the cloud
            const activeId = getActiveEventId();
            if (activeId && !cloudIds.has(activeId)) {
                clearActiveEvent();
            }
        }

        // Also pull archived events silently — cloud is source of truth
        try {
            const archiveData = await _fetchFromAppsScript('pullArchivedEvents');
            const cloudArchived = (archiveData && archiveData.events) ? archiveData.events : [];
            const localArchived = getArchivedEvents();

            const cloudArchiveIds = new Set(cloudArchived.map(e => e.id));
            let archiveChanged = false;

            // Remove local archived events not in cloud
            const filteredArchived = localArchived.filter(e => {
                if (!cloudArchiveIds.has(e.id)) { archiveChanged = true; return false; }
                return true;
            });

            // Add new archived events from cloud
            for (const remote of cloudArchived) {
                if (!filteredArchived.find(e => e.id === remote.id)) {
                    filteredArchived.push(remote);
                    archiveChanged = true;
                }
            }

            if (archiveChanged) {
                saveArchivedEvents(filteredArchived);
                changed = true;
            }
        } catch (_) { /* ignore archive pull errors silently */ }

        // Re-render overlay if it's currently visible
        if (changed) {
            const overlay = $('event-overlay');
            if (overlay && overlay.style.display !== 'none') {
                renderEventOverlay();
            }
            // Also refresh main UI if active event was updated
            if (getActiveEvent()) {
                populatePlayerDropdown();
                populateStageDropdown();
                showStageInfo();
            }
        }

        console.log('Auto-pull complete' + (changed ? ' (events updated)' : ' (no changes)'));
        showSyncToast('✓ Synced with cloud' + (changed ? ' (updated)' : ''));
    } catch (err) {
        console.warn('Auto-pull events failed:', err.message);
        showSyncToast('✗ Sync failed: ' + err.message, true);
    }
}

/* --- Pull all events from the cloud and merge into localStorage --- */
async function pullEvents() {
    if (!navigator.onLine) return alert('Cannot pull events while offline.');

    const pullBtn = $('pull-events-btn');
    if (pullBtn) { pullBtn.disabled = true; pullBtn.textContent = 'Pulling\u2026'; }

    try {
        const data = await _fetchFromAppsScript('pullEvents');

        // Debug: show raw response if no events found
        if (!data.events || !data.events.length) {
            const raw = JSON.stringify(data).substring(0, 300);
            alert('App ' + APP_VERSION + ' | Method: XHR GET\n\nNo events found.\n\nServer response:\n' + raw);
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

        renderEventOverlay();

        const parts = [];
        if (added)   parts.push(`${added} new`);
        if (updated) parts.push(`${updated} updated`);
        if (archivedPulled) parts.push(`${archivedPulled} old`);
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
    const competitors = event ? (event.competitors || []) : [];
    const stages = event ? (event.stages || []) : [];

    const syncBtn = $('sync-btn');
    if (syncBtn) { syncBtn.disabled = true; syncBtn.textContent = 'Syncing\u2026'; }

    try {
        await _postToAppsScript({
            action: 'syncScores',
            eventName,
            scores: pending,
            competitors,
            stages
        });

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
