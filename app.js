/* =============================================================
   RNG Scoring App — Main Entry Point
   
   Load order (set in index.html):
     1. js/db.js       — IndexedDB operations & dbReady promise
     2. js/players.js  — Player/competitor CRUD (localStorage)
     3. js/stages.js   — Stage CRUD (localStorage)
     4. js/ui.js       — DOM rendering, dropdowns, display helpers
     5. js/excel.js    — Import/export with SheetJS
     6. js/sync.js     — Network sync
     7. app.js         — This file: init, service worker, events
   ============================================================= */

// DOM shorthand used by all modules
const $ = (id) => document.getElementById(id);

/* =============================================================
   Install Prompt (PWA "Add to Home Screen")
   ============================================================= */
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();                       // Stop the default mini-infobar
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
        await updateUI();
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
   UI Event Listeners — registered on page load, independent of DB
   ============================================================= */
document.addEventListener('DOMContentLoaded', () => {

    // --- Tab switching ---
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            $('tab-' + btn.dataset.tab).classList.add('active');
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

    // Show iOS-specific hint (Safari doesn't fire beforeinstallprompt)
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
    toggleDNFFields();  // Set initial visibility

    // --- Scores tab ---
    $('sync-btn').addEventListener('click', syncScores);
    $('export-excel-btn').addEventListener('click', exportToExcel);

    // --- Populate lists from localStorage ---
    populatePlayerDropdown();
    renderCompetitorsList();
    populateStageDropdown();
    renderStagesList();

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

        // Check for existing score for this shooter + stage
        await dbReady;
        const existing = await getAllScores();
        const isDuplicate = existing.some(s => s.playerName === playerName && s.stage === stageName);
        if (isDuplicate) {
            const confirmed = confirm(
                `A score for "${playerName}" on "${stageName}" has already been recorded.\n\nAre you sure you want to add another entry?`
            );
            if (!confirmed) return;
        }

        const score = {
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
