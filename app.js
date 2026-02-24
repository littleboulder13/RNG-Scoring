// Database setup
const DB_NAME = 'RNGScoringDB';
const DB_VERSION = 1;
const STORE_NAME = 'scores';
let db;

// Player management (stored in localStorage)
function getPlayers() {
    const raw = localStorage.getItem('rng_players');
    if (!raw) return [];
    const players = JSON.parse(raw);
    // Migrate old plain-string format to {name, division} objects
    const migrated = players.map(p => (typeof p === 'string' ? { name: p, division: '' } : p));
    // If migration was needed, save the updated format back
    if (players.some(p => typeof p === 'string')) {
        localStorage.setItem('rng_players', JSON.stringify(migrated));
    }
    return migrated;
}

function savePlayers(players) {
    localStorage.setItem('rng_players', JSON.stringify(players));
}

function addPlayer(name, division = '') {
    const players = getPlayers();
    if (!players.find(p => p.name === name)) {
        players.push({ name, division });
        players.sort((a, b) => a.name.localeCompare(b.name));
        savePlayers(players);
    }
    populatePlayerDropdown();
    renderCompetitorsList();
}

function removePlayer(name) {
    const players = getPlayers().filter(p => p.name !== name);
    savePlayers(players);
    populatePlayerDropdown();
    renderCompetitorsList();
}

function renderCompetitorsList() {
    const container = document.getElementById('competitors-list');
    if (!container) return;

    const players = getPlayers();
    if (players.length === 0) {
        container.innerHTML = '<div class="empty-state">No competitors yet. Add names above to get started.</div>';
        return;
    }

    container.innerHTML = players.map(p => `
        <div class="competitor-item">
            <div class="competitor-info">
                <span class="competitor-name">${p.name}</span>
                ${p.division ? `<span class="competitor-division-tag">${p.division}</span>` : ''}
            </div>
            <button class="btn-delete" data-name="${p.name}">Remove</button>
        </div>
    `).join('');

    container.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', () => removePlayer(btn.dataset.name));
    });
}

function populatePlayerDropdown() {
    const select = document.getElementById('player-name');
    const currentValue = select.value;
    
    // Clear existing options (keep the placeholder)
    select.innerHTML = '<option value="" disabled selected>Select shooter...</option>';
    
    const players = getPlayers();
    players.forEach(player => {
        const option = document.createElement('option');
        option.value = player.name;
        option.textContent = player.name;
        select.appendChild(option);
    });
    
    // Restore selection if it still exists
    if (currentValue && players.find(p => p.name === currentValue)) {
        select.value = currentValue;
    }
}

// Stage management (stored in localStorage)
function getStages() {
    const raw = localStorage.getItem('rng_stages');
    if (!raw) return [];
    const stages = JSON.parse(raw);
    // Migrate old plain-string format to {name, targets} objects
    return stages.map(s => (typeof s === 'string' ? { name: s, targets: '' } : s));
}

function saveStages(stages) {
    localStorage.setItem('rng_stages', JSON.stringify(stages));
}

function addStage(name, targets = '') {
    const stages = getStages();
    if (!stages.find(s => s.name === name)) {
        stages.push({ name, targets });
        saveStages(stages);
    }
    populateStageDropdown();
    renderStagesList();
}

function removeStage(name) {
    const stages = getStages().filter(s => s.name !== name);
    saveStages(stages);
    populateStageDropdown();
    renderStagesList();
}

function renderStagesList() {
    const container = document.getElementById('stages-list');
    if (!container) return;

    const stages = getStages();
    if (stages.length === 0) {
        container.innerHTML = '<div class="empty-state">No stages yet. Add stages above to get started.</div>';
        return;
    }

    container.innerHTML = stages.map(stage => `
        <div class="competitor-item">
            <span class="competitor-name">${stage.name}${stage.targets ? ` <em style="color:#888;font-size:0.85em">(${stage.targets} targets)</em>` : ''}</span>
            <button class="btn-delete" data-name="${stage.name}">Remove</button>
        </div>
    `).join('');

    container.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', () => removeStage(btn.dataset.name));
    });
}

function populateStageDropdown() {
    const select = document.getElementById('stage');
    if (!select) return;
    const currentValue = select.value;
    select.innerHTML = '<option value="" disabled selected>Select stage...</option>';
    const stages = getStages();
    stages.forEach(stage => {
        const option = document.createElement('option');
        option.value = stage.name;
        option.textContent = stage.name;
        select.appendChild(option);
    });
    if (currentValue && stages.find(s => s.name === currentValue)) {
        select.value = currentValue;
    }
}

function showStageInfo() {
    const stageName = document.getElementById('stage')?.value;
    const display = document.getElementById('stage-info-display');
    if (!display) return;
    const stage = getStages().find(s => s.name === stageName);
    display.textContent = stage && stage.targets ? `Targets: ${stage.targets}` : '';
}

// Look up a competitor's division by name
function getPlayerDivision(name) {
    const player = getPlayers().find(p => p.name === name);
    return player ? (player.division || '') : '';
}

// Show the selected shooter's division below the dropdown
function showShooterDivision() {
    const name = document.getElementById('player-name').value;
    const el = document.getElementById('shooter-division-display');
    if (!el) return;
    const division = getPlayerDivision(name);
    if (division) {
        el.textContent = `Division: ${division}`;
        el.style.display = 'block';
    } else {
        el.textContent = '';
        el.style.display = 'none';
    }
}

// Import competitors from the first sheet of an Excel file
// Expected: Column A = Name, Column B = Division (optional header row is skipped)
async function importFromExcel(file) {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const players = getPlayers();
    let imported = 0;
    rows.forEach(row => {
        const name = (row[0] || '').toString().trim();
        const division = (row[1] || '').toString().trim();
        // Skip blank rows and header rows
        if (!name || ['name', 'shooter', 'competitor'].includes(name.toLowerCase())) return;
        // Skip duplicates
        if (players.find(p => p.name === name)) return;
        players.push({ name, division });
        imported++;
    });

    if (imported === 0) {
        alert('No new competitors found to import.\n\nMake sure:\n• Column A = Name\n• Column B = Division\n• First sheet is the competitor list');
        return;
    }

    players.sort((a, b) => a.name.localeCompare(b.name));
    savePlayers(players);
    populatePlayerDropdown();
    renderCompetitorsList();
    alert(`Successfully imported ${imported} competitor(s).`);
}

// Initialize IndexedDB
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                store.createIndex('timestamp', 'timestamp', { unique: false });
                store.createIndex('synced', 'synced', { unique: false });
            }
        };
    });
}

// Save score to IndexedDB
async function saveScore(score) {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    score.timestamp = new Date().toISOString();
    score.synced = 0;
    
    return new Promise((resolve, reject) => {
        const request = store.add(score);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Get all scores from IndexedDB
async function getAllScores() {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    
    return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Get pending (unsynced) scores
async function getPendingScores() {
    const scores = await getAllScores();
    return scores.filter(s => !s.synced);
}

// Mark score as synced
async function markAsSynced(id) {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    return new Promise((resolve, reject) => {
        const getRequest = store.get(id);
        getRequest.onsuccess = () => {
            const score = getRequest.result;
            score.synced = 1;
            const updateRequest = store.put(score);
            updateRequest.onsuccess = () => resolve();
            updateRequest.onerror = () => reject(updateRequest.error);
        };
        getRequest.onerror = () => reject(getRequest.error);
    });
}

// Sync scores to server
async function syncScores() {
    if (!navigator.onLine) {
        alert('Cannot sync while offline');
        return;
    }
    
    const pendingScores = await getPendingScores();
    
    if (pendingScores.length === 0) {
        alert('No scores to sync');
        return;
    }
    
    try {
        // TODO: Replace with your actual API endpoint
        const response = await fetch('https://your-api-endpoint.com/api/scores', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(pendingScores)
        });
        
        if (response.ok) {
            // Mark all as synced
            for (const score of pendingScores) {
                await markAsSynced(score.id);
            }
            alert(`Successfully synced ${pendingScores.length} scores`);
            updateUI();
        } else {
            throw new Error('Sync failed');
        }
    } catch (error) {
        console.error('Sync error:', error);
        alert('Sync failed. Scores are saved locally and will sync when possible.');
    }
}

// Format total seconds as m:ss
function formatWaitTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

// Export all scores to Excel with one sheet per stage
async function exportToExcel() {
    const allScores = await getAllScores();
    const players = getPlayers();
    const stages = getStages();

    if (stages.length === 0) {
        alert('No stages found. Add stages first.');
        return;
    }
    if (players.length === 0) {
        alert('No competitors found. Add competitors first.');
        return;
    }

    // Sort scores oldest first so the first recorded run is used when a shooter has multiple entries
    allScores.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const wb = XLSX.utils.book_new();
    const headers = ['#', 'Shooter', 'Division', 'Time (s)', 'Wait Time (m:ss)', 'Targets Not Neutralized', 'Notes'];

    stages.forEach(stage => {
        // All scores for this stage, in input order
        const stageScores = allScores.filter(s => s.stage === stage.name);

        // Build a lookup: playerName -> score (first recorded run)
        const scoreMap = {};
        stageScores.forEach(s => {
            if (!scoreMap[s.playerName]) scoreMap[s.playerName] = s;
        });

        // One row per competitor in competitor-list order; fill score if it exists
        const rows = players.map((p, i) => {
            const s = scoreMap[p.name];
            if (s) {
                return [
                    i + 1,
                    p.name,
                    p.division || '',
                    s.dnf ? 'DNF' : s.time,
                    formatWaitTime(s.waitTime),
                    s.targetsNotNeutralized,
                    s.notes || ''
                ];
            } else {
                return [i + 1, p.name, p.division || '', '', '', '', '', '', ''];
            }
        });

        const wsData = [headers, ...rows];
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        XLSX.utils.book_append_sheet(wb, ws, stage.name.substring(0, 31));
    });

    // Also add a sheet for any scores recorded against stages not in the stage list
    const knownStageNames = new Set(stages.map(s => s.name));
    const orphanScores = allScores.filter(s => s.stage && !knownStageNames.has(s.stage));
    if (orphanScores.length > 0) {
        const orphanStages = [...new Set(orphanScores.map(s => s.stage))];
        orphanStages.forEach(stageName => {
            const stageScores = orphanScores.filter(s => s.stage === stageName);
            const wsData = [
                headers,
                ...stageScores.map((s, i) => [
                    i + 1,
                    s.playerName || '',
                    s.division || '',
                    s.dnf ? 'DNF' : s.time,
                    formatWaitTime(s.waitTime),
                    s.targetsNotNeutralized,
                    s.notes || ''
                ])
            ];
            const ws = XLSX.utils.aoa_to_sheet(wsData);
            XLSX.utils.book_append_sheet(wb, ws, stageName.substring(0, 31));
        });
    }

    XLSX.writeFile(wb, `rng-scores-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// Update UI with scores
async function updateUI() {
    const scores = await getAllScores();
    const pending = await getPendingScores();
    
    // Update pending count
    document.getElementById('pending-count').textContent = pending.length;
    
    // Display scores
    const container = document.getElementById('scores-container');
    
    if (scores.length === 0) {
        container.innerHTML = '<div class="empty-state">No scores yet. Add your first score above!</div>';
        return;
    }
    
    // Sort by timestamp (newest first)
    scores.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    container.innerHTML = scores.map(score => `
        <div class="score-item ${score.synced ? 'synced' : 'pending'}">
            <div class="score-info">
                <h3>${score.playerName}${score.division ? ` <span class="score-division-tag">${score.division}</span>` : ''}</h3>
                ${score.stage ? `<div class="score-stage-badge">${score.stage}</div>` : ''}
                <div class="score-meta">
                    ${new Date(score.timestamp).toLocaleString()}
                    ${score.notes ? `<br>📝 ${score.notes}` : ''}
                    <br><em>${score.synced ? '✓ Synced' : '⏳ Pending sync'}</em>
                </div>
            </div>
            <div class="score-details">
                <div class="score-value ${score.dnf ? 'dnf' : ''}">${score.dnf ? 'DNF' : score.time + 's'}</div>
                <div class="score-stats">
                    <span>Wait: ${formatWaitTime(score.waitTime)}</span>
                    <span>TNT: ${score.targetsNotNeutralized}</span>
                </div>
            </div>
        </div>
    `).join('');
}

// Handle online/offline status
function updateOnlineStatus() {
    const indicator = document.getElementById('online-status');
    const text = document.getElementById('status-text');
    
    if (navigator.onLine) {
        indicator.classList.remove('offline');
        indicator.classList.add('online');
        text.textContent = 'Online';
    } else {
        indicator.classList.remove('online');
        indicator.classList.add('offline');
        text.textContent = 'Offline';
    }
}

// Resolves when the DB is ready — used by the form submit handler
let resolveDbReady;
const dbReady = new Promise(resolve => { resolveDbReady = resolve; });

// Initialize app
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

    // Sync button
    document.getElementById('sync-btn').addEventListener('click', syncScores);

    // Export Excel button
    document.getElementById('export-excel-btn').addEventListener('click', exportToExcel);

    // Online/offline listeners
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    // Auto-sync when coming online
    window.addEventListener('online', async () => {
        const pending = await getPendingScores();
        if (pending.length > 0) {
            setTimeout(syncScores, 1000);
        }
    });
}

// Register service worker for offline capability
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js')
            .then(reg => console.log('Service Worker registered'))
            .catch(err => console.error('Service Worker registration failed:', err));
    });
}

// UI event listeners — registered immediately on page load, independent of DB
document.addEventListener('DOMContentLoaded', () => {

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        });
    });

    // Add competitor button
    document.getElementById('add-competitor-btn').addEventListener('click', () => {
        const nameInput = document.getElementById('competitor-name-input');
        const divInput = document.getElementById('competitor-division-input');
        const name = nameInput.value.trim();
        const division = divInput.value.trim();
        if (name) {
            addPlayer(name, division);
            nameInput.value = '';
            divInput.value = '';
        }
    });

    document.getElementById('competitor-name-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('add-competitor-btn').click(); }
    });

    // Add stage button
    document.getElementById('add-stage-mgmt-btn').addEventListener('click', () => {
        const nameInput = document.getElementById('stage-name-input');
        const targetsInput = document.getElementById('stage-targets-input');
        const name = nameInput.value.trim();
        if (name) {
            addStage(name, targetsInput.value.trim());
            nameInput.value = '';
            targetsInput.value = '';
        }
    });

    document.getElementById('stage-name-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('add-stage-mgmt-btn').click(); }
    });

    // Show stage target count when stage changes
    document.getElementById('stage').addEventListener('change', showStageInfo);

    // Show division when shooter changes
    document.getElementById('player-name').addEventListener('change', showShooterDivision);

    // Import from Excel
    document.getElementById('import-excel-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            importFromExcel(file);
            e.target.value = '';
        }
    });

    // Populate all dropdowns and lists from localStorage
    populatePlayerDropdown();
    renderCompetitorsList();
    populateStageDropdown();
    renderStagesList();
    showShooterDivision();

    // Form submission — waits for DB to be ready before saving
    document.getElementById('score-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        const score = {
            stage: document.getElementById('stage').value,
            playerName: document.getElementById('player-name').value,
            division: getPlayerDivision(document.getElementById('player-name').value),
            time: parseFloat(document.getElementById('time').value),
            waitTime: (parseInt(document.getElementById('wait-time-min').value) || 0) * 60
                    + (parseInt(document.getElementById('wait-time-sec').value) || 0),
            targetsNotNeutralized: parseInt(document.getElementById('targets-not-neutralized').value) || 0,
            dnf: document.getElementById('dnf').checked,
            notes: document.getElementById('notes').value
        };

        try {
            await dbReady;
            await saveScore(score);

            // Keep the selected stage and player, reset everything else
            const selectedStage = document.getElementById('stage').value;
            const selectedPlayer = document.getElementById('player-name').value;
            e.target.reset();
            document.getElementById('stage').value = selectedStage;
            document.getElementById('player-name').value = selectedPlayer;
            showShooterDivision();

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
