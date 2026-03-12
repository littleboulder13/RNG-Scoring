/* =============================================================
   RNG Scoring App — Main Entry Point
   
   Load order (set in index.html):
     1. js/db.js       — IndexedDB operations & dbReady promise
     2. js/events.js   — Event CRUD, active event, migration
     3. js/players.js  — Player/competitor CRUD (event-scoped)
     4. js/stages.js   — Stage CRUD (event-scoped)
     5. js/ui.js       — DOM rendering, dropdowns, display helpers
     6. js/excel.js    — Import/export with SheetJS
     7. js/sync.js     — Network sync
     8. app.js         — This file: init, service worker, events
   ============================================================= */

// DOM shorthand used by all modules
const $ = (id) => document.getElementById(id);

/* =============================================================
   Install Prompt (PWA "Add to Home Screen")
   ============================================================= */
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const banner = $('install-banner');
    if (banner && !sessionStorage.getItem('install-dismissed')) {
        banner.style.display = 'flex';
    }
});

window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    const banner = $('install-banner');
    if (banner) banner.style.display = 'none';
    console.log('App installed successfully');
});

/* =============================================================
   App Initialization
   ============================================================= */
async function init() {
    try {
        await initDB();
        resolveDbReady();

        // Migrate legacy data (pre-events) into a default event
        const migratedEventId = migrateToEvents();
        if (migratedEventId) {
            await migrateScoresToEvent(migratedEventId);
        }

        // Show overlay or refresh based on active event and saved view state
        const savedView = sessionStorage.getItem('rng_current_view');
        if (savedView === 'events') {
            // User was on events page — stay there
            if (getActiveEvent()) await refreshAfterEventChange();
            showEventOverlay();
        } else if (getActiveEvent()) {
            await refreshAfterEventChange();
        } else {
            showEventOverlay();
        }
    } catch (err) {
        console.error('App init error:', err);
        alert('Error initialising database: ' + err.message);
    }

    updateOnlineStatus();

    // Force version badge on scoring page header (independent of overlay)
    const vh = document.getElementById('app-version-header');
    if (vh && typeof APP_VERSION !== 'undefined') vh.textContent = APP_VERSION;

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    window.addEventListener('online', async () => {
        if (getSyncUrl() && (await getPendingScores()).length) setTimeout(syncScores, 1000);
    });
}

// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' })
            .then(reg => {
                console.log('Service Worker registered');
                // Force update check on every load
                reg.update().catch(() => {});

                // When a new service worker is installed, prompt reload
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    if (newWorker) {
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'activated') {
                                console.log('New version available — reloading');
                                window.location.reload();
                            }
                        });
                    }
                });
            })
            .catch(err => console.error('SW registration failed:', err));
    });

    // If a new SW took over, reload immediately
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
            refreshing = true;
            window.location.reload();
        }
    });
}

/* =============================================================
   Event Overlay — Select / Create / Delete Events
   ============================================================= */
function showEventOverlay() {
    sessionStorage.setItem('rng_current_view', 'events');
    renderEventOverlay();
    $('event-overlay').style.display = 'flex';
    $('active-event-bar').style.display = 'none';
}

function hideEventOverlay() {
    sessionStorage.setItem('rng_current_view', 'scoring');
    $('event-overlay').style.display = 'none';
}

function selectEvent(id) {
    const event = getEventById(id);
    if (!event) return;

    // Skip password check for admins or events without a password
    if (!event.password || isAdminLoggedIn()) {
        setActiveEvent(id);
        hideEventOverlay();
        refreshAfterEventChange();
        return;
    }

    // Show password prompt
    promptEventPassword(id);
}

function promptEventPassword(eventId) {
    const modal = $('event-password-modal');
    const input = $('event-password-input');
    const error = $('event-password-error');
    input.value = '';
    error.style.display = 'none';
    modal.style.display = 'flex';
    modal.dataset.eventId = eventId;
    setTimeout(() => input.focus(), 100);
}

async function refreshAfterEventChange() {
    const event = getActiveEvent();
    if (!event) return;
    updateActiveEventBar();
    populatePlayerDropdown();
    populateStageDropdown();
    showStageInfo();
    showShooterDivision();
    try { await updateUI(); } catch (e) { /* DB may not be ready yet */ }
}

/* =============================================================
   Admin Session — Login / Logout / UI Toggle
   ============================================================= */
function updateAdminUI() {
    if (isAdminLoggedIn()) {
        document.body.classList.add('admin-mode');
    } else {
        document.body.classList.remove('admin-mode');
    }
    const icon  = isAdminLoggedIn() ? '\uD83D\uDD13' : '\uD83D\uDD12';
    const title = isAdminLoggedIn() ? 'Admin Logout' : 'Admin Login';
    ['overlay-admin-btn', 'admin-btn'].forEach(id => {
        const btn = $(id);
        if (btn) { btn.textContent = icon; btn.title = title; }
    });
}

/* =============================================================
   Pending Start Helpers — check/fill/update active runners
   ============================================================= */

/** Auto-fill start time if a pending start exists for the selected shooter + stage. */
function checkAndFillPendingStart() {
    const info = $('saved-start-info');
    if (info) info.style.display = 'none';

    const stageName  = $('stage')?.value;
    const playerName = $('player-name')?.value;
    const eventId    = getActiveEventId();
    if (!stageName || !playerName || !eventId) return;

    const stage = getStages().find(s => s.name === stageName);
    if (!stage || (stage.type || 'standard_rng') !== 'run_time') return;

    const pending = getPendingStart(eventId, stageName, playerName);
    if (!pending) return;

    // Auto-fill start time field
    $('run-start-time').value = pending.startHms || '';
    // Show info banner
    if (info) {
        info.textContent = `⏱ Start time loaded (${pending.startHms}) — enter finish time to complete`;
        info.style.display = 'block';
    }
}

/** Update the active-runners indicator for the current Run Time stage. */
function updateActiveRunners() {
    const row   = $('active-runners-row');
    const count = $('active-runner-count');
    const list  = $('active-runners-list');
    if (!row) return;

    const stageName = $('stage')?.value;
    const eventId   = getActiveEventId();
    const stage     = getStages().find(s => s.name === stageName);
    const isRunTime = stage && (stage.type || 'standard_rng') === 'run_time';

    if (!isRunTime || !stageName || !eventId) {
        row.style.display = 'none';
        return;
    }

    const runners = getPendingStartsForStage(eventId, stageName);
    if (runners.length === 0) {
        row.style.display = 'none';
        return;
    }

    row.style.display = '';
    count.textContent = runners.length;
    list.innerHTML = runners.map(r => {
        return `<div class="active-runner-item" data-player="${r.playerName}">
            <span class="runner-name">${r.playerName}</span>
            <span class="runner-start">${r.startHms || ''}</span>
            <button type="button" class="runner-select-btn" title="Select this shooter">↩</button>
            <button type="button" class="runner-clear-btn" title="Remove saved start">✕</button>
        </div>`;
    }).join('');

    // Attach click handlers for select / clear buttons
    list.querySelectorAll('.runner-select-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const name = btn.closest('.active-runner-item').dataset.player;
            $('player-name').value = name;
            showShooterDivision();
            checkAndFillPendingStart();
        });
    });
    list.querySelectorAll('.runner-clear-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const name = btn.closest('.active-runner-item').dataset.player;
            if (confirm(`Remove saved start time for ${name}?`)) {
                clearPendingStart(eventId, stageName, name);
                updateActiveRunners();
                // If this shooter is currently selected, clear the start fields
                if ($('player-name').value === name) {
                    $('run-start-time').value = '';
                    $('saved-start-info').style.display = 'none';
                }
            }
        });
    });
}

/* =============================================================
   UI Event Listeners — registered on page load, independent of DB
   ============================================================= */
document.addEventListener('DOMContentLoaded', () => {

    // --- Tab switching ---
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            $('tab-' + tab).classList.add('active');
        });
    });

    // --- Install banner buttons ---
    $('install-btn').addEventListener('click', async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        console.log('Install prompt outcome:', outcome);
        deferredInstallPrompt = null;
        $('install-banner').style.display = 'none';
    });
    $('install-dismiss').addEventListener('click', () => {
        $('install-banner').style.display = 'none';
        sessionStorage.setItem('install-dismissed', '1');
    });

    // Show iOS-specific hint
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                      || navigator.standalone === true;
    if (isIOS && !isStandalone) {
        const banner = $('install-banner');
        $('install-message').innerHTML =
            '📲 To install: tap <strong>Share</strong> ⎋ then <strong>"Add to Home Screen"</strong>';
        $('install-btn').style.display = 'none';
        banner.style.display = 'flex';
    }

    // --- Reusable admin PIN prompt via HTML modal ---
    let _adminPinResolve = null;

    function requestAdminPin(actionLabel) {
        return new Promise((resolve) => {
            _adminPinResolve = resolve;
            const modal = $('admin-pin-modal');
            const setupDiv = $('admin-pin-setup');
            const pinInput = $('admin-pin-input');
            const newPinInput = $('admin-pin-new');

            $('admin-pin-title').textContent = actionLabel
                ? 'PIN required to ' + actionLabel
                : 'Enter Admin PIN';
            $('admin-pin-error').style.display = 'none';
            pinInput.value = '';
            newPinInput.value = '';

            if (!hasAdminPin()) {
                // No PIN set — show setup fields
                pinInput.style.display = 'none';
                setupDiv.style.display = '';
            } else {
                pinInput.style.display = '';
                setupDiv.style.display = 'none';
            }

            modal.style.display = 'flex';
            (hasAdminPin() ? pinInput : newPinInput).focus();
        });
    }

    $('admin-pin-close').addEventListener('click', () => {
        $('admin-pin-modal').style.display = 'none';
        if (_adminPinResolve) { _adminPinResolve(false); _adminPinResolve = null; }
    });

    $('admin-pin-cancel').addEventListener('click', () => {
        $('admin-pin-modal').style.display = 'none';
        if (_adminPinResolve) { _adminPinResolve(false); _adminPinResolve = null; }
    });

    $('admin-pin-submit').addEventListener('click', () => {
        if (!hasAdminPin()) {
            // Setting up a new PIN
            const newPin = ($('admin-pin-new').value || '').trim();
            if (!newPin) {
                $('admin-pin-error').textContent = 'PIN cannot be empty.';
                $('admin-pin-error').style.display = 'block';
                return;
            }
            setAdminPin(newPin);
            adminLogin();
            updateAdminUI();
            $('admin-pin-modal').style.display = 'none';
            if (_adminPinResolve) { _adminPinResolve(true); _adminPinResolve = null; }
        } else {
            // Verifying existing PIN
            const entered = $('admin-pin-input').value;
            if (verifyAdminPin(entered)) {
                adminLogin();
                updateAdminUI();
                $('admin-pin-modal').style.display = 'none';
                if (_adminPinResolve) { _adminPinResolve(true); _adminPinResolve = null; }
            } else {
                $('admin-pin-error').textContent = 'Incorrect PIN.';
                $('admin-pin-error').style.display = 'block';
            }
        }
    });

    // --- Event overlay: Create event (admin-only, gated by visibility) ---
    $('create-event-btn').addEventListener('click', async () => {
        const name = $('new-event-name').value.trim();
        if (!name) { alert('Please enter an event name.'); return; }
        const scoringMethod = $('new-event-scoring').value;
        const event = createEvent(name, scoringMethod);
        pushEventConfig(event.id);
        $('new-event-name').value = '';
        renderEventOverlay();
        openEventEditor(event.id);
    });

    // --- Event overlay: Select / Edit / Delete (delegated) ---
    $('event-cards').addEventListener('click', async (e) => {
        const selectBtn = e.target.closest('.btn-select-event');
        if (selectBtn) {
            selectEvent(selectBtn.dataset.id);
            return;
        }
        const editBtn = e.target.closest('.btn-edit-event');
        if (editBtn) {
            openEventEditor(editBtn.dataset.id);
            return;
        }
        const deleteBtn = e.target.closest('.btn-delete-event');
        if (deleteBtn) {
            const ev = getEvents().find(ev => ev.id === deleteBtn.dataset.id);
            if (!ev) return;
            if (!confirm(`Move "${ev.name}" to Old Events?\n\nYou can restore it later from the Old Events section.`)) return;
            archiveEvent(ev.id);
            pushArchiveEvent(ev.id);
            renderEventOverlay();
        }
    });

    // --- Archived events: Restore / Permanently Delete (delegated) ---
    $('archived-events').addEventListener('click', async (e) => {
        const restoreBtn = e.target.closest('.btn-restore-event');
        if (restoreBtn) {
            const ev = restoreEvent(restoreBtn.dataset.id);
            if (ev) pushRestoreEvent(ev.id);
            renderEventOverlay();
            return;
        }
        const permDeleteBtn = e.target.closest('.btn-perm-delete-event');
        if (permDeleteBtn) {
            const archived = getArchivedEvents();
            const ev = archived.find(a => a.id === permDeleteBtn.dataset.id);
            if (!ev) return;
            if (!confirm(`Permanently delete "${ev.name}"?\n\nThis will also delete all scores for this event.\n\nThis cannot be undone.`)) return;
            permanentlyDeleteEvent(ev.id);
            await deleteScoresByEventId(ev.id);
            pushPermanentlyDeleteEvent(ev.id, ev);
            renderEventOverlay();
        }
    });

    // --- Event Editor: close, done, add competitor, import ---
    $('event-editor-close').addEventListener('click', () => {
        saveEventEditorFields();
        const wasEditingId = editingEventId;
        closeEventEditor();
        // Auto-push changes to cloud (admin only)
        if (wasEditingId && isAdminLoggedIn()) pushEventConfig(wasEditingId);
        if (wasEditingId === getActiveEventId()) {
            refreshAfterEventChange();
        }
    });
    $('event-editor-done').addEventListener('click', () => {
        saveEventEditorFields();
        const wasEditingId = editingEventId;
        closeEventEditor();
        // Auto-push updated event to cloud (admin only)
        if (wasEditingId && isAdminLoggedIn()) pushEventConfig(wasEditingId);
        // If this event is the active one, refresh the main UI
        if (wasEditingId === getActiveEventId()) {
            refreshAfterEventChange();
        }
    });
    $('edit-add-competitor-btn').addEventListener('click', () => {
        const name = $('edit-competitor-name').value.trim();
        const div  = $('edit-competitor-division').value.trim();
        if (!name || !editingEventId) return;
        const ev = getEventById(editingEventId);
        if (!ev) return;
        if (ev.competitors.find(p => p.name === name)) return;
        ev.competitors.push({ name, division: div });
        ev.competitors.sort((a, b) => a.name.localeCompare(b.name));
        updateEvent(editingEventId, { competitors: ev.competitors });
        $('edit-competitor-name').value = '';
        $('edit-competitor-division').value = '';
        renderEditCompetitorsList();
    });
    $('edit-competitor-name').addEventListener('keypress', e => {
        if (e.key === 'Enter') { e.preventDefault(); $('edit-add-competitor-btn').click(); }
    });
    $('edit-import-excel').addEventListener('change', async (e) => {
        if (!e.target.files[0] || !editingEventId) return;
        await importCompetitorsToEvent(e.target.files[0], editingEventId);
        e.target.value = '';
        renderEditCompetitorsList();
    });

    // --- Header: Switch Event button ---
    $('change-event-btn').addEventListener('click', showEventOverlay);

    // --- Event Editor: add stage ---
    $('edit-add-stage-btn').addEventListener('click', () => {
        const name = $('edit-stage-name').value.trim();
        if (!name || !editingEventId) return;
        const ev = getEventById(editingEventId);
        if (!ev) return;
        if (ev.stages.find(s => s.name === name)) { alert(`Stage "${name}" already exists.`); return; }
        const stageType = $('edit-stage-type').value || 'standard_rng';
        if (stageType === 'run_time' && ev.stages.some(s => (s.type || 'standard_rng') === 'run_time')) {
            alert('Only one Run Time stage is allowed per event.');
            return;
        }
        ev.stages.push({
            name,
            type:    stageType,
            targets: $('edit-stage-targets').value.trim(),
            par:     $('edit-stage-par').value.trim()
        });
        updateEvent(editingEventId, { stages: ev.stages });
        $('edit-stage-name').value = '';
        $('edit-stage-type').value = 'standard_rng';
        $('edit-stage-targets').value = '';
        $('edit-stage-targets').style.display = '';
        $('edit-stage-par').value = '';
        $('edit-stage-par').style.display = '';
        renderEditStagesList();
    });
    $('edit-stage-type').addEventListener('change', () => {
        const isRunTime = $('edit-stage-type').value === 'run_time';
        $('edit-stage-targets').style.display = isRunTime ? 'none' : '';
        $('edit-stage-par').style.display     = isRunTime ? 'none' : '';
        if (isRunTime) {
            $('edit-stage-targets').value = '';
            $('edit-stage-par').value = '';
            if (!$('edit-stage-name').value.trim()) $('edit-stage-name').value = 'Run Time';
        }
    });
    $('edit-stage-name').addEventListener('keypress', e => {
        if (e.key === 'Enter') { e.preventDefault(); $('edit-add-stage-btn').click(); }
    });

    // --- Score Entry tab ---
    $('stage').addEventListener('change', () => {
        showStageInfo();
        toggleStageTypeFields();
        updateScoredShooterStyles();
        updateActiveRunners();
        checkAndFillPendingStart();
    });
    $('player-name').addEventListener('change', () => {
        showShooterDivision();
        checkAndFillPendingStart();
    });
    $('dnf').addEventListener('change', () => {
        toggleDNFFields();
        toggleStageTypeFields();
    });
    toggleDNFFields();
    toggleStageTypeFields();

    // --- Initialize HH:MM:SS auto-format inputs ---
    initHmsInput($('run-start-time'));
    initHmsInput($('run-finish-time'));
    initMsInput($('wait-time'));

    // --- Start Time "Now" button ---
    $('start-now-btn').addEventListener('click', () => {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        $('run-start-time').value = `${hh}:${mm}:${ss}`;
    });

    // --- Finish Time "Now" button ---
    $('finish-now-btn').addEventListener('click', () => {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        $('run-finish-time').value = `${hh}:${mm}:${ss}`;
    });

    // --- Save Start Time button (Run Time stages) ---
    $('save-start-btn').addEventListener('click', () => {
        const stageName  = $('stage').value;
        const playerName = $('player-name').value;
        const eventId    = getActiveEventId();
        if (!stageName || !playerName || !eventId) {
            const err = $('form-error');
            err.textContent = 'Select a stage and shooter first.';
            err.style.display = 'block';
            return;
        }
        const startHms = $('run-start-time').value.trim();
        const startSec = parseHmsToSeconds(startHms);
        if (isNaN(startSec) || startSec === 0) {
            const err = $('form-error');
            err.textContent = 'Enter a valid start time (HH:MM:SS) before saving.';
            err.style.display = 'block';
            return;
        }
        $('form-error').style.display = 'none';
        savePendingStart(eventId, stageName, playerName, startHms);
        // Show brief confirmation
        const info = $('saved-start-info');
        info.textContent = `⏱ Start time saved for ${playerName}`;
        info.style.display = 'block';
        setTimeout(() => { info.style.display = 'none'; }, 3000);
        // Reset shooter dropdown to allow entering another
        $('player-name').value = '';
        $('run-start-time').value = '';
        $('run-finish-time').value = '';
        showShooterDivision();
        updateActiveRunners();
    });

    // --- Active runners toggle (expand/collapse) ---
    $('active-runners-toggle').addEventListener('click', () => {
        const list = $('active-runners-list');
        const chevron = document.querySelector('.active-runners-chevron');
        if (list.style.display === 'none') {
            list.style.display = '';
            if (chevron) chevron.textContent = '▾';
        } else {
            list.style.display = 'none';
            if (chevron) chevron.textContent = '▸';
        }
    });

    // --- Scores tab ---
    $('sync-btn').addEventListener('click', syncScores);
    $('export-excel-btn').addEventListener('click', exportToExcel);
    updateSyncStatus();

    // --- Settings: sync URL ---
    $('settings-btn').addEventListener('click', promptSyncUrl);
    $('overlay-settings-btn').addEventListener('click', promptSyncUrl);
    $('settings-modal-close').addEventListener('click', closeSettingsModal);
    $('settings-pin-submit').addEventListener('click', unlockSettings);
    $('settings-pin-input').addEventListener('keydown', e => { if (e.key === 'Enter') unlockSettings(); });
    $('settings-save-btn').addEventListener('click', saveSettings);

    // --- Event Password modal ---
    function closeEventPasswordModal() {
        $('event-password-modal').style.display = 'none';
    }
    function submitEventPassword() {
        const modal = $('event-password-modal');
        const eventId = modal.dataset.eventId;
        const event = getEventById(eventId);
        if (!event) { closeEventPasswordModal(); return; }
        const entered = $('event-password-input').value;
        if (entered === event.password) {
            closeEventPasswordModal();
            setActiveEvent(eventId);
            hideEventOverlay();
            refreshAfterEventChange();
        } else {
            $('event-password-error').style.display = 'block';
        }
    }
    $('event-password-submit').addEventListener('click', submitEventPassword);
    $('event-password-cancel').addEventListener('click', closeEventPasswordModal);
    $('event-password-close').addEventListener('click', closeEventPasswordModal);
    $('event-password-input').addEventListener('keydown', e => { if (e.key === 'Enter') submitEventPassword(); });
    $('event-password-input').addEventListener('input', () => { $('event-password-error').style.display = 'none'; });

    // --- Admin login/logout buttons ---
    async function handleAdminToggle() {
        if (isAdminLoggedIn()) {
            adminLogout();
            updateAdminUI();
        } else {
            await requestAdminPin('log in as admin');
        }
    }
    $('admin-btn').addEventListener('click', handleAdminToggle);
    $('overlay-admin-btn').addEventListener('click', handleAdminToggle);

    // --- Populate UI for active event (immediate, from localStorage) ---
    if (getActiveEvent()) {
        populatePlayerDropdown();
        populateStageDropdown();
        updateActiveEventBar();
    }

    // --- Restore admin session state ---
    updateAdminUI();

    // --- Score confirmation modal ---
    let pendingScore = null;

    function showConfirmScoreModal(score) {
        pendingScore = score;
        const waitMin = Math.floor((score.waitTime || 0) / 60);
        const waitSec = (score.waitTime || 0) % 60;
        const waitStr = String(waitMin).padStart(2, '0') + ':' + String(waitSec).padStart(2, '0');

        let rows;
        if (score.stageType === 'run_time') {
            rows = [
                ['Stage', score.stage],
                ['Shooter', score.playerName],
                ['Division', score.division || '—'],
                ['Start Time', score.startTimeFormatted],
                ['Finish Time', score.finishTimeFormatted],
                ['Run Time (s)', score.time],
                ['Notes', score.notes || '—']
            ];
        } else {
            rows = [
                ['Stage', score.stage],
                ['Shooter', score.playerName],
                ['Division', score.division || '—'],
                ['DNF', score.dnf ? 'Yes' : 'No', score.dnf],
                ['Time (s)', score.dnf ? 'N/A' : score.time],
                ['Wait Time', waitStr],
                ['Targets Not Neutralized', score.targetsNotNeutralized || 0],
                ['Notes', score.notes || '—']
            ];
        }

        const html = rows.map(r => {
            const valClass = r[2] ? 'confirm-value dnf-flag' : 'confirm-value';
            return `<div class="confirm-row"><span class="confirm-label">${r[0]}</span><span class="${valClass}">${r[1]}</span></div>`;
        }).join('');

        $('confirm-score-details').innerHTML = html;
        $('confirm-score-modal').style.display = 'flex';
    }

    function closeConfirmScoreModal() {
        $('confirm-score-modal').style.display = 'none';
        pendingScore = null;
    }

    $('confirm-score-close').addEventListener('click', closeConfirmScoreModal);
    $('confirm-score-cancel').addEventListener('click', closeConfirmScoreModal);
    $('confirm-score-submit').addEventListener('click', async () => {
        if (!pendingScore) return;
        const score = pendingScore;
        closeConfirmScoreModal();

        try {
            await dbReady;
            await saveScore(score);
            // Clear pending start if this was a Run Time score
            if (score.stageType === 'run_time' && score.eventId) {
                clearPendingStart(score.eventId, score.stage, score.playerName);
            }
            const savedStage  = $('stage').value;
            const savedPlayer = $('player-name').value;
            $('score-form').reset();
            $('stage').value       = savedStage;
            $('player-name').value = savedPlayer;
            showShooterDivision();
            toggleDNFFields();
            await updateUI();
            updateScoredShooterStyles();
            updateActiveRunners();
            // Hide saved-start info banner
            if ($('saved-start-info')) $('saved-start-info').style.display = 'none';
        } catch (err) {
            console.error('Save error:', err);
            alert('Error saving score: ' + err.message);
        }
    });

    // --- Score form submission ---
    $('score-form').addEventListener('submit', async e => {
        e.preventDefault();
        const tnt       = parseInt($('targets-not-neutralized').value) || 0;
        const stageName = $('stage').value;
        const stage     = getStages().find(s => s.name === stageName);
        const stageType = stage?.type || 'standard_rng';
        const stageTargets = stage?.targets !== '' ? parseInt(stage?.targets) : NaN;

        // --- Run Time stage validation ---
        if (stageType === 'run_time') {
            const startHms  = $('run-start-time').value.trim();
            const finishHms = $('run-finish-time').value.trim();
            const startTotal = parseHmsToSeconds(startHms);
            const finTotal   = parseHmsToSeconds(finishHms);

            if (isNaN(startTotal)) {
                const err = $('form-error');
                err.textContent = 'Enter a valid start time (HH:MM:SS).';
                err.style.display = 'block';
                return;
            }
            if (isNaN(finTotal)) {
                const err = $('form-error');
                err.textContent = 'Enter a valid finish time (HH:MM:SS).';
                err.style.display = 'block';
                return;
            }
            if (finTotal <= startTotal) {
                const err = $('form-error');
                err.textContent = 'Finish time must be after start time.';
                err.style.display = 'block';
                return;
            }

            const runTime = Math.round((finTotal - startTotal) * 100) / 100;

            $('form-error').style.display = 'none';

            const playerName = $('player-name').value;
            await dbReady;
            const existing = await getEventScores();
            const isDuplicate = existing.some(s => s.playerName === playerName && s.stage === stageName);
            if (isDuplicate) {
                const confirmed = confirm(
                    `A score for "${playerName}" on "${stageName}" has already been recorded.\n\nAre you sure you want to add another entry?`
                );
                if (!confirmed) return;
            }

            const score = {
                eventId:               getActiveEventId(),
                stage:                 stageName,
                stageType:             'run_time',
                playerName,
                division:              getPlayerDivision($('player-name').value),
                time:                  runTime,
                startTime:             startTotal,
                finishTime:            finTotal,
                startTimeFormatted:    startHms,
                finishTimeFormatted:   finishHms,
                waitTime:              0,
                targetsNotNeutralized: 0,
                dnf:                   false,
                notes:                 $('notes').value
            };

            showConfirmScoreModal(score);
            return;
        }

        // --- Standard RNG Stage validation ---
        if ($('dnf').checked) {
            // DNF requires TNT > 0 and <= stage targets
            if (!isNaN(stageTargets)) {
                if (tnt <= 0 || tnt > stageTargets) {
                    const err = $('form-error');
                    err.textContent = 'Correct Targets Not Neutralized value.';
                    err.style.display = 'block';
                    return;
                }
            } else if (tnt <= 0) {
                const err = $('form-error');
                err.textContent = 'Correct Targets Not Neutralized value.';
                err.style.display = 'block';
                return;
            }
        }

        // Par time validation (only when not DNF)
        const shootTime = parseFloat($('time').value);
        const stagePar  = stage?.par !== '' && stage?.par != null ? parseFloat(stage.par) : NaN;
        if (!$('dnf').checked && !isNaN(stagePar) && stagePar > 0 && shootTime > stagePar) {
            const err = $('form-error');
            err.textContent = 'Shoot time is greater than stage par time.';
            err.style.display = 'block';
            return;
        }

        // Wait time warning (> 30 minutes)
        const waitTotalSec = parseMsToSeconds($('wait-time').value);
        if (isNaN(waitTotalSec)) {
            const err = $('form-error');
            err.textContent = 'Enter a valid wait time (MM:SS).';
            err.style.display = 'block';
            return;
        }
        const totalWaitMin = waitTotalSec / 60;
        if (totalWaitMin > 30) {
            const wm = Math.floor(waitTotalSec / 60);
            const ws = waitTotalSec % 60;
            if (!confirm(`Wait time is over 30 minutes (${wm}m ${ws}s).\n\nAre you sure this is correct?`)) return;
        }

        $('form-error').style.display = 'none';

        const playerName = $('player-name').value;

        // Duplicate check (event-scoped)
        await dbReady;
        const existing = await getEventScores();
        const isDuplicate = existing.some(s => s.playerName === playerName && s.stage === stageName);
        if (isDuplicate) {
            const confirmed = confirm(
                `A score for "${playerName}" on "${stageName}" has already been recorded.\n\nAre you sure you want to add another entry?`
            );
            if (!confirmed) return;
        }

        const score = {
            eventId:               getActiveEventId(),
            stage:                 stageName,
            stageType:             'standard_rng',
            playerName,
            division:              getPlayerDivision($('player-name').value),
            time:                  parseFloat($('time').value),
            waitTime:              parseMsToSeconds($('wait-time').value) || 0,
            targetsNotNeutralized: tnt,
            dnf:                   $('dnf').checked,
            notes:                 $('notes').value
        };

        showConfirmScoreModal(score);
    });
});

// Start the app
init();
