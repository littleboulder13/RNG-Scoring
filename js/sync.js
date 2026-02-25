/* =============================================================
   Network Sync — Google Sheets via Apps Script
   ============================================================= */
const SYNC_URL = 'https://script.google.com/macros/s/AKfycbxoD1vYRzXA6-gHyaBMmEhUx4_7NWbQQmSbCFdwMSmlCT-0Xj8aD5jach-g1rxGI9jP/exec';

function updateSyncStatus() {
    const badge = $('sync-status-badge');
    if (!badge) return;
    badge.textContent = '☁ Connected';
    badge.className = 'sync-status-badge connected';
}

/* --- Push a single event's config (stages & competitors) to the cloud --- */
async function pushEventConfig(eventId) {
    if (!navigator.onLine) return;  // silent fail — will push later
    const ev = getEventById(eventId);
    if (!ev) return;

    try {
        await fetch(SYNC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'pushEvent', event: ev })
        });
    } catch (err) {
        console.warn('Event push failed (will retry):', err.message);
    }
}

/* --- Pull all events from the cloud and merge into localStorage --- */
async function pullEvents() {
    if (!navigator.onLine) return alert('Cannot pull events while offline.');

    const pullBtn = $('pull-events-btn');
    if (pullBtn) { pullBtn.disabled = true; pullBtn.textContent = 'Pulling…'; }

    try {
        // Cache-bust to prevent stale responses
        const res = await fetch(SYNC_URL + '?action=pullEvents&_t=' + Date.now());
        if (!res.ok) {
            alert('Pull failed: server returned ' + res.status + ' ' + res.statusText);
            return;
        }
        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (parseErr) {
            alert('Pull failed: invalid response from cloud.\n\n' + text.substring(0, 200));
            return;
        }

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
                // Update stages and competitors from cloud
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
        alert(`✓ Pulled events from cloud: ${parts.join(', ') || 'already up to date'}`);
    } catch (err) {
        console.error('Pull error:', err);
        alert('Failed to pull events: ' + err.message + '\n\nMake sure you have internet access and try again.');
    } finally {
        if (pullBtn) { pullBtn.disabled = false; pullBtn.textContent = '⬇ Pull Events from Cloud'; }
    }
}

/* --- Sync scores to Google Sheets --- */
async function syncScores() {
    if (!navigator.onLine) return alert('Cannot sync while offline.');

    const pending = await getPendingScores();
    if (!pending.length) return alert('No scores to sync — all up to date!');

    const event = getActiveEvent();
    const eventName = event ? event.name : 'Unknown Event';

    const syncBtn = $('sync-btn');
    if (syncBtn) { syncBtn.disabled = true; syncBtn.textContent = 'Syncing…'; }

    try {
        await fetch(SYNC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'syncScores', eventName, scores: pending })
        });

        for (const s of pending) await markAsSynced(s.id);
        await updateUI();
        alert(`✓ Synced ${pending.length} score(s) to Google Sheets!`);
    } catch (err) {
        console.error('Sync error:', err);
        alert('Sync failed: ' + err.message + '\n\nScores are saved locally and you can retry.');
    } finally {
        if (syncBtn) { syncBtn.disabled = false; syncBtn.textContent = 'Sync Now'; }
    }
}
