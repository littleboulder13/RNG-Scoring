/* =============================================================
   UI — Render Lists, Dropdowns, Display Helpers
   ============================================================= */

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
                    <span>Wait: ${formatWaitTime(s.waitTime)}</span>
                    <span>TNT: ${s.targetsNotNeutralized}</span>
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

    el.innerHTML = ev.stages.map(s => {
        const meta = [
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
                <input type="number" class="edit-targets" value="${s.targets}" placeholder="# targets" min="0" style="width:100px">
                <input type="number" class="edit-par" value="${s.par}" placeholder="PAR (s)" min="0" step="0.01" style="width:100px">
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
            evNow.stages[idx] = {
                name: newName,
                targets: row.querySelector('.edit-targets').value.trim(),
                par:     row.querySelector('.edit-par').value.trim()
            };
            updateEvent(editingEventId, { stages: evNow.stages });
            renderEditStagesList();
        });
    });
}