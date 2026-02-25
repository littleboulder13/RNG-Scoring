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

// Admin session state — reset when switching events
let adminAuthenticated = false;

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

        // Show overlay or refresh based on active event
        if (getActiveEvent()) {
            await refreshAfterEventChange();
        } else {
            showEventOverlay();
        }
    } catch (err) {
        console.error('App init error:', err);
        alert('Error initialising database: ' + err.message);
    }

    updateOnlineStatus();
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    window.addEventListener('online', async () => {
        if ((await getPendingScores()).length) setTimeout(syncScores, 1000);
    });
}

// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js')
            .then(() => console.log('Service Worker registered'))
            .catch(err => console.error('SW registration failed:', err));
    });
}

/* =============================================================
   Event Overlay — Select / Create / Delete Events
   ============================================================= */
function showEventOverlay() {
    renderEventOverlay();
    $('event-overlay').style.display = 'flex';
    $('active-event-bar').style.display = 'none';
}

function hideEventOverlay() {
    $('event-overlay').style.display = 'none';
}

function selectEvent(id) {
    setActiveEvent(id);
    adminAuthenticated = false;
    hideEventOverlay();
    refreshAfterEventChange();
}

async function refreshAfterEventChange() {
    const event = getActiveEvent();
    if (!event) return;
    updateActiveEventBar();
    populatePlayerDropdown();
    renderCompetitorsList();
    populateStageDropdown();
    renderStagesList();
    showStageInfo();
    showShooterDivision();
    try { await updateUI(); } catch (e) { /* DB may not be ready yet */ }
}

/* =============================================================
   UI Event Listeners — registered on page load, independent of DB
   ============================================================= */
document.addEventListener('DOMContentLoaded', () => {

    // --- Tab switching (with admin PIN gate on Stages) ---
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;

            // PIN-protect Stages tab
            if (tab === 'stages' && !adminAuthenticated) {
                if (hasAdminPin()) {
                    if (!promptAdminPin('access Stages')) return;
                    adminAuthenticated = true;
                }
            }

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

    // --- Event overlay: Create event (admin PIN required) ---
    $('create-event-btn').addEventListener('click', () => {
        // Ensure admin PIN is set
        if (!hasAdminPin()) {
            const newPin = prompt('Set up your admin PIN.\n\nThis PIN will be required to create events and manage stages:');
            if (!newPin || !newPin.trim()) { alert('Admin PIN is required.'); return; }
            setAdminPin(newPin.trim());
            alert('Admin PIN saved! Remember this PIN.');
        } else {
            if (!promptAdminPin('create an event')) return;
        }

        const name = $('new-event-name').value.trim();
        if (!name) { alert('Please enter an event name.'); return; }
        const date = $('new-event-date').value;
        const event = createEvent(name, date);
        $('new-event-name').value = '';
        $('new-event-date').value = '';
        selectEvent(event.id);
    });

    // --- Event overlay: Select / Delete (delegated) ---
    $('event-cards').addEventListener('click', (e) => {
        const selectBtn = e.target.closest('.btn-select-event');
        if (selectBtn) {
            selectEvent(selectBtn.dataset.id);
            return;
        }
        const deleteBtn = e.target.closest('.btn-delete-event');
        if (deleteBtn) {
            const ev = getEvents().find(ev => ev.id === deleteBtn.dataset.id);
            if (!ev) return;
            if (hasAdminPin() && !promptAdminPin('delete this event')) return;
            if (!confirm(`Delete "${ev.name}"?\n\nThis removes the event and its stages/competitors. Scores in the database are kept.`)) return;
            deleteEvent(ev.id);
            renderEventOverlay();
        }
    });

    // --- Header: Switch Event button ---
    $('change-event-btn').addEventListener('click', showEventOverlay);

    // --- Set default date on create form ---
    $('new-event-date').valueAsDate = new Date();

    // --- Competitors tab ---
    $('add-competitor-btn').addEventListener('click', () => {
        const name = $('competitor-name-input').value.trim();
        const div  = $('competitor-division-input').value.trim();
        if (!name) return;
        addPlayer(name, div);
        $('competitor-name-input').value = '';
        $('competitor-division-input').value = '';
    });
    $('competitor-name-input').addEventListener('keypress', e => {
        if (e.key === 'Enter') { e.preventDefault(); $('add-competitor-btn').click(); }
    });
    $('import-excel-input').addEventListener('change', e => {
        if (e.target.files[0]) { importFromExcel(e.target.files[0]); e.target.value = ''; }
    });

    // --- Stages tab ---
    $('add-stage-mgmt-btn').addEventListener('click', () => {
        const name = $('stage-name-input').value.trim();
        if (!name) return;
        addStage(name, $('stage-targets-input').value.trim(), $('stage-par-input').value.trim());
        $('stage-name-input').value = '';
        $('stage-targets-input').value = '';
        $('stage-par-input').value = '';
    });
    $('stage-name-input').addEventListener('keypress', e => {
        if (e.key === 'Enter') { e.preventDefault(); $('add-stage-mgmt-btn').click(); }
    });

    // --- Score Entry tab ---
    $('stage').addEventListener('change', showStageInfo);
    $('player-name').addEventListener('change', showShooterDivision);
    $('dnf').addEventListener('change', toggleDNFFields);
    toggleDNFFields();

    // --- Scores tab ---
    $('sync-btn').addEventListener('click', syncScores);
    $('export-excel-btn').addEventListener('click', exportToExcel);

    // --- Populate UI for active event (immediate, from localStorage) ---
    if (getActiveEvent()) {
        populatePlayerDropdown();
        renderCompetitorsList();
        populateStageDropdown();
        renderStagesList();
        updateActiveEventBar();
    }

    // --- Score form submission ---
    $('score-form').addEventListener('submit', async e => {
        e.preventDefault();
        const tnt       = parseInt($('targets-not-neutralized').value) || 0;
        const stageName = $('stage').value;
        const stage     = getStages().find(s => s.name === stageName);
        const stageTargets = stage?.targets !== '' ? parseInt(stage?.targets) : NaN;

        if ($('dnf').checked && !isNaN(stageTargets) && tnt > stageTargets) {
            const err = $('form-error');
            err.textContent = "Targets not neutralized input is too high. Review the value input.";
            err.style.display = 'block';
            return;
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
            playerName,
            division:              getPlayerDivision($('player-name').value),
            time:                  parseFloat($('time').value),
            waitTime:              (parseInt($('wait-time-min').value) || 0) * 60
                                 + (parseInt($('wait-time-sec').value) || 0),
            targetsNotNeutralized: tnt,
            dnf:                   $('dnf').checked,
            notes:                 $('notes').value
        };

        try {
            await dbReady;
            await saveScore(score);
            const savedStage  = $('stage').value;
            const savedPlayer = $('player-name').value;
            e.target.reset();
            $('stage').value       = savedStage;
            $('player-name').value = savedPlayer;
            showShooterDivision();
            toggleDNFFields();
            await updateUI();
            alert('Score saved!');
        } catch (err) {
            console.error('Save error:', err);
            alert('Error saving score: ' + err.message);
        }
    });
});

// Start the app
init();
