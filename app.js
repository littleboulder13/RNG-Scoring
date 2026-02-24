/* ============================================================
   RNG Scoring App — Main Application Logic
   ============================================================ */

// --- Configuration & State -----------------------------------
const DB_NAME    = 'RNGScoringDB';
const DB_VERSION = 1;
const STORE_NAME = 'scores';
let db;

let resolveDbReady;
const dbReady = new Promise(r => { resolveDbReady = r; });

// DOM shorthand
const $ = (id) => document.getElementById(id);

/* =============================================================
   LOCAL STORAGE — Players
   ============================================================= */
function getPlayers() {
    const raw = localStorage.getItem('rng_players');
    if (!raw) return [];
    const arr = JSON.parse(raw);
    // Migrate old plain-string format → { name, division }
    if (arr.length && typeof arr[0] === 'string') {
        const migrated = arr.map(n => ({ name: n, division: '' }));
        localStorage.setItem('rng_players', JSON.stringify(migrated));
        return migrated;
    }
    return arr;
}

function savePlayers(list) {
    localStorage.setItem('rng_players', JSON.stringify(list));
}

function addPlayer(name, division = '') {
    const players = getPlayers();
    if (players.find(p => p.name === name)) return;
    players.push({ name, division });
    players.sort((a, b) => a.name.localeCompare(b.name));
    savePlayers(players);
    populatePlayerDropdown();
    renderCompetitorsList();
}

function removePlayer(name) {
    savePlayers(getPlayers().filter(p => p.name !== name));
    populatePlayerDropdown();
    renderCompetitorsList();
}

function getPlayerDivision(name) {
    const p = getPlayers().find(p => p.name === name);
    return p ? p.division || '' : '';
}

/* =============================================================
   LOCAL STORAGE — Stages
   ============================================================= */
function getStages() {
    const raw = localStorage.getItem('rng_stages');
    if (!raw) return [];
    // Migrate old plain-string format → { name, targets }
    return JSON.parse(raw).map(s =>
        typeof s === 'string' ? { name: s, targets: '' } : s
    );
}

function saveStages(list) {
    localStorage.setItem('rng_stages', JSON.stringify(list));
}

function addStage(name, targets = '', par = '') {
    const stages = getStages();
    if (stages.find(s => s.name === name)) return;
    stages.push({ name, targets, par });
    saveStages(stages);
    populateStageDropdown();
    renderStagesList();
}

function removeStage(name) {
    saveStages(getStages().filter(s => s.name !== name));
    populateStageDropdown();
    renderStagesList();
}

/* =============================================================
   UI — Render Lists & Dropdowns
   ============================================================= */
function renderCompetitorsList() {
    const el = $('competitors-list');
    if (!el) return;
    const players = getPlayers();

    if (!players.length) {
        el.innerHTML = '<div class="empty-state">No competitors yet. Add names above to get started.</div>';
        return;
    }

    el.innerHTML = players.map(p => `
        <div class="competitor-item">
            <div class="competitor-info">
                <span class="competitor-name">${p.name}</span>
                ${p.division ? `<span class="competitor-division-tag">${p.division}</span>` : ''}
            </div>
            <button class="btn-delete" data-name="${p.name}">Remove</button>
        </div>
    `).join('');

    el.querySelectorAll('.btn-delete').forEach(btn =>
        btn.addEventListener('click', () => removePlayer(btn.dataset.name))
    );
}

function populatePlayerDropdown() {
    const sel = $('player-name');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="" disabled selected>Select shooter...</option>';
    const players = getPlayers();
    players.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        sel.appendChild(opt);
    });
    if (prev && players.find(p => p.name === prev)) sel.value = prev;
}

function renderStagesList() {
    const el = $('stages-list');
    if (!el) return;
    const stages = getStages();

    if (!stages.length) {
        el.innerHTML = '<div class="empty-state">No stages yet. Add stages above to get started.</div>';
        return;
    }

    el.innerHTML = stages.map(s => {
        const meta = [
            s.targets ? `${s.targets} targets` : '',
            s.par     ? `PAR: ${s.par}s`        : ''
        ].filter(Boolean).join(' · ');
        return `
        <div class="competitor-item">
            <span class="competitor-name">
                ${s.name}${meta ? ` <em style="color:#888;font-size:0.85em">(${meta})</em>` : ''}
            </span>
            <button class="btn-delete" data-name="${s.name}">Remove</button>
        </div>`;
    }).join('');

    el.querySelectorAll('.btn-delete').forEach(btn =>
        btn.addEventListener('click', () => removeStage(btn.dataset.name))
    );
}

function populateStageDropdown() {
    const sel = $('stage');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="" disabled selected>Select stage...</option>';
    const stages = getStages();
    stages.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.name;
        opt.textContent = s.name;
        sel.appendChild(opt);
    });
    if (prev && stages.find(s => s.name === prev)) sel.value = prev;
}

function showStageInfo() {
    const display = $('stage-info-display');
    if (!display) return;
    const stage = getStages().find(s => s.name === $('stage')?.value);
    const parts = [
        stage?.targets ? `Targets: ${stage.targets}` : '',
        stage?.par     ? `PAR: ${stage.par}s`         : ''
    ].filter(Boolean);
    display.textContent = parts.join('  ·  ');
    display.style.display = parts.length ? 'block' : 'none';
}

function showShooterDivision() {
    const el = $('shooter-division-display');
    if (!el) return;
    const div = getPlayerDivision($('player-name').value);
    el.textContent = div ? `Division: ${div}` : '';
    el.style.display = div ? 'block' : 'none';
}

function toggleDNFFields() {
    const dnf = $('dnf').checked;
    if ($('time-row'))  $('time-row').style.display  = dnf ? 'none' : '';
    if ($('tnt-row'))   $('tnt-row').style.display   = dnf ? ''     : 'none';
    if ($('time'))      $('time').required = !dnf;
    if ($('dnf-group')) $('dnf-group').classList.toggle('dnf-active', dnf);
}

/* =============================================================
   UI — Scores Display & Online Status
   ============================================================= */
async function updateUI() {
    const scores  = await getAllScores();
    const pending = scores.filter(s => !s.synced);

    $('pending-count').textContent = pending.length;

    const el = $('scores-container');
    if (!scores.length) {
        el.innerHTML = '<div class="empty-state">No scores yet. Add your first score above!</div>';
        return;
    }

    scores.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Build a set of shooter+stage combos that appear more than once
    const comboCounts = {};
    scores.forEach(s => {
        const key = `${s.playerName}||${s.stage}`;
        comboCounts[key] = (comboCounts[key] || 0) + 1;
    });

    el.innerHTML = scores.map(s => {
        const isDup = comboCounts[`${s.playerName}||${s.stage}`] > 1;
        return `
        <div class="score-item ${s.synced ? 'synced' : 'pending'}${isDup ? ' duplicate' : ''}">
            <div class="score-info">
                <h3>${s.playerName}${s.division ? ` <span class="score-division-tag">${s.division}</span>` : ''}${isDup ? ' <span class="duplicate-badge">⚠ Duplicate</span>' : ''}</h3>
                ${s.stage ? `<div class="score-stage-badge">${s.stage}</div>` : ''}
                <div class="score-meta">
                    ${new Date(s.timestamp).toLocaleString()}
                    ${s.notes ? `<br>📝 ${s.notes}` : ''}
                    <br><em>${s.synced ? '✓ Synced' : '⏳ Pending sync'}</em>
                </div>
            </div>
            <div class="score-details">
                <div class="score-value ${s.dnf ? 'dnf' : ''}">${s.dnf ? 'DNF' : s.time + 's'}</div>
                <div class="score-stats">
                    <span>Wait: ${formatWaitTime(s.waitTime)}</span>
                    <span>TNT: ${s.targetsNotNeutralized}</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

function updateOnlineStatus() {
    const online = navigator.onLine;
    $('online-status').classList.toggle('online', online);
    $('online-status').classList.toggle('offline', !online);
    $('status-text').textContent = online ? 'Online' : 'Offline';
}

/* =============================================================
   EXCEL — Import
   ============================================================= */
async function importFromExcel(file) {
    const data = await file.arrayBuffer();
    const wb   = XLSX.read(data);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });

    const players     = getPlayers();
    const headerNames = new Set(['name', 'shooter', 'competitor']);
    let imported = 0;

    for (const row of rows) {
        const name     = String(row[0] || '').trim();
        const division = String(row[1] || '').trim();
        if (!name || headerNames.has(name.toLowerCase())) continue;
        if (players.find(p => p.name === name)) continue;
        players.push({ name, division });
        imported++;
    }

    if (!imported) {
        alert('No new competitors found to import.\n\nMake sure:\n• Column A = Name\n• Column B = Division\n• First sheet is the competitor list');
        return;
    }

    players.sort((a, b) => a.name.localeCompare(b.name));
    savePlayers(players);
    populatePlayerDropdown();
    renderCompetitorsList();
    alert(`Successfully imported ${imported} competitor(s).`);
}

/* =============================================================
   EXCEL — Export
   ============================================================= */
function formatWaitTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

async function exportToExcel() {
    const allScores = await getAllScores();
    const players   = getPlayers();
    const stages    = getStages();

    if (!stages.length)  return alert('No stages found. Add stages first.');
    if (!players.length) return alert('No competitors found. Add competitors first.');

    allScores.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const wb      = XLSX.utils.book_new();
    const headers = ['#', 'Shooter', 'Division', 'Time (s)', 'Wait Time (m:ss)', 'Targets Not Neutralized', 'Notes'];

    // Helper: build one row for a competitor
    const buildRow = (i, name, division, score) => score
        ? [i + 1, name, division, score.dnf ? 'DNF' : score.time,
           formatWaitTime(score.waitTime), score.targetsNotNeutralized, score.notes || '']
        : [i + 1, name, division, '', '', '', ''];

    // One sheet per stage — every competitor listed
    for (const stage of stages) {
        const scoreMap = {};
        allScores.filter(s => s.stage === stage.name).forEach(s => {
            if (!scoreMap[s.playerName]) scoreMap[s.playerName] = s;
        });
        const rows = players.map((p, i) => buildRow(i, p.name, p.division || '', scoreMap[p.name]));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), stage.name.substring(0, 31));
    }

    // Orphan scores (recorded against stages no longer in the list)
    const knownNames = new Set(stages.map(s => s.name));
    const orphans    = allScores.filter(s => s.stage && !knownNames.has(s.stage));
    for (const stageName of [...new Set(orphans.map(s => s.stage))]) {
        const rows = orphans.filter(s => s.stage === stageName)
            .map((s, i) => buildRow(i, s.playerName || '', s.division || '', s));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), stageName.substring(0, 31));
    }

    // Duplicates sheet — all scores where a shooter+stage combo appears more than once
    const comboCounts = {};
    allScores.forEach(s => {
        const key = `${s.playerName}||${s.stage}`;
        comboCounts[key] = (comboCounts[key] || 0) + 1;
    });

    const dupeScores = allScores.filter(s => comboCounts[`${s.playerName}||${s.stage}`] > 1);

    if (dupeScores.length) {
        // Track run instance per shooter+stage
        const instanceCounter = {};
        const dupeHeaders = ['#', 'Shooter', 'Division', 'Stage', 'Run #', 'Time (s)', 'Wait Time (m:ss)', 'Targets Not Neutralized', 'Notes'];
        const dupeRows = dupeScores.map((s, i) => {
            const key = `${s.playerName}||${s.stage}`;
            instanceCounter[key] = (instanceCounter[key] || 0) + 1;
            return [
                i + 1,
                s.playerName || '',
                s.division || '',
                s.stage || '',
                instanceCounter[key],
                s.dnf ? 'DNF' : s.time,
                formatWaitTime(s.waitTime),
                s.targetsNotNeutralized,
                s.notes || ''
            ];
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([dupeHeaders, ...dupeRows]), 'Duplicates');
    }

    XLSX.writeFile(wb, `rng-scores-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/* =============================================================
   INDEXEDDB — Database Operations
   ============================================================= */
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

/* =============================================================
   NETWORK SYNC
   ============================================================= */
async function syncScores() {
    if (!navigator.onLine) return alert('Cannot sync while offline');
    const pending = await getPendingScores();
    if (!pending.length) return alert('No scores to sync');

    try {
        // TODO: Replace with your actual API endpoint
        const res = await fetch('https://your-api-endpoint.com/api/scores', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pending)
        });
        if (!res.ok) throw new Error('Sync failed');
        for (const s of pending) await markAsSynced(s.id);
        alert(`Successfully synced ${pending.length} scores`);
        updateUI();
    } catch (err) {
        console.error('Sync error:', err);
        alert('Sync failed. Scores are saved locally and will sync when possible.');
    }
}

/* =============================================================
   INITIALIZATION & EVENT BINDING
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

// All UI event listeners — registered on page load, independent of DB
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
