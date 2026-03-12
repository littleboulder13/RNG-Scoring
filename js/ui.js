/* =============================================================
   UI — Render Lists, Dropdowns, Display Helpers
   ============================================================= */

/* =============================================================
   HH:MM:SS Auto-Format Input Helper
   As the user types digits, colons are inserted automatically.
   Accepts only digits; colons are managed by the formatter.
   ============================================================= */

/**
 * Attach auto-format behavior to an HH:MM:SS input element.
 * Call once per input during init.
 */
function initHmsInput(inputEl) {
    if (!inputEl) return;

    inputEl.addEventListener('input', () => {
        const raw = inputEl.value.replace(/\D/g, '').slice(-6);   // digits only, keep last 6
        const padded = raw.padStart(6, '0');                       // right-align digits
        const hh = padded.slice(0, 2);
        const mm = padded.slice(2, 4);
        const ss = padded.slice(4, 6);
        inputEl.value = raw.length ? `${hh}:${mm}:${ss}` : '';
    });

    // Prevent non-digit keys (allow navigation, backspace, tab, etc.)
    inputEl.addEventListener('keydown', (e) => {
        // Allow: backspace, delete, tab, escape, enter, arrows, home, end
        if ([8, 9, 13, 27, 46, 37, 38, 39, 40, 35, 36].includes(e.keyCode)) return;
        // Allow Ctrl/Cmd + A, C, V, X
        if ((e.ctrlKey || e.metaKey) && [65, 67, 86, 88].includes(e.keyCode)) return;
        // Block anything that isn't a digit
        if (e.key < '0' || e.key > '9') e.preventDefault();
    });
}

/**
 * Initialise a MM:SS auto-format input (right-fill, max 4 digits).
 */
function initMsInput(inputEl) {
    if (!inputEl) return;

    inputEl.addEventListener('input', () => {
        const raw = inputEl.value.replace(/\D/g, '').slice(-4);   // digits only, keep last 4
        const padded = raw.padStart(4, '0');
        const mm = padded.slice(0, 2);
        const ss = padded.slice(2, 4);
        inputEl.value = raw.length ? `${mm}:${ss}` : '';
    });

    inputEl.addEventListener('keydown', (e) => {
        if ([8, 9, 13, 27, 46, 37, 38, 39, 40, 35, 36].includes(e.keyCode)) return;
        if ((e.ctrlKey || e.metaKey) && [65, 67, 86, 88].includes(e.keyCode)) return;
        if (e.key < '0' || e.key > '9') e.preventDefault();
    });
}

/**
 * Parse a MM:SS string into total seconds.
 * Returns NaN if invalid.
 */
function parseMsToSeconds(ms) {
    if (!ms || typeof ms !== 'string') return 0;
    const clean = ms.replace(/\D/g, '');
    if (!clean) return 0;
    const padded = clean.padStart(4, '0');
    const m = parseInt(padded.slice(0, 2)) || 0;
    const s = parseInt(padded.slice(2, 4)) || 0;
    if (s > 59) return NaN;
    return m * 60 + s;
}

/**
 * Parse an HH:MM:SS string into total seconds.
 * Returns NaN if invalid.
 */
function parseHmsToSeconds(hms) {
    if (!hms || typeof hms !== 'string') return NaN;
    const parts = hms.split(':');
    if (parts.length === 3) {
        const h = parseInt(parts[0]) || 0;
        const m = parseInt(parts[1]) || 0;
        const s = parseInt(parts[2]) || 0;
        if (m > 59 || s > 59) return NaN;
        return h * 3600 + m * 60 + s;
    }
    if (parts.length === 2) {
        const m = parseInt(parts[0]) || 0;
        const s = parseInt(parts[1]) || 0;
        if (s > 59) return NaN;
        return m * 60 + s;
    }
    return NaN;
}

/**
 * Format total seconds into HH:MM:SS string.
 */
function formatSecondsToHms(totalSec) {
    if (totalSec == null || isNaN(totalSec)) return '';
    const sec = Math.round(totalSec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return String(h).padStart(2, '0') + ':' +
           String(m).padStart(2, '0') + ':' +
           String(s).padStart(2, '0');
}

// --- Player Dropdown ---
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
    // Update scored styling after populating
    updateScoredShooterStyles();
}

// Grey out shooters who already have a score on the selected stage
async function updateScoredShooterStyles() {
    const sel = $('player-name');
    const stageVal = $('stage')?.value;
    if (!sel || !stageVal) {
        // No stage selected — clear all styling
        Array.from(sel?.options || []).forEach(opt => {
            opt.style.color = '';
        });
        return;
    }
    try {
        await dbReady;
        const scores = await getEventScores();
        const scoredSet = new Set(
            scores.filter(s => s.stage === stageVal).map(s => s.playerName)
        );
        Array.from(sel.options).forEach(opt => {
            if (opt.value && scoredSet.has(opt.value)) {
                opt.style.color = '#aaa';
            } else {
                opt.style.color = '';
            }
        });
    } catch (_) { /* DB may not be ready */ }
}

// --- Stage Dropdown ---
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

// --- Score Entry Helpers ---
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

function getSelectedStageType() {
    const stageName = $('stage')?.value;
    if (!stageName) return 'standard_rng';
    const stage = getStages().find(s => s.name === stageName);
    return stage?.type || 'standard_rng';
}

function toggleStageTypeFields() {
    const stageType = getSelectedStageType();
    const isRunTime = stageType === 'run_time';
    const isStandard = !isRunTime;
    const dnf = $('dnf').checked;

    // Standard RNG fields
    if ($('dnf-group'))  $('dnf-group').style.display  = isStandard ? '' : 'none';
    if ($('time-row'))   $('time-row').style.display    = isStandard && !dnf ? '' : 'none';
    if ($('tnt-row'))    $('tnt-row').style.display     = isStandard && dnf ? '' : 'none';
    if ($('time'))       $('time').required = isStandard && !dnf;

    // Wait time — hidden for Run Time
    const waitTimeRow = document.querySelector('.form-group:has(#wait-time)');
    if (waitTimeRow) waitTimeRow.style.display = isRunTime ? 'none' : '';
    if (isRunTime) {
        if ($('wait-time')) $('wait-time').value = '';
    }

    // Run Time fields
    if ($('run-time-start-row'))  $('run-time-start-row').style.display  = isRunTime ? '' : 'none';
    if ($('run-time-finish-row')) $('run-time-finish-row').style.display = isRunTime ? '' : 'none';

    // Save Start button & active runners — only for Run Time
    if ($('run-time-save-start-row')) $('run-time-save-start-row').style.display = isRunTime ? '' : 'none';
    if (!isRunTime) {
        if ($('active-runners-row'))  $('active-runners-row').style.display  = 'none';
        if ($('saved-start-info'))    $('saved-start-info').style.display    = 'none';
    }

    // Clear hidden fields when switching
    if (isRunTime) {
        if ($('time')) $('time').value = '';
        if ($('targets-not-neutralized')) $('targets-not-neutralized').value = '0';
        if ($('dnf')) $('dnf').checked = false;
    } else {
        if ($('run-start-time'))  $('run-start-time').value  = '';
        if ($('run-finish-time')) $('run-finish-time').value = '';
    }
}

// --- Scores Display ---
async function updateUI() {
    const scores  = await getEventScores();
    const pending = scores.filter(s => !s.synced);

    $('pending-count').textContent = pending.length;

    const el = $('scores-container');
    if (!scores.length) {
        el.innerHTML = '<div class="empty-state">No scores yet. Add your first score above!</div>';
        return;
    }

    scores.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Detect duplicates (shooter+stage appearing more than once)
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
                    ${s.stageType === 'run_time' ? `<span>${s.startTimeFormatted || ''} → ${s.finishTimeFormatted || ''}</span>` : ''}
                    ${s.stageType !== 'run_time' ? `<span>Wait: ${formatWaitTime(s.waitTime)}</span>` : ''}
                    ${s.stageType !== 'run_time' ? `<span>TNT: ${s.targetsNotNeutralized}</span>` : ''}
                </div>
            </div>
        </div>`;
    }).join('');
}

// --- Online/Offline Status ---
function updateOnlineStatus() {
    const online = navigator.onLine;
    $('online-status').classList.toggle('online', online);
    $('online-status').classList.toggle('offline', !online);
    $('status-text').textContent = online ? 'Online' : 'Offline';
}

// --- Event Overlay ---
function renderEventOverlay() {
    const cardsEl = $('event-cards');
    if (!cardsEl) return;

    // Always sync version badges from JS constant (survives stale HTML cache)
    if (typeof APP_VERSION !== 'undefined') {
        const versionEl = $('app-version');
        if (versionEl) versionEl.textContent = APP_VERSION;
        const versionHeader = $('app-version-header');
        if (versionHeader) versionHeader.textContent = APP_VERSION;
    }

    const events = getEvents();

    if (!events.length) {
        cardsEl.innerHTML = '<div class="empty-state">No events yet. Create your first event below.</div>';
    } else {
        cardsEl.innerHTML = events.map(e => `
            <div class="event-card">
                <div class="event-card-info">
                    <h3>${e.password ? '🔒 ' : ''}${e.name}</h3>
                    <div class="event-card-meta">
                        \uD83C\uDFAF ${e.stages.length} stage${e.stages.length !== 1 ? 's' : ''}
                        &nbsp;·&nbsp; \uD83D\uDC65 ${e.competitors.length} shooter${e.competitors.length !== 1 ? 's' : ''}
                    </div>
                </div>
                <div class="event-card-actions">
                    <button class="btn-edit-event admin-only" data-id="${e.id}">✎ Edit</button>
                    <button class="btn-select-event" data-id="${e.id}">Select</button>
                    <button class="btn-delete-event admin-only" data-id="${e.id}">\u2715</button>
                </div>
            </div>
        `).join('');
    }

    // Archived (old) events — admin only
    renderArchivedEvents();
}

function renderArchivedEvents() {
    const el = $('archived-events');
    if (!el) return;
    const archived = getArchivedEvents();

    if (!archived.length) {
        el.innerHTML = '';
        return;
    }

    el.innerHTML = `
        <h3 class="archived-events-title">Old Events</h3>
        ${archived.map(e => `
            <div class="event-card archived-event-card">
                <div class="event-card-info">
                    <h3>${e.name}</h3>
                    <div class="event-card-meta">
                        \uD83C\uDFAF ${e.stages.length} stage${e.stages.length !== 1 ? 's' : ''}
                        &nbsp;·&nbsp; \uD83D\uDC65 ${e.competitors.length} shooter${e.competitors.length !== 1 ? 's' : ''}
                    </div>
                </div>
                <div class="event-card-actions">
                    <button class="btn-restore-event" data-id="${e.id}">↩ Restore</button>
                    <button class="btn-perm-delete-event" data-id="${e.id}">\uD83D\uDDD1 Delete</button>
                </div>
            </div>
        `).join('')}
    `;
}

// --- Active Event Header Bar ---
function updateActiveEventBar() {
    const event = getActiveEvent();
    const bar = $('active-event-bar');
    if (!bar) return;
    if (event) {
        $('active-event-name').textContent = event.name;
        bar.style.display = '';
    } else {
        bar.style.display = 'none';
    }
}

/* =============================================================
   Event Editor — open / close / save / competitor list
   ============================================================= */
let editingEventId = null;

function openEventEditor(eventId) {
    const ev = getEventById(eventId);
    if (!ev) return;
    editingEventId = eventId;

    // Populate fields
    $('event-editor-title').textContent = `Edit: ${ev.name}`;
    $('edit-event-name').value = ev.name;
    $('edit-event-password').value = ev.password || '';
    $('edit-event-scoring').value = ev.scoringMethod || 'percentile_dnf0';
    renderEditCompetitorsList();
    renderEditStagesList();

    // Hide the cards, create section & cloud bar; show editor
    $('event-cards').style.display = 'none';
    document.querySelector('.event-create-section').style.display = 'none';
    $('event-editor').style.display = '';
}

function closeEventEditor() {
    editingEventId = null;
    $('event-editor').style.display = 'none';
    $('event-cards').style.display = '';
    document.querySelector('.event-create-section').style.display = '';
    renderEventOverlay();
}

function saveEventEditorFields() {
    if (!editingEventId) return;
    const name = $('edit-event-name').value.trim();
    if (!name) return;
    const password = ($('edit-event-password').value || '').trim();
    const scoringMethod = $('edit-event-scoring').value || 'percentile_dnf0';
    updateEvent(editingEventId, { name, password, scoringMethod });
}

function renderEditCompetitorsList() {
    const el = $('edit-competitors-list');
    if (!el || !editingEventId) return;
    const ev = getEventById(editingEventId);
    if (!ev) return;

    if (!ev.competitors.length) {
        el.innerHTML = '<div class="empty-state">No competitors yet.</div>';
        return;
    }

    el.innerHTML = ev.competitors.map(p => `
        <div class="competitor-item">
            <div class="stage-view">
                <div class="competitor-info">
                    <span class="competitor-name">${p.name}</span>
                    ${p.division ? `<span class="competitor-division-tag">${p.division}</span>` : ''}
                </div>
                <div class="item-actions">
                    <button class="btn-delete" data-name="${p.name}">Remove</button>
                </div>
            </div>
        </div>
    `).join('');

    // Wire up remove buttons
    el.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', () => {
            const evNow = getEventById(editingEventId);
            if (!evNow) return;
            evNow.competitors = evNow.competitors.filter(c => c.name !== btn.dataset.name);
            updateEvent(editingEventId, { competitors: evNow.competitors });
            renderEditCompetitorsList();
        });
    });
}

function renderEditStagesList() {
    const el = $('edit-stages-list');
    if (!el || !editingEventId) return;
    const ev = getEventById(editingEventId);
    if (!ev) return;

    if (!ev.stages.length) {
        el.innerHTML = '<div class="empty-state">No stages yet.</div>';
        return;
    }

    var STAGE_TYPE_LABELS = { 'standard_rng': 'Standard RNG Stage', 'run_time': 'Run Time' };
    el.innerHTML = ev.stages.map(s => {
        const typeLabel = STAGE_TYPE_LABELS[s.type || 'standard_rng'] || s.type || 'Standard RNG Stage';
        const meta = [
            typeLabel,
            s.targets ? `${s.targets} targets` : '',
            s.par     ? `PAR: ${s.par}s`        : ''
        ].filter(Boolean).join(' · ');
        return `
        <div class="competitor-item" data-stage-name="${s.name}">
            <div class="stage-view">
                <span class="competitor-name">
                    ${s.name}${meta ? ` <em style="color:#888;font-size:0.85em">(${meta})</em>` : ''}
                </span>
                <div class="item-actions">
                    <button class="btn-edit" data-name="${s.name}">Edit</button>
                    <button class="btn-delete" data-name="${s.name}">Remove</button>
                </div>
            </div>
            <div class="stage-edit" style="display:none">
                <input type="text" class="edit-name" value="${s.name}" placeholder="Stage name">
                <select class="edit-type" style="width:180px">
                    <option value="standard_rng"${(s.type || 'standard_rng') === 'standard_rng' ? ' selected' : ''}>Standard RNG Stage</option>
                    <option value="run_time"${s.type === 'run_time' ? ' selected' : ''}>Run Time</option>
                </select>
                <input type="number" class="edit-targets" value="${s.targets}" placeholder="# targets" min="0" style="width:100px${(s.type || 'standard_rng') === 'run_time' ? ';display:none' : ''}">
                <input type="number" class="edit-par" value="${s.par}" placeholder="PAR (s)" min="0" step="0.01" style="width:100px${(s.type || 'standard_rng') === 'run_time' ? ';display:none' : ''}">
                <div class="edit-actions">
                    <button class="btn-save-edit" data-name="${s.name}">Save</button>
                    <button class="btn-cancel-edit">Cancel</button>
                </div>
            </div>
        </div>`;
    }).join('');

    // Remove
    el.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', () => {
            const evNow = getEventById(editingEventId);
            if (!evNow) return;
            evNow.stages = evNow.stages.filter(s => s.name !== btn.dataset.name);
            updateEvent(editingEventId, { stages: evNow.stages });
            renderEditStagesList();
        });
    });

    // Edit → show inline form
    el.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const row = btn.closest('.competitor-item');
            row.querySelector('.stage-view').style.display = 'none';
            row.querySelector('.stage-edit').style.display = '';
            row.querySelector('.edit-name').focus();
        });
    });

    // Cancel edit
    el.querySelectorAll('.btn-cancel-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const row = btn.closest('.competitor-item');
            row.querySelector('.stage-view').style.display = '';
            row.querySelector('.stage-edit').style.display = 'none';
        });
    });

    // Toggle targets/par visibility + default name on type change in inline edit
    el.querySelectorAll('.edit-type').forEach(sel => {
        sel.addEventListener('change', () => {
            const row = sel.closest('.competitor-item');
            const isRT = sel.value === 'run_time';
            row.querySelector('.edit-targets').style.display = isRT ? 'none' : '';
            row.querySelector('.edit-par').style.display     = isRT ? 'none' : '';
            if (isRT) {
                row.querySelector('.edit-targets').value = '';
                row.querySelector('.edit-par').value = '';
                var nameInput = row.querySelector('.edit-name');
                if (!nameInput.value.trim()) nameInput.value = 'Run Time';
            }
        });
    });

    // Save edit
    el.querySelectorAll('.btn-save-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const evNow = getEventById(editingEventId);
            if (!evNow) return;
            const row     = btn.closest('.competitor-item');
            const newName = row.querySelector('.edit-name').value.trim();
            if (!newName) return;
            const oldName = btn.dataset.name;
            if (newName !== oldName && evNow.stages.find(s => s.name === newName)) {
                alert(`Stage "${newName}" already exists.`);
                return;
            }
            const idx = evNow.stages.findIndex(s => s.name === oldName);
            if (idx === -1) return;
            const newType = row.querySelector('.edit-type').value || 'standard_rng';
            if (newType === 'run_time' && (evNow.stages[idx].type || 'standard_rng') !== 'run_time'
                && evNow.stages.some(s => (s.type || 'standard_rng') === 'run_time')) {
                alert('Only one Run Time stage is allowed per event.');
                return;
            }
            evNow.stages[idx] = {
                name: newName,
                type:    newType,
                targets: newType === 'run_time' ? '' : row.querySelector('.edit-targets').value.trim(),
                par:     newType === 'run_time' ? '' : row.querySelector('.edit-par').value.trim()
            };
            updateEvent(editingEventId, { stages: evNow.stages });
            renderEditStagesList();
        });
    });
}